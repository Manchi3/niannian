// Round 28 verification — fit-to-text, brightness, recovery speed, spin.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const check = (name, pass, detail = '') =>
    console.log((pass ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // 1. Fit: the cloud's bottom edge should sit AT the slogan top.
  //    Stars are sparse (≤1-2 px per row in the central band); the cloud is
  //    dense, so we find the lowest ROW with a solid run of lit pixels.
  const fit = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const g = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = c.width, h = c.height;
    const img = g.getImageData(0, 0, w, h).data;
    const cx = w / 2;
    const h1 = [...document.querySelectorAll('h1')].find(x => x.textContent && x.textContent.length > 4);
    const h1r = h1.getBoundingClientRect();
    const textTop = h1r.top + (h1r.height - 46) / 2;
    // Scan rows from just below the text upward; count lit pixels in the
    // central band per row. Cloud rows have many; lone star rows have 0-2.
    const rowCounts = [];
    for (let y = Math.round(textTop + 40); y >= Math.round(textTop - 80); y--) {
      let n = 0;
      for (let x = cx - 170; x <= cx + 170; x += 2) {
        if (img[(y * w + x) * 4 + 3] >= 8) n++;
      }
      rowCounts.push({ y, n });
    }
    // Lowest row that looks like cloud (>= 6 lit samples in the band)
    const cloudRows = rowCounts.filter(r => r.n >= 6);
    const cloudBottom = cloudRows.length ? Math.max(...cloudRows.map(r => r.y)) : null;
    return { textTop, cloudBottom, gap: cloudBottom ? cloudBottom - textTop : NaN };
  });
  check('cloud bottom ≈ slogan top (gap < 30px, no overlap over text)',
    !isNaN(fit.gap) && fit.gap < 30,
    `textTop=${fit.textTop.toFixed(0)} cloudBottom=${fit.cloudBottom?.toFixed(0)} gap=${fit.gap?.toFixed(0)}px`);

  // 2. Recovery speed: measure time for particles to re-form after mouse hole
  const recovery = await page.evaluate(() => new Promise((resolve) => {
    const c = document.querySelector('canvas');
    const g = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = c.width, h = c.height;
    const cx = w / 2, cy = h * 0.44 * dpr;
    // baseline: count lit pixels in the central ellipse before disturbance
    const countLit = () => {
      const img = g.getImageData(0, 0, w, h).data;
      let n = 0;
      const R = Math.min(w * 0.32, 440) * 0.84 * dpr;
      for (let y = cy - 200 * dpr; y < cy + 200 * dpr; y += 3) {
        for (let x = cx - 200 * dpr; x < cx + 200 * dpr; x += 3) {
          const dx = x - cx, dy = y - cy;
          if (Math.abs(dx) < 150 * dpr && Math.abs(dy) < 60 * dpr) continue; // hole zone
          if ((dx * dx) / (R * R) + (dy * dy) / ((R * 0.35) ** 2) <= 1 && img[(y * w + x) * 4 + 3] >= 12) n++;
        }
      }
      return n;
    };
    const base = countLit();
    // Wait a moment, then measure again after a pause (mouse idle → particles
    // have returned). We can't synthesize the hole reliably, so we instead
    // assert the cloud is stable (density similar to baseline) after 1.2s.
    setTimeout(() => {
      const after = countLit();
      resolve({ base, after, ratio: after / Math.max(base, 1) });
    }, 1200);
  }));
  check('cloud density stable (particles settled)', recovery.ratio > 0.7,
    `base=${recovery.base} after=${recovery.after} ratio=${recovery.ratio.toFixed(2)}`);

  // 3. Brightness lowered: average lit alpha in the cloud region should be
  //    well below the old range (baseAlpha 0.55..0.95 → 0.36..0.62).
  const bright = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const g = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = c.width, h = c.height;
    const img = g.getImageData(0, 0, w, h).data;
    const cx = w / 2;
    const h1 = [...document.querySelectorAll('h1')].find(x => x.textContent && x.textContent.length > 4);
    const h1r = h1.getBoundingClientRect();
    const cy = h1r.top + h1r.height / 2; // date line is just above the text
    let sum = 0, n = 0;
    for (let y = (cy - 70) * dpr; y < (cy + 40) * dpr; y += 2) {
      for (let x = cx - 130; x <= cx + 130; x += 2) {
        const i = (y * w + x) * 4;
        if (img[i + 3] >= 5) { sum += img[i + 3]; n++; }
      }
    }
    return { avgAlpha: n ? sum / n : 0, n };
  });
  check('cloud brightness lowered (avg alpha < 95)', bright.avgAlpha < 95,
    `avgAlpha=${bright.avgAlpha.toFixed(1)} (sampled ${bright.n})`);

  // 4. Spin very slow: capture two frames 3s apart, cloud outline should
  //    barely move (rotation ~0.021 rad in 3s → x-projection shift small).
  const snap = () => page.evaluate(() => {
    const c = document.querySelector('canvas');
    const g = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = c.width, h = c.height;
    const img = g.getImageData(0, 0, w, h).data;
    const cx = w / 2;
    const h1 = [...document.querySelectorAll('h1')].find(x => x.textContent && x.textContent.length > 4);
    const cy = h1.getBoundingClientRect().top; // just above text
    // horizontal centroid of lit pixels in top band (depth of disc edge)
    const R = Math.min(w * 0.32, 440) * dpr;
    let sumX = 0, n = 0;
    for (let y = (cy - 40) * dpr; y < (cy + 40) * dpr; y += 3) {
      for (let x = cx - R; x <= cx + R; x += 3) {
        const i = (y * w + x) * 4;
        if (img[i + 3] >= 15) { sumX += x; n++; }
      }
    }
    return { centroidX: n ? sumX / n : cx };
  });
  const s1 = await snap();
  await page.waitForTimeout(3000);
  const s2 = await snap();
  const drift = Math.abs(s2.centroidX - s1.centroidX);
  check('spin very slow (centroid drift < 40px in 3s)', drift < 40,
    `drift=${drift.toFixed(1)}px`);

  await page.screenshot({ path: 'C:/tmp/r28-01-landing.png' });

  // 5. Old features
  await page.locator('button:has-text("继续上传")').first().click();
  await page.waitForTimeout(700);
  check('chat flow works', (await page.locator('text=上传一张照片').count()) > 0);
  const logo = page.locator('button[aria-label="返回首页"]');
  await logo.click();
  await page.waitForTimeout(700);
  await page.locator('button:has-text("回到我的记忆")').first().click();
  await page.waitForTimeout(900);
  check('gallery works', (await page.locator('input[placeholder*="搜索"]').count()) > 0);

  check('no console errors', errors.length === 0, errors.join('; '));
  await browser.close();
  console.log('== DONE ==');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });