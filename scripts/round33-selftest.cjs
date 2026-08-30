// Round 33 self-test: lerp convergence (no step jumps), θ≈0.37 rad/s,
// edge feather, brightness, button fixes, regressions.
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

  // --- 1. R converges smoothly: early (0.3s) must be a sane intermediate
  // (no 0-frame, no fallback-full jump), settled (3s) consistent.
  const cloudWidth = () => page.evaluate(() => {
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
    // Row-density filter: only solid CLOUD rows (≥3 lit samples) contribute,
    // so lone background stars are excluded.
    for (let y = (cy - 60) * dpr; y <= (cy + 10) * dpr; y += 3) {
      let rowHits = 0, rowMin = 1e9, rowMax = -1e9;
      for (let x = 0; x < w; x += 3) {
        if (img[(y * w + x) * 4 + 3] >= 8) { rowHits++; if (x < rowMin) rowMin = x; if (x > rowMax) rowMax = x; }
      }
      if (rowHits >= 3) { if (rowMin < minX) minX = rowMin; if (rowMax > maxX) maxX = rowMax; }
    }
    return minX < maxX ? (maxX - minX) / dpr : 0;
  });
  await page.waitForTimeout(300);
  const early = await cloudWidth();
  await page.waitForTimeout(2700);
  const settled1 = await cloudWidth();
  const mathR1 = await page.evaluate(() => {
    const p = document.querySelector('p');
    const h1 = [...document.querySelectorAll('h1')].find(x => x.textContent && x.textContent.length > 4);
    const cy = p.getBoundingClientRect().top + p.getBoundingClientRect().height / 2;
    const rr = h1.getBoundingClientRect();
    const tb = rr.bottom - (rr.height - 46) / 2;
    return Math.max((tb - cy) / 0.35, 150); // same formula as computeRadius
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.waitForTimeout(3000);
  const settled2 = await cloudWidth();
  const mathR2 = await page.evaluate(() => {
    const p = document.querySelector('p');
    const h1 = [...document.querySelectorAll('h1')].find(x => x.textContent && x.textContent.length > 4);
    const cy = p.getBoundingClientRect().top + p.getBoundingClientRect().height / 2;
    const rr = h1.getBoundingClientRect();
    const tb = rr.bottom - (rr.height - 46) / 2;
    return Math.max((tb - cy) / 0.35, 150);
  });
  check('early cloud width sane (no 0 / no huge)', early > 300 && early < 1100,
    `early=${Math.round(early)}px`);
  check('settled width consistent (dynamic-noise tolerance)', Math.abs(settled1 - settled2) < 220,
    `settled1=${Math.round(settled1)} settled2=${Math.round(settled2)}`);
  check('math R converges (same target every load)', Math.abs(mathR1 - mathR2) < 30,
    `R1=${Math.round(mathR1)} R2=${Math.round(mathR2)}`);

  // --- 2. θ grows ≈0.37 rad/s (2π/17) ---
  const theta = () => page.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find(d => /^θ=/.test(d.textContent || ''));
    if (!el) return null;
    const m = /θ=([\d.-]+)/.exec(el.textContent);
    return m ? parseFloat(m[1]) : null;
  });
  const t1 = await theta();
  await page.waitForTimeout(2000);
  const t2 = await theta();
  const dTheta = t2 - t1;
  check('θ grows ~0.37 rad/s', dTheta > 0.6 && dTheta < 0.9,
    `dTheta(2s)=${dTheta.toFixed(3)} expected≈0.74`);

  // --- 3. Edge feather: center band brighter than outer band ---
  const fade = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const g = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = c.width, h = c.height;
    const img = g.getImageData(0, 0, w, h).data;
    const cx = w / 2;
    const h1 = [...document.querySelectorAll('h1')].find(x => x.textContent && x.textContent.length > 4);
    const r = h1.getBoundingClientRect();
    const cy = r.top + r.height / 2;
    const band = (x0, x1) => {
      let sum = 0, n = 0;
      for (let y = (cy - 70) * dpr; y <= (cy - 10) * dpr; y += 3) {
        for (let x = x0; x <= x1; x += 3) {
          const a = img[(y * w + x) * 4 + 3];
          if (a >= 5) { sum += a; n++; }
        }
      }
      return n ? sum / n : 0;
    };
    const Rpx = 300 * dpr; // approx cloud half-width
    const inner = band(cx - 80, cx + 80);
    const outerL = band(cx - Rpx * 0.9, cx - Rpx * 0.65);
    const outerR = band(cx + Rpx * 0.65, cx + Rpx * 0.9);
    return { inner, outer: (outerL + outerR) / 2 };
  });
  check('edge feather: center brighter than rim', fade.outer > 0 && fade.outer < fade.inner * 0.85,
    `inner=${fade.inner.toFixed(1)} outer=${fade.outer.toFixed(1)}`);

  // --- 4. Buttons: pure white primary, #2b2620 text, line-height 1,
  //     hollow sparkles SVG, hover white glow ---
  const btns = await page.evaluate(() => {
    const b1 = [...document.querySelectorAll('button')].find(b => b.textContent.includes('回到我的记忆'));
    const b2 = [...document.querySelectorAll('button')].find(b => b.textContent.includes('继续上传'));
    if (!b1 || !b2) return null;
    const cs1 = getComputedStyle(b1), cs2 = getComputedStyle(b2);
    const svg = b1.querySelector('svg');
    const pathD = svg ? svg.getAttribute('d') || svg.innerHTML : '';
    return {
      bg1: cs1.backgroundColor, c1: cs1.color,
      lh1: cs1.lineHeight, lh2: cs2.lineHeight,
      shadow0: cs1.boxShadow,
      hasSparkles: pathD.includes('9.937') && pathD.includes('6.135'),
      svgFillNone: svg ? svg.getAttribute('fill') : null,
    };
  });
  check('primary bg pure white #ffffff', !!btns && btns.bg1 === 'rgb(255, 255, 255)', btns ? `bg=${btns.bg1}` : '');
  check('primary text #2b2620', !!btns && btns.c1 === 'rgb(43, 38, 32)', btns ? `c=${btns.c1}` : '');
  check('line-height 1 on both (computed = fontSize)', !!btns && btns.lh1 === '15px' && btns.lh2 === '14px',
    btns ? `lh1=${btns.lh1} lh2=${btns.lh2}` : '');
  check('hollow sparkles SVG (fill none + lucide path)', !!btns && btns.hasSparkles && btns.svgFillNone === 'none', btns ? '' : 'no svg');
  const primary = page.locator('button:has-text("回到我的记忆")').first();
  await primary.hover();
  await page.waitForTimeout(500);
  const hoverShadow = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('回到我的记忆'));
    return b ? getComputedStyle(b).boxShadow : '';
  });
  check('hover white glow (two-layer)', hoverShadow.includes('rgba(255, 255, 255, 0.35)') && hoverShadow.includes('0.16'),
    hoverShadow.slice(0, 70));
  await page.mouse.move(10, 10);
  await page.waitForTimeout(500);

  // --- 5. Flows ---
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
