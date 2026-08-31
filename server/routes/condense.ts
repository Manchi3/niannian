import { Router } from 'express';
import { condenseChat } from '../utils/deepseek.js';
import { optionalAuth } from '../middleware/auth.js';
import type { CondenseRequest } from '../types.js';

const router = Router();
router.use(optionalAuth);

/**
 * POST /api/condense — Condense chat history into a diary.
 *
 * Receives the full chat message history and returns a JSON object
 * with AI-generated diary title and content.
 *
 * Request body: { messages: [{ role, content }, ...], imageDescription?: string }
 * Response: { title: string, content: string }
 */
router.post('/', async (req, res) => {
  const { messages, imageDescription } = req.body as CondenseRequest;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      error: 'Missing or empty "messages" field',
    });
  }

  try {
    const result = await condenseChat(messages, imageDescription);
    return res.status(200).json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Condense Route] Error:', message);
    return res.status(500).json({
      error: 'Failed to condense chat into diary',
      message,
    });
  }
});

export default router;
