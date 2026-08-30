// Round 27 verification — pixel analysis for edge distribution + centerY
// alignment + rotation speed; behavior checks for slogan interval etc.
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

  // 1. Edge vs center density (inside the ellipse window)
  const density = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const g = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = c.width, h = c.height;
    const img = g.getImageData(0, 0, w, h).data;
    const cx = w / 2;
    const cy = h * 0.44;
    const R = Math.min(w * 0.32, 440) * 0.84 * dpr;
    const rx = R, ry = R * 0.35;
    let centerCnt = 0, edgeCnt = 0;
    for (let y = 0; y < h; y += 3) {
      for (let x = 0; x < w; x += 3) {
        const dx = x - cx, dy = y - cy;
        if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) > 1) continue;
        const i = (y * w + x) * 4;
        if (img[i + 3] < 15) continue;
        const nr = Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry));
        if (nr < 0.4) centerCnt++;
        else if (nr > 0.8) edgeCnt++;
      }
    }
    return { centerCnt, edgeCnt, ratio: edgeCnt / Math.max(centerCnt, 1) };
  });
  check('center denser than rim (no bright ring)', density.ratio < 1.0,
    `center=${density.centerCnt} edge=${density.edgeCnt} edge/center=${density.ratio.toFixed(2)}`);

  // 2. Cloud center aligned to date line y
  const align = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const g = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = c.width, h = c.height;
    const img = g.getImageData(0, 0, w, h).data;
    // date p is the first <p> in the centered column
    const dateP = document.querySelector('p');
    const dr = dateP.getBoundingClientRect();
    const dateY = dr.top + dr.height / 2;
    // cloud's vertical centroid from pixels (within central window)
    const cx = w / 2;
    const R = Math.min(w * 0.32, 440) * 0.84 * dpr;
    let sumY = 0, cnt = 0;
    for (let y = 0; y < h; y += 3) {
      for (let x = 0; x < w; x += 3) {
        const dx = x - cx;
        const dy = y - dateY * dpr;
        if ((dx * dx) / (R * R) + (dy * dy) / ((R * 0.35) ** 2) > 1) continue;
        const i = (y * w + x) * 4;
        if (img[i + 3] < 20) continue;
        sumY += y; cnt++;
      }
    }
    const centroidY = cnt ? sumY / cnt / dpr : 0;
    return { dateY, centroidY, diff: Math.abs(centroidY - dateY) };
  });
  check('cloud centroid ≈ date line y', align.diff < 60,
    `dateY=${align.dateY.toFixed(0)} centroidY=${align.centroidY.toFixed(0)} diff=${align.diff.toFixed(0)}`);

  // 3. Slogan interval is ~4s: measure the actual gap between two switches
  const s1 = await page.evaluate(() => {
    const el = [...document.querySelectorAll('h1')].find(x => x.textContent && x.textContent.length > 4);
    return el ? el.textContent : '';
  });
  // Wait for the NEXT switch to happen, then time the following one
  await page.waitForFunction((prev) => {
    const el = [...document.querySelectorAll('h1')].find(x => x.textContent && x.textContent.length > 4);
    return el && el.textContent !== prev;
  }, s1, { timeout: 8000 }).catch(() => {});
  const s2 = await page.evaluate(() => {
    const el = [...document.querySelectorAll('h1')].find(x => x.textContent && x.textContent.length > 4);
    return el ? el.textContent : '';
  });
  const start = Date.now();
  await page.waitForFunction((prev) => {
    const el = [...document.querySelectorAll('h1')].find(x => x.textContent && x.textContent.length > 4);
    return el && el.textContent !== prev;
  }, s2, { timeout: 8000 }).catch(() => {});
  const elapsed = Date.now() - start;
  check('slogan interval ≈ 4s', elapsed >= 3200 && elapsed <= 4800,
    `elapsed=${elapsed}ms (${s1} -> ${s2})`);

  // 4. Cloud smaller than before: measured width should be ~84% of 440*2
  const wMeasured = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const g = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = c.width, h = c.height;
    const img = g.getImageData(0, 0, w, h).data;
    const cx = w / 2, cy = h * 0.44 * dpr;
    const R = Math.min(w * 0.32, 440) * 0.84 * dpr;
    let minX = 1e9, maxX = -1e9;
    for (let y = 0; y < h; y += 3) {
      for (let x = 0; x < w; x += 3) {
        const dx = x - cx, dy = y - cy;
        if ((dx * dx) / (R * R) + (dy * dy) / ((R * 0.35) ** 2) > 1) continue;
        if (img[(y * w + x) * 4 + 3] < 15) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
    return { wpx: (maxX - minX) / dpr };
  });
  check('cloud shrunk (~690px wide @1280)', wMeasured.wpx < 760 && wMeasured.wpx > 560,
    `width=${wMeasured.wpx.toFixed(0)}px`);

  await page.screenshot({ path: 'C:/tmp/r27-01-landing.png' });

  // 5. Old features: chat + gallery + logo
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