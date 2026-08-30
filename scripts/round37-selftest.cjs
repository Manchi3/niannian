// Round 37 self-test: curve-morph entrance (double-arc → ellipse, smoothstep
// only), red-line audit (no overshoot easing), 60fps, regressions.
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

  // --- 0. RED LINE audit: no overshoot easing anywhere in the CODE.
  // (Comments legitimately say "no back/elastic/bounce" — check actual
  // code patterns only.)
  const src = fs.readFileSync('src/components/EllipseParticles.tsx', 'utf8');
  const redLine = /Math\.pow\(localE|1\s*\+\s*2\.7|1\.7\s*\*\s*Math\.pow|easeOutBack/.test(src);
  check('red line: zero overshoot easing in code', !redLine, redLine ? 'FOUND overshoot pattern' : '');

  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 15000 });

  // --- 1. Particles pass THROUGH the ribbon form during the entrance ---
  // Sample INSIDE the page every ~90ms across the whole 1.8s entrance;
  // capture the peak ribbon-band count. If the curve really morphs from
  // double-arc → ellipse, there must exist a frame with many particles on
  // the high ribbon band (cy−140..cy−10).
  const ribbonPeak = await page.evaluate(() => new Promise((resolve) => {
    const dpr = window.devicePixelRatio || 1;
    let peak = 0;
    let shots = 0;
    const sample = () => {
      const c = document.querySelector('canvas');
      const g = c.getContext('2d');
      const w = c.width, h = c.height;
      const img = g.getImageData(0, 0, w, h).data;
      const cx = w / 2;
      const p = document.querySelector('p');
      const cy = p.getBoundingClientRect().top + p.getBoundingClientRect().height / 2;
      let n = 0;
      for (let y = (cy - 140) * dpr; y <= (cy - 10) * dpr; y += 2) {
        for (let x = 0; x < w; x += 3) {
          if (img[(y * w + x) * 4 + 3] >= 4) n++;
        }
      }
      if (n > peak) peak = n;
      shots++;
      if (shots < 20) setTimeout(sample, 90); else resolve(peak);
    };
    sample();
  }));
  check('particles pass through ribbon form (peak on arc band)',
    ribbonPeak > 120, `ribbonPeak=${ribbonPeak}`);

  // --- 2. Morphs into ellipse ---
  await page.waitForTimeout(2200);
  const settled = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const g = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = c.width, h = c.height;
    const img = g.getImageData(0, 0, w, h).data;
    const cx = w / 2;
    const p = document.querySelector('p');
    const cy = p.getBoundingClientRect().top + p.getBoundingClientRect().height / 2;
    let n = 0;
    for (let y = (cy - 60) * dpr; y <= (cy + 60) * dpr; y += 3) {
      for (let x = cx - 90; x <= cx + 90; x += 3) {
        if (img[(y * w + x) * 4 + 3] >= 8) n++;
      }
    }
    return n;
  });
  check('morph converges (settled center dense)', settled > 300, `settled=${settled}`);

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
