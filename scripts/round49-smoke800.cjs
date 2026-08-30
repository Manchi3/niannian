// Round 49 smoke at 1280×800 — wheel direction + slide + fade + hover hold up
// on a shorter screen (biasY changes, math must follow).
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const check = (name, pass, detail = '') =>
    console.log(`${pass ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);

  await page.goto('http://localhost:5174', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.waitForTimeout(1000);
  await page.evaluate(async () => {
    const open = () => new Promise((res, rej) => {
      const r = indexedDB.open('particle_diary_db', 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('diaries')) {
          const s = db.createObjectStore('diaries', { keyPath: 'id' });
          s.createIndex('by_createdAt', 'createdAt');
        }
      };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    const db = await open();
    const tx = db.transaction('diaries', 'readwrite');
    const store = tx.objectStore('diaries');
    const now = Date.now();
    const thumb = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
    for (let i = 0; i < 6; i++) store.put({
      _schemaVersion: 2, id: 's-' + i, title: '测试日记 ' + i, date: '2026-08-14',
      content: 'c', chatHistory: [], thumbnailBlob: thumb, imageRef: null,
      createdAt: now - i * 1000, updatedAt: now - i * 1000,
    });
    return new Promise((res) => { tx.oncomplete = () => res(true); tx.onerror = () => res(false); });
  });
  await page.locator('button:has-text("回到我的记忆")').first().click();
  await page.waitForTimeout(2200);
  await page.locator('button[aria-label="叠影模式"]').click();
  await page.waitForTimeout(1100);

  const geo = (i) => page.evaluate((idx) => {
    const img = document.querySelector(`img[alt="测试日记 ${idx}"]`);
    const w = img.closest('button').parentElement;
    const r = w.getBoundingClientRect();
    const cs = getComputedStyle(w);
    const m = cs.transform.match(/matrix\(([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^,]+)/);
    return { x: r.x, y: r.y, tx: m ? parseFloat(m[5]) : 0, ty: m ? parseFloat(m[6]) : 0, scale: m ? parseFloat(m[1]) : 1, opacity: parseFloat(cs.opacity) };
  }, i);

  const g0 = await geo(0);
  check('800p default: scale 1', Math.abs(g0.scale - 1) < 0.01, `s=${g0.scale}`);
  check('800p default: card0 fully inside viewport', g0.y >= 0 && g0.y + 460 <= 800, `y=${g0.y.toFixed(0)} bottom=${(g0.y + 460).toFixed(0)}`);

  // wheel down ×1 → left −220 / down +150
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(700);
  await page.mouse.move(1200, 400); // clear hover
  await page.waitForTimeout(350);
  const g1 = await geo(0);
  check('800p wheel down → slides left/down', Math.abs(g1.tx - (g0.tx - 220)) < 4 && Math.abs(g1.ty - (g0.ty + 150)) < 4,
    `tx ${g0.tx.toFixed(0)}→${g1.tx.toFixed(0)} ty ${g0.ty.toFixed(0)}→${g1.ty.toFixed(0)}`);

  // wheel down ×3 more → fade ~0.08
  for (let k = 0; k < 3; k++) { await page.mouse.move(640, 400); await page.mouse.wheel(0, 120); await page.waitForTimeout(250); }
  await page.waitForTimeout(700);
  await page.mouse.move(1200, 400);
  await page.waitForTimeout(350);
  const g4 = await geo(0);
  check('800p fade to ~0.08 at offset=4', g4.opacity >= 0.06 && g4.opacity <= 0.12, `op=${g4.opacity}`);

  // wheel up ×4 → back to origin, clamp
  for (let k = 0; k < 4; k++) { await page.mouse.move(640, 400); await page.mouse.wheel(0, -120); await page.waitForTimeout(250); }
  await page.waitForTimeout(700);
  await page.mouse.move(1200, 400);
  await page.waitForTimeout(350);
  const gBack = await geo(0);
  check('800p wheel up ×4 → restored', Math.abs(gBack.tx - g0.tx) < 4 && Math.abs(gBack.ty - g0.ty) < 4,
    `tx=${gBack.tx.toFixed(0)} ty=${gBack.ty.toFixed(0)}`);

  check('no console errors', errors.length === 0, errors.slice(0, 3).join('; '));
  console.log('== DONE ==');
  browser.close().catch(() => {});
  setTimeout(() => process.exit(0), 200);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
