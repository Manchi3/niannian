import { create } from 'zustand';

/**
 * Toast — lightweight ephemeral notification.
 *
 * Used by Round 18 features:
 *   - Diary condense success: "已凝聚为日记《xxx》"
 *   - Phase errors (re-using setError)
 *
 * Auto-dismisses after `duration` ms (default 3000).
 */
export type ToastKind = 'success' | 'info' | 'error';

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  /** Auto-dismiss duration in ms. Set to 0 to require manual dismiss. */
  duration: number;
}

interface ToastState {
  toasts: Toast[];
  /** Show a new toast (auto-dismisses). */
  showToast: (msg: string, opts?: { kind?: ToastKind; duration?: number }) => void;
  /** Dismiss a toast manually. */
  dismissToast: (id: string) => void;
}

const DEFAULT_DURATION = 3000;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  showToast: (message, opts = {}) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const kind: ToastKind = opts.kind ?? 'success';
    const duration = opts.duration ?? DEFAULT_DURATION;
    const toast: Toast = { id, kind, message, duration };
    set((state) => ({ toasts: [...state.toasts, toast] }));
    if (duration > 0) {
      setTimeout(() => {
        if (get().toasts.find((t) => t.id === id)) {
          get().dismissToast(id);
        }
      }, duration);
    }
  },

  dismissToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));
