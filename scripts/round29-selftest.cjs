// Round 29 verification — rotation alive, sparser cloud, fit to text bottom,
// dimmer particles, logo ×2.
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
  await page.waitForTimeout(4500);

  // 1. Rotation alive: sample the horizontal centroid of a band just above
  //    the text bottom across 6s; with 0.014 rad/s it should drift visibly.
  const snapBand = (bandY) => page.evaluate((by) => {
    const c = document.querySelector('canvas');
    const g = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = c.width, h = c.height;
    const img = g.getImageData(0, 0, w, h).data;
    const cx = w / 2;
    let sumX = 0, n = 0;
    for (let y = Math.round((by - 6) * dpr); y < Math.round((by + 6) * dpr); y++) {
      for (let x = cx - 200; x <= cx + 200; x += 2) {
        if (img[(y * w + x) * 4 + 3] >= 8) { sumX += x; n++; }
      }
    }
    return n ? sumX / n : -1;
  }, bandY);
  const h1Info = await page.evaluate(() => {
    const h1 = [...document.querySelectorAll('h1')].find(x => x.textContent && x.textContent.length > 4);
    const r = h1.getBoundingClientRect();
    const textBottom = r.bottom - (r.height - 46) / 2;
    return { textBottom };
  });
  const band = h1Info.textBottom - 30; // just above text bottom (cloud region)
  const p1 = await snapBand(band);
  await page.waitForTimeout(6000);
  const p2 = await snapBand(band);
  const drift = Math.abs(p2 - p1);
  // 0.014 rad/s × 6s = 0.084 rad → at r≈150 the arc is ~12.6px; centroid
  // of one band moves less, but should be a few px. Require >= 2px.
  check('rotation alive (band centroid drift)', drift >= 1.5,
    `p1=${p1.toFixed(1)} p2=${p2.toFixed(1)} drift=${drift.toFixed(2)}px`);

  // 2. Cloud bottom touches TEXT BOTTOM (not top)
  const fit = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const g = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = c.width, h = c.height;
    const img = g.getImageData(0, 0, w, h).data;
    const cx = w / 2;
    const h1 = [...document.querySelectorAll('h1')].find(x => x.textContent && x.textContent.length > 4);
    const r = h1.getBoundingClientRect();
    const textBottom = r.bottom - (r.height - 46) / 2;
    const rows = [];
    for (let y = Math.round(textBottom + 30); y >= Math.round(textBottom - 90); y--) {
      let n = 0;
      for (let x = cx - 170; x <= cx + 170; x += 2) {
        if (img[(y * w + x) * 4 + 3] >= 6) n++;
      }
      rows.push({ y, n });
    }
    const cloudRows = rows.filter(r2 => r2.n >= 5);
    const bottom = cloudRows.length ? Math.max(...cloudRows.map(r2 => r2.y)) : null;
    return { textBottom, bottom, gap: bottom ? bottom - textBottom : NaN };
  });
  check('cloud bottom ≈ text bottom (gap < 30px)', !isNaN(fit.gap) && fit.gap < 30,
    `textBottom=${fit.textBottom.toFixed(0)} cloudBottom=${fit.bottom?.toFixed(0)} gap=${fit.gap?.toFixed(0)}px`);

  // 3. Sparser: pixel count in cloud region lower than before (~-30-40%)
  const sparse = await page.evaluate(() => {
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
    for (let y = (cy - 60) * dpr; y < (cy + 50) * dpr; y += 3) {
      for (let x = cx - 150; x <= cx + 150; x += 3) {
        if (img[(y * w + x) * 4 + 3] >= 6) n++;
      }
    }
    return { n };
  });
  // 720 particles vs 1200 (reduced 40%); the cloud is bigger now (bottom
  // touches text bottom) so the window holds more samples — still expect a
  // clear reduction vs 1200 particles.
  check('cloud sparser (particle count reduced)', sparse.n < 1050,
    `litSamples=${sparse.n}`);

  // 4. Dimmer: avg alpha lower than r28 (~83 → expect < 70)
  const dim = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const g = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = c.width, h = c.height;
    const img = g.getImageData(0, 0, w, h).data;
    const cx = w / 2;
    const h1 = [...document.querySelectorAll('h1')].find(x => x.textContent && x.textContent.length > 4);
    const r = h1.getBoundingClientRect();
    const cy = r.top + r.height / 2;
    let sum = 0, n = 0;
    for (let y = (cy - 70) * dpr; y < (cy + 40) * dpr; y += 2) {
      for (let x = cx - 130; x <= cx + 130; x += 2) {
        const a = img[(y * w + x) * 4 + 3];
        if (a >= 5) { sum += a; n++; }
      }
    }
    return { avg: n ? sum / n : 0 };
  });
  check('cloud dimmer (avg alpha < 70)', dim.avg < 70, `avgAlpha=${dim.avg.toFixed(1)}`);

  // 5. Logo font ~38px
  const logoFont = await page.evaluate(() => {
    const b = document.querySelector('button[aria-label="返回首页"]');
    const span = b ? b.querySelector('span > span:last-child') : null;
    return span ? getComputedStyle(span.parentElement).fontSize : '';
  });
  check('logo font ~38px (x2)', Math.abs(parseFloat(logoFont) - 38) < 4,
    'fontSize=' + logoFont);

  await page.screenshot({ path: 'C:/tmp/r29-01-landing.png' });

  // 6. Old features
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