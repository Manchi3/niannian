// Round 43 self-test — DiaryGallery: no particle cloud, 3s sync auto-hide
// (Logo + chrome together), centered filters, stack hover highlight.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|net::|Failed to load resource/i.test(m.text())) errors.push(m.text());
  });

  const check = (name, pass, detail = '') =>
    console.log(`${pass ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);

  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.waitForTimeout(1500);

  // --- Seed 3 v2 diaries directly into IndexedDB ---
  const seeded = await page.evaluate(async () => {
    const open = () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('particle_diary_db', 1);
        // The app only creates the DB when a page opens it — create the
        // store here if it does not exist yet (mirrors db.ts).
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('diaries')) {
            const store = db.createObjectStore('diaries', { keyPath: 'id' });
            store.createIndex('by_createdAt', 'createdAt');
            store.createIndex('by_date', 'date');
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    const db = await open();
    const tx = db.transaction('diaries', 'readwrite');
    const store = tx.objectStore('diaries');
    const now = Date.now();
    const thumb = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'image/png' });
    for (let i = 0; i < 3; i++) {
      store.put({
        _schemaVersion: 2,
        id: 'seed-' + i,
        title: '测试日记 ' + i,
        date: '2026-08-14',
        content: '内容 ' + i,
        chatHistory: [],
        thumbnailBlob: thumb,
        imageRef: null,
        createdAt: now - i * 1000,
        updatedAt: now - i * 1000,
      });
    }
    return new Promise((resolve) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  });
  check('seed 3 diaries into IDB', seeded === true, `seeded=${seeded}`);

  // --- Go to gallery ---
  await page.locator('button:has-text("回到我的记忆")').first().click();
  await page.waitForTimeout(2200);

  // 1. NO particle canvas on the memory list page
  const canvases = await page.evaluate(() => document.querySelectorAll('canvas').length);
  check('no particle canvas on gallery', canvases === 0, `canvases=${canvases}`);

  // 2. Logo + chrome fade together after 3s stillness, back on move
  const readOpacities = () =>
    page.evaluate(() => {
      const logo = document.querySelector('button[aria-label="返回首页"]');
      const inp = document.querySelector('input[placeholder*="搜索"]');
      return {
        logo: logo ? getComputedStyle(logo).opacity : 'no-logo',
        header: inp ? getComputedStyle(inp.closest('header')).opacity : 'no-header',
      };
    });
  await page.mouse.move(640, 400); // reset timers
  await page.waitForTimeout(300);
  const before = await readOpacities();
  await page.waitForTimeout(3300); // > 3s stillness
  const after = await readOpacities();
  check('logo + chrome visible before', parseFloat(before.logo) > 0.9 && parseFloat(before.header) > 0.9, JSON.stringify(before));
  check('logo + chrome both fade after 3s', parseFloat(after.logo) < 0.2 && parseFloat(after.header) < 0.2, JSON.stringify(after));
  await page.mouse.move(200, 300);
  await page.waitForTimeout(600);
  const back = await readOpacities();
  check('logo + chrome reappear on move', parseFloat(back.logo) > 0.9 && parseFloat(back.header) > 0.9, JSON.stringify(back));

  // 3. Filters horizontally centered at the top, clear of the search box
  const filterInfo = await page.evaluate(() => {
    const nav = [...document.querySelectorAll('nav')].find((x) => x.textContent && x.textContent.includes('全部'));
    if (!nav) return null;
    const r = nav.getBoundingClientRect();
    const inp = document.querySelector('input[placeholder*="搜索"]');
    const ir = inp ? inp.getBoundingClientRect() : null;
    return { cx: r.left + r.width / 2, vw: window.innerWidth, gap: ir ? r.left - ir.right : -1 };
  });
  check(
    'filters centered at top (clear of search)',
    !!filterInfo && Math.abs(filterInfo.cx - filterInfo.vw / 2) < 12 && filterInfo.gap > 0,
    filterInfo ? `navCx=${filterInfo.cx.toFixed(0)} vw/2=${filterInfo.vw / 2} gap=${filterInfo.gap.toFixed(0)}` : 'no nav',
  );

  // 4. Stack mode — all cards visible, hover lifts one + golden glow
  await page.locator('button[aria-label="叠影模式"]').click();
  await page.waitForTimeout(600);
  const stackCount = await page.locator('button:has-text("测试日记")').count();
  check('stack shows all cards', stackCount === 3, `cards=${stackCount}`);

  await page.locator('button:has-text("测试日记")').nth(1).hover();
  await page.waitForTimeout(500);
  const hoverState = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')].filter((b) => b.textContent && b.textContent.includes('测试日记'));
    return btns.map((b) => {
      const w = b.parentElement;
      const cs = getComputedStyle(w);
      return { opacity: parseFloat(cs.opacity), shadow: cs.boxShadow };
    });
  });
  const lifted = hoverState.filter((h) => h.opacity > 0.9);
  const dimmed = hoverState.filter((h) => h.opacity < 0.5);
  check('hover lifts ONE card (opacity 1)', lifted.length === 1 && dimmed.length === 2,
    hoverState.map((h) => h.opacity.toFixed(2)).join(','));
  check('hovered card has golden glow', lifted.length === 1 && lifted[0].shadow.includes('212, 168, 83'),
    lifted[0] ? lifted[0].shadow : '');

  // leave the deck → all restore to ~0.88 opacity
  await page.mouse.move(400, 60); // over the header (outside the deck)
  await page.waitForTimeout(500);
  const restored = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')].filter((b) => b.textContent && b.textContent.includes('测试日记'));
    return btns.map((b) => parseFloat(getComputedStyle(b.parentElement).opacity));
  });
  check('deck restores after leave', restored.length === 3 && restored.every((o) => o > 0.8 && o < 1),
    restored.map((o) => o.toFixed(2)).join(','));

  // 5. Corridor + grid still work
  await page.locator('button[aria-label="长廊模式"]').click();
  await page.waitForTimeout(500);
  const corridorOk = await page.locator('button:has-text("测试日记")').count();
  check('corridor mode intact', corridorOk === 3, `cards=${corridorOk}`);
  await page.locator('button[aria-label="网格模式"]').click();
  await page.waitForTimeout(500);
  const gridOk = await page.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find((d) => getComputedStyle(d).display === 'grid' && d.children.length > 1);
    return !!el;
  });
  check('grid mode intact (CSS Grid)', gridOk);

  // 6. Landing still has the particle cloud
  await page.mouse.move(640, 300);
  await page.waitForTimeout(200);
  await page.locator('button[aria-label="返回首页"]').click();
  await page.waitForTimeout(1600);
  const landingCanvas = await page.evaluate(() => document.querySelectorAll('canvas').length);
  check('landing still has particle cloud', landingCanvas > 0, `canvases=${landingCanvas}`);

  // 7. Chat page still has the particle cloud (via 继续上传 filechooser)
  const fcPromise = page.waitForEvent('filechooser');
  await page.locator('button:has-text("继续上传")').first().click();
  const fc = await fcPromise;
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 240;
    const g = c.getContext('2d');
    g.fillStyle = '#d4a853';
    g.fillRect(0, 0, 320, 240);
    g.fillStyle = '#fff';
    g.fillText('hi', 140, 120);
    return c.toDataURL('image/jpeg').split(',')[1];
  });
  await fc.setFiles({ name: 't.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') });
  await page.waitForTimeout(4000);
  const chatCanvas = await page.evaluate(() => document.querySelectorAll('canvas').length);
  check('chat page has particle cloud after upload', chatCanvas > 0, `canvases=${chatCanvas}`);

  check('no console errors', errors.length === 0, errors.slice(0, 3).join('; '));

  await browser.close();
  console.log('== DONE ==');
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
