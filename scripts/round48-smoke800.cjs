// Round 48 smoke at 1280×800 (previous rounds' baseline viewport) — verify
// bigger cards + stack default state survive a shorter screen.
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

  await page.goto('http://localhost:5174', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.waitForTimeout(1200);

  // seed 6 diaries (light: thumbnail only — sharpness is covered by the main script)
  await page.evaluate(async () => {
    const open = () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('particle_diary_db', 1);
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
    for (let i = 0; i < 6; i++) {
      store.put({
        _schemaVersion: 2, id: 'seed-' + i, title: '测试日记 ' + i, date: '2026-08-14',
        content: '内容 ' + i, chatHistory: [], thumbnailBlob: thumb, imageRef: null,
        createdAt: now - i * 1000, updatedAt: now - i * 1000,
      });
    }
    return new Promise((resolve) => { tx.oncomplete = () => resolve(true); tx.onerror = () => resolve(false); });
  });

  await page.locator('button:has-text("回到我的记忆")').first().click();
  await page.waitForTimeout(2200);

  const cardInfo = (i) => page.evaluate((idx) => {
    const img = document.querySelector(`img[alt="测试日记 ${idx}"]`);
    if (!img) return null;
    const w = img.closest('button').parentElement;
    const r = w.getBoundingClientRect();
    const cs = getComputedStyle(w);
    const m = cs.transform.match(/matrix\(([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^,]+)/);
    return { x: r.x, y: r.y, w: r.width, h: r.height, scale: m ? parseFloat(m[1]) : 1, ty: m ? parseFloat(m[6]) : 0, z: parseInt(cs.zIndex, 10) || 0 };
  }, i);

  // corridor: adaptive height (fits 800p), still 420 wide, no clip of current card
  await page.waitForTimeout(500);
  const cc0 = await cardInfo(0);
  check('800p corridor card 420 wide', cc0 && Math.abs(cc0.w - 420) < 3, `w=${cc0 && cc0.w.toFixed(0)}`);
  check('800p corridor current card fully inside viewport',
    cc0 && cc0.y >= 0 && cc0.y + cc0.h <= 800, `y=${cc0 && cc0.y.toFixed(0)} h=${cc0 && cc0.h.toFixed(0)} bottom=${cc0 && (cc0.y + cc0.h).toFixed(0)}`);

  // stack: default all scale 1, card0 topmost + bottom-left + bottom on screen
  await page.locator('button[aria-label="叠影模式"]').click();
  await page.waitForTimeout(1100);
  const def = [];
  for (let i = 0; i < 6; i++) def.push(await cardInfo(i));
  check('800p stack default all scale 1', def.every((c) => c && Math.abs(c.scale - 1) < 0.01), def.map((c) => c.scale.toFixed(2)).join(','));
  check('800p stack card0 topmost (z6)', def[0].z === 6 && def[5].z === 1, `z0=${def[0].z} z5=${def[5].z}`);
  check('800p stack card0 bottom-left of card5', def[0].y > def[5].y && def[0].x < def[5].x,
    `c0=(${def[0].x.toFixed(0)},${def[0].y.toFixed(0)}) c5=(${def[5].x.toFixed(0)},${def[5].y.toFixed(0)})`);
  check('800p stack card0 bottom edge inside viewport', def[0].y + def[0].h <= 780,
    `bottom=${(def[0].y + def[0].h).toFixed(0)}`);
  const dX = (def[5].x - def[0].x) / 5;
  const dY = (def[0].y - def[5].y) / 5;
  check('800p stack step still 90/70', dX > 86 && dX < 94 && dY > 66 && dY < 74, `dX=${dX.toFixed(1)} dY=${dY.toFixed(1)}`);

  // hover the top-right card's VISIBLE strip (its top is clipped at 800p;
  // the strip x ∈ (card4.right, card5.right] = (955, 1045], y ∈ [178, 404])
  await page.mouse.move(1000, 300);
  await page.waitForTimeout(380);
  const s5 = await cardInfo(5);
  check('800p stack hover top card works', s5 && s5.scale > 1.05, `scale=${s5 && s5.scale}`);

  // grid
  await page.locator('button[aria-label="网格模式"]').click();
  await page.waitForTimeout(600);
  const gridCols = await page.evaluate(() => {
    const g = [...document.querySelectorAll('div')].find((d) => (d.style.gridTemplateColumns || '').includes('minmax'));
    return g ? g.style.gridTemplateColumns : '';
  });
  check('800p grid columns 300px', gridCols.includes('300px'), gridCols);

  check('no console errors', errors.length === 0, errors.slice(0, 3).join('; '));
  await browser.close();
  console.log('== DONE ==');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
