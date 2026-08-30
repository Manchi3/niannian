/**
 * Memories routes (guest allowed — anonymous visitors share the guest space):
 *   GET    /api/memories       → { memories } (createdAt descending)
 *   POST   /api/memories       → 201 { memory }
 *   DELETE /api/memories/:id   → { ok: true } | 404
 *
 * Data lives in server/data/<uid>/memories.json (uid from optionalAuth).
 */
import { Router } from 'express';
import crypto from 'node:crypto';
import { optionalAuth } from '../middleware/auth.js';
import { readMemories, saveMemories } from '../utils/store.js';
import type { Memory } from '../types.js';

const router = Router();
router.use(optionalAuth);

const MAX_TEXT_LENGTH = 500;

/** GET /api/memories */
router.get('/', async (req, res) => {
  const uid = (req.uid ?? 'guest') as string;
  const memories = await readMemories(uid);
  memories.sort((a, b) => b.createdAt - a.createdAt);
  return res.json({ memories });
});

/** POST /api/memories — { text } */
router.post('/', async (req, res) => {
  const uid = (req.uid ?? 'guest') as string;
  const { text } = (req.body ?? {}) as { text?: string };

  if (typeof text !== 'string' || text.trim().length === 0) {
    return res.status(400).json({ error: 'invalid_text', message: '记忆内容不能为空' });
  }
  if (text.trim().length > MAX_TEXT_LENGTH) {
    return res
      .status(400)
      .json({ error: 'text_too_long', message: `记忆内容不能超过 ${MAX_TEXT_LENGTH} 字` });
  }

  const memory: Memory = {
    id: crypto.randomUUID(),
    text: text.trim(),
    source: '你亲手写下的',
    createdAt: Date.now(),
  };

  const list = await readMemories(uid);
  list.push(memory);
  await saveMemories(uid, list);

  return res.status(201).json({ memory });
});

/** DELETE /api/memories/:id */
router.delete('/:id', async (req, res) => {
  const uid = (req.uid ?? 'guest') as string;
  const { id } = req.params as { id: string };

  const list = await readMemories(uid);
  const next = list.filter((m) => m.id !== id);
  if (next.length === list.length) {
    return res.status(404).json({ error: 'not_found', message: '记忆不存在' });
  }

  await saveMemories(uid, next);
  return res.json({ ok: true });
});

export default router;
