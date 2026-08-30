// Round 44 self-test — DiaryGallery: stack hit insurance + parallax, pure
// image cards, grid hover float text, RingCursor + cursor:none, ambient
// background always-on, filter 3-state brightness, auto-hide regression.
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

  // --- Seed 3 v2 diaries ---
  const seeded = await page.evaluate(async () => {
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
  check('seed 3 diaries', seeded === true);

  // --- Go to gallery ---
  await page.locator('button:has-text("回到我的记忆")').first().click();
  await page.waitForTimeout(2200);

  // 1. Ambient background always present (stars canvas + breathing halo)
  const ambient = await page.evaluate(() => {
    const canvases = document.querySelectorAll('canvas').length;
    const halo = [...document.querySelectorAll('div')].find(
      (d) => getComputedStyle(d).backgroundImage.includes('radial-gradient'),
    );
    const haloAnim = halo ? getComputedStyle(halo).animationName : '';
    const ring = [...document.querySelectorAll('div')].find((d) => getComputedStyle(d).zIndex === '999');
    return { canvases, hasHalo: !!halo, breathing: haloAnim.includes('breathe'), ringCursor: !!ring };
  });
  check('ambient stars canvas present', ambient.canvases === 1, `canvases=${ambient.canvases}`);
  check('golden halo present + breathing', ambient.hasHalo && ambient.breathing);
  check('ring cursor element present', ambient.ringCursor);

  // 2. cursor:none across the page
  const cursors = await page.evaluate(() => {
    const root = document.querySelector('.gallery-root');
    const btn = document.querySelector('.gallery-root button');
    return { root: getComputedStyle(root).cursor, btn: btn ? getComputedStyle(btn).cursor : 'no-btn' };
  });
  check('system cursor hidden (cursor none)', cursors.root === 'none' && cursors.btn === 'none', JSON.stringify(cursors));

  // 3. Stack mode: pure images + every card hoverable (hit insurance)
  await page.locator('button[aria-label="叠影模式"]').click();
  await page.waitForTimeout(700);
  const pureImages = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')].filter(
      (b) => b.querySelector('img[alt^="测试日记"]'),
    );
    return btns.map((b) => ({ text: b.textContent.trim(), imgs: b.querySelectorAll('img').length }));
  });
  check('stack cards are PURE images (no caption text)', pureImages.length === 3 && pureImages.every((c) => c.text === '' && c.imgs === 1),
    JSON.stringify(pureImages));

  const hoverCard = async (i) => {
    const card = page.locator(`button:has(img[alt="测试日记 ${i}"])`);
    const box = await card.boundingBox();
    // hover the LEFT strip (x=12% width) — exposed for every card
    await page.mouse.move(box.x + box.width * 0.12, box.y + box.height * 0.5);
    await page.waitForTimeout(450); // let the spring settle
    return page.evaluate((idx) => {
      const b = [...document.querySelectorAll('button')].find(
        (x) => x.querySelector(`img[alt="测试日记 ${idx}"]`),
      );
      const w = b.parentElement; // motion.div wrapper
      const cs = getComputedStyle(w);
      return { opacity: parseFloat(cs.opacity), scale: new DOMMatrix(cs.transform).a, shadow: cs.boxShadow };
    }, i);
  };

  let allHit = true;
  const hoverStates = [];
  for (let i = 0; i < 3; i++) {
    // Leave the deck first so the previous hovered card's z=40 doesn't
    // cover the next card's hit strip (inherent to the z scheme — each
    // card is reachable from the idle state).
    await page.mouse.move(400, 60);
    await page.waitForTimeout(450);
    const st = await hoverCard(i);
    hoverStates.push(st);
    if (!(st.opacity > 0.95 && st.scale > 1.04 && st.shadow.includes('212, 168, 83'))) allHit = false;
  }
  check('EVERY card (incl. middle) pops on hover', allHit,
    JSON.stringify(hoverStates.map((s) => ({ o: s.opacity.toFixed(2), s: s.scale.toFixed(2) }))));

  // 4. Parallax: deck transform follows the pointer (inside the deck)
  // First reset to idle (leave the deck → hover null + parallax zeroed).
  await page.mouse.move(400, 60); // header area, outside the stack container
  await page.waitForTimeout(600);
  await page.mouse.move(640, 430); // deck center → mx≈0
  await page.waitForTimeout(600);
  const deckBefore = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="stack-deck"]');
    return getComputedStyle(el).transform;
  });
  await page.mouse.move(1050, 480); // inside the deck (right side) — strong parallax offset
  await page.waitForTimeout(600);
  const deckAfter = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="stack-deck"]');
    return getComputedStyle(el).transform;
  });
  const parX = (m) => (m.match(/matrix\([^)]*\)/) ? parseFloat(m.match(/matrix\(([^,]*),/)[1]) : 0);
  const dX = (() => {
    const a = deckAfter.match(/matrix\(([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^)]+)\)/);
    const b = deckBefore.match(/matrix\(([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^)]+)\)/);
    return a && b ? Math.abs(parseFloat(a[5]) - parseFloat(b[5])) : 999;
  })();
  check('stack deck parallax follows pointer (dx > 2px)', dX > 2,
    `before=${deckBefore} after=${deckAfter} dX=${dX.toFixed(2)}`);

  // Reset to idle before the per-card hover checks.
  await page.mouse.move(400, 60);
  await page.waitForTimeout(500);

  // 5. Bottom meta line follows hover (title + i/n)
  await hoverCard(2);
  const meta1 = await page.evaluate(() => document.querySelector('[data-testid="bottom-meta"]').textContent);
  await hoverCard(0);
  await page.waitForTimeout(300);
  const meta2 = await page.evaluate(() => document.querySelector('[data-testid="bottom-meta"]').textContent);
  check('bottom meta follows hovered card', meta1.includes('测试日记 2') && meta1.includes('3 / 3') && meta2.includes('测试日记 0') && meta2.includes('1 / 3'),
    `m1="${meta1.trim()}" m2="${meta2.trim()}"`);

  // 6. Corridor: pure images + bottom meta on wheel switch
  await page.locator('button[aria-label="长廊模式"]').click();
  await page.waitForTimeout(600);
  const corridorPure = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')].filter((b) => b.querySelector('img[alt^="测试日记"]'));
    return btns.every((b) => b.textContent.trim() === '');
  });
  check('corridor cards are pure images', corridorPure);

  // 7. Grid: hover floats text inside image (no bg block) + golden glow
  await page.locator('button[aria-label="网格模式"]').click();
  await page.waitForTimeout(600);
  const gridCard = page.locator('button:has(img[alt="测试日记 0"])').first();
  await gridCard.hover();
  await page.waitForTimeout(350);
  const gridState = await page.evaluate(() => {
    const card = [...document.querySelectorAll('button')].find((b) => b.querySelector('img[alt="测试日记 0"]'));
    const overlay = card.querySelector('span span') || card.querySelector('span');
    const cs = getComputedStyle(card);
    const os = getComputedStyle(overlay);
    return {
      cardOpacity: cs.opacity,
      shadow: cs.boxShadow,
      overlayOpacity: os.opacity,
      overlayBg: os.backgroundColor,
      title: overlay.textContent,
    };
  });
  check('grid hover: float text visible (no bg block)',
    parseFloat(gridState.overlayOpacity) > 0.9 && gridState.overlayBg === 'rgba(0, 0, 0, 0)',
    `overlayOpacity=${gridState.overlayOpacity} bg=${gridState.overlayBg} title="${gridState.title?.trim()}"`);
  check('grid hover: golden glow ring', gridState.shadow.includes('212, 168, 83'),
    gridState.shadow);
  check('grid idle opacity 0.92', Math.abs(parseFloat(gridState.cardOpacity) - 0.92) < 0.02,
    `opacity=${gridState.cardOpacity}`);

  // 8. Filter buttons: dim idle → brighter hover → gold selected
  const filterColor = async (label) =>
    page.evaluate((lbl) => {
      const btn = [...document.querySelectorAll('nav button')].find((b) => b.textContent.trim() === lbl);
      return btn ? getComputedStyle(btn).color : 'no-btn';
    }, label);
  const idleColor = await filterColor('对话中');
  const hoverBtn = page.locator('nav button:has-text("对话中")');
  await hoverBtn.hover();
  await page.waitForTimeout(250);
  const hoverColor = await filterColor('对话中');
  await page.locator('nav button:has-text("对话中")').click();
  await page.waitForTimeout(250);
  const selColor = await filterColor('对话中');
  check('filter idle dim (0.4)', idleColor.includes('0.4'), idleColor);
  check('filter hover brighter (0.85)', hoverColor.includes('0.85'), hoverColor);
  check('filter selected gold', selColor.includes('212, 168, 83'), selColor);

  // 9. Auto-hide 3s: chrome fades, ambient + cursor stay
  await page.mouse.move(640, 400);
  await page.waitForTimeout(300);
  await page.waitForTimeout(3300);
  const hiddenState = await page.evaluate(() => {
    const inp = document.querySelector('input[placeholder*="搜索"]');
    const header = inp ? getComputedStyle(inp.closest('header')).opacity : 'no-header';
    const canvases = document.querySelectorAll('canvas').length;
    const ring = [...document.querySelectorAll('div')].some((d) => getComputedStyle(d).zIndex === '999');
    return { header, canvases, ring };
  });
  check('chrome fades after 3s', parseFloat(hiddenState.header) < 0.2, `header=${hiddenState.header}`);
  check('ambient background + cursor stay after hide', hiddenState.canvases === 1 && hiddenState.ring,
    `canvases=${hiddenState.canvases} ring=${hiddenState.ring}`);

  // 10. Landing regression: particle cloud + halo intact
  await page.mouse.move(640, 300);
  await page.waitForTimeout(200);
  await page.locator('button[aria-label="返回首页"]').click();
  await page.waitForTimeout(1600);
  const landing = await page.evaluate(() => {
    const canvases = document.querySelectorAll('canvas').length;
    const halo = [...document.querySelectorAll('div')].some((d) => getComputedStyle(d).backgroundImage.includes('radial-gradient'));
    return { canvases, halo };
  });
  check('landing particle cloud + halo intact', landing.canvases >= 1 && landing.halo,
    `canvases=${landing.canvases} halo=${landing.halo}`);

  check('no console errors', errors.length === 0, errors.slice(0, 3).join('; '));

  await browser.close();
  console.log('== DONE ==');
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
