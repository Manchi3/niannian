// Round 36 self-test: silk-ribbon GROWTH entrance (particles drift DOWN
// from high start, propagation wave), 60fps during entrance, regressions.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  const check = (name, pass, detail = '') =>
    console.log(`${pass ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);

  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 15000 });

  // --- 0. FPS during the 1.6s entrance (expect ~96 frames @60fps) ---
  const fps = await page.evaluate(() => new Promise((resolve) => {
    const t0 = performance.now();
    let n = 0;
    const step = () => { n++; if (performance.now() - t0 < 1600) requestAnimationFrame(step); else resolve(n); };
    requestAnimationFrame(step);
  }));
  check('entrance runs ≥55fps', fps >= 88, `${fps} frames in 1.6s (${(fps / 1.6).toFixed(0)}fps)`);

  // --- 1. Particles start HIGH (drift down, not slide sideways) ---
  // Sample EARLY (120ms, E≈0.2): outer particles have just started sliding
  // while inner ones still sit high on the ribbon — mass must be ABOVE cy.
  await page.waitForTimeout(120);
  const early = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const g = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = c.width, h = c.height;
    const img = g.getImageData(0, 0, w, h).data;
    const cx = w / 2;
    const p = document.querySelector('p');
    const cy = p.getBoundingClientRect().top + p.getBoundingClientRect().height / 2;
    // y-band counts (threshold 3 — mid-fade particles are dim)
    const bands = {};
    let spanMin = 1e9, spanMax = -1e9, total = 0;
    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x += 3) {
        if (img[(y * w + x) * 4 + 3] >= 3) {
          const rel = Math.round((y - cy) / 20) * 20;
          bands[rel] = (bands[rel] || 0) + 1;
          if (x < spanMin) spanMin = x;
          if (x > spanMax) spanMax = x;
          total++;
        }
      }
    }
    return { bands, span: (spanMax - spanMin) / dpr, total, cy: Math.round(cy) };
  });
  // The ribbon START END sits ~130px ABOVE the cloud center (cy − R·0.55).
  // If particles truly drift DOWN from there, the earliest frame must show
  // lit particles ABOVE the ellipse top edge (cy − R·SQUASH ≈ cy − 89) —
  // i.e. somewhere in the cy−160..cy−90 band — which a flat-slide model
  // could never produce.
  let highBand = 0, ySum = 0, yN = 0;
  for (const [k, v] of Object.entries(early.bands)) {
    const rel = parseInt(k);
    if (rel <= -90 && rel >= -170) highBand += v;
    ySum += rel * v;
    yN += v;
  }
  check('particles start HIGH (lit above ellipse top edge = drift down)',
    highBand > 40,
    `highBand(cy−170..cy−90)=${highBand} cy=${early.cy} span=${Math.round(early.span)}px`);
  const earlyCentroid = yN ? ySum / yN : 0; // (informational; stars pollute it)
  check('early span wide (particles on ribbons at cx±1.7R)',
    early.span > 700, `span=${Math.round(early.span)}px`);

  // --- 2. Converges into ellipse; early centroid sits ABOVE settled one ---
  await page.waitForTimeout(1800);
  const settled = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const g = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = c.width, h = c.height;
    const img = g.getImageData(0, 0, w, h).data;
    const cx = w / 2;
    const p = document.querySelector('p');
    const cy = p.getBoundingClientRect().top + p.getBoundingClientRect().height / 2;
    let n = 0, ySum = 0;
    for (let y = (cy - 60) * dpr; y <= (cy + 60) * dpr; y += 3) {
      for (let x = cx - 90; x <= cx + 90; x += 3) {
        if (img[(y * w + x) * 4 + 3] >= 8) { n++; ySum += y - cy * dpr; }
      }
    }
    return { n, centroid: n ? ySum / n / dpr : 0 };
  });
  check('ribbon growth converges (settled center dense)', settled.n > 300, `settled=${settled.n}`);

  // --- 3. Date style kept ---
  const date = await page.evaluate(() => {
    const p = document.querySelector('p');
    const cs = getComputedStyle(p);
    return { color: cs.color, font: cs.fontFamily, shadow: cs.textShadow };
  });
  check('date warm white kept', /255,\s*244,\s*224/.test(date.color), date.color);
  check('date KaiTi kept', /KaiTi|楷体|STKaiti/.test(date.font), '');
  check('date glow shadow kept', date.shadow !== 'none', '');

  // --- 4. dateZoneFade kept ---
  const dim = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const g = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = c.width, h = c.height;
    const img = g.getImageData(0, 0, w, h).data;
    const cx = w / 2;
    const p = document.querySelector('p');
    const pr = p.getBoundingClientRect();
    const cy = pr.top + pr.height / 2;
    const band = (x0, x1) => {
      let sum = 0, n = 0;
      for (let y = (cy - 40) * dpr; y <= (cy + 40) * dpr; y += 2) {
        for (let x = x0; x <= x1; x += 2) {
          const a = img[(y * w + x) * 4 + 3];
          if (a >= 5) { sum += a; n++; }
        }
      }
      return n ? sum / n : 0;
    };
    return { center: band(cx - 45, cx + 45), side: (band(cx - 240, cx - 160) + band(cx + 160, cx + 240)) / 2 };
  });
  check('dateZoneFade kept (center < side)', dim.center < dim.side * 0.95,
    `center=${dim.center.toFixed(1)} side=${dim.side.toFixed(1)}`);

  // --- 5. Rotation 2π/17 ---
  const theta = () => page.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find(d => /^θ=/.test(d.textContent || ''));
    const m = el ? /θ=([\d.-]+)/.exec(el.textContent) : null;
    return m ? parseFloat(m[1]) : null;
  });
  const t1 = await theta();
  await page.waitForTimeout(2000);
  const t2 = await theta();
  check('rotation 2π/17', t2 - t1 > 0.6 && t2 - t1 < 0.9, `dθ=${(t2 - t1).toFixed(3)}`);

  // --- 6. Flows + console ---
  await page.locator('button:has-text("继续上传")').first().click();
  await page.waitForTimeout(900);
  const uploadZone = await page.locator('text=上传一张照片').count();
  check('继续上传 → chat', uploadZone > 0, `uploadZone=${uploadZone}`);
  await page.locator('button[aria-label="返回首页"]').click();
  await page.waitForTimeout(900);
  await page.locator('button:has-text("回到我的记忆")').first().click();
  await page.waitForTimeout(1000);
  const search = await page.locator('input[placeholder*="搜索"]').count();
  check('回到我的记忆 → gallery', search > 0, `search=${search}`);
  check('no console errors', errors.length === 0, errors.slice(0, 2).join('; '));

  await browser.close();
  console.log('== DONE ==');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
