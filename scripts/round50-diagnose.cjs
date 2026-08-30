// Diagnose: does useSpring(sp) keep following p across MULTIPLE wheel steps?
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto('http://localhost:5174', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.waitForTimeout(1200);
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
    for (let i = 0; i < 10; i++) store.put({
      _schemaVersion: 2, id: 'd-' + i, title: '测试日记 ' + i, date: '2026-08-14',
      content: 'c', chatHistory: [], thumbnailBlob: thumb, imageRef: null,
      createdAt: now - i * 1000, updatedAt: now - i * 1000,
    });
    return new Promise((res) => { tx.oncomplete = () => res(true); tx.onerror = () => res(false); });
  });
  await page.locator('button:has-text("回到我的记忆")').first().click();
  await page.waitForTimeout(2200);
  await page.locator('button[aria-label="叠影模式"]').click();
  await page.waitForTimeout(1200);

  const meta = () => page.evaluate(() => document.querySelector('[data-testid="bottom-meta"]').textContent);
  const geo = (i) => page.evaluate((idx) => {
    const img = document.querySelector(`img[alt="测试日记 ${idx}"]`);
    const w = img.closest('button').parentElement;
    const r = w.getBoundingClientRect();
    const cs = getComputedStyle(w);
    const m = cs.transform.match(/matrix3d\(([^,]+)/);
    return { opacity: parseFloat(cs.opacity), scale: m ? parseFloat(m[1]) : 1, x: r.x, y: r.y, w: r.width, h: r.height };
  }, i);
  // EXACT self-test sequence with 10 cards
  await page.mouse.move(800, 500); await page.mouse.wheel(0, 120); await page.waitForTimeout(1400); // down#1 (cascade)
  await page.mouse.move(1500, 700); await page.waitForTimeout(350); // clear hover
  const s0 = await geo(0);
  console.log('cascade settle: card0 tx-ish scale=', s0.scale, 'op=', s0.opacity, ' meta=', (await meta()).trim().slice(0, 34));
  await page.mouse.move(800, 500); await page.mouse.wheel(0, -120); await page.waitForTimeout(1400); // up#1, mouse ON card
  await page.mouse.move(300, 900); await page.waitForTimeout(350); // move OUT of root → onMouseLeave
  await page.waitForTimeout(500);
  const r0 = await geo(0);
  console.log('reverse(footer-clear): card0 op=', r0.opacity, 'scale=', r0.scale, ' meta=', (await meta()).trim().slice(0, 34));
  // HOVER repro: move to card0's box center, wait, read card0's scale
  const g0b = await geo(0);
  const cx = g0b.x + g0b.w / 2, cy = g0b.y + g0b.h / 2;
  console.log('card0 box center =', cx.toFixed(0), cy.toFixed(0));
  await page.mouse.move(cx, cy);
  await page.waitForTimeout(600);
  const h0 = await geo(0), h1 = await geo(1);
  console.log('PLAYWRIGHT move → card0 scale=', h0.scale, 'op=', h0.opacity, '| card1 scale=', h1.scale);
  // now dispatch a raw mousemove at the SAME viewport point via the stage div
  await page.evaluate(({ px, py }) => {
    const stage = [...document.querySelectorAll('div')].find((d) => getComputedStyle(d).perspective && getComputedStyle(d).perspective !== 'none');
    if (!stage) return 'no-stage';
    const r = stage.getBoundingClientRect();
    stage.dispatchEvent(new MouseEvent('mousemove', { clientX: r.left + px, clientY: r.top + py, bubbles: true }));
    return 'dispatched';
  }, { px: cx, py: cy });
  await page.waitForTimeout(600);
  const d0 = await geo(0);
  console.log('DISPATCH move → card0 scale=', d0.scale, 'op=', d0.opacity);
  console.log('DONE');
  browser.close().catch(() => {});
  setTimeout(() => process.exit(0), 200);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
