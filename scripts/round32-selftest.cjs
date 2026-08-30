// Round 32 self-test: entrance (once, no multi-spin), θ readout speed,
// slim capsule buttons, wider glow, brightness, regression flows.
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

  // --- 1. Entrance fades in (early alpha < settled alpha) + θ monotonic ---
  // Use domcontentloaded + immediate sampling: networkidle waits for Google
  // Fonts which can outlast the 1.6s entrance, so early==settled.
  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.waitForTimeout(200); // entrance ~0.15 through (opacity ≈ 0.35)
  const cloudAlpha = () => page.evaluate(() => {
    const c = document.querySelector('canvas');
    const g = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = c.width, h = c.height;
    const img = g.getImageData(0, 0, w, h).data;
    const cx = w / 2;
    const h1 = [...document.querySelectorAll('h1')].find(x => x.textContent && x.textContent.length > 4);
    const r = h1.getBoundingClientRect();
    const cy = r.top + r.height / 2; // roughly the cloud band
    let sum = 0, n = 0;
    for (let y = (cy - 90) * dpr; y < (cy + 90) * dpr; y += 4) {
      for (let x = cx - 160; x <= cx + 160; x += 4) {
        const a = img[(y * w + x) * 4 + 3];
        if (a >= 5) { sum += a; n++; }
      }
    }
    return n ? sum / n : 0;
  });
  const earlyAlpha = await cloudAlpha();
  await page.waitForTimeout(2400); // entrance done + cloud settled
  const settledAlpha = await cloudAlpha();
  check('entrance fades in (early < settled)', earlyAlpha < settledAlpha * 0.9,
    `early=${earlyAlpha.toFixed(1)} settled=${settledAlpha.toFixed(1)}`);

  // θ readout exists + grows ~+0.105 rad/s
  const theta = () => page.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find(d => /^θ=/.test(d.textContent || ''));
    if (!el) return null;
    const m = /θ=([\d.-]+)/.exec(el.textContent);
    return m ? parseFloat(m[1]) : null;
  });
  const t1 = await theta();
  await page.waitForTimeout(2500);
  const t2 = await theta();
  const dTheta = t2 - t1;
  check('θ debug readout present', t1 !== null && t2 !== null, `t1=${t1} t2=${t2}`);
  check('θ grows ~0.105 rad/s (dt in seconds)', dTheta > 0.18 && dTheta < 0.36,
    `dTheta(2.5s)=${dTheta.toFixed(3)} expected≈0.26`);

  // --- 2. Slim capsule buttons ---
  const btns = await page.evaluate(() => {
    const b1 = [...document.querySelectorAll('button')].find(b => b.textContent.includes('回到我的记忆'));
    const b2 = [...document.querySelectorAll('button')].find(b => b.textContent.includes('继续上传'));
    if (!b1 || !b2) return null;
    const r1 = b1.getBoundingClientRect(), r2 = b2.getBoundingClientRect();
    const cs1 = getComputedStyle(b1), cs2 = getComputedStyle(b2);
    return {
      h1: Math.round(r1.height), h2: Math.round(r2.height),
      p1: cs1.padding, p2: cs2.padding,
      f1: cs1.fontSize, f2: cs2.fontSize,
      r1: cs1.borderRadius, r2: cs2.borderRadius,
      gap1: cs1.gap,
    };
  });
  check('primary button ≈48px tall', !!btns && btns.h1 >= 45 && btns.h1 <= 52, btns ? `h=${btns.h1}px` : '');
  check('secondary button ≈42px tall', !!btns && btns.h2 >= 39 && btns.h2 <= 46, btns ? `h=${btns.h2}px` : '');
  check('primary padding 13px 30px', !!btns && btns.p1 === '13px 30px', btns ? `padding=${btns.p1}` : '');
  check('secondary padding 10px 26px', !!btns && btns.p2 === '10px 26px', btns ? `padding=${btns.p2}` : '');
  check('fonts 15/14px + radius 999', !!btns && btns.f1 === '15px' && btns.f2 === '14px' && btns.r1 === '999px' && btns.r2 === '999px',
    btns ? `f1=${btns.f1} f2=${btns.f2}` : '');

  // --- 3. Wider glow (105% 82.5% ellipse, flattened stops) ---
  const glow = await page.evaluate(() => {
    const root = document.querySelector('#root > div') || document.body.firstElementChild;
    const bg = getComputedStyle(root).backgroundImage;
    return bg;
  });
  check('glow ellipse widened ×1.5 (105% 82.5%)', /105% 82\.5%/.test(glow), glow.slice(0, 90));
  check('glow stops flattened (0.26/0.12/100%)', glow.includes('0.26') && glow.includes('0.12') && glow.includes('100%'), '');

  // --- 4. Reload ×3 — θ keeps growing monotonically (no reset to 0) ---
  let mono = true;
  const seq = [];
  for (let i = 0; i < 3; i++) {
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2200); // entrance done
    const a = await theta();
    await page.waitForTimeout(900);
    const b = await theta();
    seq.push(b - a);
    if (a === null || b === null || b - a <= 0) mono = false;
  }
  check('reload ×3: θ monotonic growth, never reset', mono, 'dθ=' + seq.map(x => x.toFixed(3)).join(','));

  // --- 5. Flow regression ---
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
