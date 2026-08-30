/**
 * Server-side type definitions.
 *
 * These mirror the shared types in src/types/index.ts but live within the
 * server directory so that tsconfig.node.json (composite project) has no
 * cross-project imports. This avoids TS6305/TS6307 errors that occur when
 * a file is included in multiple composite projects.
 *
 * Structural compatibility with the frontend types is maintained — the
 * server only receives JSON payloads, so nominal identity is unnecessary.
 */

// ---------------------------------------------------------------------------
// Chat Messages
// ---------------------------------------------------------------------------

/** Role of a chat message participant. */
export type MessageRole = 'user' | 'assistant' | 'system';

// ---------------------------------------------------------------------------
// API Request / Response Types
// ---------------------------------------------------------------------------

/** Request payload for POST /api/chat. */
export interface ChatRequest {
  /** Chat messages (role + content only — id/timestamp are client-only). */
  messages: Array<{ role: MessageRole; content: string }>;
  /** Base64-encoded image data URI (only on first AI greeting). */
  imageBase64?: string;
}

/** Response payload from POST /api/condense. */
export interface CondenseResponse {
  /** AI-generated diary title. */
  title: string;
  /** AI-generated diary body text. */
  content: string;
}

/** A single SSE event chunk sent from the server. */
export interface SSEChunk {
  /** Event type. */
  type: 'chunk' | 'done' | 'error';
  /** Text fragment (only when type === 'chunk'). */
  content?: string;
  /** Error message (only when type === 'error'). */
  error?: string;
}

// ---------------------------------------------------------------------------
// Account / Auth / Long-term Memory
// ---------------------------------------------------------------------------

/** A registered user account (public fields only — no credentials). */
export interface User {
  /** Unique account id (crypto.randomUUID on the server). */
  id: string;
  /** Login contact — email or 11-digit mobile number. */
  contact: string;
  /** Display nickname. */
  nickname: string;
  /** Base64 avatar data URL (data:image/...;base64,...) or null. */
  avatar?: string | null;
  /** Account creation timestamp (ms). */
  createdAt: number;
}

/** Full persisted user record (users.json) — includes credentials. */
export interface StoredUser extends User {
  /** SHA-256(salt + password) hex digest. */
  passHash: string;
  /** Per-user random salt (hex). */
  salt: string;
}

/** A long-term memory entry the user hand-wrote. */
export interface Memory {
  /** Unique id (crypto.randomUUID on the server). */
  id: string;
  /** Memory text (≤500 chars). */
  text: string;
  /** Source label, e.g. '你亲手写下的'. */
  source: string;
  /** Creation timestamp (ms). */
  createdAt: number;
}

/** Response from POST /api/auth/register and POST /api/auth/login. */
export interface AuthResponse {
  /** Opaque bearer token. */
  token: string;
  /** The authenticated user. */
  user: User;
}
