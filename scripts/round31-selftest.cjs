// Round 31 verification — reload stability, faster rotation, snappier
// spring, bigger buttons, twinkle, fuller cloud with clean text zone.
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

  // Deterministic fonts: block Google Fonts so text metrics are stable in
  // headless (the browser falls back to system serif every time) — this
  // isolates the reload-stability check from network font flakiness.
  await ctx.route('**fonts.googleapis.com/**', (r) => r.abort());
  await ctx.route('**fonts.gstatic.com/**', (r) => r.abort());

  // --- 1. Reload stability: the mathematical R (= (textBottom−cy)/SQUASH)
  // must converge fast and stay flat after first paint (no 0→big→real
  // flicker loop). We sample it repeatedly on one fresh load.
  let stable = true;
  let Rseq = [];
  for (let i = 0; i < 5; i++) {
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
    const Rseq = [];
    for (let k = 0; k < 7; k++) {
      const s = await page.evaluate(() => {
        const h1 = [...document.querySelectorAll('h1')].find(x => x.textContent && x.textContent.length > 4);
        const dateP = document.querySelector('p');
        if (!h1 || !dateP) return -1;
        const hr = h1.getBoundingClientRect();
        const dr = dateP.getBoundingClientRect();
        const textBottom = hr.bottom - (hr.height - 46) / 2;
        const cy = dr.top + dr.height / 2;
        if (textBottom <= cy) return -1;
        return Math.max((textBottom - cy) / 0.35, 150);
      });
      Rseq.push(s);
      await page.waitForTimeout(350);
    }
    const valid = Rseq.filter(x => x > 0);
    // after the first two samples R must stay flat (late samples differ < 4)
    const late = valid.slice(2);
    const lateSpread = late.length ? Math.max(...late) - Math.min(...late) : 999;
    const nonZero = valid.length >= 5; // renders at sane size from the start
    if (!nonZero || lateSpread > 4) stable = false;
  }
  check('reload stable (R converges & stays flat, no flicker loop)', stable,
    'Rseq example=' + Rseq.map(x => Math.round(x)).join(','));

  // --- 2. Rotation clearly visible: 10s should move ~0.45 rad → big drift
  await page.waitForTimeout(1500);
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
  const h1b = await page.evaluate(() => {
    const el = [...document.querySelectorAll('h1')].find(x => x.textContent && x.textContent.length > 4);
    const r = el.getBoundingClientRect();
    return r.bottom - (r.height - 46) / 2;
  });
  const band = h1b - 30;
  const s1 = await snapBand(band);
  await page.waitForTimeout(10000);
  const s2 = await snapBand(band);
  const drift = Math.abs(s2 - s1);
  check('rotation clearly visible (drift > 15px in 10s)', drift > 15,
    `drift=${drift.toFixed(1)}px (0.045 rad/s)`);

  // --- 3. Twinkle: brightness of a fixed region should fluctuate over time
  const tw = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const g = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = c.width, h = c.height;
    const cx = w / 2;
    const h1 = [...document.querySelectorAll('h1')].find(x => x.textContent && x.textContent.length > 4);
    const r = h1.getBoundingClientRect();
    const cy = r.top + r.height / 2;
    const sample = () => {
      const img = g.getImageData(0, 0, w, h).data;
      let sum = 0, n = 0;
      for (let y = (cy - 50) * dpr; y < (cy - 10) * dpr; y += 2) {
        for (let x = cx - 100; x <= cx + 100; x += 2) {
          const a = img[(y * w + x) * 4 + 3];
          if (a >= 5) { sum += a; n++; }
        }
      }
      return n ? sum / n : 0;
    };
    const a1 = sample();
    return a1;
  });
  await page.waitForTimeout(1500);
  const tw2 = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const g = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = c.width, h = c.height;
    const cx = w / 2;
    const h1 = [...document.querySelectorAll('h1')].find(x => x.textContent && x.textContent.length > 4);
    const r = h1.getBoundingClientRect();
    const cy = r.top + r.height / 2;
    const img = g.getImageData(0, 0, w, h).data;
    let sum = 0, n = 0;
    for (let y = (cy - 50) * dpr; y < (cy - 10) * dpr; y += 2) {
      for (let x = cx - 100; x <= cx + 100; x += 2) {
        const a = img[(y * w + x) * 4 + 3];
        if (a >= 5) { sum += a; n++; }
      }
    }
    return n ? sum / n : 0;
  });
  check('twinkle active (region brightness fluctuates)', Math.abs(tw2 - tw) > 2,
    `avg1=${tw.toFixed(1)} avg2=${tw2.toFixed(1)}`);

  // --- 4. Buttons bigger: measure heights
  const btn = await page.evaluate(() => {
    const primary = [...document.querySelectorAll('button')].find(b => b.textContent.includes('回到我的记忆'));
    return primary ? { h: primary.getBoundingClientRect().height, fs: getComputedStyle(primary).fontSize } : null;
  });
  check('primary button bigger (h ≥ 48px, fs ≥ 17px)',
    !!btn && btn.h >= 48 && parseFloat(btn.fs) >= 17,
    btn ? `h=${btn.h.toFixed(0)} fs=${btn.fs}` : 'not found');

  await page.screenshot({ path: 'C:/tmp/r31-01-landing.png' });

  // --- 5. Old features
  await page.locator('button:has-text("继续上传")').first().click();
  await page.waitForTimeout(700);
  check('chat flow works', (await page.locator('text=上传一张照片').count()) > 0);
  const logo = page.locator('button[aria-label="返回首页"]');
  await logo.click();
  await page.waitForTimeout(700);
  await page.locator('button:has-text("回到我的记忆")').first().click();
  await page.waitForTimeout(900);
  check('gallery works', (await page.locator('input[placeholder*="搜索"]').count()) > 0);

  const cleanErrors = errors.filter((e) => !e.includes('ERR_FAILED') && !e.includes('fonts'));
  check('no console errors', cleanErrors.length === 0, cleanErrors.join('; '));
  await browser.close();
  console.log('== DONE ==');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });