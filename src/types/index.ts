/**
 * Global TypeScript type definitions for Particle Diary.
 *
 * This file is the root of the dependency graph — it imports nothing
 * from other modules and is imported by stores, services, hooks, and components.
 */

// ---------------------------------------------------------------------------
// Application State Machine
// ---------------------------------------------------------------------------

/** Application phase — drives the top-level routing logic. */
export type AppPhase =
  | 'idle' // Initial empty state, shows upload entry
  | 'uploading' // Image being processed
  | 'particle' // Particle rendering complete, awaiting AI greeting
  | 'chatting' // Chat in progress
  | 'condensing' // Diary being generated from chat
  | 'diary' // Diary display state
  | 'saved' // Diary saved, confirmation state
  | 'reviewing'; // Reviewing a historical diary

// ---------------------------------------------------------------------------
// Chat Messages
// ---------------------------------------------------------------------------

/** Role of a chat message participant. */
export type MessageRole = 'user' | 'assistant' | 'system';

/** A single chat message exchanged between the user and AI. */
export interface Message {
  /** Unique identifier (crypto.randomUUID()). */
  id: string;
  /** Message sender role. */
  role: MessageRole;
  /** Text content of the message. */
  content: string;
  /** Unix timestamp (ms) when the message was created. */
  timestamp: number;
  /**
   * Round 23: marks that this message's typewriter reveal has already
   * completed at least once. Persisted in the chat store so that switching
   * views (which unmounts/remounts ChatPanel) does NOT replay the typing
   * animation for messages that were already fully revealed.
   */
  typed?: boolean;
}

// ---------------------------------------------------------------------------
// Particle Data (generated from image sampling)
// ---------------------------------------------------------------------------

/** Structured particle data produced by the image processor. */
export interface ParticleData {
  /** Per-particle x,y,z coordinates — length = 3 * count. */
  positions: Float32Array;
  /** Per-particle r,g,b color values — length = 3 * count. */
  colors: Float32Array;
  /** Per-particle size — length = count. */
  sizes: Float32Array;
  /** Target (home) positions for assemble animation — length = 3 * count. */
  originalPositions: Float32Array;
  /** Random start positions for assemble animation — length = 3 * count. */
  randomPositions: Float32Array;
  /** Random seeds for float animation phase — length = count. */
  randomSeeds: Float32Array;
  /** Edge fade factor for elliptical vignette — length = count.
   *  0.0 = fully visible center, 1.0 = fully transparent edge. */
  edges: Float32Array;
  /** Total number of particles. */
  count: number;
}

// ---------------------------------------------------------------------------
// Diary
// ---------------------------------------------------------------------------

/** Current record-level schema version for Diary entries. */
export const CURRENT_SCHEMA_VERSION = 2;

/**
 * A saved diary entry.
 *
 * v2 (Round 41): the ORIGINAL image moved out of IndexedDB into OPFS —
 * the record only holds an imageRef ('opfs:<filename>' | 'idb:' | null) and
 * a small thumbnailBlob. legacyImageBlob exists ONLY when OPFS is
 * unavailable and the original was downgraded into IndexedDB ('idb:').
 * tags/mood are reserved placeholders (no UI yet).
 */
export interface Diary {
  /** Record-level schema version — always CURRENT_SCHEMA_VERSION on write. */
  _schemaVersion: number;
  /** Unique identifier (UUID). */
  id: string;
  /** Round 29 (⑤): the conversation round this diary belongs to. Diaries
   *  from the same round replace one another instead of stacking. Optional
   *  for records created before this field existed (old data → undefined). */
  conversationId?: string;
  /** AI-generated poetic title (≤10 characters). */
  title: string;
  /** Diary date in ISO 8601 format (YYYY-MM-DD). */
  date: string;
  /** Diary body text. */
  content: string;
  /** Full chat history that produced this diary. */
  chatHistory: Message[];
  /** Small thumbnail (~100×100) for list display — stays in IndexedDB. */
  thumbnailBlob?: Blob;
  /** Original image reference: 'opfs:<filename>' | 'idb:' | null. */
  imageRef?: string | null;
  /** Original image blob — ONLY set when imageRef === 'idb:' (OPFS
   *  unavailable downgrade). */
  legacyImageBlob?: Blob;
  /** Reserved placeholder (no UI yet). */
  tags?: string[];
  /** Reserved placeholder (no UI yet). */
  mood?: string;
  /** Creation timestamp (ms). */
  createdAt: number;
  /** Last update timestamp (ms). */
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// API Request / Response Types
// ---------------------------------------------------------------------------

/** Request payload for POST /api/chat. */
export interface ChatRequest {
  /** Chat messages (role + content only — id/timestamp are client-only). */
  messages: Pick<Message, 'role' | 'content'>[];
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

/** Login-state status of the frontend auth store. */
export type AuthStatus = 'boot' | 'guest' | 'authed';

/** Response from POST /api/auth/register and POST /api/auth/login. */
export interface AuthResponse {
  /** Opaque bearer token (stored in localStorage.nn_token). */
  token: string;
  /** The authenticated user. */
  user: User;
}

/** Response from POST /api/auth/code (dev mode echoes the code). */
export interface SendCodeResponse {
  ok: boolean;
  /** Only present in development mode (NODE_ENV !== 'production'). */
  devCode?: string;
  /** Cooldown seconds before the next code may be sent. */
  retryAfterSec?: number;
  /** Code validity in seconds. */
  expiresInSec?: number;
}

/** Payload for POST /api/auth/register. */
export interface RegisterInput {
  contact: string;
  /**
   * Required. The password is the only credential protecting an account, so
   * the server rejects anything shorter than 6 characters.
   */
  password: string;
  nickname?: string;
  /** Optional legacy field: validated only when supplied. Not used by the UI. */
  code?: string;
}

/** Payload for POST /api/auth/login (password OR code mode). */
export interface LoginInput {
  contact: string;
  password?: string;
  code?: string;
}
