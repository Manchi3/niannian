/**
 * Security primitives for the Particle Diary server.
 *
 *   - Password hashing: SHA-256(salt + password) with a per-user 16-byte
 *     random salt (hex). Plaintext is never stored.
 *   - Token store: in-memory Map<token, uid>. Tokens are 32 random bytes
 *     hex-encoded; no expiry, no blacklist (development-stage decision).
 *   - Code store: in-memory Map<contact, {code, expiresAt, cooldownUntil}>.
 *     Codes are 6 digits, valid 5 minutes, send cooldown 60 seconds, and
 *     are consumed on first successful verification (one-time use).
 *
 * In-memory stores reset on server restart — acceptable for development.
 */
import crypto from 'node:crypto';
import type { User } from '../types.js';

const SALT_BYTES = 16;
const CODE_TTL_MS = 5 * 60 * 1000;
const CODE_COOLDOWN_MS = 60 * 1000;
const CODE_LENGTH = 6;

/** In-memory token → uid map (no expiry, no blacklist). */
const tokenStore = new Map<string, string>();

/** In-memory contact → code entry map. */
const codeStore = new Map<
  string,
  { code: string; expiresAt: number; cooldownUntil: number }
>();

// ---------------------------------------------------------------------------
// Password hashing
// ---------------------------------------------------------------------------

/** Generate a random salt and the SHA-256(salt + password) hex digest. */
export function hashPassword(password: string): { salt: string; hash: string } {
  const salt = crypto.randomBytes(SALT_BYTES).toString('hex');
  const hash = crypto
    .createHash('sha256')
    .update(salt + password)
    .digest('hex');
  return { salt, hash };
}

/** Constant-time-ish verification of a password against stored salt+hash. */
export function verifyPassword(password: string, salt: string, hash: string): boolean {
  const candidate = crypto
    .createHash('sha256')
    .update(salt + password)
    .digest('hex');
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/** Issue a new opaque token for a uid. */
export function issueToken(uid: string): string {
  const token = crypto.randomBytes(32).toString('hex');
  tokenStore.set(token, uid);
  return token;
}

/** Resolve a token to its uid (undefined when unknown). */
export function resolveToken(token: string | undefined): string | undefined {
  if (!token) return undefined;
  return tokenStore.get(token);
}

// ---------------------------------------------------------------------------
// Verification codes
// ---------------------------------------------------------------------------

/**
 * Issue (or re-issue) a 6-digit code for a contact.
 * When still inside the 60s cooldown, returns cooldownMs > 0 and no code.
 */
export function issueCode(contact: string): { code: string; cooldownMs: number } {
  const now = Date.now();
  const existing = codeStore.get(contact);
  if (existing && existing.cooldownUntil > now) {
    return { code: '', cooldownMs: existing.cooldownUntil - now };
  }
  const code = String(crypto.randomInt(0, 1000000)).padStart(CODE_LENGTH, '0');
  codeStore.set(contact, {
    code,
    expiresAt: now + CODE_TTL_MS,
    cooldownUntil: now + CODE_COOLDOWN_MS,
  });
  return { code, cooldownMs: 0 };
}

/**
 * Verify a code for a contact. Codes are single-use: a successful check
 * consumes the entry immediately (expired entries are pruned lazily).
 */
export function verifyCode(contact: string, code: string): boolean {
  const entry = codeStore.get(contact);
  if (!entry) return false;
  if (entry.expiresAt < Date.now()) {
    codeStore.delete(contact);
    return false;
  }
  const ok = entry.code === code;
  if (ok) {
    codeStore.delete(contact); // consume on success
  }
  return ok;
}

/** Strip credential fields (passHash/salt) before sending a user to clients. */
export function sanitizeUser(user: User & { passHash?: string; salt?: string }): User {
  const { passHash: _passHash, salt: _salt, ...rest } = user;
  return rest;
}
