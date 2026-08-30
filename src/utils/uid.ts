/**
 * UID namespace helpers — shared rule for all per-account local storage.
 *
 *   - TOKEN_KEY is global (not namespaced): it stores the current session
 *     token so restoreSession() can find it before any user is known.
 *   - currentUid() resolves the active account id ('guest' when signed out).
 *   - nnKey(k) prefixes a storage key with the active uid:
 *       `nn_${currentUid()}_${k}`  e.g. nn_guest_textDisplayMode
 *
 * IMPORTANT: uid.ts sits in an import cycle (authStore ↔ appStore ↔
 * constants ↔ uid). Module-level initialisers may call currentUid() BEFORE
 * the authStore module has finished evaluating (its `useAuthStore` binding
 * is still in the temporal dead zone). The try/catch in currentUid() makes
 * that safe — it simply falls back to 'guest' until auth is ready.
 */
import { useAuthStore } from '../stores/authStore';

/** localStorage key for the session token (global, not namespaced). */
export const TOKEN_KEY = 'nn_token';

/** Resolve the active account id; 'guest' when signed out or not ready. */
export function currentUid(): string {
  try {
    return useAuthStore.getState().user?.id ?? 'guest';
  } catch {
    return 'guest';
  }
}

/** Namespace a storage key with the active account id. */
export function nnKey(k: string): string {
  return `nn_${currentUid()}_${k}`;
}
