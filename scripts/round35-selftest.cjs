// Round 35 self-test v2 — sampling anchored on the DATE line (cloud center),
// not the slogan h1 (which sits below the cloud center).
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

  // --- 1. Ribbon entrance: particles spread ALONG two arcs (not two blobs).
  await page.waitForTimeout(200); // e≈0.35 — mid entrance
  const early = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const g = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = c.width, h = c.height;
    const img = g.getImageData(0, 0, w, h).data;
    const cx = w / 2;
    const p = document.querySelector('p');
    const pr = p.getBoundingClientRect();
    const cy = pr.top + pr.height / 2; // cloud center = date center
    let minX = 1e9, maxX = -1e9, midN = 0, total = 0;
    // Threshold 3: at ~150-200ms the entrance fade (alpha × e≈0.35) stacks
    // with edgeFade/zone/twinkle, so lit particles read ~10-30 alpha.
    const TH = 3;
    for (let y = (cy - 45) * dpr; y <= (cy + 15) * dpr; y += 3) {
      for (let x = 0; x < w; x += 3) {
        if (img[(y * w + x) * 4 + 3] >= TH) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          total++;
          if (x >= cx - 90 && x <= cx + 90) midN++;
        }
      }
    }
    return { left: minX / dpr, right: maxX / dpr, w: (maxX - minX) / dpr, midN, total };
  });
  check('early particles span the full ribbon (both sides + middle)',
    early.w > 700 && early.midN > 5,
    `w=${Math.round(early.w)}px (${Math.round(early.left)}..${Math.round(early.right)}) midN=${early.midN}`);

  // --- 2. Converges into ellipse: settled center dense ---
  await page.waitForTimeout(2400);
  const settled = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const g = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = c.width, h = c.height;
    const img = g.getImageData(0, 0, w, h).data;
    const cx = w / 2;
    const p = document.querySelector('p');
    const pr = p.getBoundingClientRect();
    const cy = pr.top + pr.height / 2;
    let n = 0;
    for (let y = (cy - 60) * dpr; y <= (cy + 60) * dpr; y += 3) {
      for (let x = cx - 90; x <= cx + 90; x += 3) {
        if (img[(y * w + x) * 4 + 3] >= 8) n++;
      }
    }
    return n;
  });
  check('ribbon converges (settled center dense)', settled > 300, `settled=${settled}`);

  // --- 3. Date style ---
  const date = await page.evaluate(() => {
    const p = document.querySelector('p');
    const cs = getComputedStyle(p);
    return { color: cs.color, shadow: cs.textShadow, font: cs.fontFamily };
  });
  check('date warm white', /255,\s*244,\s*224/.test(date.color), `color=${date.color}`);
  check('date KaiTi font', /KaiTi|楷体|STKaiti/.test(date.font), date.font.slice(0, 40));
  check('date glow shadow', date.shadow !== 'none', date.shadow.slice(0, 50));

  // --- 4. Date-center radial dim: band near (cx, dateCy) darker than sides ---
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
  check('date-center radial dim (center < side)', dim.center < dim.side * 0.95,
    `center=${dim.center.toFixed(1)} side=${dim.side.toFixed(1)}`);

  // --- 5. Rotation 2π/17 ---
  const theta = () => page.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find(d => /^θ=/.test(d.textContent || ''));
    const m = el ? /θ=([\d.-]+)/.exec(el.textContent) : null;
    return m ? parseFloat(m[1]) : null;
  });
  const t1 = await theta();
  await page.waitForTimeout(2000);
  const t2 = await theta();
  check('rotation 2π/17', t2 - t1 > 0.6 && t2 - t1 < 0.9, `dθ=${(t2 - t1).toFixed(3)}`);

  // --- 6. Flows + console ---
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
