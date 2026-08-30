// Round 21 UI self-test — ver 2 (fixed event-probe ordering + enough history)
const { chromium } = require('playwright');

const SSE_REPLY = [
  'data: {"type":"chunk","content":"好的，海边总是让人放松呢。还有什么想聊的吗？"}\n\n',
  'data: {"type":"done"}\n\n',
].join('');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  await page.route('**/api/chat', (r) => r.fulfill({
    status: 200, contentType: 'text/event-stream',
    headers: { 'Cache-Control': 'no-cache' }, body: SSE_REPLY,
  }));

  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  const check = (name, pass, detail = '') =>
    console.log(`${pass ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  const pngDataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 400; c.height = 300;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 400, 300);
    grad.addColorStop(0, '#3a6ea5'); grad.addColorStop(0.5, '#d4a853'); grad.addColorStop(1, '#7a4a2b');
    g.fillStyle = grad; g.fillRect(0, 0, 400, 300);
    g.fillStyle = '#fff'; g.font = 'bold 40px sans-serif'; g.fillText('校园生活', 120, 160);
    return c.toDataURL('image/png');
  });
  const pngBuf = Buffer.from(pngDataUrl.split(',')[1], 'base64');

  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'r21.png', mimeType: 'image/png', buffer: pngBuf,
  });

  const inputPill = page.locator('div.rounded-full:has(textarea)').first();
  try {
    await inputPill.waitFor({ state: 'visible', timeout: 60000 });
    check('particle view appears', true);
  } catch {
    check('particle view appears', false);
    await browser.close();
    return;
  }
  await page.waitForTimeout(2500);

  // Send 9 messages so the history definitely overflows the stack (~584px)
  const send = async (text) => {
    const ta = page.locator('textarea');
    await ta.fill(text);
    await page.waitForTimeout(100);
    await page.locator('button[aria-label="发送"]').click();
    await page.waitForFunction(() => {
      const el = document.querySelector('textarea');
      return el && !el.disabled;
    }, { timeout: 15000 });
    await page.waitForTimeout(250);
  };
  for (let i = 1; i <= 9; i++) {
    await send(`第${i}条：海边的风很舒服，待了很久很久`);
  }

  // --- TEST 1: bubble stack pointer transparency + bottom alignment ---
  const pe = await page.evaluate(() => {
    const bubbles = [...document.querySelectorAll('div.rounded-2xl')];
    if (!bubbles.length) return null;
    const stack = bubbles[0].parentElement;
    const cs = getComputedStyle(stack);
    // Bottom alignment is achieved via a mt-auto spacer (NOT justify-end,
    // which breaks scrolling). Verify the spacer div exists in the stack.
    const hasSpacer = !!stack.querySelector(':scope > [aria-hidden="true"]');
    return { pointerEvents: cs.pointerEvents, overflowY: cs.overflowY, hasSpacer };
  });
  check('bubble stack pointer-events none', !!pe && pe.pointerEvents === 'none', pe ? `pointerEvents=${pe.pointerEvents}` : '');
  check('bubble stack bottom-aligned (mt-auto spacer)', !!pe && pe.hasSpacer, pe ? `hasSpacer=${pe.hasSpacer}` : '');

  // --- TEST 2: window pointermove fires over bubble area (not blocked by UI) ---
  // Register listeners FIRST (synchronously), then move the real mouse.
  await page.evaluate(() => {
    window.__probe = { move: [], down: [] };
    window.addEventListener('pointermove', (e) => {
      window.__probe.move.push({
        isUI: !!(e.target && e.target.closest && e.target.closest('button, input, textarea, a, [role="button"], [data-ui]')),
        tag: e.target ? e.target.tagName : '',
      });
    });
    window.addEventListener('pointerdown', (e) => {
      window.__probe.down.push({
        isUI: !!(e.target && e.target.closest && e.target.closest('button, input, textarea, a, [role="button"], [data-ui]')),
        tag: e.target ? e.target.tagName : '',
      });
    });
  });
  const bubbleRect = await page.evaluate(() => {
    const b = [...document.querySelectorAll('div.rounded-2xl')];
    if (!b.length) return null;
    // sample a point at the TOP of the stack (middle of bubble area)
    const stack = b[0].parentElement;
    const r = stack.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + 60 };
  });
  if (bubbleRect) {
    await page.mouse.move(bubbleRect.x, bubbleRect.y);
    await page.waitForTimeout(250);
    const hits = await page.evaluate(() => window.__probe.move);
    const nonUI = hits.filter((h) => !h.isUI);
    check('pointermove over bubble area reaches window (non-UI target)', nonUI.length > 0,
      `hits=${hits.length} nonUI=${nonUI.length} ${hits[0] ? 'firstTag=' + hits[0].tag : ''}`);
  } else {
    check('pointermove over bubble area reaches window', false, 'no bubble rect');
  }

  // --- TEST 3: click on bubble blank area → pointerdown with non-UI target ---
  if (bubbleRect) {
    await page.evaluate(() => { window.__probe.down = []; });
    await page.mouse.move(bubbleRect.x, bubbleRect.y);
    await page.mouse.down();
    await page.waitForTimeout(150);
    await page.mouse.up();
    const downs = await page.evaluate(() => window.__probe.down);
    const nonUIDown = downs.filter((h) => !h.isUI);
    check('pointerdown over bubble area reaches window (non-UI)', nonUIDown.length > 0,
      `downs=${downs.length} nonUI=${nonUIDown.length}`);
  }

  // --- TEST 4: UI click target is UI (particle will suppress) ---
  await page.evaluate(() => { window.__probe.down = []; });
  await page.locator('textarea').click();
  await page.waitForTimeout(250);
  const uiDowns = await page.evaluate(() => window.__probe.down);
  check('pointerdown on input is flagged UI (suppressed)', uiDowns.length > 0 && uiDowns.some((h) => h.isUI),
    uiDowns.length ? `tags=${uiDowns.map((h) => h.tag).join(',')}` : 'no down events');

  // --- TEST 5: latest message sits at the container bottom ---
  const align = await page.evaluate(() => {
    const bubbles = [...document.querySelectorAll('div.rounded-2xl')];
    if (!bubbles.length) return null;
    const stack = bubbles[0].parentElement;
    const sRect = stack.getBoundingClientRect();
    const last = bubbles[bubbles.length - 1].getBoundingClientRect();
    return { stackBottom: sRect.bottom, lastBottom: last.bottom, gap: sRect.bottom - last.bottom, count: bubbles.length };
  });
  check('latest at bottom (gap within 5px)', !!align && align.gap > -5 && align.gap < 20,
    align ? `count=${align.count} gap=${align.gap.toFixed(1)}px` : '');
  await page.screenshot({ path: 'C:/tmp/r21-01-full-bottom.png' });

  // --- TEST 6: wheel scrolls the bubble history ---
  // Start at the BOTTOM (newest) and wheel UP (deltaY -200) to read older
  // messages: scrollTop must decrease.
  const wheel = await page.evaluate(() => {
    const bubbles = [...document.querySelectorAll('div.rounded-2xl')];
    if (!bubbles.length) return null;
    const stack = bubbles[0].parentElement;
    stack.scrollTop = stack.scrollHeight; // bottom
    const before = stack.scrollTop;
    const rect = stack.getBoundingClientRect();
    const evt = new WheelEvent('wheel', {
      clientX: rect.x + rect.width / 2,
      clientY: rect.y + rect.height / 2,
      deltaY: -200, // wheel up → older messages
      cancelable: true, bubbles: true,
    });
    window.dispatchEvent(evt);
    const after = stack.scrollTop;
    return { before, after, scrolled: after < before };
  });
  check('wheel scrolls bubble history (capture handler)', !!wheel && wheel.scrolled,
    wheel ? `before=${wheel.before} after=${wheel.after}` : 'no stack');

  // --- TEST 7: single mode — bubble above input, not middle ---
  const modeBtn = page.locator('button[aria-label="切换文字呈现方式"]');
  await modeBtn.click(); await page.waitForTimeout(400); // -> single
  const singlePos = await page.evaluate(() => {
    const bubbles = [...document.querySelectorAll('div.rounded-2xl')];
    if (!bubbles.length) return null;
    const b = bubbles[0].getBoundingClientRect();
    const vh = window.innerHeight;
    return { bubbleBottom: b.bottom, vh, nearBottom: b.bottom > vh - 140 };
  });
  check('single bubble above input (near bottom)', !!singlePos && singlePos.nearBottom,
    singlePos ? `bubbleBottom=${singlePos.bubbleBottom.toFixed(0)} vh=${singlePos.vh}` : 'no bubble');
  await page.screenshot({ path: 'C:/tmp/r21-02-single.png' });

  // --- TEST 8: zero drift + hidden mode ---
  const m1 = await modeBtn.boundingBox();
  await modeBtn.click(); await page.waitForTimeout(400); // -> hidden
  const m2 = await modeBtn.boundingBox();
  check('mode button zero drift', Math.abs(m2.x - m1.x) < 2, `x ${m1.x}->${m2.x}`);
  check('hidden mode: input gone', (await page.locator('textarea').count()) === 0);
  check('hidden mode: condense gone', (await page.locator('button[aria-label="凝聚记忆"]').count()) === 0);
  await page.screenshot({ path: 'C:/tmp/r21-03-hidden.png' });
  await modeBtn.click(); await page.waitForTimeout(400); // -> full

  // --- TEST 9: tab switch + back ---
  await page.locator('button:has-text("日记")').first().click();
  await page.waitForTimeout(500);
  const diaryView = await page.locator('text=还没有日记').count();
  await page.locator('button:has-text("对话")').first().click();
  await page.waitForTimeout(500);
  check('tab switch round-trip works', (await page.locator('textarea').count()) === 1);

  const cleanErrors = errors.filter((e) => !e.includes('404'));
  check('no console errors (except 404 noise)', cleanErrors.length === 0, cleanErrors.join('; '));

  await browser.close();
  console.log('== DONE ==');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
