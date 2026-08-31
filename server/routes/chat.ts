import { Router } from 'express';
import type { Response } from 'express';
import { streamChat, describeImage } from '../utils/deepseek.js';
import { optionalAuth } from '../middleware/auth.js';
import type { ChatRequest, SSEChunk } from '../types.js';

const router = Router();
router.use(optionalAuth);

/**
 * POST /api/chat — Streaming chat endpoint.
 *
 * Receives a ChatRequest (messages + optional imageBase64), streams the
 * AI response back as Server-Sent Events (SSE).
 *
 * Image understanding flow:
 *   1. If `imageBase64` is present (first greeting), call MiMo to get a
 *      natural-language description of the photo.
 *   2. Pass the description to DeepSeek's `streamChat` so it can converse
 *      about the image without needing Vision support itself.
 *   3. Subsequent requests (no `imageBase64`) skip MiMo entirely — the
 *      conversation history already carries the image context.
 *
 * SSE format:
 *   data: {"type":"chunk","content":"text"}\n\n
 *   data: {"type":"done"}\n\n
 *   data: {"type":"error","error":"message"}\n\n
 */
router.post('/', async (req, res: Response) => {
  const { messages, imageBase64 } = req.body as ChatRequest;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Missing or invalid "messages" field' });
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx buffering

  // Flush headers immediately so the client knows the connection is established.
  // Without this, the fetch() on the client side won't resolve until the first
  // res.write() call, which could be delayed by the MiMo image description step.
  res.flushHeaders();

  // Send an SSE comment to confirm the connection is live.
  // SSE comments start with ":" and are ignored by the client parser.
  res.write(': connected\n\n');

  // Helper to send an SSE event
  const sendEvent = (chunk: SSEChunk): void => {
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    // Force flush for SSE so proxies/browsers do not buffer events.
    if (typeof (res as { flush?: () => void }).flush === 'function') {
      (res as { flush: () => void }).flush();
    }
  };

  try {
    // --- Step 1: Image understanding via MiMo (first greeting only) ---
    let imageDescription: string | undefined;

    if (imageBase64) {
      console.log('[Chat Route] Calling MiMo for image description...');
      try {
        imageDescription = await describeImage(imageBase64);
        console.log('[Chat Route] MiMo description:', imageDescription);
      } catch (mimoErr) {
        // If MiMo fails, log the error but continue with a fallback
        const errMsg = mimoErr instanceof Error ? mimoErr.message : String(mimoErr);
        console.error('[Chat Route] MiMo describeImage failed:', errMsg);
        // Use a generic fallback so the conversation can still proceed
        imageDescription = '用户上传了一张照片，但无法获取照片内容描述。';
      }
    }

    // --- Step 1.5: Hand the description back to the client ---
    // The client stores it and replays it to /api/condense later. Without this
    // the diary step would have no idea what the photo actually showed, since
    // the condense call replaces the system prompt that carried it.
    if (imageDescription) {
      sendEvent({ type: 'image_description', content: imageDescription });
    }

    // --- Step 2: Stream DeepSeek conversation with image context ---
    const stream = streamChat(messages, imageDescription);

    for await (const text of stream) {
      sendEvent({ type: 'chunk', content: text });
    }

    sendEvent({ type: 'done' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown streaming error';
    console.error('[Chat Route] Streaming error:', message);
    sendEvent({ type: 'error', error: message });
  } finally {
    res.end();
  }
});

export default router;
