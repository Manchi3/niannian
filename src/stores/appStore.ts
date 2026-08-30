import { create } from 'zustand';
import type { AppPhase } from '../types';
import { nnKey } from '../utils/uid';
import { generateId } from '../utils/helpers';
import { useChatStore } from './chatStore';

/**
 * Application-level state managed by Zustand.
 *
 * The `phase` field acts as a simple state machine that drives
 * top-level component routing (see App.tsx).
 *
 * Round 20 additions:
 *   - `textDisplayMode` now uses the three states full | single | hidden
 *     (Round 20 replaces the old full | subtitle | hidden). The old
 *     'subtitle' value is mapped to 'single' when loading from storage.
 */
interface AppState {
  /** Current application phase — sole routing authority. */
  phase: AppPhase;
  /** Global loading flag for transitions between phases. */
  isLoading: boolean;
  /** Global error message (null when no error). */
  errorMessage: string | null;
  /** Currently active image data URL (for re-processing / display). */
  currentImageDataUrl: string | null;
  /** Currently active image Blob (for diary save). */
  currentImageBlob: Blob | null;
  /**
   * Round 42: image picked from the LANDING page's "继续上传" — a transient
   * hand-off to ChatMainView, which consumes it on mount (skips the
   * intermediate upload page). Cleared once consumed.
   */
  pendingImageFile: File | null;
  /**
   * Round 26 (bug④): the unique id of the CURRENT conversation round. A new
   * id is minted every time the user starts a fresh round ("继续上传" picks a
   * new photo). App.tsx keys <ChatMainView> on this id, so a changed id
   * force-remounts the whole chat view — wiping all stale local state (old
   * particle data / image blob) and, together with startNewRound's
   * clearMessages(), guarantees a brand-new, blank conversation every round.
   */
  conversationId: string;
  /**
   * Round 18: which tab is shown during particle / chatting phase.
   * 'chat' shows the chat UI (default), 'diary' shows the in-place
   * diary view (or empty-state). Particle background stays in both.
   */
  viewTab: 'chat' | 'diary';
  /**
   * Round 20: text rendering mode for the chat view.
   * Persisted to localStorage as 'textDisplayMode'.
   * - 'full'  : show ALL chat bubbles (scrollable history)
   * - 'single': show only the most recent message, centered
   * - 'hidden': hide all chat text + input + condense (pure particles)
   * Cycle: full → single → hidden → full.
   */
  textDisplayMode: 'full' | 'single' | 'hidden';

  /** Transition to a new application phase. */
  setPhase: (phase: AppPhase) => void;
  /** Toggle the global loading indicator. */
  setLoading: (loading: boolean) => void;
  /** Set or clear the global error message. */
  setError: (error: string | null) => void;
  /** Store the current image data URL. */
  setCurrentImage: (dataUrl: string, blob: Blob) => void;
  /** Clear current image data. */
  clearCurrentImage: () => void;
  /** Round 42: set/clear the pending upload file handed from Landing. */
  setPendingImageFile: (file: File | null) => void;
  /**
   * Round 26 (bug④): begin a brand-new conversation round from a freshly
   * picked photo. Resets phase → idle, clears the in-flight image, wipes the
   * global chat history, and mints a new conversationId so the chat view
   * remounts clean. Called by LandingPage's "继续上传" before switching to
   * the chat view.
   */
  startNewRound: (file: File) => void;
  /** Reset to the initial idle state. */
  reset: () => void;
  /** Round 18: switch which view is shown over the particle layer. */
  setViewTab: (tab: 'chat' | 'diary') => void;
  /** Round 20: set the text-display mode for chat view. */
  setTextDisplayMode: (mode: 'full' | 'single' | 'hidden') => void;
  /**
   * Round 53/54: when true, the chat messages start hidden (opacity 0) and
   * fade in only AFTER the particle formation finishes (≈2.5s, normal speed)
   * — used by the review ("重温这一天") entry so text never "runs ahead" of
   * the forming picture. Cleared once the reveal fires. No formation-speed
   * multiplier is involved (the picture always forms once at normal speed).
   */
  messageRevealPending: boolean;
  /**
   * Round Auth: re-read the CURRENT uid's textDisplayMode from storage.
   * Called after restoreSession() resolves the user — module-level reads
   * happened before auth was known (and may have read the guest value).
   */
  reloadLocalPrefs: () => void;
}

// ---------------------------------------------------------------------------
// Round 20: textDisplayMode persistence — load on init, save on change.
// Old stored value 'subtitle' is migrated to 'single'.
// Round Auth: the storage key is uid-namespaced (nn_${uid}_textDisplayMode)
// so each account keeps its own mode; module-level reads fall back to the
// guest namespace until restoreSession() knows the real user (the auth
// store calls reloadLocalPrefs() after resolving).
// ---------------------------------------------------------------------------

const VALID_TEXT_MODES: Array<'full' | 'single' | 'hidden'> = [
  'full',
  'single',
  'hidden',
];

function loadTextDisplayMode(): 'full' | 'single' | 'hidden' {
  if (typeof window === 'undefined') return 'full';
  try {
    const raw = window.localStorage.getItem(nnKey('textDisplayMode'));
    if (raw) {
      if (raw === 'subtitle') {
        // Round 20 migration: the old "subtitle" mode is now "single"
        return 'single';
      }
      if (VALID_TEXT_MODES.includes(raw as 'full' | 'single' | 'hidden')) {
        return raw as 'full' | 'single' | 'hidden';
      }
    }
  } catch {
    // Ignore storage errors (e.g. private browsing)
  }
  return 'full';
}

function persistTextDisplayMode(mode: 'full' | 'single' | 'hidden'): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(nnKey('textDisplayMode'), mode);
  } catch {
    // Ignore storage errors
  }
}

export const useAppStore = create<AppState>((set) => ({
  phase: 'idle',
  isLoading: false,
  errorMessage: null,
  currentImageDataUrl: null,
  currentImageBlob: null,
  pendingImageFile: null,
  viewTab: 'chat',
  textDisplayMode: loadTextDisplayMode(),
  conversationId: generateId(),
  messageRevealPending: false,

  setPhase: (phase) => set({ phase, errorMessage: null }),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (errorMessage) => set({ errorMessage }),

  setCurrentImage: (currentImageDataUrl, currentImageBlob) =>
    set({ currentImageDataUrl, currentImageBlob }),

  clearCurrentImage: () =>
    set({ currentImageDataUrl: null, currentImageBlob: null }),

  setPendingImageFile: (pendingImageFile) => set({ pendingImageFile }),

  startNewRound: (file) =>
    set(() => {
      // Wipe the global chat history so the new round starts blank (bug④).
      useChatStore.getState().clearMessages();
      return {
        // Fresh, idle phase so ChatMainView's pending-file effect fires.
        phase: 'idle',
        isLoading: false,
        errorMessage: null,
        viewTab: 'chat',
        // Drop any stale image from the previous round.
        currentImageDataUrl: null,
        currentImageBlob: null,
        // Hand the new photo + a brand-new round id to the chat view.
        pendingImageFile: file,
        conversationId: generateId(),
      };
    }),

  reset: () =>
    set({
      phase: 'idle',
      isLoading: false,
      errorMessage: null,
      viewTab: 'chat',
      pendingImageFile: null,
    }),

  setViewTab: (viewTab) => set({ viewTab }),

  setTextDisplayMode: (mode) => {
    persistTextDisplayMode(mode);
    set({ textDisplayMode: mode });
  },

  reloadLocalPrefs: () => {
    set({ textDisplayMode: loadTextDisplayMode() });
  },
}));
