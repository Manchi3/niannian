/**
 * navStore tests — back stack (Round Nav).
 *
 * Exercises the full back-stack contract:
 *   - goTo pushes the current view (dedup on same view);
 *   - goBack pops views back toward 'landing', closes overlays first;
 *   - empty stack is a safe no-op;
 *   - openOverlay / closeOverlay keep overlay markers in sync;
 *   - goHome force-resets to landing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// navStore → authStore → services/api; mock api so the store graph loads
// cleanly in jsdom (same pattern as authStore.test.ts).
vi.mock('../../services/api', () => ({
  sendCode: vi.fn(),
  register: vi.fn(),
  login: vi.fn(),
  fetchMe: vi.fn(),
  updateProfile: vi.fn(),
  updatePassword: vi.fn(),
  fetchMemories: vi.fn(),
  addMemory: vi.fn(),
  deleteMemory: vi.fn(),
}));

import { useNavStore } from '../navStore';
import { useAuthStore } from '../authStore';

const resetNav = (): void => {
  useNavStore.setState({ currentView: 'landing', history: [] });
};

beforeEach(() => {
  vi.clearAllMocks();
  resetNav();
  // Overlay switches start closed.
  useAuthStore.setState({ authModalOpen: false, profileOpen: false, memoryOpen: false });
});

describe('goTo / back stack', () => {
  it('pushes the current view before switching', () => {
    useNavStore.getState().goTo('chat');
    expect(useNavStore.getState().currentView).toBe('chat');
    expect(useNavStore.getState().history).toEqual([{ kind: 'view', view: 'landing' }]);

    useNavStore.getState().goTo('gallery');
    expect(useNavStore.getState().currentView).toBe('gallery');
    expect(useNavStore.getState().history).toEqual([
      { kind: 'view', view: 'landing' },
      { kind: 'view', view: 'chat' },
    ]);
  });

  it('dedups: goTo to the same view is a no-op', () => {
    useNavStore.getState().goTo('chat');
    useNavStore.getState().goTo('chat');
    expect(useNavStore.getState().history).toEqual([{ kind: 'view', view: 'landing' }]);
    expect(useNavStore.getState().currentView).toBe('chat');
  });

  it('goBack pops views in order (chat → landing)', () => {
    useNavStore.getState().goTo('chat');
    useNavStore.getState().goBack();
    expect(useNavStore.getState().currentView).toBe('landing');
    expect(useNavStore.getState().history).toEqual([]);
  });

  it('goBack pops the full chain: landing → chat → gallery → chat → landing', () => {
    useNavStore.getState().goTo('chat'); // history: [landing]
    useNavStore.getState().goTo('gallery'); // history: [landing, chat]
    useNavStore.getState().goBack();
    expect(useNavStore.getState().currentView).toBe('chat');
    useNavStore.getState().goBack();
    expect(useNavStore.getState().currentView).toBe('landing');
    expect(useNavStore.getState().history).toEqual([]);
  });

  it('goBack on an empty stack is a safe no-op', () => {
    expect(() => useNavStore.getState().goBack()).not.toThrow();
    expect(useNavStore.getState().currentView).toBe('landing');
    expect(useNavStore.getState().history).toEqual([]);
  });
});

describe('overlay markers', () => {
  it('openOverlay pushes once (dedup per id)', () => {
    useNavStore.getState().openOverlay('profile');
    useNavStore.getState().openOverlay('profile');
    expect(useNavStore.getState().history).toEqual([{ kind: 'overlay', id: 'profile' }]);
  });

  it('closeOverlay removes all markers of that id', () => {
    useNavStore.getState().openOverlay('auth');
    useNavStore.getState().openOverlay('profile');
    useNavStore.getState().closeOverlay('auth');
    expect(useNavStore.getState().history).toEqual([{ kind: 'overlay', id: 'profile' }]);
  });

  it('goBack closes an overlay on top (and does NOT change the view)', () => {
    useNavStore.getState().goTo('chat'); // history: [landing]
    useNavStore.getState().openOverlay('profile'); // history: [landing, profile]
    useNavStore.getState().goBack();
    expect(useAuthStore.getState().profileOpen).toBe(false);
    expect(useNavStore.getState().currentView).toBe('chat');
    expect(useNavStore.getState().history).toEqual([{ kind: 'view', view: 'landing' }]);
  });

  it('goBack closes the right overlay switch per id', () => {
    useAuthStore.setState({ memoryOpen: true });
    useNavStore.getState().openOverlay('memory');
    useNavStore.getState().goBack();
    expect(useAuthStore.getState().memoryOpen).toBe(false);
    expect(useNavStore.getState().currentView).toBe('landing');
  });
});

describe('goHome', () => {
  it('force-resets to landing and clears the stack', () => {
    useNavStore.getState().goTo('chat');
    useNavStore.getState().openOverlay('memory');
    useNavStore.getState().goHome();
    expect(useNavStore.getState().currentView).toBe('landing');
    expect(useNavStore.getState().history).toEqual([]);
  });
});
