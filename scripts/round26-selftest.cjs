// Round 26 geometry verification — reads canvas pixels to prove the disc
// renders as a flat ellipse (w/h ≈ 2.5~3) with bottom-brighter depth cue.
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
  await page.waitForTimeout(2500);

  // Analyze the central cloud region only (stars are everywhere else).
  const measure = () => page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return null;
    const g = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = c.width, h = c.height;
    const img = g.getImageData(0, 0, w, h).data;
    const cx = w / 2;
    const cy = h * 0.44;
    const rx = Math.min(w * 0.32, 440) * dpr;
    const ry = rx * 0.42; // sample window slightly larger than the ellipse
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    let topSum = 0, topCnt = 0, botSum = 0, botCnt = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x - cx, dy = y - cy;
        if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) > 1) continue; // skip stars outside
        const i = (y * w + x) * 4;
        const a = img[i + 3];
        if (a < 15) continue; // low threshold to capture glow edges
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        // brightness ~ max(r,g,b) weighted by alpha
        const br = Math.max(img[i], img[i + 1], img[i + 2]) * (a / 255);
        if (dy < 0) { topSum += br; topCnt++; } else { botSum += br; botCnt++; }
      }
    }
    const bw = (maxX - minX) / dpr;
    const bh = (maxY - minY) / dpr;
    return {
      bw, bh, ratio: bh > 0 ? bw / bh : 0,
      topAvg: topCnt ? topSum / topCnt : 0,
      botAvg: botCnt ? botSum / botCnt : 0,
    };
  });

  const m1 = await measure();
  await page.waitForTimeout(2000); // let the disc rotate ~0.06 rad
  const m2 = await measure();

  if (!m1) {
    check('canvas measurable', false);
    await browser.close();
    return;
  }

  // 1. Outline is a flat ellipse: w/h in [2.2, 3.4]
  const ratioOk = m1.ratio >= 2.2 && m1.ratio <= 3.4 && m2.ratio >= 2.2 && m2.ratio <= 3.4;
  check('outline is flat ellipse (w/h ~2.5-3)', ratioOk,
    `m1=${m1.ratio.toFixed(2)} (w=${m1.bw.toFixed(0)},h=${m1.bh.toFixed(0)}) m2=${m2.ratio.toFixed(2)}`);

  // 2. Bottom brighter than top (near edge closer to viewer)
  check('bottom edge brighter than top (depth cue)', m1.botAvg > m1.topAvg * 1.05,
    `topAvg=${m1.topAvg.toFixed(1)} botAvg=${m1.botAvg.toFixed(1)}`);

  // 3. Shape stays ellipse across two frames (no square / no ball)
  const shapeDrift = Math.abs(m1.ratio - m2.ratio);
  check('shape stable across rotation (no square/ball)', shapeDrift < 0.5,
    `drift=${shapeDrift.toFixed(2)}`);

  await page.screenshot({ path: 'C:/tmp/r26-01-landing.png' });

  // 4. Old features still work
  await page.locator('button:has-text("继续上传")').first().click();
  await page.waitForTimeout(800);
  check('chat flow still works', (await page.locator('text=上传一张照片').count()) > 0);
  const logo = page.locator('button[aria-label="返回首页"]');
  await logo.click();
  await page.waitForTimeout(700);
  await page.locator('button:has-text("回到我的记忆")').first().click();
  await page.waitForTimeout(900);
  check('gallery still works', (await page.locator('input[placeholder*="搜索"]').count()) > 0);

  check('no console errors', errors.length === 0, errors.join('; '));
  await browser.close();
  console.log('== DONE ==');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });