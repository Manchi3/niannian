import { create } from 'zustand';
import * as api from '../services/api';
import { TOKEN_KEY } from '../utils/uid';
import { useAppStore } from './appStore';
import { reloadConfig } from '../utils/constants';
import { useDiaryStore } from './diaryStore';
import type {
  AuthStatus,
  LoginInput,
  Memory,
  RegisterInput,
  SendCodeResponse,
  User,
} from '../types';

/**
 * Auth store — login state, profile, long-term memories, and the dialog
 * switches for the three auth overlays (AuthModal / ProfileEditor /
 * MemoryModal).
 *
 * Refresh strategy:
 *   - login / register / logout → window.location.reload() — the ONLY
 *     reliable way to rebuild the IndexedDB/OPFS connections, re-read the
 *     uid-namespaced localStorage prefs and remount everything under the
 *     new uid (PRD P0-11).
 *   - profile edits → live state sync (set({ user })) — top bar and logo
 *     re-render immediately without a reload.
 *   - page-load restore → no reload; reloadLocalPrefs() / reloadConfig()
 *     re-read the current uid's prefs after the user is known.
 */
export type { AuthStatus };

interface AuthState {
  /** Current session token (localStorage.nn_token) or null. */
  token: string | null;
  /** Current user (null until authed). */
  user: User | null;
  /** 'boot' (restoring) | 'guest' | 'authed'. */
  status: AuthStatus;
  /** AuthModal open switch. */
  authModalOpen: boolean;
  /** ProfileEditor open switch. */
  profileOpen: boolean;
  /** MemoryModal open switch. */
  memoryOpen: boolean;
  /** Current account's long-term memories (newest first). */
  memories: Memory[];
  /** Whether memories are being fetched. */
  memoriesLoading: boolean;

  sendCode: (contact: string) => Promise<SendCodeResponse>;
  register: (input: RegisterInput) => Promise<void>;
  login: (input: LoginInput) => Promise<void>;
  logout: () => void;
  restoreSession: () => Promise<void>;
  updateProfile: (patch: { nickname?: string; avatar?: string }) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  loadMemories: () => Promise<void>;
  addMemory: (text: string) => Promise<void>;
  deleteMemory: (id: string) => Promise<void>;
  setAuthModalOpen: (open: boolean) => void;
  setProfileOpen: (open: boolean) => void;
  setMemoryOpen: (open: boolean) => void;
}

/** Clear the token from localStorage (best effort). */
function clearStoredToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore storage errors (private browsing etc.)
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  status: 'boot',
  authModalOpen: false,
  profileOpen: false,
  memoryOpen: false,
  memories: [],
  memoriesLoading: false,

  sendCode: async (contact) => {
    const res = await api.sendCode(contact);
    return res;
  },

  register: async (input) => {
    const { token, user } = await api.register(input);
    try {
      window.localStorage.setItem(TOKEN_KEY, token);
    } catch {
      // ignore storage errors
    }
    set({ token, user, status: 'authed' });
    window.location.reload();
  },

  login: async (input) => {
    const { token, user } = await api.login(input);
    try {
      window.localStorage.setItem(TOKEN_KEY, token);
    } catch {
      // ignore storage errors
    }
    set({ token, user, status: 'authed' });
    window.location.reload();
  },

  logout: () => {
    clearStoredToken();
    set({ token: null, user: null, status: 'guest' });
    window.location.reload();
  },

  restoreSession: async () => {
    let token: string | null = null;
    try {
      token = window.localStorage.getItem(TOKEN_KEY);
    } catch {
      token = null;
    }
    if (!token) {
      set({ token: null, user: null, status: 'guest' });
      return;
    }
    try {
      const user = await api.fetchMe();
      set({ token, user, status: 'authed' });
      // Re-read the (now correctly namespaced) local prefs + config for
      // this uid, then re-pull diaries under the new uid.
      useAppStore.getState().reloadLocalPrefs();
      reloadConfig();
      void useDiaryStore.getState().loadDiaries();
    } catch {
      // Invalid / expired token → silently drop back to guest (Q9).
      clearStoredToken();
      set({ token: null, user: null, status: 'guest' });
    }
  },

  updateProfile: async (patch) => {
    const user = await api.updateProfile(patch);
    set({ user });
  },

  updatePassword: async (password) => {
    await api.updatePassword(password);
  },

  loadMemories: async () => {
    set({ memoriesLoading: true });
    try {
      const memories = await api.fetchMemories();
      set({ memories });
    } finally {
      set({ memoriesLoading: false });
    }
  },

  addMemory: async (text) => {
    const memory = await api.addMemory(text);
    set((state) => ({ memories: [memory, ...state.memories] }));
  },

  deleteMemory: async (id) => {
    await api.deleteMemory(id);
    set((state) => ({ memories: state.memories.filter((m) => m.id !== id) }));
  },

  setAuthModalOpen: (authModalOpen) => set({ authModalOpen }),
  setProfileOpen: (profileOpen) => set({ profileOpen }),
  setMemoryOpen: (memoryOpen) => set({ memoryOpen }),
}));
