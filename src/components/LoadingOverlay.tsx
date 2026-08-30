import { motion, AnimatePresence } from 'framer-motion';

/**
 * Props for the LoadingOverlay component.
 */
interface LoadingOverlayProps {
  /** Whether the overlay is visible. */
  visible: boolean;
  /** Loading message to display. */
  message?: string;
  /** Optional error message (renders error style). */
  error?: string | null;
  /** Optional retry callback when error is shown. */
  onRetry?: () => void;
}

/**
 * LoadingOverlay — full-screen loading / error overlay.
 *
 * Shows a centered spinner with a message during long operations,
 * or an error message with a retry button.
 */
export default function LoadingOverlay({
  visible,
  message = '请稍候...',
  error = null,
  onRetry,
}: LoadingOverlayProps): React.ReactElement | null {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{
            background: 'rgba(8, 6, 5, 0.8)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
          }}
        >
          {error ? (
            // Error state
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="flex flex-col items-center gap-4 px-8 text-center"
            >
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10">
                <svg
                  className="h-8 w-8 text-red-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                  />
                </svg>
              </div>
              <p className="font-serif text-lg text-warm-white/80">{error}</p>
              {onRetry && (
                <button
                  onClick={onRetry}
                  className="rounded-full border border-gold-muted px-6 py-2 text-sm text-gold transition-colors hover:bg-gold/10"
                  style={{
                    borderColor: 'rgba(212, 168, 83, 0.5)',
                    color: 'rgba(212, 168, 83, 1)',
                  }}
                >
                  重试
                </button>
              )}
            </motion.div>
          ) : (
            // Loading state
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="flex flex-col items-center gap-6"
            >
              {/* Particle-like loading animation */}
              <div className="relative h-16 w-16">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                  className="absolute inset-0 rounded-full border-2 border-gold/20 border-t-gold"
                  style={{
                    borderColor: 'rgba(212, 168, 83, 0.2)',
                    borderTopColor: 'rgba(212, 168, 83, 1)',
                  }}
                />
                {/* Inner dot */}
                <motion.div
                  animate={{ scale: [1, 1.3, 1], opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                  className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold"
                  style={{ background: 'rgba(212, 168, 83, 1)' }}
                />
              </div>

              <p className="font-serif text-sm text-warm-white/60">{message}</p>
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
