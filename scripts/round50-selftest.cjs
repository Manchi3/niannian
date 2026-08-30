// Round 50 self-test — stack rel continuous model: cascade ripple (delay),
// reverse on scroll-up, adaptive step (no clip at 10 cards), book-shelf
// rotateY tilt, collision on live coords, hover precision.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
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

  // seed 10 diaries; seed-0 carries a real 800×600 original (sharpness check)
  await page.evaluate(async () => {
    const open = () => new Promise((res, rej) => {
      const r = indexedDB.open('particle_diary_db', 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('diaries')) {
          const s = db.createObjectStore('diaries', { keyPath: 'id' });
          s.createIndex('by_createdAt', 'createdAt');
          s.createIndex('by_date', 'date');
        }
      };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    const c = document.createElement('canvas');
    c.width = 800; c.height = 600;
    const g = c.getContext('2d');
    g.fillStyle = '#c8764a'; g.fillRect(0, 0, 800, 600);
    g.fillStyle = '#1b140f'; g.fillRect(80, 90, 320, 50);
    const original = await new Promise((r2) => c.toBlob(r2, 'image/png'));
    const db = await open();
    const tx = db.transaction('diaries', 'readwrite');
    const store = tx.objectStore('diaries');
    const now = Date.now();
    const thumb = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
    for (let i = 0; i < 10; i++) store.put({
      _schemaVersion: 2, id: 'seed-' + i, title: '测试日记 ' + i, date: '2026-08-14',
      content: 'c', chatHistory: [],
      thumbnailBlob: thumb, imageRef: i === 0 ? 'idb:' : null,
      legacyImageBlob: i === 0 ? original : undefined,
      createdAt: now - i * 1000, updatedAt: now - i * 1000,
    });
    return new Promise((res) => { tx.oncomplete = () => res(true); tx.onerror = () => res(false); });
  });

  await page.locator('button:has-text("回到我的记忆")').first().click();
  await page.waitForTimeout(2600);
  await page.locator('button[aria-label="叠影模式"]').click();
  await page.waitForTimeout(1400); // let mount spring settle

  const geo = (i) => page.evaluate((idx) => {
    const img = document.querySelector(`img[alt="测试日记 ${idx}"]`);
    if (!img) return null;
    const w = img.closest('button').parentElement;
    const r = w.getBoundingClientRect();
    const cs = getComputedStyle(w);
    // matrix3d(m11,...) or matrix(a,b,c,d,tx,ty)
    const m3 = cs.transform.match(/matrix3d\(([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^,]+)/);
    const m2 = cs.transform.match(/matrix\(([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^,]+)/);
    return {
      x: r.x, y: r.y, w: r.width, h: r.height,
      tx: m3 ? parseFloat(m3[13]) : m2 ? parseFloat(m2[5]) : 0,
      ty: m3 ? parseFloat(m3[14]) : m2 ? parseFloat(m2[6]) : 0,
      m11: m3 ? parseFloat(m3[1]) : m2 ? parseFloat(m2[1]) : 1, // cos(rotateY)
      scale: m3 ? parseFloat(m3[1]) : m2 ? parseFloat(m2[1]) : 1,
      opacity: parseFloat(cs.opacity),
    };
  }, i);

  const meta = () => page.evaluate(() => document.querySelector('[data-testid="bottom-meta"]').textContent);
  const wheelAt = async (x, y, dy, wait = 700) => { await page.mouse.move(x, y); await page.mouse.wheel(0, dy); await page.waitForTimeout(wait); };
  // Move OUT of the stack root (top-left corner, above the header) → root
  // onMouseLeave → setHovered(null) — bulletproof clear. (A point inside the
  // root but outside the stage div receives NEITHER stage mousemove NOR root
  // mouseleave, leaving a stale hover.)
  const clearHover = async () => { await page.mouse.move(30, 30); await page.waitForTimeout(400); };

  // ==== 1. Default stack (10 cards): front card anchored, tilt, no clip ====
  log('--- Default (10 cards) ---');
  const g0 = await geo(0), g9 = await geo(9);
  check('front card anchored bottom-left (tx=-120)', Math.abs(g0.tx - (-120)) < 5, `tx=${g0.tx.toFixed(0)}`);
  check('front card bottom fully inside viewport', g0.y + g0.h <= 1000, `bottom=${(g0.y + g0.h).toFixed(0)}`);
  // adaptive step: 10 cards → stepX ≈ W*0.42/9 ≈ 74.7 (compressed from 90)
  const g1 = await geo(1);
  const stepX = g1.x - g0.x;
  check('adaptive stepX compressed (~74.7 for 10 cards)', stepX > 68 && stepX < 82, `stepX=${stepX.toFixed(1)}`);
  check('last card fully inside screen (right edge < W−40)', g9.x + g9.w <= 1560, `right=${(g9.x + g9.w).toFixed(0)}`);
  // book-shelf tilt: n=10 → tilt −22 → m11 = cos(22°) ≈ 0.927
  check('book-shelf rotateY tilt applied (cos22°≈0.927)', Math.abs(g0.m11 - 0.927) < 0.03, `m11=${g0.m11.toFixed(3)}`);
  check('default meta 1 / 10', (await meta()).includes('1 / 10'), (await meta()).trim());

  // ==== 2. CASCADE ripple: scroll down 1 step, read mid-flight (110ms) ====
  log('--- Cascade ripple ---');
  const before = [];
  for (let i = 0; i < 4; i++) before.push(await geo(i));
  await page.mouse.move(800, 500);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(110); // front + second (delay 0) moving; deeper delayed
  const mid = [];
  for (let i = 0; i < 4; i++) mid.push(await geo(i));
  const moved = (i) => Math.abs(mid[i].tx - before[i].tx);
  check('cascade: front card moves most at t≈110ms', moved(0) > 40, `Δ0=${moved(0).toFixed(0)}`);
  check('cascade: ripple order Δ1 > Δ2 > Δ3 (deeper starts later)',
    moved(1) > moved(2) && moved(2) > moved(3),
    `Δ1=${moved(1).toFixed(0)} Δ2=${moved(2).toFixed(0)} Δ3=${moved(3).toFixed(0)}`);
  // settle → exact staircase slots; gone card fully transparent at fly-off spot
  await page.waitForTimeout(1300);
  await clearHover();
  const s0 = await geo(0), s1 = await geo(1), s2 = await geo(2);
  check('settled: gone card at fly-off spot + opacity 0', Math.abs(s0.tx - (-540)) < 5 && Math.abs(s0.ty - 340) < 5 && s0.opacity < 0.05,
    `tx=${s0.tx.toFixed(0)} ty=${s0.ty.toFixed(0)} op=${s0.opacity}`);
  check('settled: card1 now at front anchor (tx=-120, opacity 1)', Math.abs(s1.tx - (-120)) < 5 && s1.opacity > 0.95,
    `tx=${s1.tx.toFixed(0)} op=${s1.opacity}`);
  check('settled: card2 advanced exactly one slot', Math.abs(s2.tx - (-120 + stepX)) < 8 && Math.abs(s2.ty - (s1.ty - stepX * 0.78)) < 8,
    `tx=${s2.tx.toFixed(0)} ty=${s2.ty.toFixed(0)}`);
  check('meta advances to 2 / 10', (await meta()).includes('2 / 10'), (await meta()).trim());

  // ==== 3. REVERSE: scroll up plays back ====
  log('--- Reverse ---');
  await wheelAt(800, 500, -120, 1400);
  await clearHover();
  await page.waitForTimeout(500); // let opacity spring settle back to 1
  const r0 = await geo(0), r1 = await geo(1);
  check('scroll up: gone card slides back to anchor, opacity 1', Math.abs(r0.tx - (-120)) < 5 && r0.opacity > 0.85,
    `tx=${r0.tx.toFixed(0)} op=${r0.opacity}`);
  check('scroll up: card1 back one slot', Math.abs(r1.tx - (-120 + stepX)) < 8, `tx=${r1.tx.toFixed(0)}`);
  check('meta back to 1 / 10', (await meta()).includes('1 / 10'), (await meta()).trim());
  // clamp at top: scroll up again → nothing moves
  await wheelAt(800, 500, -120, 600);
  await clearHover();
  const c0 = await geo(0);
  check('scroll up at top → stops (no wrap)', Math.abs(c0.tx - (-120)) < 5, `tx=${c0.tx.toFixed(0)}`);

  // ==== 4. Continuous multi-step ====
  log('--- Continuous multi-step ---');
  for (let k = 0; k < 3; k++) { await page.mouse.move(800, 500); await page.mouse.wheel(0, 120); await page.waitForTimeout(300); }
  await page.waitForTimeout(1400);
  await clearHover();
  const m0 = await geo(0), m3 = await geo(3);
  check('after 3 steps: cards 0-2 gone (opacity 0)', m0.opacity < 0.05, `op0=${m0.opacity}`);
  check('after 3 steps: card3 at front anchor', Math.abs(m3.tx - (-120)) < 5, `tx=${m3.tx.toFixed(0)}`);
  check('meta 4 / 10', (await meta()).includes('4 / 10'), (await meta()).trim());
  for (let k = 0; k < 3; k++) { await page.mouse.move(800, 500); await page.mouse.wheel(0, -120); await page.waitForTimeout(300); }
  await page.waitForTimeout(1400);
  await clearHover();
  const b0 = await geo(0);
  check('round-trip back to full stack', Math.abs(b0.tx - (-120)) < 5 && b0.opacity > 0.95, `tx=${b0.tx.toFixed(0)} op=${b0.opacity}`);

  // ==== 5. Hover on live coords + book-shelf straighten ====
  log('--- Hover ---');
  const h0 = await geo(0), h1 = await geo(1);
  const hStepX = h1.x - h0.x;
  const hStepY = h0.y - h1.y;
  // card i visible strip: mid of (prev.right, own.right], at own vertical center
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const gi = await geo(i);
    if (i === 0) pts.push([i, gi.x + gi.w / 2, gi.y + gi.h / 2]);
    else {
      const gp = await geo(i - 1);
      pts.push([i, (gp.x + gp.w + gi.x + gi.w) / 2, gi.y + gi.h / 2]);
    }
  }
  let hoverOk = true;
  let hoverDetail = [];
  for (const [i, px, py] of pts) {
    await page.mouse.move(px, py);
    await page.waitForTimeout(800); // depth-5 card has 0.35s cascade delay
    const st = [];
    for (let j = 0; j < 6; j++) st.push(await geo(j));
    // hovered: straighten (m11→1) + scale 1.08; others 0.35
    const ok = st[i].m11 > 0.99 && st[i].scale > 1.05 && st.every((s, j) => j === i || s.opacity < 0.4);
    if (!ok) hoverOk = false;
    hoverDetail.push(`#${i}:${ok ? 'ok' : 'BAD[' + st.map((s) => s.m11.toFixed(2) + '/' + s.opacity.toFixed(2)).join(',') + ']'}`);
  }
  check('hover straightens + raises ONLY hovered card (6 incl. middle)', hoverOk, hoverDetail.join(' '));

  // blank bands (inside stage, outside every rect)
  const deckR = Math.max(...(await Promise.all([0, 1, 2, 3, 4, 5].map((i) => geo(i)))).map((g) => g.x + g.w));
  const midY0 = (await geo(0)).y + (await geo(0)).h / 2;
  const blank = async (px, py, label) => {
    await clearHover(); // ensure no stale hover before the sweep
    await page.mouse.move(px, py);
    await page.waitForTimeout(450);
    const st = [];
    for (let j = 0; j < 6; j++) st.push((await geo(j)).scale);
    check(`blank ${label} → no hover`, st.every((s) => s < 1.05), st.map((s) => s.toFixed(2)).join(','));
  };
  await blank(1500, 700, 'right of deck');
  await blank(300, midY0, 'left of deck');
  // diagonal gap between card0 and card1
  const gA = await geo(0), gB = await geo(1);
  const gapX = (gA.x + gA.w + gB.x + gB.w) / 2;
  await blank(gapX, gB.y + gB.h + 40, 'diagonal gap');

  // ==== 6. Click opens diary; clear hover after slide (gone card no hover) ====
  log('--- Click / gone-card inertness ---');
  await page.mouse.move(pts[2][1], pts[2][2]);
  await page.waitForTimeout(800);
  await page.mouse.click(pts[2][1], pts[2][2]);
  await page.waitForTimeout(500);
  const modalOpen = await page.evaluate(() =>
    !![...document.querySelectorAll('div')].find((d) => getComputedStyle(d).backdropFilter && getComputedStyle(d).backdropFilter.includes('blur')));
  check('click hovered card opens diary', modalOpen);
  await page.mouse.click(200, 200);
  await page.waitForTimeout(400);
  // scroll down 1 → card0 gone; moving over its fly-off spot must NOT hover it
  await wheelAt(800, 500, 120, 1300);
  const gGone = await geo(0);
  await page.mouse.move(gGone.x + 30, gGone.y + 100);
  await page.waitForTimeout(450);
  const allScales = [];
  for (let j = 0; j < 6; j++) allScales.push((await geo(j)).scale);
  check('gone card (opacity 0) never responds to hover', allScales.every((s) => s < 1.05), allScales.map((s) => s.toFixed(2)).join(','));
  for (let k = 0; k < 2; k++) { await page.mouse.move(800, 500); await page.mouse.wheel(0, -120); await page.waitForTimeout(300); }
  await page.waitForTimeout(1300);

  // ==== 7. Regression ====
  log('--- Regression ---');
  const sharp = await page.evaluate(() => {
    const img = document.querySelector('img[alt="测试日记 0"]');
    return img ? img.naturalWidth : 0;
  });
  check('original image still used (nw 800)', sharp >= 600, `nw=${sharp}`);
  await page.locator('button[aria-label="长廊模式"]').click();
  await page.waitForTimeout(700);
  const cc0 = await page.evaluate(() => {
    const img = document.querySelector('img[alt="测试日记 0"]');
    const r = img.closest('button').parentElement.getBoundingClientRect();
    return { w: r.width, h: r.height };
  });
  check('corridor still 420×560', Math.abs(cc0.w - 420) < 3, `w=${cc0.w.toFixed(0)}`);
  const corridorBtn = await page.locator('button:has-text("✦ 翻开这一天")').count();
  check('corridor 翻开这一天 button', corridorBtn >= 1);
  await page.locator('button[aria-label="叠影模式"]').click();
  await page.waitForTimeout(900);
  const stackBtn = await page.locator('button:has-text("✦ 翻开这一天")').count();
  check('stack 翻开这一天 button', stackBtn >= 1);
  await page.mouse.move(300, 150);
  await page.waitForTimeout(350);
  const ringScale = await page.evaluate(() => {
    const outer = [...document.querySelectorAll('div')].find((d) => getComputedStyle(d).zIndex === '999');
    const scaleEl = outer?.firstElementChild?.firstElementChild;
    const t = scaleEl ? getComputedStyle(scaleEl).transform : 'none';
    const m = t !== 'none' && t.match(/matrix\(([^,]+),/);
    return m ? parseFloat(m[1]) : 1;
  });
  check('ring cursor visible', ringScale > 0.9, `scale=${ringScale}`);
  await page.mouse.move(400, 60);
  await page.waitForTimeout(4600);
  const hidden = await page.evaluate(() => {
    const inp = document.querySelector('input[placeholder*="搜索"]');
    return {
      header: inp ? parseFloat(getComputedStyle(inp.closest('header')).opacity) : 1,
      canvases: document.querySelectorAll('canvas').length,
      ring: [...document.querySelectorAll('div')].some((d) => getComputedStyle(d).zIndex === '999'),
    };
  });
  check('3s auto-hide fades chrome', hidden.header < 0.2, `header=${hidden.header}`);
  check('ambient + cursor stay', hidden.canvases === 1 && hidden.ring);
  await page.mouse.move(640, 300);
  await page.waitForTimeout(300);
  await page.locator('button[aria-label="网格模式"]').click();
  await page.waitForTimeout(600);
  const gridCols = await page.evaluate(() => {
    const g = [...document.querySelectorAll('div')].find((d) => (d.style.gridTemplateColumns || '').includes('minmax'));
    return g ? g.style.gridTemplateColumns : '';
  });
  check('grid columns still 300px', gridCols.includes('300px'), gridCols);
  await page.locator('button:has(img[alt="测试日记 0"])').first().hover();
  await page.waitForTimeout(400);
  const gridOk = await page.evaluate(() => {
    const card = [...document.querySelectorAll('button')].find((b) => b.querySelector('img[alt="测试日记 0"]'));
    const overlay = card.querySelector('span span') || card.querySelector('span');
    return parseFloat(getComputedStyle(overlay).opacity) > 0.9;
  });
  check('grid hover float text intact', gridOk);
  await page.mouse.move(640, 300);
  await page.waitForTimeout(200);
  await page.locator('button[aria-label="返回首页"]').click();
  await page.waitForTimeout(1600);
  const landing = await page.evaluate(() => ({
    canvases: document.querySelectorAll('canvas').length,
    halo: [...document.querySelectorAll('div')].some((d) => getComputedStyle(d).backgroundImage.includes('radial-gradient')),
  }));
  check('landing intact', landing.canvases >= 1 && landing.halo);
  check('no console errors', errors.length === 0, errors.slice(0, 3).join('; '));

  log('== DONE ==');
  browser.close().catch(() => {});
  setTimeout(() => process.exit(0), 200);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });

function log(s) { console.log(s); }
