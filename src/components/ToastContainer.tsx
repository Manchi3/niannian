import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToastStore } from '../stores/toastStore';

/**
 * ToastContainer — renders all current toasts in a fixed bottom-center stack.
 *
 * Layout:
 *   - position: fixed bottom-8 left-1/2 -translate-x-1/2
 *   - each toast: pill shape, backdrop blur, kind-tinted left border, dismiss
 *
 * z-index: 110 (above AuthModal 100 / MemoryModal 90 / ProfileEditor 80 /
 * UserMenu 70 — verification-code toasts must cover the auth dialog).
 */
export default function ToastContainer(): React.ReactElement {
  const { toasts, dismissToast } = useToastStore();

  // Auto-cleanup handled by store; nothing else to do here.
  useEffect(() => undefined, [toasts.length]);

  return (
    <div
      className="pointer-events-none fixed bottom-8 left-1/2 z-[110] -translate-x-1/2"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-2">
        <AnimatePresence initial={false}>
          {toasts.map((t) => {
            const borderColor =
              t.kind === 'error'
                ? 'rgba(239, 68, 68, 0.6)'
                : t.kind === 'info'
                  ? 'rgba(232, 221, 208, 0.4)'
                  : 'rgba(212, 168, 83, 0.6)';
            const icon =
              t.kind === 'error' ? '⚠' : t.kind === 'info' ? '·' : '✓';
            return (
              <motion.button
                key={t.id}
                type="button"
                onClick={() => dismissToast(t.id)}
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
                className="pointer-events-auto max-w-md rounded-2xl px-5 py-2.5 text-left shadow-xl"
                style={{
                  background: 'rgba(15, 12, 9, 0.85)',
                  backdropFilter: 'blur(14px)',
                  WebkitBackdropFilter: 'blur(14px)',
                  borderLeft: `3px solid ${borderColor}`,
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  borderLeftWidth: '3px',
                  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.45)',
                }}
              >
                <p className="flex items-center gap-2 font-mono text-sm">
                  <span style={{ color: 'rgba(212, 168, 83, 0.9)' }}>{icon}</span>
                  <span style={{ color: 'rgba(232, 221, 208, 0.92)' }}>
                    {t.message}
                  </span>
                </p>
              </motion.button>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
