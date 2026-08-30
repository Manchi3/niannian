// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  issueToken,
  resolveToken,
  issueCode,
  verifyCode,
  sanitizeUser,
} from '../utils/security.js';

describe('hashPassword / verifyPassword', () => {
  it('hashes with a random salt and verifies correctly', () => {
    const { salt, hash } = hashPassword('abc123');
    expect(salt).toHaveLength(32); // 16 bytes hex
    expect(hash).toHaveLength(64); // sha256 hex
    expect(verifyPassword('abc123', salt, hash)).toBe(true);
  });

  it('rejects wrong passwords', () => {
    const { salt, hash } = hashPassword('abc123');
    expect(verifyPassword('wrong', salt, hash)).toBe(false);
  });

  it('produces different salts (and hashes) for the same password', () => {
    const a = hashPassword('same-password');
    const b = hashPassword('same-password');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });
});

describe('tokenStore', () => {
  it('issues a 64-char token and resolves it to the uid', () => {
    const token = issueToken('u1');
    expect(token).toHaveLength(64);
    expect(resolveToken(token)).toBe('u1');
  });

  it('returns undefined for unknown tokens', () => {
    expect(resolveToken('nope')).toBeUndefined();
  });

  it('returns undefined for empty / missing tokens', () => {
    expect(resolveToken(undefined)).toBeUndefined();
    expect(resolveToken('')).toBeUndefined();
  });
});

describe('codeStore', () => {
  it('issues a 6-digit code and verifies it exactly once', () => {
    const { code, cooldownMs } = issueCode('a@b.com');
    expect(cooldownMs).toBe(0);
    expect(code).toMatch(/^\d{6}$/);
    expect(verifyCode('a@b.com', code)).toBe(true);
    // Consumed on success — a second verify must fail.
    expect(verifyCode('a@b.com', code)).toBe(false);
  });

  it('rejects wrong codes without consuming', () => {
    issueCode('c@d.com');
    expect(verifyCode('c@d.com', '000000')).toBe(false);
  });

  it('enforces a 60s cooldown between sends', () => {
    issueCode('e@f.com');
    const { cooldownMs } = issueCode('e@f.com');
    expect(cooldownMs).toBeGreaterThan(0);
    expect(cooldownMs).toBeLessThanOrEqual(60_000);
  });
});

describe('sanitizeUser', () => {
  it('strips passHash and salt from a stored user', () => {
    const user = sanitizeUser({
      id: 'u',
      contact: 'a@b.com',
      nickname: 'n',
      passHash: 'h',
      salt: 's',
      avatar: null,
      createdAt: 1,
    });
    expect('passHash' in user).toBe(false);
    expect('salt' in user).toBe(false);
    expect(user.id).toBe('u');
    expect(user.contact).toBe('a@b.com');
  });
});
