import { OpenAI } from 'openai';
import type { ChatRequest } from '../types.js';
import {
  SYSTEM_PROMPT_GREETING,
  SYSTEM_PROMPT_CONDENSE,
  DEFAULT_MODEL,
  DEFAULT_MIMO_MODEL,
  DEFAULT_MIMO_BASE_URL,
  MIMO_IMAGE_PROMPT,
  buildGreetingPromptWithImage,
  buildCondensePromptWithImage,
} from '../constants.js';

/**
 * Dual-AI client wrapper.
 *
 * - **MiMo** (mimo-v2.5): Image understanding — converts uploaded photos
 *   into natural-language descriptions.
 * - **DeepSeek**: Conversation + diary condensation — all text-based
 *   interactions use the OpenAI-compatible DeepSeek API.
 *
 * Architecture:
 *   Image → MiMo.describeImage() → text description
 *         → DeepSeek.streamChat(description) → streamed conversation
 *
 * MiMo is only called once (first greeting). Subsequent chat turns
 * rely on the conversation history which already embeds the image context.
 */

// ---------------------------------------------------------------------------
// DeepSeek Client (conversation + condense)
// ---------------------------------------------------------------------------

const deepseekApiKey = process.env.DEEPSEEK_API_KEY ?? '';
const deepseekBaseURL = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1';
const deepseekModel = process.env.DEEPSEEK_MODEL ?? DEFAULT_MODEL;

// Log configuration on first access for debugging
let _deepseekConfigLogged = false;

let _deepseekClient: OpenAI | null = null;
function getDeepSeekClient(): OpenAI {
  if (!_deepseekClient) {
    if (!deepseekApiKey) {
      console.warn('[DeepSeek] DEEPSEEK_API_KEY is not set. API calls will fail.');
    }
    if (!_deepseekConfigLogged) {
      console.log('[DeepSeek] Config:', { model: deepseekModel, baseURL: deepseekBaseURL, hasKey: !!deepseekApiKey });
      _deepseekConfigLogged = true;
    }
    _deepseekClient = new OpenAI({
      apiKey: deepseekApiKey,
      baseURL: deepseekBaseURL,
      timeout: 60000, // 60 second timeout
      maxRetries: 1,
    });
  }
  return _deepseekClient;
}

// ---------------------------------------------------------------------------
// MiMo Client (image understanding)
// ---------------------------------------------------------------------------

const mimoApiKey = process.env.MIMO_API_KEY ?? '';
const mimoBaseURL = process.env.MIMO_BASE_URL ?? DEFAULT_MIMO_BASE_URL;
const mimoModel = process.env.MIMO_MODEL ?? DEFAULT_MIMO_MODEL;

let _mimoConfigLogged = false;

let _mimoClient: OpenAI | null = null;
function getMiMoClient(): OpenAI {
  if (!_mimoClient) {
    if (!mimoApiKey) {
      console.warn('[MiMo] MIMO_API_KEY is not set. Image understanding will fail.');
    }
    if (!_mimoConfigLogged) {
      console.log('[MiMo] Config:', { model: mimoModel, baseURL: mimoBaseURL, hasKey: !!mimoApiKey });
      _mimoConfigLogged = true;
    }
    _mimoClient = new OpenAI({
      apiKey: mimoApiKey,
      baseURL: mimoBaseURL,
      timeout: 30000, // 30 second timeout — MiMo is only for image description, don't hang too long
      maxRetries: 0,  // No retries — fallback immediately on failure
    });
  }
  return _mimoClient;
}

// ---------------------------------------------------------------------------
// MiMo: Image Description
// ---------------------------------------------------------------------------

/**
 * Send an image to MiMo and receive a natural-language description.
 *
 * The image is sent as an `image_url` (data URI) with a text prompt
 * asking for a concise Chinese description (2-3 sentences).
 *
 * @param imageBase64 — Full data URI string (e.g. "data:image/jpeg;base64,...")
 * @returns Natural-language description of the image content
 */
export async function describeImage(imageBase64: string): Promise<string> {
  const client = getMiMoClient();

  const response = await client.chat.completions.create({
    model: mimoModel,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: imageBase64 },
          },
          {
            type: 'text',
            text: MIMO_IMAGE_PROMPT,
          },
        ],
      },
    ],
    max_tokens: 512,
  });

  const description = response.choices[0]?.message?.content ?? '';

  if (!description) {
    console.warn('[MiMo] describeImage returned empty content');
  }

  return description;
}

// ---------------------------------------------------------------------------
// DeepSeek: Conversation + Condense
// ---------------------------------------------------------------------------

/** Which system prompt to use for the DeepSeek API call. */
type PromptType = 'greeting' | 'condense';

/**
 * Build the messages array for a DeepSeek chat completion request.
 *
 * - `promptType === 'greeting'` with `imageDescription`: uses a greeting
 *   prompt that embeds the MiMo-generated image description, so DeepSeek
 *   can "see" the photo and initiate a conversation about it.
 * - `promptType === 'greeting'` without `imageDescription`: uses the
 *   standard warm conversation prompt (for subsequent chat turns).
 * - `promptType === 'condense'`: uses the diary condensation prompt.
 *
 * @param messages — Conversation history from the client
 * @param imageDescription — Optional MiMo-generated image description (text)
 * @param promptType — Which system prompt variant to use
 */
function buildMessages(
  messages: ChatRequest['messages'],
  imageDescription: string | undefined,
  promptType: PromptType,
): Array<{ role: string; content: string }> {
  // Determine the system prompt based on type and image context
  let systemPrompt: string;

  if (promptType === 'condense') {
    // Re-attach the photo: the condense call swaps out the system prompt that
    // originally carried the MiMo description, so it has to be passed in again.
    systemPrompt = imageDescription
      ? buildCondensePromptWithImage(imageDescription)
      : SYSTEM_PROMPT_CONDENSE;
  } else if (imageDescription) {
    // First greeting with image — inject the MiMo description
    systemPrompt = buildGreetingPromptWithImage(imageDescription);
  } else {
    // Subsequent chat turns — standard warm conversation prompt
    systemPrompt = SYSTEM_PROMPT_GREETING;
  }

  const result: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemPrompt },
  ];

  // Append the conversation history
  for (const msg of messages) {
    result.push({ role: msg.role, content: msg.content });
  }

  return result;
}

/**
 * Stream a DeepSeek chat completion response.
 *
 * Yields text chunks as they arrive from the API.
 * Always uses the greeting (conversational) system prompt.
 *
 * When `imageDescription` is provided (first greeting), it is injected
 * into the system prompt so DeepSeek can converse about the photo.
 *
 * @param messages — Conversation history
 * @param imageDescription — Optional MiMo-generated image description (text, not base64)
 */
export async function* streamChat(
  messages: ChatRequest['messages'],
  imageDescription?: string,
): AsyncGenerator<string> {
  const client = getDeepSeekClient();
  const apiMessages = buildMessages(messages, imageDescription, 'greeting');

  const stream = await client.chat.completions.create({
    model: deepseekModel,
    messages: apiMessages as never,
    stream: true,
    max_tokens: 500,
    temperature: 0.8,
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      yield delta;
    }
  }
}

/**
 * Non-streaming DeepSeek chat completion for condensing chat history into a diary.
 *
 * Uses the condense system prompt and requests JSON output.
 *
 * Round 22 hardening (fixes "blank diary" bug): the result is validated
 * before returning — title must be non-empty AND content must contain at
 * least one non-empty paragraph. An unusable result throws instead of
 * returning an empty diary, so the route responds 500 and the client can
 * retry (up to 2 retries) and finally fall back to a local template.
 *
 * @param messages — Full chat history
 * @returns Parsed { title, content } from the AI response
 */
export async function condenseChat(
  messages: ChatRequest['messages'],
  imageDescription?: string,
): Promise<{ title: string; content: string }> {
  const client = getDeepSeekClient();
  const apiMessages = buildMessages(messages, imageDescription, 'condense');

  const completion = await client.chat.completions.create({
    model: deepseekModel,
    messages: apiMessages as never,
    stream: false,
    max_tokens: 1000,
    // 0.8, not 0.85 — measured: at 0.85 with json_object the model
    // intermittently emits a run of pure whitespace instead of JSON.
    temperature: 0.8,
    // json_object is load-bearing, not cosmetic. Without it the model follows
    // the conversation instead of the system prompt and replies with another
    // chat turn ("最后调出来了吗？") rather than writing the diary — 0/4
    // success when omitted, vs 4/4 with it.
    response_format: { type: 'json_object' },
    // Diary writing needs no chain-of-thought, and reasoning tokens are billed
    // and drawn from max_tokens. Disabling thinking cut latency ~3x
    // (6-9s → 2-3s) and removed a whole class of blank responses.
    extra_body: { thinking: { type: 'disabled' } },
  });

  const content = completion.choices[0]?.message?.content ?? '';
  if (!content || !content.trim()) {
    // LLM returned an empty body — signal the caller to retry.
    throw new Error('condense_empty_response');
  }

  try {
    const parsed = JSON.parse(content) as { title?: unknown; content?: unknown };
    const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
    const body = typeof parsed.content === 'string' ? parsed.content.trim() : '';
    const paragraphs = body
      .split(/\n+/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (!title || paragraphs.length === 0) {
      // Valid JSON but missing required fields — treat as unusable.
      throw new Error('condense_incomplete_result');
    }
    return { title, content: paragraphs.join('\n\n') };
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message === 'condense_empty_response' ||
        err.message === 'condense_incomplete_result')
    ) {
      throw err;
    }
    // JSON.parse failed — try a best-effort regex extraction, else salvage
    // the raw prose (only when it is clearly not JSON), else throw.
    console.warn('[DeepSeek] Failed to parse condense response as JSON:', content);
    const titleMatch = content.match(/"title"\s*:\s*"([^"]*)"/);
    const contentMatch = content.match(/"content"\s*:\s*"([^"]*)"/);
    if (titleMatch && contentMatch && contentMatch[1].trim()) {
      const body = contentMatch[1].trim();
      const paragraphs = body
        .split(/\\n+/)
        .map((p) => p.trim())
        .filter(Boolean);
      if (paragraphs.length > 0) {
        return { title: (titleMatch[1] || '今天的碎片').trim(), content: paragraphs.join('\n\n') };
      }
    }
    const cleaned = content
      .replace(/^```json\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    if (cleaned && !cleaned.startsWith('{')) {
      const paragraphs = cleaned
        .split(/\n+/)
        .map((p) => p.trim())
        .filter(Boolean);
      if (paragraphs.length > 0) {
        return { title: '今天的碎片', content: paragraphs.join('\n\n') };
      }
    }
    throw new Error('condense_incomplete_result');
  }
}
