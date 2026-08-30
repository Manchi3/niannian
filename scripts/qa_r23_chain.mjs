// Independent QA run for R23 avatar full-chain + condense prompt (real calls).
const BASE = 'http://localhost:3001';
const contact = `qa_r23_${Date.now()}@test.local`;
const tinyPng =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC';

const log = (...a) => console.log(...a);

async function j(method, path, body, token) {
  const opt = { method, headers: { 'Content-Type': 'application/json' } };
  if (token) opt.headers['Authorization'] = `Bearer ${token}`;
  if (body) opt.body = JSON.stringify(body);
  const r = await fetch(BASE + path, opt);
  let data = null;
  try { data = await r.json(); } catch {}
  return { status: r.status, data };
}

(async () => {
  log('--- 1) health ---');
  const h = await j('GET', '/api/health');
  log('GET /api/health', h.status, JSON.stringify(h.data));

  log('--- 2) register (dev code) ---');
  const codeRes = await j('POST', '/api/auth/code', { contact });
  const devCode = codeRes.data?.devCode;
  log('POST /api/auth/code', codeRes.status, JSON.stringify(codeRes.data));
  if (!devCode) { log('FAIL: no devCode'); return; }

  const regRes = await j('POST', '/api/auth/register', { contact, code: devCode, nickname: 'QA小测' });
  const token = regRes.data?.token;
  log('POST /api/auth/register', regRes.status, 'user.avatar=', regRes.data?.user?.avatar);
  if (!token) { log('FAIL: no token'); return; }

  log('--- 3) PUT /api/user/profile (avatar) ---');
  const putRes = await j('PUT', '/api/user/profile', { avatar: tinyPng }, token);
  const putAvatar = putRes.data?.user?.avatar;
  log('PUT /api/user/profile', putRes.status,
      'avatar non-null?', !!putAvatar,
      'png prefix?', putAvatar?.startsWith('data:image/png;base64,'));

  log('--- 4) GET /api/auth/me (persistence) ---');
  const meRes = await j('GET', '/api/auth/me', null, token);
  const meAvatar = meRes.data?.user?.avatar;
  log('GET /api/auth/me', meRes.status,
      'avatar persisted?', !!meAvatar,
      'matches PUT?', meAvatar === putAvatar);

  log('--- 5) POST /api/condense (new prompt) [optional live LLM] ---');
  try {
    const condRes = await j('POST', '/api/condense', {
      messages: [
        { role: 'user', content: '今天和朋友去公园散步，阳光很好，我们聊了很久。' },
        { role: 'assistant', content: '听起来很舒服呀，公园里是不是很多花？' },
        { role: 'user', content: '对，还有人在放风筝，小孩跑来跑去特别开心。' },
      ],
    });
    log('POST /api/condense', condRes.status, JSON.stringify(condRes.data));
  } catch (e) {
    log('condense call error (likely env/network, NOT a code bug):', e.message);
  }
})();
