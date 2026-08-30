// Round 40 self-test: repulsion persists while mouse is STILL (10s), debug
// text gone, rotation still runs, entrance intact, regressions.
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
  await page.waitForTimeout(2500); // entrance done

  // Helper: density of lit particles around (x, y) within radius r (px)
  const density = (x, y, r) => page.evaluate(([mx, my, rr]) => {
    const c = document.querySelector('canvas');
    const g = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = c.width, h = c.height;
    const img = g.getImageData(0, 0, w, h).data;
    let n = 0, tot = 0;
    for (let dy = -rr; dy <= rr; dy += 4) {
      for (let dx = -rr; dx <= rr; dx += 4) {
        const d = Math.hypot(dx, dy);
        if (d > rr) continue;
        tot++;
        const x = Math.round((mx + dx) * dpr), y = Math.round((my + dy) * dpr);
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        if (img[(y * w + x) * 4 + 3] >= 8) n++;
      }
    }
    return tot ? n / tot : 0;
  }, [x, y, r]);

  // Cloud center (date line)
  const center = await page.evaluate(() => {
    const p = document.querySelector('p');
    const pr = p.getBoundingClientRect();
    return { x: window.innerWidth / 2, y: pr.top + pr.height / 2 };
  });

  // --- 1. Repulsion PERSISTS while mouse is STILL ---
  // Move mouse onto the cloud center, wait for hole to form, then wait
  // 10s WITHOUT moving: the hole must remain (particles stay pushed open).
  await page.mouse.move(center.x, center.y);
  await page.waitForTimeout(2000);
  const hole1 = await density(center.x, center.y, 80);
  await page.waitForTimeout(9000); // 11s total stillness — bug used to collapse here
  const hole2 = await density(center.x, center.y, 80);
  check('repulsion persists after 10s still (hole stays open)',
    hole1 < 0.12 && hole2 < 0.12,
    `hole@2s=${hole1.toFixed(3)} hole@11s=${hole2.toFixed(3)}`);

  // --- 2. Release → spring back; re-enter → hole again ---
  await page.mouse.move(40, 40); // leave the cloud
  await page.waitForTimeout(2000);
  const back1 = await density(center.x, center.y, 80);
  await page.mouse.move(center.x, center.y);
  await page.waitForTimeout(2000);
  const hole3 = await density(center.x, center.y, 80);
  check('spring back on leave, hole reopens on re-enter',
    back1 > hole1 * 5 && hole3 < 0.12,
    `back=${back1.toFixed(3)} (hole was ${hole1.toFixed(3)}) hole=${hole3.toFixed(3)}`);

  // --- 3. No θ debug text anywhere ---
  const debugText = await page.evaluate(() => {
    const all = document.body.innerText;
    return /θ=\s*[\d.]+/.test(all) || all.includes('rad');
  });
  check('no θ debug text (bottom-left clean)', !debugText);

  // --- 4. Rotation still running: cloud changes steadily (thetaRef intact) ---
  // No on-screen readout anymore — verify via slow, continuous drift of the
  // cloud's lit-mass centroid over 4s (rotation redistributes edge scatter).
  const centroid = () => page.evaluate(() => {
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
    return n ? { x: sx / n / dpr, y: sy / n / dpr } : { x: 0, y: 0 };
  });
  const c1 = await centroid();
  await page.waitForTimeout(4000);
  const c2 = await centroid();
  const drift = Math.hypot(c1.x - c2.x, c1.y - c2.y);
  check('rotation still running (centroid drifts over 4s)',
    drift > 1 && drift < 40, `drift=${drift.toFixed(1)}px`);

  // --- 5. Entrance intact (fresh reload: ribbon morphs, no hard cut) ---
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.waitForTimeout(2400);
  const stable = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const g = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
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
    return n;
  });
  check('entrance intact (solid cloud after morph)', stable > 200, `centerDensity=${stable}`);

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
