// Round 50 smoke at 1280×800 — cascade/reverse/tilt/hover survive a short
// screen (smaller W → smaller adaptive stepX, no clipping).
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
    for (let i = 0; i < 7; i++) store.put({
      _schemaVersion: 2, id: 's-' + i, title: '测试日记 ' + i, date: '2026-08-14',
      content: 'c', chatHistory: [], thumbnailBlob: thumb, imageRef: null,
      createdAt: now - i * 1000, updatedAt: now - i * 1000,
    });
    return new Promise((res) => { tx.oncomplete = () => res(true); tx.onerror = () => res(false); });
  });
  await page.locator('button:has-text("回到我的记忆")').first().click();
  await page.waitForTimeout(2200);
  await page.locator('button[aria-label="叠影模式"]').click();
  await page.waitForTimeout(1300);

  const geo = (i) => page.evaluate((idx) => {
    const img = document.querySelector(`img[alt="测试日记 ${idx}"]`);
    const w = img.closest('button').parentElement;
    const r = w.getBoundingClientRect();
    const cs = getComputedStyle(w);
    const m3 = cs.transform.match(/matrix3d\(([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^,]+)/);
    const m2 = cs.transform.match(/matrix\(([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^,]+)/);
    return {
      x: r.x, y: r.y, w: r.width, h: r.height,
      tx: m3 ? parseFloat(m3[13]) : m2 ? parseFloat(m2[5]) : 0,
      ty: m3 ? parseFloat(m3[14]) : m2 ? parseFloat(m2[6]) : 0,
      m11: m3 ? parseFloat(m3[1]) : m2 ? parseFloat(m2[1]) : 1,
      opacity: parseFloat(cs.opacity),
    };
  }, i);
  const meta = () => page.evaluate(() => document.querySelector('[data-testid="bottom-meta"]').textContent);
  const clearHover = async () => { await page.mouse.move(30, 30); await page.waitForTimeout(400); };

  // default: 7 cards, no right-edge clip, tilt, front card on screen
  const g0 = await geo(0), g6 = await geo(6);
  check('800p front card anchored + on screen', Math.abs(g0.tx - (-120)) < 6 && g0.y + g0.h <= 800, `tx=${g0.tx.toFixed(0)} bottom=${(g0.y + g0.h).toFixed(0)}`);
  check('800p last card fully inside (right < 1280)', g6.x + g6.w <= 1280, `right=${(g6.x + g6.w).toFixed(0)}`);
  check('800p tilt applied (cos22°≈0.927)', Math.abs(g0.m11 - 0.927) < 0.03, `m11=${g0.m11.toFixed(3)}`);

  // wheel down → cascade, gone card fly-off + fade
  await page.mouse.move(640, 400); await page.mouse.wheel(0, 120); await page.waitForTimeout(1400);
  await clearHover();
  const g0g = await geo(0);
  check('800p wheel down → gone card fly-off + opacity 0', Math.abs(g0g.tx - (-540)) < 6 && g0g.opacity < 0.05, `tx=${g0g.tx.toFixed(0)} op=${g0g.opacity}`);
  check('800p meta 2 / 7', (await meta()).includes('2 / 7'), (await meta()).trim());

  // wheel up → reverse back
  await page.mouse.move(640, 400); await page.mouse.wheel(0, -120); await page.waitForTimeout(1400);
  await clearHover();
  const g0r = await geo(0);
  check('800p wheel up → back to anchor opacity 1', Math.abs(g0r.tx - (-120)) < 6 && g0r.opacity > 0.85, `tx=${g0r.tx.toFixed(0)} op=${g0r.opacity}`);
  check('800p meta 1 / 7', (await meta()).includes('1 / 7'), (await meta()).trim());

  // hover a middle card after the round trip
  const h0 = await geo(0), h1 = await geo(1);
  const pts = [];
  for (let i = 0; i < 5; i++) {
    const gi = await geo(i);
    if (i === 0) pts.push([i, gi.x + gi.w / 2, gi.y + gi.h / 2]);
    else { const gp = await geo(i - 1); pts.push([i, (gp.x + gp.w + gi.x + gi.w) / 2, gi.y + gi.h / 2]); }
  }
  await page.mouse.move(pts[2][1], pts[2][2]);
  await page.waitForTimeout(800);
  const s2 = await geo(2);
  check('800p hover middle card straightens + raises', s2.m11 > 0.99 && s2.m11 < 1.15, `m11=${s2.m11.toFixed(2)}`);

  check('no console errors', errors.length === 0, errors.slice(0, 3).join('; '));
  console.log('== DONE ==');
  browser.close().catch(() => {});
  setTimeout(() => process.exit(0), 200);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
