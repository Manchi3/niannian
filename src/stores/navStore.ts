import { create } from 'zustand';
import { useAuthStore } from './authStore';

/**
 * Top-level navigation store — controls which page is shown, and keeps a
 * back stack so the global Logo (top-left) can act as a "back" button.
 *
 * Three views:
 *   - 'landing' : Home page with ellipse particles, slogan, two CTAs.
 *   - 'chat'    : The existing chat/particle interaction page (Round 21 logic).
 *   - 'gallery' : The diary gallery (横滑卡片流 / 搜索 / 筛选 / 排序).
 *
 * Back stack:
 *   - `goTo(view)`   pushes the CURRENT view before switching, so the Logo
 *                    can return to it later. Repeated goTo to the same view
 *                    is a no-op (avoids stack bloat).
 *   - `openOverlay`  pushes an overlay marker when an auth overlay
 *                    (AuthModal / ProfileEditor / MemoryModal) opens.
 *   - `closeOverlay` removes that marker when the overlay closes.
 *   - `goBack()`     pops the stack top:
 *                      1. overlay → close the corresponding overlay store
 *                         switch (and drop every marker of that id);
 *                      2. view    → switch currentView back to it;
 *                      3. empty   → do nothing (no error, no reload).
 *
 * The Logo click calls `goBack()` (Round Nav: click = 返回上一步).
 * `goHome()` is kept as a compatibility reset (force-return to landing).
 */
export type View = 'landing' | 'chat' | 'gallery';

/** Auth overlay ids pushed onto the back stack while their modal is open. */
export type OverlayId = 'auth' | 'profile' | 'memory';

/** A single back-stack entry — either a previously-visited view or an open overlay. */
type NavEntry =
  | { kind: 'view'; view: View }
  | { kind: 'overlay'; id: OverlayId };

interface NavState {
  currentView: View;
  /** Back stack: most recent entry is at the END (stack top). */
  history: NavEntry[];
  /** Switch views — pushes the current view before changing (dedup: same view = no-op). */
  goTo: (v: View) => void;
  /** Record that an auth overlay opened (dedup per id). */
  openOverlay: (id: OverlayId) => void;
  /** Remove all back-stack markers for a closed overlay id. */
  closeOverlay: (id: OverlayId) => void;
  /** Pop the stack: close overlay / return to previous view / no-op when empty. */
  goBack: () => void;
  /** Compatibility reset — force-return to landing and clear the stack. */
  goHome: () => void;
}

/** Map overlay id → the authStore switch used to close that overlay. */
const overlayClosers: Record<OverlayId, (open: boolean) => void> = {
  auth: (open) => useAuthStore.getState().setAuthModalOpen(open),
  profile: (open) => useAuthStore.getState().setProfileOpen(open),
  memory: (open) => useAuthStore.getState().setMemoryOpen(open),
};

export const useNavStore = create<NavState>((set, get) => ({
  currentView: 'landing',
  history: [],

  goTo: (view) =>
    set((state) => {
      // Dedup: switching to the view we are already on is a no-op — it
      // avoids pushing identical entries and bloating the stack.
      if (view === state.currentView) return state;
      return {
        currentView: view,
        history: [...state.history, { kind: 'view', view: state.currentView }],
      };
    }),

  openOverlay: (id) =>
    set((state) => {
      // Dedup: never push the same overlay id twice.
      const alreadyOpen = state.history.some(
        (e) => e.kind === 'overlay' && e.id === id,
      );
      if (alreadyOpen) return state;
      return { history: [...state.history, { kind: 'overlay', id }] };
    }),

  closeOverlay: (id) =>
    set((state) => ({
      history: state.history.filter(
        (e) => !(e.kind === 'overlay' && e.id === id),
      ),
    })),

  goBack: () => {
    const state = get();
    const last = state.history[state.history.length - 1];
    // Empty stack → nothing to go back to (no error, no reload).
    if (!last) return;

    if (last.kind === 'overlay') {
      // 1. Top is an overlay → close it through the authStore switch. The
      //    overlay's own effect also calls closeOverlay, so filtering here
      //    is just belt-and-suspenders (idempotent).
      overlayClosers[last.id](false);
      set({
        history: state.history.filter(
          (e) => !(e.kind === 'overlay' && e.id === last.id),
        ),
      });
      return;
    }

    // 2. Top is a view → pop it and switch back.
    set({
      currentView: last.view,
      history: state.history.slice(0, -1),
    });
  },

  goHome: () => set({ currentView: 'landing', history: [] }),
}));
