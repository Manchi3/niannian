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

  // 1. Slogan font size ≤ 42px (reduced from 58)
  const font = await page.evaluate(() => {
    const el = [...document.querySelectorAll('h1')].find(x => x.textContent && x.textContent.length > 4);
    return el ? getComputedStyle(el).fontSize : '';
  });
  check('slogan font <= 42px', parseFloat(font) <= 42.5, 'fontSize=' + font);

  // 2. All three slogans don't overflow (scrollWidth <= clientWidth)
  //    Cycle through by waiting 3.2s each; test at 1280 and 375 widths.
  const overflowAt = async () => {
    for (let i = 0; i < 3; i++) {
      const o = await page.evaluate(() => {
        const el = [...document.querySelectorAll('h1')].find(x => x.textContent && x.textContent.length > 4);
        if (!el) return { ok: false, txt: '' };
        const p = el.parentElement;
        return { ok: el.scrollWidth <= el.clientWidth + 2, txt: el.textContent, sw: el.scrollWidth, cw: el.clientWidth };
      });
      if (!o.ok) return o;
      if (i < 2) await page.waitForTimeout(3200);
    }
    return { ok: true };
  };
  const ov1 = await overflowAt();
  check('no slogan overflow @1280', ov1.ok,
    ov1.ok ? 'all 3 lines fit' : 'overflow ' + ov1.txt + ' sw=' + ov1.sw + ' cw=' + ov1.cw);

  // 3. Narrow viewport (375px) — longest line must fit
  await page.setViewportSize({ width: 375, height: 800 });
  await page.waitForTimeout(800);
  const ov2 = await overflowAt();
  check('no slogan overflow @375px', ov2.ok,
    ov2.ok ? 'all 3 lines fit' : 'overflow ' + ov2.txt + ' sw=' + ov2.sw + ' cw=' + ov2.cw);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(500);

  // 4. Cursor: date + slogan user-select none + cursor default
  const cur = await page.evaluate(() => {
    const h1 = [...document.querySelectorAll('h1')].find(x => x.textContent && x.textContent.length > 4);
    const dateP = document.querySelector('p');
    const hs = h1 ? getComputedStyle(h1) : null;
    const ds = dateP ? getComputedStyle(dateP) : null;
    return {
      h1sel: hs ? hs.userSelect : '',
      h1cur: hs ? hs.cursor : '',
      dateSel: ds ? ds.userSelect : '',
      dateCur: ds ? ds.cursor : '',
    };
  });
  check('slogan user-select none', cur.h1sel === 'none', 'userSelect=' + cur.h1sel);
  check('slogan cursor default', cur.h1cur === 'default', 'cursor=' + cur.h1cur);
  check('date user-select none', cur.dateSel === 'none', 'userSelect=' + cur.dateSel);
  check('date cursor default', cur.dateCur === 'default', 'cursor=' + cur.dateCur);

  // 5. Daily quote present at bottom + deterministic (same text on reload)
  const q1 = await page.evaluate(() => {
    const el = document.querySelector('p.absolute');
    return el ? el.textContent : '';
  });
  check('daily quote visible', q1.length > 0, 'quote="' + q1 + '"');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const q2 = await page.evaluate(() => {
    const el = document.querySelector('p.absolute');
    return el ? el.textContent : '';
  });
  check('quote stable within a day', q1 === q2, q1 + ' vs ' + q2);

  // 6. Old features: logo, buttons, gallery
  const logo = page.locator('button[aria-label="返回首页"]');
  check('logo visible', (await logo.count()) > 0);
  await page.locator('button:has-text("回到我的记忆")').first().click();
  await page.waitForTimeout(1000);
  check('gallery opens', (await page.locator('input[placeholder*="搜索"]').count()) > 0);
  await logo.click();
  await page.waitForTimeout(700);
  await page.locator('button:has-text("继续上传")').first().click();
  await page.waitForTimeout(800);
  check('chat upload flow opens', (await page.locator('text=上传一张照片').count()) > 0);

  // Screenshots
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'C:/tmp/r25-01-landing.png' });

  check('no console errors', errors.length === 0, errors.join('; '));
  await browser.close();
  console.log('== DONE ==');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });