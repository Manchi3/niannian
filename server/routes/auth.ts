/**
 * Auth routes:
 *   POST /api/auth/code     — issue a 6-digit verification code (dev echoes it)
 *   POST /api/auth/register — create an account (code-verified) → { token, user }
 *   POST /api/auth/login    — password OR code login → { token, user }
 *   GET  /api/auth/me       — resolve the Bearer token → { user }
 *
 * All routes run optionalAuth first so /me can rely on req.uid.
 */
import { Router } from 'express';
import crypto from 'node:crypto';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { getUsers, saveUser } from '../utils/store.js';
import {
  hashPassword,
  issueCode,
  issueToken,
  sanitizeUser,
  verifyCode,
  verifyPassword,
} from '../utils/security.js';
import type { StoredUser } from '../types.js';

const router = Router();
router.use(optionalAuth);

/** Development mode (NODE_ENV !== 'production') echoes codes in responses. */
const DEV_MODE = process.env.NODE_ENV !== 'production';

/** Contact must be a non-empty email-ish string or an 11-digit mobile number. */
function isValidContact(contact: string): boolean {
  const c = contact.trim();
  return c.length > 0 && (c.includes('@') || /^\d{11}$/.test(c));
}

/** POST /api/auth/code — { contact } */
router.post('/code', async (req, res) => {
  const { contact } = (req.body ?? {}) as { contact?: string };
  if (!contact || !isValidContact(contact)) {
    return res
      .status(400)
      .json({ error: 'invalid_contact', message: '请输入有效的邮箱或手机号' });
  }

  const { code, cooldownMs } = issueCode(contact.trim());
  if (cooldownMs > 0) {
    return res.status(429).json({
      error: 'rate_limited',
      message: '发送太频繁，请稍后再试',
      retryAfterSec: Math.ceil(cooldownMs / 1000),
    });
  }

  if (DEV_MODE) {
    console.log(`[Auth] 验证码 for ${contact.trim()}: ${code}`);
    return res.json({ ok: true, devCode: code, expiresInSec: 300 });
  }
  return res.json({ ok: true, expiresInSec: 300 });
});

/** POST /api/auth/register — { contact, code, nickname?, password? } */
router.post('/register', async (req, res) => {
  const { contact, code, nickname, password } = (req.body ?? {}) as {
    contact?: string;
    code?: string;
    nickname?: string;
    password?: string;
  };

  if (!contact || !isValidContact(contact)) {
    return res
      .status(400)
      .json({ error: 'invalid_contact', message: '请输入有效的邮箱或手机号' });
  }
  const c = contact.trim();

  if (!code || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: 'invalid_code', message: '请输入 6 位验证码' });
  }
  if (password !== undefined && password !== '' && password.length < 6) {
    return res.status(400).json({ error: 'weak_password', message: '密码至少 6 位' });
  }
  if (!verifyCode(c, code)) {
    return res.status(400).json({ error: 'invalid_code', message: '验证码错误或已过期' });
  }

  const users = await getUsers();
  if (users.some((u) => u.contact === c)) {
    return res.status(409).json({ error: 'contact_exists', message: '该账号已注册，请直接登录' });
  }

  const { salt, hash } = hashPassword(password ?? '');
  const stored: StoredUser = {
    id: crypto.randomUUID(),
    contact: c,
    nickname: (nickname ?? '').trim() || '念念的朋友',
    passHash: hash,
    salt,
    avatar: null,
    createdAt: Date.now(),
  };
  await saveUser(stored);

  const token = issueToken(stored.id);
  return res.status(201).json({ token, user: sanitizeUser(stored) });
});

/** POST /api/auth/login — { contact, password } OR { contact, code } */
router.post('/login', async (req, res) => {
  const { contact, password, code } = (req.body ?? {}) as {
    contact?: string;
    password?: string;
    code?: string;
  };

  if (!contact || !isValidContact(contact)) {
    return res
      .status(400)
      .json({ error: 'invalid_contact', message: '请输入有效的邮箱或手机号' });
  }
  const c = contact.trim();

  const users = await getUsers();
  const user = users.find((u) => u.contact === c);
  if (!user) {
    return res.status(404).json({ error: 'user_not_found', message: '账号不存在，请先注册' });
  }

  if (code) {
    if (!verifyCode(c, code)) {
      return res.status(400).json({ error: 'invalid_code', message: '验证码错误或已过期' });
    }
  } else if (password !== undefined && password !== '') {
    if (!verifyPassword(password, user.salt, user.passHash)) {
      return res.status(401).json({ error: 'invalid_password', message: '密码不正确' });
    }
  } else {
    return res
      .status(400)
      .json({ error: 'invalid_credentials', message: '请提供密码或验证码' });
  }

  const token = issueToken(user.id);
  return res.json({ token, user: sanitizeUser(user) });
});

/** GET /api/auth/me — Bearer token → { user } */
router.get('/me', requireAuth, async (req, res) => {
  const users = await getUsers();
  const user = users.find((u) => u.id === req.uid);
  if (!user) {
    return res.status(401).json({ error: 'invalid_token', message: '账号不存在' });
  }
  return res.json({ user: sanitizeUser(user) });
});

export default router;
