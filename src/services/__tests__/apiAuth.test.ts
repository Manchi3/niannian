/**
 * API auth service tests — authFetch Bearer attachment + the 9 auth/user/
 * memory endpoints (mocked fetch).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  authFetch,
  sendCode,
  register,
  login,
  fetchMe,
  updateProfile,
  updatePassword,
  fetchMemories,
  addMemory,
  deleteMemory,
} from '../api';
import { TOKEN_KEY } from '../../utils/uid';

const mockFetch = vi.fn();

function okJson(data: unknown): Response {
  return { ok: true, status: 200, json: async () => data } as unknown as Response;
}

beforeEach(() => {
  mockFetch.mockReset();
  globalThis.fetch = mockFetch as unknown as typeof fetch;
  window.localStorage.removeItem(TOKEN_KEY);
});

describe('authFetch', () => {
  it('attaches the Bearer token when one is stored', async () => {
    window.localStorage.setItem(TOKEN_KEY, 'tok-123');
    mockFetch.mockResolvedValueOnce(okJson({}));

    await authFetch('/api/auth/me');

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toEqual(
      expect.objectContaining({ Authorization: 'Bearer tok-123' }),
    );
  });

  it('sends no Authorization header when no token is stored', async () => {
    mockFetch.mockResolvedValueOnce(okJson({}));

    await authFetch('/api/auth/me');

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });
});

describe('auth endpoints', () => {
  it('sendCode posts the contact', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ ok: true, devCode: '123456' }));

    const res = await sendCode('test@qq.com');

    expect(res.devCode).toBe('123456');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/auth/code',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ contact: 'test@qq.com' }),
      }),
    );
  });

  it('register posts credentials and returns { token, user }', async () => {
    const user = { id: 'u1', contact: 'a@b.com', nickname: '小董', createdAt: 1 };
    mockFetch.mockResolvedValueOnce(okJson({ token: 't1', user }));

    const res = await register({
      contact: 'a@b.com',
      code: '123456',
      nickname: '小董',
      password: 'abc123',
    });

    expect(res.token).toBe('t1');
    expect(res.user.nickname).toBe('小董');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/auth/register',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('login posts { contact, password }', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ token: 't2', user: {} }));

    await login({ contact: 'a@b.com', password: 'abc123' });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ contact: 'a@b.com', password: 'abc123' }),
      }),
    );
  });

  it('fetchMe resolves the user from { user }', async () => {
    const user = { id: 'u1', contact: 'a@b.com', nickname: '小董', createdAt: 1 };
    mockFetch.mockResolvedValueOnce(okJson({ user }));

    const result = await fetchMe();
    expect(result.id).toBe('u1');
    // authFetch uses fetch's default method (GET) when none is given.
    expect(mockFetch.mock.calls[0][0]).toBe('/api/auth/me');
  });

  it('updateProfile sends nickname/avatar and returns the user', async () => {
    const user = { id: 'u1', contact: 'a@b.com', nickname: '新名字', createdAt: 1 };
    mockFetch.mockResolvedValueOnce(okJson({ user }));

    const result = await updateProfile({ nickname: '新名字' });

    expect(result.nickname).toBe('新名字');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/user/profile',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('updatePassword sends the new password', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ ok: true }));

    await updatePassword('newpass123');

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/user/password',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ password: 'newpass123' }),
      }),
    );
  });

  it('fetchMemories returns the memories array', async () => {
    const memories = [
      { id: 'm1', text: '今天记得带伞', source: '你亲手写下的', createdAt: 1 },
    ];
    mockFetch.mockResolvedValueOnce(okJson({ memories }));

    const result = await fetchMemories();
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('今天记得带伞');
  });

  it('addMemory posts text and returns the created memory', async () => {
    const memory = { id: 'm2', text: '新的记忆', source: '你亲手写下的', createdAt: 2 };
    mockFetch.mockResolvedValueOnce(okJson({ memory }));

    const result = await addMemory('新的记忆');

    expect(result.id).toBe('m2');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/memories',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ text: '新的记忆' }),
      }),
    );
  });

  it('deleteMemory deletes by id', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ ok: true }));

    await deleteMemory('m2');

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/memories/m2',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('throws a helpful message on non-ok responses', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: 'contact_exists', message: '该账号已注册，请直接登录' }),
    } as unknown as Response);

    await expect(
      register({ contact: 'a@b.com', password: 'secret123' }),
    ).rejects.toThrow('该账号已注册，请直接登录');
  });
});
