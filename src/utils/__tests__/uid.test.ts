/**
 * UID helper tests — namespace key derivation + current uid resolution.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { TOKEN_KEY, currentUid, nnKey } from '../uid';
import { useAuthStore } from '../../stores/authStore';
import type { User } from '../../types';

function makeUser(id: string): User {
  return { id, contact: 'a@b.com', nickname: '小董', createdAt: 1 };
}

describe('uid helpers', () => {
  beforeEach(() => {
    useAuthStore.setState({ token: null, user: null, status: 'guest' });
  });

  it('exposes the global token key', () => {
    expect(TOKEN_KEY).toBe('nn_token');
  });

  it('returns "guest" when no user is signed in', () => {
    expect(currentUid()).toBe('guest');
  });

  it('returns the user id when signed in', () => {
    useAuthStore.setState({ user: makeUser('u-123') });
    expect(currentUid()).toBe('u-123');
  });

  it('namespaces keys with the current uid (guest)', () => {
    expect(nnKey('textDisplayMode')).toBe('nn_guest_textDisplayMode');
    expect(nnKey('particle_atmosphere_config_v2')).toBe(
      'nn_guest_particle_atmosphere_config_v2',
    );
  });

  it('namespaces keys with the current uid (signed in)', () => {
    useAuthStore.setState({ user: makeUser('u-123') });
    expect(nnKey('textDisplayMode')).toBe('nn_u-123_textDisplayMode');
  });
});
