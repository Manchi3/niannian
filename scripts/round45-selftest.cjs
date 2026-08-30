// Round 45 self-test — RingCursor always visible, 翻开这一天 restored,
// mode-button hover three-state, stack symmetric hit (left→right AND
// right→left), auto-hide regression.
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

  // 1. RingCursor ALWAYS visible — on blank background (idle scale ≈ 1, not 0)
  const ringScaleAt = async (x, y) => {
    await page.mouse.move(x, y);
    await page.waitForTimeout(400);
    return page.evaluate(() => {
      // Outer cursor holder (z-999) > centering div > SCALING motion.div.
      const outer = [...document.querySelectorAll('div')].find(
        (d) => getComputedStyle(d).zIndex === '999',
      );
      const scaleEl = outer?.firstElementChild?.firstElementChild;
      if (!scaleEl) return { scale: 0, found: false };
      const t = getComputedStyle(scaleEl).transform;
      const m = t !== 'none' && t.match(/matrix\(([^,]+),/);
      return { scale: m ? parseFloat(m[1]) : 1, found: true }; // 'none' ⇒ scale 1
    });
  };
  const blank1 = await ringScaleAt(200, 250); // blank dark background
  const blank2 = await ringScaleAt(1050, 700); // blank bottom-right
  check('ring visible on blank background (scale ≈ 1)', blank1.found && blank1.scale > 0.9 && blank2.scale > 0.9,
    `blank(200,250) scale=${blank1.scale} blank(1050,700) scale=${blank2.scale}`);
  // …and it enlarges over a button (hover affordance still works)
  const overBtn = await ringScaleAt(660, 500); // over a card/button area
  check('ring enlarges over clickable (scale > 1.15)', overBtn.scale > 1.15,
    `overBtn scale=${overBtn.scale}`);

  // 2. Corridor: 翻开这一天 button present + opens the diary
  const corridorBtn = page.locator('button:has-text("✦ 翻开这一天")').first();
  const hasCorridorBtn = await corridorBtn.count();
  check('corridor has 翻开这一天 button', hasCorridorBtn >= 1, `count=${hasCorridorBtn}`);
  if (hasCorridorBtn) {
    const bgBefore = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('翻开这一天'));
      return getComputedStyle(b).backgroundColor;
    });
    await corridorBtn.hover();
    await page.waitForTimeout(250);
    const bgHover = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('翻开这一天'));
      return getComputedStyle(b).backgroundColor;
    });
    check('翻开 button hover brightens', bgHover !== bgBefore, `bg ${bgBefore} → ${bgHover}`);
    await corridorBtn.click();
    await page.waitForTimeout(700);
    const modalOpen = await page.evaluate(() => {
      const h = [...document.querySelectorAll('div')].find((d) => getComputedStyle(d).backdropFilter && getComputedStyle(d).backdropFilter.includes('blur'));
      return !!h;
    });
    check('翻开 button opens diary detail', modalOpen);
    // close the modal — click the backdrop (outside the card)
    await page.mouse.click(100, 700);
    await page.waitForTimeout(500);
  }

  // 3. Mode buttons three-state (idle dim → hover brighten → selected gold)
  // Probe a NON-selected mode (网格 while corridor is selected).
  const modeStroke = async (label) =>
    page.evaluate((lbl) => {
      const btn = [...document.querySelectorAll('button[aria-label]')].find((b) => b.getAttribute('aria-label').startsWith(lbl));
      const svg = btn.querySelector('svg');
      return svg ? getComputedStyle(svg).stroke : 'no-svg';
    }, label);
  const idleStroke = await modeStroke('网格');
  await page.locator('button[aria-label="网格模式"]').hover();
  await page.waitForTimeout(250);
  const hoverStroke = await modeStroke('网格');
  check('mode button idle dim → hover brightens', idleStroke.includes('0.4') && hoverStroke.includes('0.85'),
    `idle=${idleStroke} hover=${hoverStroke}`);
  await page.locator('button[aria-label="网格模式"]').click();
  await page.waitForTimeout(250);
  const selectedStroke = await modeStroke('网格');
  check('mode button selected gold (网格)', selectedStroke.includes('212, 168, 83'), selectedStroke);
  // back to stack for the sweep tests
  await page.locator('button[aria-label="叠影模式"]').click();
  await page.waitForTimeout(800);

  const hoveredCardAt = () =>
    page.evaluate(() => {
      const imgs = [...document.querySelectorAll('img[alt^="测试日记"]')];
      return imgs.map((img) => {
        const m = img.parentElement.parentElement; // motion.div (ImageCard button > motion.div)
        const o = parseFloat(getComputedStyle(m).opacity);
        return { i: parseInt(img.getAttribute('alt').split(' ')[1], 10), o };
      }).filter((x) => x.o > 0.95).map((x) => x.i);
    });

  const sweep = async (fromX, toX) => {
    const hit = new Set();
    const y = 386; // card row
    const steps = 12;
    for (let s = 0; s <= steps; s++) {
      const x = fromX + ((toX - fromX) * s) / steps;
      await page.mouse.move(x, y);
      await page.waitForTimeout(90);
      const h = await hoveredCardAt();
      h.forEach((i) => hit.add(i));
    }
    return [...hit].sort((a, b) => a - b);
  };

  const l2r = await sweep(300, 1000);
  check('stack left→right: EVERY card highlighted', l2r.length === 3 && l2r.join(',') === '0,1,2',
    `hit=${l2r.join(',')}`);
  const r2l = await sweep(1000, 300);
  check('stack right→left: EVERY card highlighted', r2l.length === 3 && r2l.join(',') === '0,1,2',
    `hit=${r2l.join(',')}`);

  // 5. Stack 翻开这一天 button present
  const stackBtn = await page.locator('button:has-text("✦ 翻开这一天")').count();
  check('stack has 翻开这一天 button', stackBtn >= 1, `count=${stackBtn}`);

  // 6. Auto-hide: chrome fades, ambient + cursor stay
  await page.mouse.move(400, 60);
  await page.waitForTimeout(4600); // 3s timer + 800ms fade + margin
  const hiddenState = await page.evaluate(() => {
    const inp = document.querySelector('input[placeholder*="搜索"]');
    const header = inp ? getComputedStyle(inp.closest('header')).opacity : 'no-header';
    const canvases = document.querySelectorAll('canvas').length;
    const ring = [...document.querySelectorAll('div')].some((d) => getComputedStyle(d).zIndex === '999');
    return { header, canvases, ring };
  });
  check('chrome fades after 3s', parseFloat(hiddenState.header) < 0.2, `header=${hiddenState.header}`);
  check('ambient + cursor stay after hide', hiddenState.canvases === 1 && hiddenState.ring,
    `canvases=${hiddenState.canvases} ring=${hiddenState.ring}`);

  // 7. Landing regression
  await page.mouse.move(640, 300);
  await page.waitForTimeout(200);
  await page.locator('button[aria-label="返回首页"]').click();
  await page.waitForTimeout(1600);
  const landing = await page.evaluate(() => ({
    canvases: document.querySelectorAll('canvas').length,
    halo: [...document.querySelectorAll('div')].some((d) => getComputedStyle(d).backgroundImage.includes('radial-gradient')),
  }));
  check('landing particle cloud + halo intact', landing.canvases >= 1 && landing.halo,
    `canvases=${landing.canvases} halo=${landing.halo}`);

  check('no console errors', errors.length === 0, errors.slice(0, 3).join('; '));

  await browser.close();
  console.log('== DONE ==');
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
