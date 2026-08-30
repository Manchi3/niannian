/**
 * User routes (require a real account):
 *   PUT /api/user/profile  — { nickname?, avatar? } → { user }
 *   PUT /api/user/password — { password } → { ok: true }
 *
 * Avatar validation: base64 data URL of png/jpeg/webp, total ≤ 200 KB.
 */
import { Router } from 'express';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { getUsers, saveUser } from '../utils/store.js';
import { hashPassword, sanitizeUser } from '../utils/security.js';
import type { StoredUser } from '../types.js';

const router = Router();
// optionalAuth first: parse the Bearer token into req.uid, then requireAuth
// rejects guests.
router.use(optionalAuth);
router.use(requireAuth);

const AVATAR_PATTERN = /^data:image\/(png|jpeg|webp);base64,/;
const MAX_AVATAR_LENGTH = 200 * 1024; // 200 KB

/** PUT /api/user/profile — { nickname?, avatar? } */
router.put('/profile', async (req, res) => {
  const uid = req.uid as string;
  const { nickname, avatar } = (req.body ?? {}) as { nickname?: string; avatar?: string };

  if (nickname !== undefined && (typeof nickname !== 'string' || nickname.trim().length === 0)) {
    return res.status(400).json({ error: 'invalid_nickname', message: '昵称不能为空' });
  }
  if (
    avatar !== undefined &&
    (typeof avatar !== 'string' ||
      avatar.length > MAX_AVATAR_LENGTH ||
      !AVATAR_PATTERN.test(avatar))
  ) {
    return res
      .status(400)
      .json({ error: 'invalid_avatar', message: '头像格式不正确或文件过大（≤200KB）' });
  }

  const users = await getUsers();
  const idx = users.findIndex((u) => u.id === uid);
  if (idx < 0) {
    return res.status(404).json({ error: 'user_not_found', message: '账号不存在' });
  }

  const stored: StoredUser = { ...users[idx] };
  if (nickname !== undefined) stored.nickname = nickname.trim() || '念念的朋友';
  if (avatar !== undefined) stored.avatar = avatar || null;
  await saveUser(stored);

  return res.json({ user: sanitizeUser(stored) });
});

/** PUT /api/user/password — { password } */
router.put('/password', async (req, res) => {
  const uid = req.uid as string;
  const { password } = (req.body ?? {}) as { password?: string };

  if (!password || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'weak_password', message: '密码至少 6 位' });
  }

  const users = await getUsers();
  const idx = users.findIndex((u) => u.id === uid);
  if (idx < 0) {
    return res.status(404).json({ error: 'user_not_found', message: '账号不存在' });
  }

  const stored: StoredUser = { ...users[idx] };
  const { salt, hash } = hashPassword(password);
  stored.salt = salt;
  stored.passHash = hash;
  await saveUser(stored);

  return res.json({ ok: true });
});

export default router;
