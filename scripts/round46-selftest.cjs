// Round 46 self-test — CorridorView (Cover Flow gaps + wheel throttle) and
// StackView (diagonal staircase + wheel focus + strict-rect hover).
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

  // Seed 3 diaries
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
    for (let i = 0; i < 3; i++) {
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

  const cardBoxes = () =>
    page.evaluate(() => {
      const out = {};
      [...document.querySelectorAll('img[alt^="测试日记"]')].forEach((img) => {
        const b = img.closest('button').parentElement; // motion.div
        const r = b.getBoundingClientRect();
        const cs = getComputedStyle(b);
        out[img.getAttribute('alt')] = {
          x: r.x, y: r.y, w: r.width, h: r.height,
          scale: cs.transform !== 'none' && cs.transform.match(/matrix\(([^,]+),/) ? parseFloat(cs.transform.match(/matrix\(([^,]+),/)[1]) : 1,
          opacity: parseFloat(cs.opacity),
        };
      });
      return out;
    });

  // ==== 1. Corridor: gaps, current-largest, wheel throttle ====
  const c1 = await cardBoxes();
  const c0 = c1['测试日记 0']; // current at idx=0
  const c1b = c1['测试日记 1'];
  check('corridor current card largest (scale 1 vs 0.72)', c0.scale > 0.99 && c1b.scale < 0.75 && c1b.scale > 0.7,
    `s0=${c0.scale.toFixed(2)} s1=${c1b.scale.toFixed(2)}`);
  const gap = c1b.x - (c0.x + c0.w);
  check('corridor clear gap between cards (≥50px, no overlap)', gap >= 50,
    `gap=${gap.toFixed(0)}px (w0=${c0.w.toFixed(0)} w1=${c1b.w.toFixed(0)})`);
  check('corridor neighbour fully visible (on-screen)', c1b.x >= 0 && c1b.x + c1b.w <= 1280,
    `x=${c1b.x.toFixed(0)} right=${(c1b.x + c1b.w).toFixed(0)}`);

  // wheel: one step per scroll (throttle 120ms)
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(50);
  await page.mouse.wheel(0, 120); // within throttle window → ignored
  await page.waitForTimeout(400);
  const metaAfter2Wheels = await page.evaluate(() => document.querySelector('[data-testid="bottom-meta"]').textContent);
  check('corridor wheel throttled (2 quick wheels = 1 step)', metaAfter2Wheels.includes('2 / 3'),
    metaAfter2Wheels.trim());
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(400);
  const metaAfter3 = await page.evaluate(() => document.querySelector('[data-testid="bottom-meta"]').textContent);
  check('corridor wheel steps again (idx 2)', metaAfter3.includes('3 / 3'), metaAfter3.trim());
  await page.mouse.wheel(0, 120); // at max — stays
  await page.waitForTimeout(400);
  const metaAtMax = await page.evaluate(() => document.querySelector('[data-testid="bottom-meta"]').textContent);
  check('corridor wheel clamps at last card', metaAtMax.includes('3 / 3'), metaAtMax.trim());

  // ==== 2. Stack: staircase + focus + strict hover ====
  await page.locator('button[aria-label="叠影模式"]').click();
  await page.waitForTimeout(900);
  const s1 = await cardBoxes();
  const b0 = s1['测试日记 0'], b1s = s1['测试日记 1'], b2 = s1['测试日记 2'];
  // Compare CENTERS of the two edge cards (focus card is lifted/scaled, so
  // use card0 ↔ card2 which are symmetric non-focus cards).
  const c0x = b0.x + b0.w / 2, c0y = b0.y + b0.h / 2;
  const c2x = b2.x + b2.w / 2, c2y = b2.y + b2.h / 2;
  const stairX = (c2x - c0x) / 2;
  const stairY = (c2y - c0y) / 2;
  check('stack diagonal staircase (right + down per step)', stairX > 55 && stairX < 85 && stairY > 30 && stairY < 60,
    `dX=${stairX.toFixed(0)} dY=${stairY.toFixed(0)}`);
  // focus = middle card (测试日记 1) → lifted & prominent
  check('stack middle card is the FOCUS (opacity 1, scale > 1)', b1s.opacity > 0.99 && b1s.scale > 1.04,
    `o1=${b1s.opacity.toFixed(2)} s1=${b1s.scale.toFixed(2)}`);

  // strict hover: sweeping the blank band above/below the cards must NOT
  // trigger hover — detect via SCALE (>1.08 = hovered; focus is only 1.06).
  const sweepNoHover = async (y) => {
    for (let x = 320; x <= 1000; x += 80) {
      await page.mouse.move(x, y);
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(300);
    const boxes = await cardBoxes();
    return Object.values(boxes).every((b) => b.scale < 1.08);
  };
  const blankAbove = await sweepNoHover(200); // above every card top (card0 top ≈ 221)
  const blankBelow = await sweepNoHover(580); // below every card bottom (card2 bottom ≈ 551)
  check('stack hover NOT triggered on blank area above cards', blankAbove, 'blank y=200');
  check('stack hover NOT triggered on blank area below cards', blankBelow, 'blank y=580');

  // normal hover: middle card pops
  await page.mouse.move(640, 386);
  await page.waitForTimeout(500);
  const hov = await cardBoxes();
  check('stack hover pops the hovered card (opacity 1, scale 1.1)',
    hov['测试日记 1'].opacity > 0.99 && hov['测试日记 1'].scale > 1.08,
    `o=${hov['测试日记 1'].opacity.toFixed(2)} s=${hov['测试日记 1'].scale.toFixed(2)}`);
  check('stack hover dims the others', hov['测试日记 0'].opacity < 0.4 && hov['测试日记 2'].opacity < 0.4,
    `o0=${hov['测试日记 0'].opacity.toFixed(2)} o2=${hov['测试日记 2'].opacity.toFixed(2)}`);

  // bidirectional sweep across the card row — every card highlighted
  const sweepHit = async (fromX, toX) => {
    const hit = new Set();
    const step = fromX <= toX ? 40 : -40;
    const cond = (x) => (step > 0 ? x <= toX : x >= toX);
    for (let x = fromX; cond(x); x += step) {
      await page.mouse.move(x, 386);
      await page.waitForTimeout(350); // let the spring settle (≈150ms to 90%)
      const boxes = await cardBoxes();
      Object.entries(boxes).forEach(([k, v]) => { if (v.scale > 1.08) hit.add(parseInt(k.split(' ')[1], 10)); });
    }
    return [...hit].sort((a, b) => a - b);
  };
  await page.mouse.move(400, 60); // reset hover
  await page.waitForTimeout(300);
  const l2r = await sweepHit(400, 900);
  // reset hover + let springs settle before the reverse sweep
  await page.mouse.move(400, 60);
  await page.waitForTimeout(600);
  const r2l = await sweepHit(900, 400);
  check('stack left→right every card responds', l2r.join(',') === '0,1,2', `hit=${l2r.join(',')}`);
  check('stack right→left every card responds', r2l.join(',') === '0,1,2', `hit=${r2l.join(',')}`);

  // wheel switches the focus card — move OUT of the deck first so the meta
  // line shows the FOCUS card (hover takes precedence while inside).
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(400);
  await page.mouse.move(400, 60); // leave the deck → hover cleared
  await page.waitForTimeout(400);
  const metaFocus = await page.evaluate(() => document.querySelector('[data-testid="bottom-meta"]').textContent);
  const focusBoxes = await cardBoxes();
  check('stack wheel moves focus (meta 3/3, card2 focus-lifted)',
    metaFocus.includes('3 / 3') && focusBoxes['测试日记 2'].opacity > 0.99,
    metaFocus.trim());

  // ==== 3. 翻开这一天 button both modes ====
  const stackBtn = await page.locator('button:has-text("✦ 翻开这一天")').count();
  check('stack has 翻开这一天 button', stackBtn >= 1);
  await page.locator('button[aria-label="长廊模式"]').click();
  await page.waitForTimeout(600);
  const corridorBtn = await page.locator('button:has-text("✦ 翻开这一天")').count();
  check('corridor has 翻开这一天 button', corridorBtn >= 1, `count=${corridorBtn}`);

  // ==== 4. Ring cursor always visible ====
  const ringScaleAt = async (x, y) => {
    await page.mouse.move(x, y);
    await page.waitForTimeout(350);
    return page.evaluate(() => {
      const outer = [...document.querySelectorAll('div')].find((d) => getComputedStyle(d).zIndex === '999');
      const scaleEl = outer?.firstElementChild?.firstElementChild;
      if (!scaleEl) return 0;
      const t = getComputedStyle(scaleEl).transform;
      const m = t !== 'none' && t.match(/matrix\(([^,]+),/);
      return m ? parseFloat(m[1]) : 1;
    });
  };
  const ringBlank = await ringScaleAt(300, 150);
  check('ring cursor visible on blank area', ringBlank > 0.9, `scale=${ringBlank}`);

  // ==== 5. Grid untouched ====
  await page.locator('button[aria-label="网格模式"]').click();
  await page.waitForTimeout(600);
  await page.locator('button:has(img[alt="测试日记 0"])').first().hover();
  await page.waitForTimeout(350);
  const gridOk = await page.evaluate(() => {
    const card = [...document.querySelectorAll('button')].find((b) => b.querySelector('img[alt="测试日记 0"]'));
    const overlay = card.querySelector('span span') || card.querySelector('span');
    return parseFloat(getComputedStyle(overlay).opacity) > 0.9;
  });
  check('grid hover float text intact', gridOk);

  // ==== 6. Auto-hide + ambient ====
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
  check('ambient + cursor stay after hide', hidden.canvases === 1 && hidden.ring);

  // ==== 7. Landing regression ====
  await page.mouse.move(640, 300);
  await page.waitForTimeout(200);
  await page.locator('button[aria-label="返回首页"]').click();
  await page.waitForTimeout(1600);
  const landing = await page.evaluate(() => ({
    canvases: document.querySelectorAll('canvas').length,
    halo: [...document.querySelectorAll('div')].some((d) => getComputedStyle(d).backgroundImage.includes('radial-gradient')),
  }));
  check('landing particle cloud + halo intact', landing.canvases >= 1 && landing.halo);

  check('no console errors', errors.length === 0, errors.slice(0, 3).join('; '));

  await browser.close();
  console.log('== DONE ==');
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
