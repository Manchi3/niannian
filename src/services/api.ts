import type { ChatRequest, CondenseResponse, SSEChunk } from '../types';
import type {
  AuthResponse,
  LoginInput,
  Memory,
  RegisterInput,
  SendCodeResponse,
  User,
} from '../types';
import { TOKEN_KEY } from '../utils/uid';

/**
 * API client service for communicating with the Express backend.
 *
 * - `chat()`: Uses fetch + ReadableStream to parse SSE from POST /api/chat
 * - `condense()`: Simple JSON POST to /api/condense
 * - `authFetch()`: fetch wrapper that attaches the Bearer token (if any)
 * - Auth/user/memory methods: sendCode / register / login / fetchMe /
 *   updateProfile / updatePassword / fetchMemories / addMemory / deleteMemory
 */

/** Stale-connection timeout: if no data arrives for this many ms, abort. */
const STALE_TIMEOUT_MS = 120_000;

/** Read the session token from localStorage (best effort). */
function getToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * fetch() wrapper that automatically attaches `Authorization: Bearer <token>`
 * when a token exists, and JSON Content-Type when a body is present.
 */
export async function authFetch(
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (init.body && !(init.headers instanceof Headers ? init.headers.has('Content-Type') : (init.headers as Record<string, string> | undefined)?.['Content-Type'])) {
    headers['Content-Type'] = 'application/json';
  }
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(input, { ...init, headers });
}

/** Parse a JSON response; throw an Error with status/data on non-2xx. */
export interface ApiError extends Error {
  status?: number;
  data?: unknown;
}

async function parseJson<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    const err = new Error(
      data.message ?? data.error ?? `HTTP ${res.status}`,
    ) as ApiError;
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data as T;
}

/**
 * Send a chat request with optional image and receive streamed response via SSE.
 *
 * Includes a stale-connection timeout: if no data is received for 120 seconds,
 * the request is aborted and an error is reported to the caller.
 *
 * @param request — ChatRequest containing messages and optional imageBase64
 * @param onChunk — Callback invoked for each text chunk received
 * @param onDone — Callback invoked when the stream is complete
 * @param onError — Callback invoked on error
 * @returns A Promise that resolves with the full accumulated text
 */
export async function chat(
  request: ChatRequest,
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (error: string) => void,
  /**
   * Receives the MiMo photo description, which the server emits once before
   * the first text chunk. Callers should stash it and hand it back to
   * `condense()` so the diary keeps the visual context.
   */
  onImageDescription?: (description: string) => void,
): Promise<string> {
  let fullText = '';
  const controller = new AbortController();

  // Stale-connection timer: reset every time data arrives.
  // If no data for STALE_TIMEOUT_MS, abort and report error.
  let staleTimer: ReturnType<typeof setTimeout> | undefined;
  let errored = false;

  const resetStaleTimer = (): void => {
    if (staleTimer) clearTimeout(staleTimer);
    staleTimer = setTimeout(() => {
      controller.abort();
      if (!errored) {
        errored = true;
        onError('请求超时，服务器长时间未响应。请重试。');
      }
    }, STALE_TIMEOUT_MS);
  };

  const clearStaleTimer = (): void => {
    if (staleTimer) {
      clearTimeout(staleTimer);
      staleTimer = undefined;
    }
  };

  resetStaleTimer();

  try {
    console.log('[api.ts] Sending fetch to /api/chat', { messagesLen: request.messages.length, hasImage: !!request.imageBase64, imageLen: request.imageBase64?.length });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    console.log('[api.ts] Response received', { status: response.status, ok: response.ok });

    if (!response.ok) {
      clearStaleTimer();
      const errorText = await response.text().catch(() => 'Request failed');
      onError(`HTTP ${response.status}: ${errorText}`);
      return '';
    }

    if (!response.body) {
      clearStaleTimer();
      onError('No response body received');
      return '';
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let chunkCount = 0;
    let lastChunkAt = Date.now();

    console.log('[api.ts] Starting to read stream...');

    // Completion fallback: if we have received content but no new data
    // arrives for 8 seconds, force-end the stream so the UI is not stuck.
    const COMPLETION_TIMEOUT_MS = 8_000;
    let completionTimer: ReturnType<typeof setTimeout> | undefined;
    const clearCompletionTimer = (): void => {
      if (completionTimer) {
        clearTimeout(completionTimer);
        completionTimer = undefined;
      }
    };
    const resetCompletionTimer = (): void => {
      clearCompletionTimer();
      if (fullText.length > 0) {
        completionTimer = setTimeout(() => {
          console.warn('[api.ts] Completion fallback triggered — forcing onDone');
          controller.abort();
          clearStaleTimer();
          onDone();
        }, COMPLETION_TIMEOUT_MS);
      }
    };

    // Read the stream chunk by chunk
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        console.log('[api.ts] Stream done, total chunks received:', chunkCount);
        break;
      }

      // Reset stale timer on every received chunk (including SSE comments)
      resetStaleTimer();
      // Reset completion fallback whenever new data arrives
      clearCompletionTimer();
      lastChunkAt = Date.now();

      const decoded = decoder.decode(value, { stream: true });
      console.log('[api.ts] Raw chunk received:', decoded.slice(0, 200));
      buffer += decoded;

      // SSE events are delimited by \n\n (handle both LF and CRLF line endings)
      const normalized = buffer.replace(/\r\n/g, '\n');
      const lines = normalized.split('\n\n');
      // Keep the last incomplete segment in the buffer
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        // Skip empty lines and SSE comments (lines starting with ":")
        if (!trimmed || trimmed.startsWith(':')) continue;

        if (!trimmed.startsWith('data:')) continue;

        // Extract the JSON payload after "data: "
        const jsonStr = trimmed.slice(5).trim();
        if (jsonStr === '[DONE]') {
          clearCompletionTimer();
          clearStaleTimer();
          onDone();
          return fullText;
        }

        try {
          const chunk: SSEChunk = JSON.parse(jsonStr);
          if (chunk.type === 'chunk' && chunk.content) {
            chunkCount++;
            fullText += chunk.content;
            onChunk(chunk.content);
          } else if (chunk.type === 'done') {
            console.log('[api.ts] Received done event');
            clearCompletionTimer();
            clearStaleTimer();
            onDone();
            return fullText;
          } else if (chunk.type === 'error' && chunk.error) {
            console.error('[api.ts] Received error event:', chunk.error);
            clearCompletionTimer();
            clearStaleTimer();
            onError(chunk.error);
            return fullText;
          } else if (chunk.type === 'image_description' && chunk.content) {
            // Non-terminal — text chunks follow, so keep reading the stream.
            onImageDescription?.(chunk.content);
          }
        } catch {
          // Ignore malformed JSON chunks
          console.warn('[API] Failed to parse SSE chunk:', jsonStr);
        }
      }

      // If we already got meaningful content but the stream is silent,
      // set a fallback timer that will force completion.
      resetCompletionTimer();
    }

    // Stream ended without explicit [DONE]
    clearCompletionTimer();
    clearStaleTimer();
    onDone();
    return fullText;
  } catch (err) {
    clearStaleTimer();

    // If we already reported a timeout error via the stale timer, don't
    // double-report — the AbortError is expected.
    if (errored) {
      return fullText;
    }

    const message = err instanceof Error ? err.message : 'Unknown network error';
    onError(message);
    return fullText;
  }
}

/**
 * Send chat messages to be condensed into a diary (title + content).
 *
 * Round 22: a timeout is enforced client-side (default 30s). On timeout the
 * request is aborted and rejects with `condense_timeout` so the caller can
 * show "记忆没有凝聚成功，再试一次" and stay on the current page.
 *
 * @param messages — The full chat history
 * @param timeoutMs — Optional per-request timeout (default 30000)
 * @returns CondenseResponse with title and content
 */
export async function condense(
  messages: { role: string; content: string }[],
  timeoutMs = 30000,
  imageDescription?: string,
): Promise<CondenseResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch('/api/condense', {
      method: 'POST',
      headers,
      body: JSON.stringify({ messages, imageDescription }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Condense request failed');
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    return (await response.json()) as CondenseResponse;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('condense_timeout');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Auth / User / Memory endpoints
// ---------------------------------------------------------------------------

/** POST /api/auth/code — request a verification code. */
export async function sendCode(contact: string): Promise<SendCodeResponse> {
  const res = await authFetch('/api/auth/code', {
    method: 'POST',
    body: JSON.stringify({ contact }),
  });
  return parseJson<SendCodeResponse>(res);
}

/** POST /api/auth/register — create an account (code-verified). */
export async function register(input: RegisterInput): Promise<AuthResponse> {
  const res = await authFetch('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return parseJson<AuthResponse>(res);
}

/** POST /api/auth/login — password OR code login. */
export async function login(input: LoginInput): Promise<AuthResponse> {
  const res = await authFetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return parseJson<AuthResponse>(res);
}

/** GET /api/auth/me — resolve the session token to a user. */
export async function fetchMe(): Promise<User> {
  const res = await authFetch('/api/auth/me');
  const data = await parseJson<{ user: User }>(res);
  return data.user;
}

/** PUT /api/user/profile — update nickname / avatar. */
export async function updateProfile(patch: {
  nickname?: string;
  avatar?: string;
}): Promise<User> {
  const res = await authFetch('/api/user/profile', {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
  const data = await parseJson<{ user: User }>(res);
  return data.user;
}

/** PUT /api/user/password — change the account password. */
export async function updatePassword(password: string): Promise<void> {
  const res = await authFetch('/api/user/password', {
    method: 'PUT',
    body: JSON.stringify({ password }),
  });
  await parseJson<{ ok: true }>(res);
}

/** GET /api/memories — fetch the current account's memories. */
export async function fetchMemories(): Promise<Memory[]> {
  const res = await authFetch('/api/memories');
  const data = await parseJson<{ memories: Memory[] }>(res);
  return data.memories;
}

/** POST /api/memories — add a hand-written memory. */
export async function addMemory(text: string): Promise<Memory> {
  const res = await authFetch('/api/memories', {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
  const data = await parseJson<{ memory: Memory }>(res);
  return data.memory;
}

/** DELETE /api/memories/:id — remove a memory. */
export async function deleteMemory(id: string): Promise<void> {
  const res = await authFetch(`/api/memories/${id}`, { method: 'DELETE' });
  await parseJson<{ ok: true }>(res);
}
