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
  await page.waitForTimeout(1500);

  // 1. Date visible
  const date = await page.locator('text=/月.*日/').first().textContent().catch(() => '');
  check('landing renders with date', !!date, 'date="' + date + '"');

  // 2. Slogan HORIZONTAL (not vertical) — w > h * 3
  const sloganLayout = await page.evaluate(() => {
    const h1 = [...document.querySelectorAll('h1')].find(el => el.textContent && el.textContent.length > 4);
    if (!h1) return null;
    const r = h1.getBoundingClientRect();
    return { w: r.width, h: r.height, txt: h1.textContent };
  });
  check('slogan is horizontal (w > h*3)', !!sloganLayout && sloganLayout.w > sloganLayout.h * 3,
    sloganLayout ? 'w=' + sloganLayout.w.toFixed(0) + ' h=' + sloganLayout.h.toFixed(0) + ' txt="' + sloganLayout.txt + '"' : 'no h1');

  // 3. Date above slogan
  const dateAbove = await page.evaluate(() => {
    const h1 = [...document.querySelectorAll('h1')].find(el => el.textContent && el.textContent.length > 4);
    const dateP = document.querySelector('p');
    if (!h1 || !dateP) return false;
    return dateP.getBoundingClientRect().top < h1.getBoundingClientRect().top;
  });
  check('date above slogan', dateAbove);

  // 4. Logo visible, 19px font
  const logo = page.locator('button[aria-label="返回首页"]').first();
  await logo.waitFor({ state: 'visible', timeout: 5000 });
  const logoStyles = await page.evaluate(() => {
    const b = document.querySelector('button[aria-label="返回首页"]');
    if (!b) return null;
    const span = b.querySelector('span > span');
    const cs = getComputedStyle(span || b);
    return { fontSize: cs.fontSize, color: cs.color };
  });
  check('logo font size >= 18px', !!logoStyles && parseFloat(logoStyles.fontSize) >= 18,
    logoStyles ? 'fontSize=' + logoStyles.fontSize : '');

  // 5. Logo hover changes color OR adds glow shadow
  const before = await page.evaluate(() => {
    const b = document.querySelector('button[aria-label="返回首页"]');
    if (!b) return { color: '', shadow: '' };
    const labelSpan = b.querySelector('span > span:last-child') || b.querySelector('span > span');
    const cs = getComputedStyle(labelSpan || b);
    return { color: cs.color, shadow: cs.textShadow };
  });
  await logo.hover();
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => {
    const b = document.querySelector('button[aria-label="返回首页"]');
    if (!b) return { color: '', shadow: '' };
    const labelSpan = b.querySelector('span > span:last-child') || b.querySelector('span > span');
    const cs = getComputedStyle(labelSpan || b);
    return { color: cs.color, shadow: cs.textShadow };
  });
  const hoverChanged = (before.color !== after.color) || (before.shadow !== after.shadow);
  check('logo hover changes color or adds glow', hoverChanged,
    'color ' + before.color + ' -> ' + after.color + ' | shadow ' + before.shadow + ' -> ' + after.shadow);

  // 6. Particle canvas
  const canvas = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    return c ? { w: c.width, h: c.height, exists: true } : { exists: false };
  });
  check('ellipse particle canvas present', !!canvas.exists && canvas.w > 0,
    canvas.exists ? 'w=' + canvas.w + ' h=' + canvas.h : '');

  await page.screenshot({ path: 'C:/tmp/r23-01-landing.png' });

  // 7. 继续上传 → chat
  await page.locator('button:has-text("继续上传")').first().click();
  await page.waitForTimeout(800);
  const uploadZone = await page.locator('text=上传一张照片').count();
  check('continue upload navigates to chat', uploadZone > 0, 'uploadZone=' + uploadZone);
  await page.screenshot({ path: 'C:/tmp/r23-02-after-upload-cta.png' });

  // 8. Logo → landing
  await logo.click();
  await page.waitForTimeout(800);
  const sloganBack = await page.evaluate(() => {
    const h1 = [...document.querySelectorAll('h1')].find(el => el.textContent && el.textContent.length > 4);
    return !!h1;
  });
  check('logo click returns to landing', sloganBack);

  // 9. 回到我的记忆 → gallery
  await page.locator('button:has-text("回到我的记忆")').first().click();
  await page.waitForTimeout(1000);
  const search = await page.locator('input[placeholder*="搜索"]').count();
  const plusCard = await page.locator('text=下一张照片').count();
  check('gallery opens with search + plus card', search > 0 && plusCard > 0,
    'search=' + search + ' plus=' + plusCard);
  await page.screenshot({ path: 'C:/tmp/r23-03-gallery.png' });

  check('no console errors', errors.length === 0, errors.join('; '));

  await browser.close();
  console.log('== DONE ==');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });