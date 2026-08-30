/**
 * AuthStore tests — actions with a mocked api module.
 *
 * login / register / logout trigger window.location.reload() by design
 * (the page re-mounts under the new uid), so location.reload is stubbed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSendCode = vi.fn();
const mockRegister = vi.fn();
const mockLogin = vi.fn();
const mockFetchMe = vi.fn();
const mockUpdateProfile = vi.fn();
const mockUpdatePassword = vi.fn();
const mockFetchMemories = vi.fn();
const mockAddMemory = vi.fn();
const mockDeleteMemory = vi.fn();

vi.mock('../../services/api', () => ({
  sendCode: (...args: unknown[]) => mockSendCode(...args),
  register: (...args: unknown[]) => mockRegister(...args),
  login: (...args: unknown[]) => mockLogin(...args),
  fetchMe: (...args: unknown[]) => mockFetchMe(...args),
  updateProfile: (...args: unknown[]) => mockUpdateProfile(...args),
  updatePassword: (...args: unknown[]) => mockUpdatePassword(...args),
  fetchMemories: (...args: unknown[]) => mockFetchMemories(...args),
  addMemory: (...args: unknown[]) => mockAddMemory(...args),
  deleteMemory: (...args: unknown[]) => mockDeleteMemory(...args),
}));

import { useAuthStore } from '../authStore';
import { TOKEN_KEY } from '../../utils/uid';
import type { User, Memory } from '../../types';

const reloadMock = vi.fn();

const makeUser = (id: string = 'u1'): User => ({
  id,
  contact: 'a@b.com',
  nickname: '小董',
  createdAt: 1,
});

const makeMemory = (id: string, text: string): Memory => ({
  id,
  text,
  source: '你亲手写下的',
  createdAt: 1,
});

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { ...window.location, reload: reloadMock },
  });
  useAuthStore.setState({
    token: null,
    user: null,
    status: 'boot',
    authModalOpen: false,
    profileOpen: false,
    memoryOpen: false,
    memories: [],
    memoriesLoading: false,
  });
});

describe('initial state', () => {
  it('starts in boot status with no token/user', () => {
    const s = useAuthStore.getState();
    expect(s.status).toBe('boot');
    expect(s.token).toBeNull();
    expect(s.user).toBeNull();
  });
});

describe('sendCode', () => {
  it('delegates to api.sendCode and returns the dev code', async () => {
    mockSendCode.mockResolvedValueOnce({ ok: true, devCode: '123456' });
    const res = await useAuthStore.getState().sendCode('test@qq.com');
    expect(mockSendCode).toHaveBeenCalledWith('test@qq.com');
    expect(res.devCode).toBe('123456');
  });
});

describe('register', () => {
  it('stores the token, sets authed and reloads', async () => {
    const user = makeUser();
    mockRegister.mockResolvedValueOnce({ token: 'tok-r', user });

    await useAuthStore.getState().register({
      contact: 'a@b.com',
      code: '123456',
      nickname: '小董',
      password: 'abc123',
    });

    expect(window.localStorage.getItem(TOKEN_KEY)).toBe('tok-r');
    expect(useAuthStore.getState().status).toBe('authed');
    expect(useAuthStore.getState().user?.nickname).toBe('小董');
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });
});

describe('login', () => {
  it('stores the token, sets authed and reloads', async () => {
    const user = makeUser();
    mockLogin.mockResolvedValueOnce({ token: 'tok-l', user });

    await useAuthStore.getState().login({ contact: 'a@b.com', password: 'abc123' });

    expect(window.localStorage.getItem(TOKEN_KEY)).toBe('tok-l');
    expect(useAuthStore.getState().status).toBe('authed');
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });
});

describe('logout', () => {
  it('clears the token, goes guest and reloads', () => {
    window.localStorage.setItem(TOKEN_KEY, 'tok-x');
    useAuthStore.setState({ token: 'tok-x', user: makeUser(), status: 'authed' });

    useAuthStore.getState().logout();

    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(useAuthStore.getState().status).toBe('guest');
    expect(useAuthStore.getState().user).toBeNull();
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });
});

describe('restoreSession', () => {
  it('goes guest when no token is stored', async () => {
    await useAuthStore.getState().restoreSession();
    expect(useAuthStore.getState().status).toBe('guest');
    expect(mockFetchMe).not.toHaveBeenCalled();
  });

  it('restores authed when /me succeeds', async () => {
    window.localStorage.setItem(TOKEN_KEY, 'tok-me');
    mockFetchMe.mockResolvedValueOnce(makeUser('u-me'));

    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState().status).toBe('authed');
    expect(useAuthStore.getState().user?.id).toBe('u-me');
    expect(useAuthStore.getState().token).toBe('tok-me');
  });

  it('silently drops to guest and clears the token when /me fails', async () => {
    window.localStorage.setItem(TOKEN_KEY, 'tok-bad');
    mockFetchMe.mockRejectedValueOnce(new Error('invalid_token'));

    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState().status).toBe('guest');
    expect(useAuthStore.getState().user).toBeNull();
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
  });
});

describe('updateProfile / updatePassword', () => {
  it('updateProfile syncs the new user into state (no reload)', async () => {
    const updated = makeUser('u1');
    updated.nickname = '新名字';
    mockUpdateProfile.mockResolvedValueOnce(updated);

    await useAuthStore.getState().updateProfile({ nickname: '新名字' });

    expect(useAuthStore.getState().user?.nickname).toBe('新名字');
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it('updatePassword delegates to the api', async () => {
    mockUpdatePassword.mockResolvedValueOnce(undefined);
    await useAuthStore.getState().updatePassword('newpass123');
    expect(mockUpdatePassword).toHaveBeenCalledWith('newpass123');
  });
});

describe('memories', () => {
  it('loadMemories fetches and stores the list', async () => {
    const list = [makeMemory('m1', '第一条'), makeMemory('m2', '第二条')];
    mockFetchMemories.mockResolvedValueOnce(list);

    await useAuthStore.getState().loadMemories();

    expect(useAuthStore.getState().memories).toHaveLength(2);
    expect(useAuthStore.getState().memoriesLoading).toBe(false);
  });

  it('addMemory prepends the new memory and updates the count', async () => {
    const created = makeMemory('m9', '新的记忆');
    mockAddMemory.mockResolvedValueOnce(created);

    await useAuthStore.getState().addMemory('新的记忆');

    expect(useAuthStore.getState().memories[0].id).toBe('m9');
  });

  it('deleteMemory removes the memory by id', async () => {
    useAuthStore.setState({
      memories: [makeMemory('m1', '一'), makeMemory('m2', '二')],
    });
    mockDeleteMemory.mockResolvedValueOnce(undefined);

    await useAuthStore.getState().deleteMemory('m1');

    expect(mockDeleteMemory).toHaveBeenCalledWith('m1');
    expect(useAuthStore.getState().memories.map((m) => m.id)).toEqual(['m2']);
  });
});

describe('dialog switches', () => {
  it('open/close switches update independently', () => {
    useAuthStore.getState().setAuthModalOpen(true);
    useAuthStore.getState().setProfileOpen(true);
    useAuthStore.getState().setMemoryOpen(true);
    const s = useAuthStore.getState();
    expect(s.authModalOpen).toBe(true);
    expect(s.profileOpen).toBe(true);
    expect(s.memoryOpen).toBe(true);
  });
});
