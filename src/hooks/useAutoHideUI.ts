import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useAutoHideUI — hide all non-essential UI after `delayMs` of pointer
 * stillness, reappear instantly on the next mousemove (with a reset timer).
 *
 * Round 42: used by the memory gallery so that only the diary images stay
 * visible while the chrome (search, filters, buttons, footer) fades out.
 *
 * Round 43: default delay lowered 4000 → 3000, and an optional
 * `onHiddenChange` callback publishes each visibility flip so other
 * components (e.g. the global Logo) can fade in perfect sync.
 *
 * @param delayMs stillness duration before hiding (default 3000)
 * @param onHiddenChange optional callback fired on every hide/show flip
 * @returns true when the UI should be hidden
 */
export function useAutoHideUI(
  delayMs = 3000,
  onHiddenChange?: (hidden: boolean) => void,
): boolean {
  const [hidden, setHidden] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);
  // Keep the latest callback in a ref so the timeout closure never goes stale.
  const cbRef = useRef(onHiddenChange);
  useEffect(() => {
    cbRef.current = onHiddenChange;
  }, [onHiddenChange]);

  const reset = useCallback(() => {
    setHidden(false);
    cbRef.current?.(false);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setHidden(true);
      cbRef.current?.(true);
    }, delayMs);
  }, [delayMs]);

  useEffect(() => {
    window.addEventListener('mousemove', reset, { passive: true });
    reset(); // start the initial timer
    return () => {
      window.removeEventListener('mousemove', reset);
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [reset]);

  return hidden;
}
