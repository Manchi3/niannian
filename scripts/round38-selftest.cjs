// Round 38 self-test: form B = p.x/p.y (real landing spots). Verifies NO
// hollow-ring stage, NO hard cut at M=1, red-line audit, regressions.
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  const check = (name, pass, detail = '') =>
    console.log(`${pass ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);

  // --- 0. Red line + ellipseShape deleted ---
  const src = fs.readFileSync('src/components/EllipseParticles.tsx', 'utf8');
  check('red line: zero overshoot easing', !/Math\.pow\(localE|1\s*\+\s*2\.7|1\.7\s*\*\s*Math\.pow|easeOutBack/.test(src), '');
  const fnDefs = (src.match(/function\s+(\w+)/g) || []).join(',');
  check('ellipseShape function deleted', !/function\s+ellipseShape/.test(src),
    `fns=${fnDefs}`);

  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 15000 });

  // --- 1. NO hollow ring: sample the cloud CENTER band through the whole
  // entrance. A hollow-ring form B would leave the center nearly empty at
  // the end of the morph; a solid cloud (form B = p.x/p.y) fills it.
  // Record the time series, then check the LAST third is dense.
  const series = await page.evaluate(() => new Promise((resolve) => {
    const dpr = window.devicePixelRatio || 1;
    const samples = [];
    const sample = () => {
      const c = document.querySelector('canvas');
      const g = c.getContext('2d');
      const w = c.width, h = c.height;
      const img = g.getImageData(0, 0, w, h).data;
      const cx = w / 2;
      const p = document.querySelector('p');
      const cy = p.getBoundingClientRect().top + p.getBoundingClientRect().height / 2;
      let n = 0;
      for (let y = (cy - 55) * dpr; y <= (cy + 55) * dpr; y += 2) {
        for (let x = cx - 80; x <= cx + 80; x += 2) {
          if (img[(y * w + x) * 4 + 3] >= 6) n++;
        }
      }
      samples.push(n);
      if (samples.length < 22) setTimeout(sample, 95); else resolve(samples);
    };
    sample();
  }));
  const lastThird = series.slice(-7);
  const lateAvg = lastThird.reduce((a, b) => a + b, 0) / lastThird.length;
  check('no hollow ring: center dense at morph end (solid cloud)',
    lateAvg > 60, `lateAvg=${lateAvg.toFixed(0)} (${lastThird.join(',')})`);

  // --- 2. NO hard cut: cloud stays put right after the entrance ---
  const pos1 = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const g = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = c.width, h = c.height;
    const img = g.getImageData(0, 0, w, h).data;
    const cx = w / 2;
    const p = document.querySelector('p');
    const cy = p.getBoundingClientRect().top + p.getBoundingClientRect().height / 2;
    // centroid of the lit cloud in a tight box around center
    let sx = 0, sy = 0, n = 0;
    for (let y = (cy - 90) * dpr; y <= (cy + 90) * dpr; y += 2) {
      for (let x = cx - 220; x <= cx + 220; x += 2) {
        if (img[(y * w + x) * 4 + 3] >= 8) { sx += x; sy += y; n++; }
      }
    }
    return n ? { x: sx / n / dpr, y: sy / n / dpr, n } : { x: 0, y: 0, n: 0 };
  });
  await page.waitForTimeout(500);
  const pos2 = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const g = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = c.width, h = c.height;
    const img = g.getImageData(0, 0, w, h).data;
    const cx = w / 2;
    const p = document.querySelector('p');
    const cy = p.getBoundingClientRect().top + p.getBoundingClientRect().height / 2;
    let sx = 0, sy = 0, n = 0;
    for (let y = (cy - 90) * dpr; y <= (cy + 90) * dpr; y += 2) {
      for (let x = cx - 220; x <= cx + 220; x += 2) {
        if (img[(y * w + x) * 4 + 3] >= 8) { sx += x; sy += y; n++; }
      }
    }
    return n ? { x: sx / n / dpr, y: sy / n / dpr, n } : { x: 0, y: 0, n: 0 };
  });
  const drift = Math.hypot(pos1.x - pos2.x, pos1.y - pos2.y);
  check('no hard cut (centroid stable after entrance)', pos1.n > 100 && drift < 15,
    `drift=${drift.toFixed(1)}px n1=${pos1.n} n2=${pos2.n}`);

  // --- 3. 60fps during 1.8s entrance ---
  const fps = await page.evaluate(() => new Promise((resolve) => {
    const t0 = performance.now();
    let n = 0;
    const step = () => { n++; if (performance.now() - t0 < 1800) requestAnimationFrame(step); else resolve(n); };
    requestAnimationFrame(step);
  }));
  check('entrance ≥55fps', fps >= 99, `${fps} frames / 1.8s (${(fps / 1.8).toFixed(0)}fps)`);

  // --- 4. Regressions ---
  const theta = () => page.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find(d => /^θ=/.test(d.textContent || ''));
    const m = el ? /θ=([\d.-]+)/.exec(el.textContent) : null;
    return m ? parseFloat(m[1]) : null;
  });
  const t1 = await theta();
  await page.waitForTimeout(2000);
  const t2 = await theta();
  check('rotation 2π/17', t2 - t1 > 0.6 && t2 - t1 < 0.9, `dθ=${(t2 - t1).toFixed(3)}`);

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
  check('dateZoneFade kept', dim.center < dim.side * 0.95,
    `center=${dim.center.toFixed(1)} side=${dim.side.toFixed(1)}`);

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
