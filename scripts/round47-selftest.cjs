// Round 47 self-test — corridor all-render + drag; stack container-rect
// collision + compact staircase; landing uniform particles (no dim box).
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

  // ---- Landing: uniform particles behind the slogan (no dim box) ----
  const landingOk = await page.evaluate(() => {
    // the slogan text container must be fully transparent
    const h1 = [...document.querySelectorAll('h1')].find((x) => x.textContent && x.textContent.length > 4);
    const h1Bg = h1 ? getComputedStyle(h1.parentElement).backgroundColor : '?';
    const c = document.querySelector('canvas');
    const g = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = c.width, h = c.height;
    const img = g.getImageData(0, 0, w, h).data;
    const h1r = h1.getBoundingClientRect();
    const textY = Math.round((h1r.top + h1r.height / 2) * dpr);
    // Text row vs a row 40px ABOVE the text (same x band 560-720, both
    // inside the cloud). dateZoneFade dims the above row MORE (closer to
    // the date) — so with the text-zone dim OFF, textRow ≥ aboveRow.
    // With the old TEXT_ZONE dim ON, textRow would collapse to ~0.27×.
    const sample = (y) => {
      let sum = 0, n = 0;
      for (let x = 560 * dpr; x <= 720 * dpr; x += 4) {
        const a = img[(y * w + x) * 4 + 3];
        if (a >= 3) { sum += a; n++; }
      }
      return n ? sum / n : 0;
    };
    const textRow = sample(textY);
    const aboveRow = sample(textY - 40 * dpr);
    return { h1Bg, textRow, aboveRow, ratio: aboveRow > 0 ? textRow / aboveRow : 0 };
  });
  check('landing slogan container fully transparent', landingOk.h1Bg === 'rgba(0, 0, 0, 0)' || landingOk.h1Bg === 'transparent',
    `bg=${landingOk.h1Bg}`);
  check('landing particles uniform behind text (no dim box)', landingOk.ratio > 0.6,
    `textRow=${landingOk.textRow.toFixed(1)} aboveRow=${landingOk.aboveRow.toFixed(1)} ratio=${landingOk.ratio.toFixed(2)}`);

  // ---- Seed 6 diaries ----
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

  const cardCount = () => page.evaluate(() =>
    [...document.querySelectorAll('img[alt^="测试日记"]')].length);

  // ==== 1. Corridor: ALL cards always rendered (no cull pop) ====
  const count0 = await cardCount();
  check('corridor renders ALL 6 cards (no culling)', count0 === 6, `count=${count0}`);
  // wheel 0 → 1 (and to the last) — count stays 6, no card pops
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(450);
  const count1 = await cardCount();
  const meta1 = await page.evaluate(() => document.querySelector('[data-testid="bottom-meta"]').textContent);
  check('corridor wheel 0→1 keeps all cards', count1 === 6 && meta1.includes('2 / 6'), `count=${count1} ${meta1.trim()}`);
  for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(250); }
  const countLast = await cardCount();
  const metaLast = await page.evaluate(() => document.querySelector('[data-testid="bottom-meta"]').textContent);
  check('corridor at LAST card keeps all cards', countLast === 6 && metaLast.includes('6 / 6'), `count=${countLast} ${metaLast.trim()}`);

  // ==== 2. Corridor: DRAG to switch ====
  // Spec direction: drag LEFT → next card (idx+1); drag RIGHT → previous.
  // Currently at idx=5 (6/6). Drag RIGHT first → 5/6, then LEFT → 6/6.
  await page.mouse.move(480, 386);
  await page.mouse.down();
  for (let x = 480; x <= 640; x += 20) { await page.mouse.move(x, 386); await page.waitForTimeout(15); }
  await page.mouse.up();
  await page.waitForTimeout(700);
  const metaDragR = await page.evaluate(() => document.querySelector('[data-testid="bottom-meta"]').textContent);
  check('corridor drag right switches to previous card (5/6)', metaDragR.includes('5 / 6'), metaDragR.trim());
  // drag left → back to last card
  await page.mouse.down();
  for (let x = 640; x >= 480; x -= 20) { await page.mouse.move(x, 386); await page.waitForTimeout(15); }
  await page.mouse.up();
  await page.waitForTimeout(700);
  const metaDragL = await page.evaluate(() => document.querySelector('[data-testid="bottom-meta"]').textContent);
  check('corridor drag left switches to next card (6/6)', metaDragL.includes('6 / 6'), metaDragL.trim());
  // NO diary modal should have opened from the drags (stray click swallowed)
  const modalFromDrag = await page.evaluate(() =>
    !![...document.querySelectorAll('div')].find((d) => getComputedStyle(d).backdropFilter && getComputedStyle(d).backdropFilter.includes('blur')));
  check('drag does NOT open the diary modal (click suppressed)', !modalFromDrag, `modal=${modalFromDrag}`);

  // ==== 3. Stack: compact staircase + container-rect collision ====
  // Safety: close any stray modal before switching views.
  await page.mouse.click(100, 700);
  await page.waitForTimeout(300);
  await page.locator('button[aria-label="叠影模式"]').click();
  await page.waitForTimeout(900);

  const cardBoxes = () =>
    page.evaluate(() => {
      const out = {};
      [...document.querySelectorAll('img[alt^="测试日记"]')].forEach((img) => {
        const b = img.closest('button').parentElement;
        const r = b.getBoundingClientRect();
        const cs = getComputedStyle(b);
        const m = cs.transform.match(/matrix\(([^,]+),([^,]+),([^,]+),([^,]+)/);
        out[parseInt(img.getAttribute('alt').split(' ')[1], 10)] = {
          x: r.x, y: r.y, w: r.width, h: r.height,
          scale: cs.transform !== 'none' && m ? parseFloat(m[1]) : 1,
          b: m ? parseFloat(m[2]) : 0, // rotation component
        };
      });
      return out;
    });

  const boxes = await cardBoxes();
  const c0 = boxes[0], c5 = boxes[5];
  // 5 steps between card 0 and card 5 (48/32 per step)
  const dX = (c5.x + c5.w / 2 - (c0.x + c0.w / 2)) / 5;
  const dY = (c5.y + c5.h / 2 - (c0.y + c0.h / 2)) / 5;
  check('stack compact staircase (48 / 32 per step)', dX > 42 && dX < 54 && dY > 26 && dY < 38,
    `dX=${dX.toFixed(1)} dY=${dY.toFixed(1)}`);
  check('stack cards upright (rotate ≈ 0)', Math.abs(c0.b) < 0.01 && Math.abs(c5.b) < 0.01,
    `b0=${c0.b} b5=${c5.b}`);

  // strict-rect collision: sweep across the card row — EVERY card incl. middle
  const sweepHit = async (fromX, toX) => {
    const hit = new Set();
    for (let x = fromX; x <= toX; x += 20) {
      await page.mouse.move(x, 386);
      await page.waitForTimeout(120); // spring settle (~150ms)
      const bx = await cardBoxes();
      Object.entries(bx).forEach(([k, v]) => { if (v.scale > 1.08) hit.add(parseInt(k, 10)); });
    }
    return [...hit].sort((a, b) => a - b);
  };
  await page.mouse.move(400, 60);
  await page.waitForTimeout(400);
  const sweepAll = await sweepHit(320, 1000);
  check('stack sweep hits EVERY card incl. middle (0..5)', sweepAll.join(',') === '0,1,2,3,4,5',
    `hit=${sweepAll.join(',')}`);

  // blank bands (inside the deck, outside every card rect) → no hover
  const sweepNoHover = async (y) => {
    for (let x = 320; x <= 1000; x += 80) {
      await page.mouse.move(x, y);
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(300);
    const bx = await cardBoxes();
    return Object.values(bx).every((v) => v.scale < 1.08);
  };
  const blankAbove = await sweepNoHover(182); // above the topmost card edge
  await page.mouse.move(400, 60); await page.waitForTimeout(300);
  const blankBelow = await sweepNoHover(700); // below the deck
  check('stack blank band above cards → no hover', blankAbove, 'y=182');
  check('stack blank band below deck → no hover', blankBelow, 'y=700');

  // wheel focus still works (meta shows focus card after leaving the deck)
  await page.mouse.move(640, 386);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(400);
  await page.mouse.move(400, 60);
  await page.waitForTimeout(400);
  const metaFocus = await page.evaluate(() => document.querySelector('[data-testid="bottom-meta"]').textContent);
  check('stack wheel focus switches (3/6 → 4/6)', metaFocus.includes('4 / 6'), metaFocus.trim());

  // ==== 4. Regression: buttons, cursor, grid, auto-hide, landing ====
  const stackBtn = await page.locator('button:has-text("✦ 翻开这一天")').count();
  check('stack has 翻开这一天 button', stackBtn >= 1);
  await page.locator('button[aria-label="长廊模式"]').click();
  await page.waitForTimeout(600);
  const corridorBtn = await page.locator('button:has-text("✦ 翻开这一天")').count();
  check('corridor has 翻开这一天 button', corridorBtn >= 1);

  const ringScale = await page.evaluate(() => {
    const outer = [...document.querySelectorAll('div')].find((d) => getComputedStyle(d).zIndex === '999');
    const scaleEl = outer?.firstElementChild?.firstElementChild;
    if (!scaleEl) return 0;
    const t = getComputedStyle(scaleEl).transform;
    const m = t !== 'none' && t.match(/matrix\(([^,]+),/);
    return m ? parseFloat(m[1]) : 1;
  });
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
  console.log('== DONE ==');
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
