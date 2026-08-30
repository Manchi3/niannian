// Round 49 self-test — stack whole-deck slide (wheel direction fix + offset
// model replacing focusIdx pull-out) + hover on final coordinates.
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

  // seed 10 diaries (6 used for interaction, 10 used for the no-overflow check)
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
    const c = document.createElement('canvas');
    c.width = 800; c.height = 600;
    const g = c.getContext('2d');
    g.fillStyle = '#c8764a'; g.fillRect(0, 0, 800, 600);
    g.fillStyle = '#1b140f'; g.fillRect(80, 90, 320, 50);
    const original = await new Promise((r) => c.toBlob(r, 'image/png'));
    const db = await open();
    const tx = db.transaction('diaries', 'readwrite');
    const store = tx.objectStore('diaries');
    const now = Date.now();
    const thumb = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'image/png' });
    for (let i = 0; i < 10; i++) {
      store.put({
        _schemaVersion: 2, id: 'seed-' + i, title: '测试日记 ' + i, date: '2026-08-14',
        content: '内容 ' + i, chatHistory: [],
        thumbnailBlob: thumb, imageRef: i === 0 ? 'idb:' : null,
        legacyImageBlob: i === 0 ? original : undefined,
        createdAt: now - i * 1000, updatedAt: now - i * 1000,
      });
    }
    return new Promise((resolve) => { tx.oncomplete = () => resolve(true); tx.onerror = () => resolve(false); });
  });

  await page.locator('button:has-text("回到我的记忆")').first().click();
  await page.waitForTimeout(2600);
  await page.locator('button[aria-label="叠影模式"]').click();
  await page.waitForTimeout(1200);

  // ---- dynamic card geometry (wrapper = img closest button parentElement) ----
  const cardGeo = (i) => page.evaluate((idx) => {
    const img = document.querySelector(`img[alt="测试日记 ${idx}"]`);
    if (!img) return null;
    const w = img.closest('button').parentElement;
    const r = w.getBoundingClientRect();
    const cs = getComputedStyle(w);
    const m = cs.transform.match(/matrix\(([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^,]+)/);
    return {
      x: r.x, y: r.y, w: r.width, h: r.height,
      tx: m ? parseFloat(m[5]) : 0, ty: m ? parseFloat(m[6]) : 0,
      scale: m ? parseFloat(m[1]) : 1,
      z: parseInt(cs.zIndex, 10) || 0,
      opacity: parseFloat(cs.opacity),
    };
  }, i);

  const meta = () => page.evaluate(() => document.querySelector('[data-testid="bottom-meta"]').textContent);

  const wheel = async (dy) => { await page.mouse.move(800, 500); await page.mouse.wheel(0, dy); await page.waitForTimeout(650); };
  // Move to a point that is NEVER inside any card at ANY offset (right of the
  // deck, inside the stage) → stage mousemove computes hit=null → hover cleared.
  const clearHover = async () => { await page.mouse.move(1500, 500); await page.waitForTimeout(350); };

  // ==== 1. DEFAULT: offset=0 → stacked tight, nothing popped ====
  log('--- Default / geometry ---');
  const def = [];
  for (let i = 0; i < 6; i++) def.push(await cardGeo(i));
  check('default: all 6 cards scale 1', def.every((c) => c && Math.abs(c.scale - 1) < 0.01), def.map((c) => c.scale.toFixed(2)).join(','));
  check('default: card0 topmost (z=n−i → 10) & card5 lowest (5)', def[0].z === 10 && def[5].z === 5, `z0=${def[0].z} z5=${def[5].z}`);
  check('default: card0 bottom-left, card5 top-right', def[0].y > def[5].y && def[0].x < def[5].x,
    `c0=(${def[0].x.toFixed(0)},${def[0].y.toFixed(0)}) c5=(${def[5].x.toFixed(0)},${def[5].y.toFixed(0)})`);
  const dX = (def[5].x - def[0].x) / 5;
  const dY = (def[0].y - def[5].y) / 5;
  check('default: staircase step still 90 / 70', dX > 86 && dX < 94 && dY > 66 && dY < 74, `dX=${dX.toFixed(1)} dY=${dY.toFixed(1)}`);
  check('default: meta shows 1 / 10', (await meta()).includes('1 / 10'), (await meta()).trim());

  // ==== 2. WHEEL DIRECTION + SLIDE ====
  log('--- Wheel direction / slide ---');
  const tx0 = def[0].tx, ty0 = def[0].ty;
  // scroll DOWN → offset+1 → deck slides LEFT (−220) and DOWN (+150)
  await wheel(120);
  await clearHover(); // pointer may have landed on a card — clear before reading
  const o1 = await cardGeo(0);
  check('scroll down → deck slides LEFT by 220', Math.abs(o1.tx - (tx0 - 220)) < 4, `tx ${tx0.toFixed(0)} → ${o1.tx.toFixed(0)}`);
  check('scroll down → deck slides DOWN by 150', Math.abs(o1.ty - (ty0 + 150)) < 4, `ty ${ty0.toFixed(0)} → ${o1.ty.toFixed(0)}`);
  check('scroll down → meta advances (2 / 10)', (await meta()).includes('2 / 10'), (await meta()).trim());
  check('slide opacity still 1 at offset=1 (drift 266 < fadeStart)', Math.abs(o1.opacity - 1) < 0.02, `op=${o1.opacity}`);

  // scroll down ×3 → offset=4 → fade to ~0.08 (drift 1065 > fadeEnd 700)
  await wheel(120); await wheel(120); await wheel(120);
  await clearHover();
  const o4 = await cardGeo(0);
  check('scroll down ×4 total → opacity bottoms at ~0.08', o4.opacity >= 0.06 && o4.opacity <= 0.12, `op=${o4.opacity}`);
  const meta4 = await meta();
  check('offset=4 → meta 5 / 10', meta4.includes('5 / 10'), meta4.trim());

  // ==== 3. SCROLL UP: returns to 0 and STOPS (no wrap / no reverse) ====
  log('--- Scroll up / clamp ---');
  await wheel(-120); await wheel(-120); await wheel(-120); await wheel(-120); // → offset 0
  await clearHover();
  const o0 = await cardGeo(0);
  check('scroll up ×4 → back to offset=0 (tx/ty restored)', Math.abs(o0.tx - tx0) < 4 && Math.abs(o0.ty - ty0) < 4,
    `tx=${o0.tx.toFixed(0)} ty=${o0.ty.toFixed(0)}`);
  check('back to offset=0 → opacity restored ~1', Math.abs(o0.opacity - 1) < 0.02, `op=${o0.opacity}`);
  check('back to 0 → meta 1 / 10', (await meta()).includes('1 / 10'), (await meta()).trim());
  // scroll up again at the top → MUST NOT move (clamp, no wrap)
  await wheel(-120);
  await clearHover();
  const oNeg = await cardGeo(0);
  check('scroll up at offset=0 → stays (no wrap/no reverse)', Math.abs(oNeg.tx - tx0) < 4 && Math.abs(oNeg.ty - ty0) < 4,
    `tx=${oNeg.tx.toFixed(0)} ty=${oNeg.ty.toFixed(0)}`);
  // scroll down to the LAST → clamp at n−1 = 9 (10 cards)
  for (let k = 0; k < 9; k++) await wheel(120); // offset 9 (max)
  await clearHover();
  const metaMax = await meta();
  check('scroll down to bottom → meta 10 / 10 (clamped at n−1)', metaMax.includes('10 / 10'), metaMax.trim());
  for (let k = 0; k < 9; k++) await wheel(-120); // back to 0
  await clearHover();
  await page.waitForTimeout(700);
  const oBack = await cardGeo(0);
  check('deck returns to origin after round trip', Math.abs(oBack.tx - tx0) < 4 && Math.abs(oBack.ty - ty0) < 4,
    `tx=${oBack.tx.toFixed(0)} ty=${oBack.ty.toFixed(0)}`);

  // ==== 4. HOVER on FINAL coordinates (after sliding) ====
  log('--- Hover on final coords ---');
  await wheel(120); // offset=1
  const rects = [];
  for (let i = 0; i < 6; i++) rects.push(await cardGeo(i));
  // dynamic hover points: card0 center; card i (≥1) → mid of its visible right
  // strip (prev.right, own.right], at its own vertical center
  const points = [];
  for (let i = 0; i < 6; i++) {
    if (i === 0) points.push([0, rects[0].x + rects[0].w / 2, rects[0].y + rects[0].h / 2]);
    else points.push([i, (rects[i - 1].x + rects[i - 1].w + rects[i].x + rects[i].w) / 2, rects[i].y + rects[i].h / 2]);
  }
  let hoverOk = true;
  let hoverDetail = [];
  for (const [i, px, py] of points) {
    await page.mouse.move(px, py);
    await page.waitForTimeout(400);
    const st = [];
    for (let j = 0; j < 6; j++) st.push((await cardGeo(j)).scale);
    const ok = st[i] > 1.05 && st.every((s, j) => j === i || s < 1.01);
    if (!ok) hoverOk = false;
    hoverDetail.push(`#${i}:${ok ? 'ok' : 'BAD[' + st.map((s) => s.toFixed(2)).join(',') + ']'}`);
  }
  check('hover (at offset=1) raises ONLY the hovered card, all 6', hoverOk, hoverDetail.join(' '));

  // blank bands at offset=1 (inside the stage, outside every card rect)
  const deckL = Math.min(...rects.map((r) => r.x));
  const deckR = Math.max(...rects.map((r) => r.x + r.w));
  const midY = rects[0].y + rects[0].h / 2;
  const blank = async (px, py, label) => {
    await page.mouse.move(px, py);
    await page.waitForTimeout(300);
    const st = [];
    for (let j = 0; j < 6; j++) st.push((await cardGeo(j)).scale);
    check(`blank ${label} → no hover`, st.every((s) => s < 1.01), st.map((s) => s.toFixed(2)).join(','));
  };
  await blank(deckL - 70, midY, 'left of deck');
  await blank(deckR + 70, midY, 'right of deck');
  // diagonal gap between card0 and card1 (below card1, right of card0)
  const gapX = (rects[0].x + rects[0].w + rects[1].x + rects[1].w) / 2;
  await blank(gapX, rects[1].y + rects[1].h + 30, 'diagonal gap');

  // click hovered card opens diary (after slide)
  await page.mouse.move(points[2][1], points[2][2]);
  await page.waitForTimeout(380);
  await page.mouse.click(points[2][1], points[2][2]);
  await page.waitForTimeout(500);
  const modalOpen = await page.evaluate(() =>
    !![...document.querySelectorAll('div')].find((d) => getComputedStyle(d).backdropFilter && getComputedStyle(d).backdropFilter.includes('blur')));
  check('click hovered card (after slide) opens diary', modalOpen);
  await page.mouse.click(200, 200);
  await page.waitForTimeout(400);

  // ==== 5. 10 cards: no right/top overflow at offset=0 ====
  log('--- 10 cards no overflow ---');
  await wheel(-120); // back to offset 0 (from 1)
  await page.waitForTimeout(700);
  const all10 = [];
  for (let i = 0; i < 10; i++) all10.push(await cardGeo(i));
  const rightMax = Math.max(...all10.map((c) => c.x + c.w));
  const leftMin = Math.min(...all10.map((c) => c.x));
  check('10 cards: all within viewport horizontally', leftMin >= 0 && rightMax <= 1600,
    `left=${leftMin.toFixed(0)} right=${rightMax.toFixed(0)}`);
  check('10 cards: deck centered (left/right margins > 100)', leftMin > 100 && rightMax < 1500,
    `left=${leftMin.toFixed(0)} right=${rightMax.toFixed(0)}`);

  // ==== 6. Regression: sharpness, corridor, grid, chrome, cursor, landing ====
  log('--- Regression ---');
  const sharp = await page.evaluate(() => {
    const img = document.querySelector('img[alt="测试日记 0"]');
    return img ? img.naturalWidth : 0;
  });
  check('stack still uses ORIGINAL image (nw 800)', sharp >= 600, `nw=${sharp}`);

  await page.locator('button[aria-label="长廊模式"]').click();
  await page.waitForTimeout(700);
  const cc0 = await page.evaluate(() => {
    const img = document.querySelector('img[alt="测试日记 0"]');
    const r = img.closest('button').parentElement.getBoundingClientRect();
    return { w: r.width, h: r.height, nw: img.naturalWidth };
  });
  check('corridor card still 420 wide / 560 tall', Math.abs(cc0.w - 420) < 3 && Math.abs(cc0.h - 560) < 6, `${cc0.w.toFixed(0)}×${cc0.h.toFixed(0)}`);
  check('corridor still original image', cc0.nw >= 600, `nw=${cc0.nw}`);
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

  // wake the chrome back up (auto-hide put header pointer-events:none)
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
  // env quirk: browser.close() sometimes hangs — fire-and-forget + force exit
  browser.close().catch(() => {});
  setTimeout(() => process.exit(0), 200);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });

function log(s) { console.log(s); }
