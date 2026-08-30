// Round 42 self-test: 继续上传直达、标题去重、gallery 三模式、auto-hide、
// storage & landing regressions.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  const check = (name, pass, detail = '') =>
    console.log(`${pass ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);

  // mock AI greeting SSE
  const SSE_REPLY =
    'data: {"type":"chunk","content":"你好呀，这张照片真好看。"}\n\ndata: {"type":"done"}\n\n';
  await page.route('**/api/chat', (r) =>
    r.fulfill({ status: 200, contentType: 'text/event-stream', body: SSE_REPLY }),
  );

  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.waitForTimeout(2200);

  // --- 1. 继续上传 → file picker → straight to chat (no upload page) ---
  const picker = await page.evaluate(() => {
    const inp = document.querySelector('input[type="file"]');
    if (!inp) return null;
    return { accept: inp.getAttribute('accept'), hidden: inp.className.includes('hidden') };
  });
  check('landing has hidden file picker (accept jpeg/png/webp)',
    !!picker && /image\/jpeg,image\/png,image\/webp/.test(picker.accept),
    JSON.stringify(picker));

  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 320; c.height = 240;
    const g = c.getContext('2d');
    g.fillStyle = '#d4a853'; g.fillRect(0, 0, 320, 240);
    g.fillStyle = '#fff'; g.fillText('hi', 140, 120);
    return c.toDataURL('image/jpeg');
  });
  const imgBuffer = Buffer.from(dataUrl.split(',')[1], 'base64');
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'r42.jpg', mimeType: 'image/jpeg', buffer: imgBuffer,
  });
  await page.waitForTimeout(2500); // processing + AI greeting

  const afterUpload = await page.evaluate(() => {
    const hasUploadZone = document.body.innerText.includes('上传一张照片');
    const hasChatInput = !!document.querySelector('textarea');
    const hasParticle = !!document.querySelector('canvas'); // chat particle layer present
    const titleCount = (document.body.innerText.match(/小董\s*的念念/g) || []).length;
    return { hasUploadZone, hasChatInput, hasParticle, titleCount };
  });
  check('skips upload page (no 上传一张照片)', !afterUpload.hasUploadZone,
    `uploadZone=${afterUpload.hasUploadZone}`);
  check('enters chat with particle + input', afterUpload.hasChatInput && afterUpload.hasParticle,
    `chatInput=${afterUpload.hasChatInput} particle=${afterUpload.hasParticle}`);

  // --- 2. Chat page: only ONE title (the global auto-hiding Logo) ---
  check('chat page has exactly one 小董 的念念 (duplicate removed)',
    afterUpload.titleCount === 1, `count=${afterUpload.titleCount}`);

  // --- 3. Gallery: search moved below logo + three distinct modes ---
  // Seed one v2 diary so corridor/stack/grid have cards to show.
  await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('particle_diary_db');
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('diaries')) {
          const s = db.createObjectStore('diaries', { keyPath: 'id' });
          s.createIndex('by_createdAt', 'createdAt');
          s.createIndex('by_date', 'date');
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('diaries', 'readwrite');
        const now = Date.now();
        tx.objectStore('diaries').put({
          _schemaVersion: 2, id: 'r42-demo', title: '海边的一天', date: '2026-08-14',
          content: '测试日记内容', chatHistory: [],
          imageRef: null,
          thumbnailBlob: new Blob([new Uint8Array([255, 216, 255, 224])], { type: 'image/jpeg' }),
          createdAt: now, updatedAt: now,
        });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.locator('button:has-text("回到我的记忆")').first().click();
  await page.waitForTimeout(1600);

  const searchPos = await page.evaluate(() => {
    const inp = document.querySelector('input[placeholder*="搜索"]');
    const logo = document.querySelector('button[aria-label="返回首页"]');
    if (!inp || !logo) return null;
    const ir = inp.getBoundingClientRect();
    const lr = logo.getBoundingClientRect();
    return { searchTop: Math.round(ir.top), logoBottom: Math.round(lr.bottom), clearGap: ir.top - lr.bottom };
  });
  check('search box below the logo (no overlap)', !!searchPos && searchPos.clearGap > 0,
    searchPos ? `searchTop=${searchPos.searchTop} logoBottom=${searchPos.logoBottom} gap=${searchPos.clearGap}px` : '');

  // corridor (default) — mode buttons present via aria-label
  const modes = await page.evaluate(() =>
    [...document.querySelectorAll('button[aria-label*="模式"]')].map((b) => b.getAttribute('aria-label')));
  check('three mode buttons present',
    modes.includes('长廊模式') && modes.includes('叠影模式') && modes.includes('网格模式'),
    modes.join(','));
  // corridor: current card centered with side offsets (transform on cards)
  const corridor = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('button')].filter(b =>
      b.className.includes('group') && b.getBoundingClientRect().height > 200);
    const transforms = cards.map(c => getComputedStyle(c.parentElement).transform).filter(t => t && t !== 'none');
    return { cards: cards.length, transformed: transforms.length };
  });
  check('corridor lays out cards (cover-flow transform)',
    corridor.cards >= 1 && corridor.transformed >= 1,
    JSON.stringify(corridor));

  // switch to grid → CSS Grid layout
  await page.locator('button[aria-label="网格模式"]').click();
  await page.waitForTimeout(500);
  const gridOk = await page.evaluate(() =>
    [...document.querySelectorAll('div')].some((d) => getComputedStyle(d).display === 'grid'));
  check('grid mode uses CSS Grid', gridOk);

  // switch to stack → absolute deck of cards
  await page.locator('button[aria-label="叠影模式"]').click();
  await page.waitForTimeout(500);
  const stackOk = await page.evaluate(() =>
    [...document.querySelectorAll('div')].some((d) => {
      const cs = getComputedStyle(d);
      return cs.position === 'absolute' && d.getBoundingClientRect().width > 200;
    }));
  check('stack mode piles cards (absolute overlay)', stackOk);

  // back to corridor for the auto-hide test
  await page.locator('button[aria-label="长廊模式"]').click();
  await page.waitForTimeout(400);

  // --- 4. Auto-hide: 4s stillness → chrome fades, images stay ---
  const headerOpacity = () => page.evaluate(() => {
    const inp = document.querySelector('input[placeholder*="搜索"]');
    const header = inp ? inp.closest('header') : null;
    return header ? parseFloat(getComputedStyle(header).opacity) : -1;
  });
  await page.mouse.move(640, 400);
  await page.waitForTimeout(500);
  const chromeVisible = await headerOpacity();
  await page.waitForTimeout(4300); // > 4s stillness
  const chromeHidden = await headerOpacity();
  await page.mouse.move(200, 300);
  await page.waitForTimeout(600); // 400ms ease-in transition
  const chromeBack = await headerOpacity();
  check('auto-hide: chrome visible → hidden after 4s → back on move',
    chromeVisible > 0.9 && chromeHidden < 0.2 && chromeBack > 0.9,
    `before=${chromeVisible} after4s=${chromeHidden} onMove=${chromeBack}`);

  // --- 5. Storage + landing regression ---
  await page.locator('button[aria-label="返回首页"]').click();
  await page.waitForTimeout(1200);
  const landing = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const g = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = c.width, h = c.height;
    const img = g.getImageData(0, 0, w, h).data;
    const cx = w / 2;
    const p = document.querySelector('p');
    const cy = p ? p.getBoundingClientRect().top + p.getBoundingClientRect().height / 2 : h / 2;
    let n = 0;
    for (let y = (cy - 55) * dpr; y <= (cy + 55) * dpr; y += 2) {
      for (let x = cx - 80; x <= cx + 80; x += 2) {
        if (img[(y * w + x) * 4 + 3] >= 6) n++;
      }
    }
    return n;
  });
  check('landing particles intact', landing > 200, `density=${landing}`);

  const realErrors = errors.filter((e) => !e.includes('ERR_FILE_NOT_FOUND'));
  check('no console errors', realErrors.length === 0, realErrors.slice(0, 2).join('; '));

  await browser.close();
  console.log('== DONE ==');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
