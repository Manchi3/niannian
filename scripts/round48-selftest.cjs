// Round 48 self-test — three views bigger + sharp (original image) + stack
// bottom-left→top-right fan with default-state fix.
const { chromium } = require('playwright');

const OUT = [];
const log = (s) => { OUT.push(s); process.stdout.write(s + '\n'); };

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
    log(`${pass ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);

  await page.goto('http://localhost:5174', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.waitForTimeout(1500);

  // ---- Seed 6 diaries; seed-0 has a REAL original image (800×600 canvas,
  // imageRef 'idb:') so sharpness can be asserted via naturalWidth. ----
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
    // real 800×600 original for seed-0 — generate BEFORE the tx opens so no
    // await lands between put() calls (await would auto-commit the tx).
    const c = document.createElement('canvas');
    c.width = 800; c.height = 600;
    const g = c.getContext('2d');
    g.fillStyle = '#c8764a'; g.fillRect(0, 0, 800, 600);
    g.fillStyle = '#1b140f'; g.fillRect(80, 90, 320, 50);
    g.fillStyle = '#ead9c4'; g.fillRect(120, 240, 420, 80);
    const original = await new Promise((r) => c.toBlob(r, 'image/png'));
    const db = await open();
    const tx = db.transaction('diaries', 'readwrite');
    const store = tx.objectStore('diaries');
    const now = Date.now();
    const thumb = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'image/png' });
    for (let i = 0; i < 6; i++) {
      store.put({
        _schemaVersion: 2, id: 'seed-' + i, title: '测试日记 ' + i, date: '2026-08-14',
        content: '内容 ' + i, chatHistory: [],
        thumbnailBlob: thumb,
        imageRef: i === 0 ? 'idb:' : null,
        legacyImageBlob: i === 0 ? original : undefined,
        createdAt: now - i * 1000, updatedAt: now - i * 1000,
      });
    }
    return new Promise((resolve) => { tx.oncomplete = () => resolve(true); tx.onerror = () => resolve(false); });
  });

  await page.locator('button:has-text("回到我的记忆")').first().click();
  await page.waitForTimeout(2600);

  const cardCount = () => page.evaluate(() =>
    [...document.querySelectorAll('img[alt^="测试日记"]')].length);

  // Read a card wrapper's transform matrix + rect. The wrapper is the
  // motion.div: button.parentElement (same as round 47).
  const cardInfo = (i) => page.evaluate((idx) => {
    const img = document.querySelector(`img[alt="测试日记 ${idx}"]`);
    if (!img) return null;
    const w = img.closest('button').parentElement;
    const r = w.getBoundingClientRect();
    const cs = getComputedStyle(w);
    const m = cs.transform.match(/matrix\(([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^,]+)/);
    return {
      x: r.x, y: r.y, w: r.width, h: r.height,
      scale: m ? parseFloat(m[1]) : 1,
      ty: m ? parseFloat(m[6]) : 0,
      z: parseInt(cs.zIndex, 10) || 0,
      willChange: cs.willChange,
      filter: cs.filter,
      opacity: parseFloat(cs.opacity),
    };
  }, i);

  // ==== 1. Corridor: bigger cards (420), spacing 520, sharp, drag/wheel ====
  log('--- Corridor ---');
  const count0 = await cardCount();
  check('corridor renders ALL 6 cards', count0 === 6, `count=${count0}`);

  await page.waitForTimeout(500); // settle
  const cc0 = await cardInfo(0);
  check('corridor card width ≈ 420 (Round 48 320→420)', cc0 && Math.abs(cc0.w - 420) < 3, `w=${cc0 && cc0.w.toFixed(1)}`);
  check('corridor card height ≈ 560 (3:4 portrait)', cc0 && Math.abs(cc0.h - 560) < 5, `h=${cc0 && cc0.h.toFixed(1)}`);
  // neighbor (idx=1) center = current center + 520
  const cc1 = await cardInfo(1);
  const stepX = cc1 ? cc1.x + cc1.w / 2 - (cc0.x + cc0.w / 2) : 0;
  check('corridor spacing ≈ 520 (gap ≥ 100)', Math.abs(stepX - 520) < 3, `step=${stepX.toFixed(1)}`);
  // gap between current card right edge and neighbor left edge (neighbor scale 0.75)
  const gap = cc1 ? (cc1.x - (cc0.x + cc0.w)) : 0;
  check('corridor visible gap ≥ 100px', gap >= 95, `gap=${gap.toFixed(1)}`);
  // current card: scale 1, filter none, willChange auto (no GPU-layer blur)
  check('corridor current card scale = 1', cc0 && Math.abs(cc0.scale - 1) < 0.01, `scale=${cc0 && cc0.scale}`);
  check('corridor current card filter = none', cc0 && cc0.filter === 'none', `filter=${cc0 && cc0.filter}`);
  check('corridor current card no will-change', cc0 && (cc0.willChange === 'auto' || cc0.willChange === ''), `wc=${cc0 && cc0.willChange}`);
  // neighbor dimmed: opacity 0.55 & brightness(0.6)
  check('corridor neighbor dimmed (0.55 + brightness)', cc1 && cc1.opacity > 0.45 && cc1.opacity < 0.65 && cc1.filter.includes('brightness(0.6)'), `op=${cc1 && cc1.opacity} f=${cc1 && cc1.filter}`);

  // sharpness: seed-0 img must be the ORIGINAL (naturalWidth 800, not thumb)
  const sharp0 = await page.evaluate(() => {
    const img = document.querySelector('img[alt="测试日记 0"]');
    return { nw: img ? img.naturalWidth : 0, dec: img ? img.decoding : '', drag: img ? img.draggable : null };
  });
  check('corridor uses ORIGINAL image (naturalWidth 800)', sharp0.nw >= 600, `nw=${sharp0.nw}`);
  check('img decoding=async + draggable=false', sharp0.dec === 'async' && sharp0.drag === false, `dec=${sharp0.dec}`);

  // wheel 0 → 1 keeps all cards, meta updates
  await page.mouse.move(800, 545);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(500);
  const count1 = await cardCount();
  const meta1 = await page.evaluate(() => document.querySelector('[data-testid="bottom-meta"]').textContent);
  check('corridor wheel 0→1 keeps all cards', count1 === 6 && meta1.includes('2 / 6'), `count=${count1} ${meta1.trim()}`);

  // drag left → next card (2→3/6), drag right → back; no modal
  await page.mouse.move(800, 545);
  await page.mouse.down();
  for (let x = 800; x >= 640; x -= 20) { await page.mouse.move(x, 545); await page.waitForTimeout(12); }
  await page.mouse.up();
  await page.waitForTimeout(700);
  const metaDragL = await page.evaluate(() => document.querySelector('[data-testid="bottom-meta"]').textContent);
  check('corridor drag left switches (2/6 → 3/6)', metaDragL.includes('3 / 6'), metaDragL.trim());
  await page.mouse.down();
  for (let x = 640; x <= 800; x += 20) { await page.mouse.move(x, 545); await page.waitForTimeout(12); }
  await page.mouse.up();
  await page.waitForTimeout(700);
  const metaDragR = await page.evaluate(() => document.querySelector('[data-testid="bottom-meta"]').textContent);
  check('corridor drag right switches back (2/6)', metaDragR.includes('2 / 6'), metaDragR.trim());
  const modalFromDrag = await page.evaluate(() =>
    !![...document.querySelectorAll('div')].find((d) => getComputedStyle(d).backdropFilter && getComputedStyle(d).backdropFilter.includes('blur')));
  check('corridor drag does NOT open modal', !modalFromDrag, `modal=${modalFromDrag}`);

  // ==== 2. Stack: default state + bottom-left→top-right fan + hover ====
  log('--- Stack ---');
  await page.mouse.click(100, 700); // safety close any stray modal
  await page.waitForTimeout(300);
  await page.locator('button[aria-label="叠影模式"]').click();
  await page.waitForTimeout(1100);

  // DEFAULT STATE: every card scale === 1, no dim, card0 topmost + bottom-left
  const def = [];
  for (let i = 0; i < 6; i++) def.push(await cardInfo(i));
  const allScale1 = def.every((c) => c && Math.abs(c.scale - 1) < 0.01);
  check('stack DEFAULT: all cards scale strictly 1 (no pop)', allScale1, def.map((c) => c.scale.toFixed(2)).join(','));
  const z0 = def[0].z, z5 = def[5].z;
  check('stack DEFAULT: card 0 topmost (z = n−i)', z0 === 6 && z5 === 1, `z0=${z0} z5=${z5}`);
  // bottom-left → top-right: card0 is LOWER (bigger y) and MORE LEFT (smaller x) than card5
  check('stack DEFAULT: card 0 bottom-left, card 5 top-right',
    def[0].y > def[5].y && def[0].x < def[5].x,
    `c0=(${def[0].x.toFixed(0)},${def[0].y.toFixed(0)}) c5=(${def[5].x.toFixed(0)},${def[5].y.toFixed(0)})`);
  // card0 fully visible: its bottom edge within the stage
  const stageBox = await page.evaluate(() => {
    const d = document.querySelector('button[aria-label="叠影模式"]');
    // the stack stage = the mousemove container; find it via the img wrapper's
    // grandparent chain is fragile — measure from card0 instead: its bottom
    // must be inside the viewport (1000px) with chrome space below.
    return { vh: window.innerHeight };
  });
  check('stack DEFAULT: card 0 bottom edge on screen', def[0].y + def[0].h <= stageBox.vh - 60,
    `bottom=${(def[0].y + def[0].h).toFixed(0)} vh=${stageBox.vh}`);
  check('stack cards 360×460 fixed box', Math.abs(def[0].w - 360) < 3 && Math.abs(def[0].h - 460) < 4,
    `${def[0].w.toFixed(0)}×${def[0].h.toFixed(0)}`);

  // geometry: per-step 90 / 70 (bottom-left → top-right)
  const dX = (def[5].x - def[0].x) / 5;
  const dY = (def[0].y - def[5].y) / 5;
  check('stack staircase step = 90 / 70', dX > 86 && dX < 94 && dY > 66 && dY < 74, `dX=${dX.toFixed(1)} dY=${dY.toFixed(1)}`);

  // HOVER sweep — every card incl. middle; each hover raises ONLY that card
  const hoverPoints = [
    [0, 575, 635], [1, 800, 565], [2, 890, 495], [3, 980, 425], [4, 1070, 355], [5, 1160, 285],
  ];
  let hoverAllOk = true;
  let hoverDetails = [];
  for (const [i, px, py] of hoverPoints) {
    await page.mouse.move(px, py);
    await page.waitForTimeout(380);
    const st = [];
    for (let j = 0; j < 6; j++) st.push((await cardInfo(j)).scale);
    const raised = st[i] > 1.05;
    const othersFlat = st.every((s, j) => j === i || s < 1.01);
    const ok = raised && othersFlat;
    if (!ok) hoverAllOk = false;
    hoverDetails.push(`#${i}:${ok ? 'ok' : 'BAD[' + st.map((s) => s.toFixed(2)).join(',') + ']'}`);
  }
  check('stack hover raises ONLY the hovered card (all 6 incl. middle)', hoverAllOk, hoverDetails.join(' '));

  // hover dims others (opacity 0.35) and gives gold glow
  await page.mouse.move(575, 635);
  await page.waitForTimeout(380);
  const hoverState = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => cardInfo(i)));
  check('stack hover dims others to 0.35', Math.abs(hoverState[1].opacity - 0.35) < 0.05, `op1=${hoverState[1].opacity}`);

  // blank bands → no hover
  const blankOk = async (px, py, label) => {
    await page.mouse.move(px, py);
    await page.waitForTimeout(300);
    const st = [];
    for (let j = 0; j < 6; j++) st.push((await cardInfo(j)).scale);
    const flat = st.every((s) => s < 1.01);
    check(`stack blank band ${label} → no hover`, flat, st.map((s) => s.toFixed(2)).join(','));
  };
  await blankOk(300, 600, 'left of deck');
  await blankOk(890, 800, 'between cards (diagonal gap)');
  await blankOk(1300, 400, 'right of deck');
  await blankOk(800, 40, 'above stage');

  // click the hovered card opens the diary
  await page.mouse.move(575, 635);
  await page.waitForTimeout(350);
  await page.mouse.click(575, 635);
  await page.waitForTimeout(500);
  const modalOpen = await page.evaluate(() =>
    !![...document.querySelectorAll('div')].find((d) => getComputedStyle(d).backdropFilter && getComputedStyle(d).backdropFilter.includes('blur')));
  check('stack click hovered card opens diary', modalOpen, `modal=${modalOpen}`);
  await page.mouse.click(200, 200);
  await page.waitForTimeout(400);

  // wheel focus: 0 → 1 (meta '2 / 6'), no scale pop while focused
  await page.mouse.move(800, 545);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(500);
  await page.mouse.move(300, 600); // clear hover
  await page.waitForTimeout(400);
  const metaFocus = await page.evaluate(() => document.querySelector('[data-testid="bottom-meta"]').textContent);
  check('stack wheel focus 0→1 (meta 2/6)', metaFocus.includes('2 / 6'), metaFocus.trim());
  const focusScales = [];
  for (let j = 0; j < 6; j++) focusScales.push((await cardInfo(j)).scale);
  check('stack focused card scale stays 1 (lift only, no pop)', focusScales.every((s) => Math.abs(s - 1) < 0.02),
    focusScales.map((s) => s.toFixed(2)).join(','));

  // ==== 3. Grid: wider columns (300) + sharp original + hover float ====
  log('--- Grid ---');
  await page.locator('button[aria-label="网格模式"]').click();
  await page.waitForTimeout(700);
  const gridCols = await page.evaluate(() => {
    const g = [...document.querySelectorAll('div')].find((d) => (d.style.gridTemplateColumns || '').includes('minmax'));
    return g ? g.style.gridTemplateColumns : '';
  });
  check('grid columns minmax(300px, 1fr)', gridCols.includes('300px'), gridCols);
  const gridSharp = await page.evaluate(() => {
    const img = document.querySelector('img[alt="测试日记 0"]');
    return img ? img.naturalWidth : 0;
  });
  check('grid uses ORIGINAL image (naturalWidth 800)', gridSharp >= 600, `nw=${gridSharp}`);
  await page.locator('button:has(img[alt="测试日记 0"])').first().hover();
  await page.waitForTimeout(400);
  const gridOk = await page.evaluate(() => {
    const card = [...document.querySelectorAll('button')].find((b) => b.querySelector('img[alt="测试日记 0"]'));
    const overlay = card.querySelector('span span') || card.querySelector('span');
    return parseFloat(getComputedStyle(overlay).opacity) > 0.9;
  });
  check('grid hover float text intact', gridOk);

  // ==== 4. Regression: buttons, cursor, auto-hide, ambient, landing ====
  log('--- Regression ---');
  await page.locator('button[aria-label="长廊模式"]').click();
  await page.waitForTimeout(600);
  const corridorBtn = await page.locator('button:has-text("✦ 翻开这一天")').count();
  check('corridor has 翻开这一天 button', corridorBtn >= 1);
  await page.locator('button[aria-label="叠影模式"]').click();
  await page.waitForTimeout(800);
  const stackBtn = await page.locator('button:has-text("✦ 翻开这一天")').count();
  check('stack has 翻开这一天 button', stackBtn >= 1);

  await page.mouse.move(300, 150);
  await page.waitForTimeout(350);
  const ringBlank = await page.evaluate(() => {
    const outer = [...document.querySelectorAll('div')].find((d) => getComputedStyle(d).zIndex === '999');
    const scaleEl = outer?.firstElementChild?.firstElementChild;
    const t = scaleEl ? getComputedStyle(scaleEl).transform : 'none';
    const m = t !== 'none' && t.match(/matrix\(([^,]+),/);
    return m ? parseFloat(m[1]) : 1;
  });
  check('ring cursor visible on blank', ringBlank > 0.9, `scale=${ringBlank}`);

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
  log('== DONE ==');
})().catch((e) => {
  log('FATAL ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
