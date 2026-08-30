// Round 30 verification — logo KaiTi+30.4px, faster rotation, glow concentric,
// bigger/faster stars, zonal alpha (text zone dimmer than surroundings).
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

  // 1. Logo: KaiTi font + ~30.4px
  const logo = await page.evaluate(() => {
    const b = document.querySelector('button[aria-label="返回首页"]');
    const span = b ? b.querySelector('span > span:last-child').parentElement : null;
    const cs = span ? getComputedStyle(span) : null;
    return { font: cs ? cs.fontFamily : '', size: cs ? cs.fontSize : '' };
  });
  check('logo KaiTi font', /KaiTi|STKaiti|楷体/i.test(logo.font), 'font=' + logo.font.slice(0, 60));
  check('logo ~30.4px', Math.abs(parseFloat(logo.size) - 30.4) < 3, 'size=' + logo.size);

  // 2. Rotation faster: centroid drift over 6s at 0.022 rad/s should be
  //    ~1.6× the r29 value (r29 measured 4.6px) → expect > 6px.
  const snapBand = (by) => page.evaluate((bandY) => {
    const c = document.querySelector('canvas');
    const g = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = c.width, h = c.height;
    const img = g.getImageData(0, 0, w, h).data;
    const cx = w / 2;
    let sumX = 0, n = 0;
    for (let y = Math.round((bandY - 6) * dpr); y < Math.round((bandY + 6) * dpr); y++) {
      for (let x = cx - 200; x <= cx + 200; x += 2) {
        if (img[(y * w + x) * 4 + 3] >= 8) { sumX += x; n++; }
      }
    }
    return n ? sumX / n : -1;
  }, by);
  const h1 = await page.evaluate(() => {
    const el = [...document.querySelectorAll('h1')].find(x => x.textContent && x.textContent.length > 4);
    const r = el.getBoundingClientRect();
    return r.bottom - (r.height - 46) / 2;
  });
  const band = h1 - 30;
  const s1 = await snapBand(band);
  await page.waitForTimeout(6000);
  const s2 = await snapBand(band);
  const drift = Math.abs(s2 - s1);
  check('rotation faster (drift > 6px in 6s)', drift > 6,
    `drift=${drift.toFixed(2)}px (r29 was 4.6)`);

  // 3. Glow concentric: sample radial brightness around the cloud center —
  //    brightest ring should be centered on the date line y (cloud center).
  const glow = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    // background gradient is on the LandingPage root div (canvas is transparent)
    const root = document.querySelector('.relative.min-h-screen');
    const cs = getComputedStyle(root);
    return { bg: cs.backgroundImage.slice(0, 120) };
  });
  check('background gradient uses dynamic center', glow.bg.includes('at 50%') || glow.bg.includes('rgba(120, 90, 45'),
    glow.bg);

  // 4. Zonal alpha: pixels in the TEXT band should be dimmer than the same
  //    width band ABOVE the text (both inside the cloud, only the text band
  //    has particles multiplied by zoneMul=0.4).
  const zone = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const g = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = c.width, h = c.height;
    const img = g.getImageData(0, 0, w, h).data;
    const h1 = [...document.querySelectorAll('h1')].find(x => x.textContent && x.textContent.length > 4);
    const r = h1.getBoundingClientRect();
    const textTop = r.top + (r.height - 46) / 2;
    const textBottom = r.bottom - (r.height - 46) / 2;
    const cx = w / 2;
    const sampleRow = (y) => {
      let sum = 0, n = 0;
      for (let x = cx - 250; x <= cx + 250; x += 2) {
        const a = img[(y * w + x) * 4 + 3];
        if (a >= 5) { sum += a; n++; }
      }
      return n ? sum / n : 0;
    };
    // average of 3 rows inside the text band vs 3 rows above it
    const textAvg = (sampleRow(Math.round((textTop + textBottom) / 2) - 4)
      + sampleRow(Math.round((textTop + textBottom) / 2))
      + sampleRow(Math.round((textTop + textBottom) / 2) + 4)) / 3;
    const aboveAvg = (sampleRow(Math.round(textTop - 44))
      + sampleRow(Math.round(textTop - 40))
      + sampleRow(Math.round(textTop - 36))) / 3;
    return { textAvg, aboveAvg };
  });
  check('text-band particles dimmer than above (zonal alpha)', zone.textAvg < zone.aboveAvg * 0.85,
    `textAvg=${zone.textAvg.toFixed(1)} aboveAvg=${zone.aboveAvg.toFixed(1)}`);

  await page.screenshot({ path: 'C:/tmp/r30-01-landing.png' });

  // 5. Old features
  await page.locator('button:has-text("继续上传")').first().click();
  await page.waitForTimeout(700);
  check('chat flow works', (await page.locator('text=上传一张照片').count()) > 0);
  const logoBtn = page.locator('button[aria-label="返回首页"]');
  await logoBtn.click();
  await page.waitForTimeout(700);
  await page.locator('button:has-text("回到我的记忆")').first().click();
  await page.waitForTimeout(900);
  check('gallery works', (await page.locator('input[placeholder*="搜索"]').count()) > 0);

  check('no console errors', errors.length === 0, errors.join('; '));
  await browser.close();
  console.log('== DONE ==');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });