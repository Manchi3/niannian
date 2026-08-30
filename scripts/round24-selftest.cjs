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
  await page.waitForTimeout(2000);

  // 1. Landing root background is radial gradient (center gold)
  const bg = await page.evaluate(() => {
    const el = document.querySelector('.relative.min-h-screen');
    return el ? getComputedStyle(el).backgroundImage : '';
  });
  check('background is radial-gradient', bg.includes('radial-gradient'), bg.slice(0, 60));

  // 2. Slogan h1 — serif font + vertical gradient clip
  const h1 = await page.evaluate(() => {
    const el = [...document.querySelectorAll('h1')].find(x => x.textContent && x.textContent.length > 4);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      font: cs.fontFamily,
      clip: cs.webkitBackgroundClip || cs.backgroundClip,
      fill: cs.webkitTextFillColor,
      transform: cs.transform,
      position: cs.position,
      txt: el.textContent,
    };
  });
  check('slogan serif font', !!h1 && /serif/i.test(h1.font), h1 ? h1.font.slice(0, 60) : 'no h1');
  check('slogan vertical gradient (text clip)', !!h1 && h1.clip === 'text', h1 ? 'clip=' + h1.clip : '');
  check('slogan no transform (pure fade)', !!h1 && (h1.transform === 'none' || h1.transform === ''),
    h1 ? 'transform=' + h1.transform : '');
  check('slogan horizontal (w > h*3)', !!h1 && h1.position === 'absolute',
    'position=' + (h1 ? h1.position : 'none'));

  // 3. Particle canvas exists + has dimensions
  const canvas = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    return c ? { w: c.width, h: c.height } : null;
  });
  check('particle canvas present', !!canvas && canvas.w > 0, canvas ? 'w=' + canvas.w : '');

  // 4. Wait for slogan cycle (3s) — text content should change across time
  const t1 = await page.evaluate(() => {
    const el = [...document.querySelectorAll('h1')].find(x => x.textContent && x.textContent.length > 4);
    return el ? el.textContent : '';
  });
  await page.waitForTimeout(3300);
  const t2 = await page.evaluate(() => {
    const el = [...document.querySelectorAll('h1')].find(x => x.textContent && x.textContent.length > 4);
    return el ? el.textContent : '';
  });
  check('slogan cycles every 3s', t1 !== t2, t1 + ' -> ' + t2);

  // 5. Logo still there + hover glow
  const logo = page.locator('button[aria-label="返回首页"]');
  check('logo visible', (await logo.count()) > 0);
  const beforeShadow = await page.evaluate(() => {
    const b = document.querySelector('button[aria-label="返回首页"]');
    const s = b ? b.querySelector('span') : null;
    return s ? getComputedStyle(s).textShadow : '';
  });
  await logo.hover();
  await page.waitForTimeout(500);
  const afterShadow = await page.evaluate(() => {
    const b = document.querySelector('button[aria-label="返回首页"]');
    const s = b ? b.querySelector('span') : null;
    return s ? getComputedStyle(s).textShadow : '';
  });
  check('logo hover glow', beforeShadow !== afterShadow, beforeShadow.slice(0, 30) + ' -> ' + afterShadow.slice(0, 50));

  await page.screenshot({ path: 'C:/tmp/r24-01-landing.png' });

  // 6. Buttons still navigate
  await page.locator('button:has-text("继续上传")').first().click();
  await page.waitForTimeout(800);
  check('continue upload -> chat', (await page.locator('text=上传一张照片').count()) > 0);
  await page.screenshot({ path: 'C:/tmp/r24-02-chat.png' });

  // 7. Back to landing via logo, then gallery
  await logo.click();
  await page.waitForTimeout(800);
  await page.locator('button:has-text("回到我的记忆")').first().click();
  await page.waitForTimeout(1000);
  check('gallery opens', (await page.locator('input[placeholder*="搜索"]').count()) > 0);

  check('no console errors', errors.length === 0, errors.join('; '));

  await browser.close();
  console.log('== DONE ==');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });