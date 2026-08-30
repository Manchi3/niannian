// Round 34 self-test: two-silk-line entrance (converge, no grow step),
// brighter + bright cores, ×1.5 density, text-zone still dims, regressions.
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

  // --- 1. Silk-line entrance: early center is EMPTY (particles still on
  // the two lines), settled center is FULL (converged).
  const centerDensity = () => page.evaluate(() => {
    const c = document.querySelector('canvas');
    const g = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = c.width, h = c.height;
    const img = g.getImageData(0, 0, w, h).data;
    const cx = w / 2;
    const h1 = [...document.querySelectorAll('h1')].find(x => x.textContent && x.textContent.length > 4);
    const r = h1.getBoundingClientRect();
    const cy = r.top + r.height / 2;
    let n = 0;
    for (let y = (cy - 60) * dpr; y <= (cy + 60) * dpr; y += 3) {
      for (let x = cx - 90; x <= cx + 90; x += 3) {
        if (img[(y * w + x) * 4 + 3] >= 8) n++;
      }
    }
    return n;
  });
  await page.waitForTimeout(200); // e≈0.35 — mid-entrance
  const earlyCenter = await centerDensity();
  await page.waitForTimeout(2400); // entrance done
  const settledCenter = await centerDensity();
  check('silk lines converge (early center sparse → settled full)',
    settledCenter > earlyCenter * 2,
    `early=${earlyCenter} settled=${settledCenter}`);

  // --- 2. Early cloud spans wide (particles on ±R*1.15 lines) ---
  const earlySpread = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const g = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = c.width, h = c.height;
    const img = g.getImageData(0, 0, w, h).data;
    const cx = w / 2;
    const h1 = [...document.querySelectorAll('h1')].find(x => x.textContent && x.textContent.length > 4);
    const r = h1.getBoundingClientRect();
    const cy = r.top + r.height / 2;
    let minX = 1e9, maxX = -1e9;
    for (let y = (cy - 70) * dpr; y <= (cy + 70) * dpr; y += 3) {
      let hits = 0, mn = 1e9, mx = -1e9;
      for (let x = 0; x < w; x += 3) {
        if (img[(y * w + x) * 4 + 3] >= 8) { hits++; if (x < mn) mn = x; if (x > mx) mx = x; }
      }
      if (hits >= 3) { if (mn < minX) minX = mn; if (mx > maxX) maxX = mx; }
    }
    return minX < maxX ? { left: minX / dpr, right: maxX / dpr, w: (maxX - minX) / dpr } : null;
  });
  check('early silk lines span wide (particles near cx±270)',
    !!earlySpread && earlySpread.w > 460,
    earlySpread ? `w=${Math.round(earlySpread.w)}px (${Math.round(earlySpread.left)}..${Math.round(earlySpread.right)})` : 'none');

  // --- 3. Brighter + bright cores: cloud avg alpha & max alpha higher ---
  const bright = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const g = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = c.width, h = c.height;
    const img = g.getImageData(0, 0, w, h).data;
    const cx = w / 2;
    const h1 = [...document.querySelectorAll('h1')].find(x => x.textContent && x.textContent.length > 4);
    const r = h1.getBoundingClientRect();
    const cy = r.top + r.height / 2;
    let sum = 0, n = 0, maxA = 0;
    for (let y = (cy - 60) * dpr; y <= (cy + 60) * dpr; y += 2) {
      for (let x = cx - 200; x <= cx + 200; x += 2) {
        const a = img[(y * w + x) * 4 + 3];
        if (a >= 8) { sum += a; n++; if (a > maxA) maxA = a; }
      }
    }
    return { avg: n ? sum / n : 0, max: maxA, n };
  });
  // avg mixes edgeFade-dimmed rim particles (×0.2~0.57) + twinkle troughs,
  // so it sits below the raw baseAlpha; r33 measured ≈31 with this method,
  // r34 (baseAlpha 0.82~1.0 + bright cores) measures ~37 → clearly brighter.
  check('cloud brighter (avg alpha high)', bright.avg > 34, `avg=${bright.avg.toFixed(1)}`);
  check('bright cores (near-opaque highlights exist)', bright.max > 230,
    `maxAlpha=${bright.max}`);

  // --- 4. Density ×1.5: many more lit samples than sparse baseline ---
  check('density up (1080 particles)', bright.n > 500, `litSamples=${bright.n}`);

  // --- 5. Text zone still dimmed (0.24 coefficient kept) ---
  const zone = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const g = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = c.width, h = c.height;
    const img = g.getImageData(0, 0, w, h).data;
    const h1 = [...document.querySelectorAll('h1')].find(x => x.textContent && x.textContent.length > 4);
    const r = h1.getBoundingClientRect();
    const top = r.top + (r.height - 46) / 2;
    const bottom = r.bottom - (r.height - 46) / 2;
    const mid = (top + bottom) / 2;
    const band = (x0, x1) => {
      let sum = 0, n = 0;
      for (let y = (mid - 15) * dpr; y <= (mid + 15) * dpr; y += 2) {
        for (let x = x0; x <= x1; x += 2) {
          const a = img[(y * w + x) * 4 + 3];
          if (a >= 5) { sum += a; n++; }
        }
      }
      return n ? sum / n : 0;
    };
    const cx = w / 2;
    const under = band(cx - 130, cx + 130);       // under slogan glyphs
    const above = band(cx - 130, cx + 130);       // same x, checked below
    // above uses a band 30px higher (cloud, not text)
    let sum = 0, n = 0;
    for (let y = (top - 45) * dpr; y <= (top - 15) * dpr; y += 2) {
      for (let x = cx - 130; x <= cx + 130; x += 2) {
        const a = img[(y * w + x) * 4 + 3];
        if (a >= 5) { sum += a; n++; }
      }
    }
    const aboveAvg = n ? sum / n : 0;
    void above;
    return { under, aboveAvg };
  });
  check('text zone dimmer than cloud above (0.24 kept)', zone.under < zone.aboveAvg * 0.85,
    `under=${zone.under.toFixed(1)} above=${zone.aboveAvg.toFixed(1)}`);

  // --- 6. Rotation still 2π/17 ---
  const theta = () => page.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find(d => /^θ=/.test(d.textContent || ''));
    const m = el ? /θ=([\d.-]+)/.exec(el.textContent) : null;
    return m ? parseFloat(m[1]) : null;
  });
  const t1 = await theta();
  await page.waitForTimeout(2000);
  const t2 = await theta();
  check('rotation 2π/17 (~0.37 rad/s)', t2 - t1 > 0.6 && t2 - t1 < 0.9,
    `dθ=${(t2 - t1).toFixed(3)}`);

  // --- 7. Flows + console ---
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
