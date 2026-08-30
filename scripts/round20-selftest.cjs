// Round 20 UI self-test — ver 4: mock /api/chat SSE for fast real-path flow
const { chromium } = require('playwright');

const SSE_REPLY = [
  'data: {"type":"chunk","content":"好的，海边总是让人放松呢。还有什么想聊的吗？"}\n\n',
  'data: {"type":"done"}\n\n',
].join('');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  // Intercept /api/chat with an instant SSE reply so AI turns complete fast
  await page.route('**/api/chat', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'Cache-Control': 'no-cache' },
      body: SSE_REPLY,
    });
  });

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
    name: 'r20.png', mimeType: 'image/png', buffer: pngBuf,
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
  // Wait for the AI greeting to complete (phase → chatting) — mocked SSE is instant
  await page.waitForTimeout(2500);
  const vw = await page.evaluate(() => window.innerWidth);

  // 1) input pill center WITHOUT condense
  const pill1 = await inputPill.boundingBox();
  const c1 = pill1.x + pill1.width / 2;
  check('input centered (no condense)', Math.abs(c1 - vw / 2) < 6, `center=${c1.toFixed(1)}`);

  // 2) send 3 messages (mocked replies)
  const send = async (text) => {
    const ta = page.locator('textarea');
    await ta.fill(text);
    await page.waitForTimeout(150);
    await page.locator('button[aria-label="发送"]').click();
    await page.waitForFunction(() => {
      const el = document.querySelector('textarea');
      return el && !el.disabled;
    }, { timeout: 15000 });
    await page.waitForTimeout(400);
  };
  await send('今天去了海边的日落，波光粼粼');
  await send('海风很舒服，待了很久');
  await send('感觉烦恼都被吹走了');

  // 3) condense button visible?
  const condenseBtn = page.locator('button[aria-label="凝聚记忆"]');
  const cbVisible = (await condenseBtn.count()) > 0;
  check('condense button visible after 3 msgs', cbVisible);

  // 4) input pill center WITH condense
  const pill2 = await inputPill.boundingBox();
  const c2 = pill2.x + pill2.width / 2;
  check('input center stable with/without condense', Math.abs(c2 - c1) < 2,
    `before=${c1.toFixed(1)} after=${c2.toFixed(1)}`);

  // 5) condense position
  if (cbVisible) {
    const cb = await condenseBtn.boundingBox();
    const gap = cb.x - (pill2.x + pill2.width);
    const distEdge = vw - (cb.x + cb.width);
    check('condense gap to input ~12px', gap >= 8 && gap <= 18, `gap=${gap.toFixed(0)}px`);
    check('condense not stuck to edge', distEdge > 100, `distToEdge=${distEdge.toFixed(0)}px`);
  }

  // 6) all history bubbles rendered
  const bubbleCount = await page.locator('div.rounded-2xl').count();
  check('history bubbles rendered (>=3)', bubbleCount >= 3, `bubbles=${bubbleCount}`);
  await page.screenshot({ path: 'C:/tmp/r20-04-full-history.png' });

  // 7) scrollable history: verify container has overflow-y auto
  const scrollable = await page.evaluate(() => {
    const ta = document.querySelector('textarea');
    const stack = ta.closest('div[class*="fixed"]').parentElement;
    // find the scrollable bubble stack: it wraps bubbles, not the input
    const bubbles = [...document.querySelectorAll('div.rounded-2xl')];
    const holder = bubbles.length ? bubbles[0].parentElement : null;
    if (!holder) return null;
    const cs = getComputedStyle(holder);
    return { overflowY: cs.overflowY, maxHeight: cs.maxHeight, childCount: holder.children.length };
  });
  check('bubble stack scrollable', !!scrollable && scrollable.overflowY === 'auto',
    scrollable ? `overflowY=${scrollable.overflowY} maxH=${scrollable.maxHeight} children=${scrollable.childCount}` : 'not found');

  // 8) mode cycle — button zero drift
  const modeBtn = page.locator('button[aria-label="切换文字呈现方式"]');
  const m1 = await modeBtn.boundingBox();
  await modeBtn.click(); await page.waitForTimeout(400); // -> single
  const singleCount = await page.locator('div.rounded-2xl').count();
  const m2 = await modeBtn.boundingBox();
  check('mode btn no drift', Math.abs(m2.x - m1.x) < 2, `x ${m1.x}->${m2.x}`);
  check('single mode: exactly 1 bubble', singleCount === 1, `count=${singleCount}`);
  await page.screenshot({ path: 'C:/tmp/r20-05-single.png' });

  await modeBtn.click(); await page.waitForTimeout(400); // -> hidden
  check('hidden mode: input gone', (await inputPill.count()) === 0);
  check('hidden mode: condense gone', (await condenseBtn.count()) === 0);
  await page.screenshot({ path: 'C:/tmp/r20-06-hidden.png' });

  const stored = await page.evaluate(() => localStorage.getItem('textDisplayMode'));
  check('mode persisted', stored === 'hidden', `stored=${stored}`);

  check('no console errors', errors.length === 0, errors.join('; '));

  await browser.close();
  console.log('== DONE ==');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
