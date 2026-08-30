import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

/**
 * CondensingOverlay — the center text shown while a diary is being
 * condensed (Round 22, ⑤).
 *
 * Replaces the old "circle spinner + 处理中..." visual:
 *   - The particle background dims & breathes via a CSS class on the
 *     ParticleCanvas outer wrapper (see ChatMainView) — this overlay only
 *     carries the rotating copy line, no spinner, no dark veil.
 *   - The copy cycles through four phrases every 2.2s with a 400ms
 *     crossfade; text is white 15px, letter-spacing 0.4em, shadowed.
 */
const CONDENSING_COPY = [
  '记忆正在凝聚…',
  '思绪正在沉淀…',
  '拾起光斑碎片…',
  '把今天写进日记…',
];

const COPY_INTERVAL_MS = 2200;
const FADE_MS = 0.4;

export default function CondensingOverlay(): React.ReactElement | null {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % CONDENSING_COPY.length);
    }, COPY_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center"
      aria-hidden="true"
    >
      <AnimatePresence mode="wait">
        <motion.p
          key={index}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: FADE_MS, ease: 'easeInOut' }}
          style={{
            margin: 0,
            color: '#ffffff',
            fontSize: 15,
            letterSpacing: '0.4em',
            textIndent: '0.4em',
            fontFamily: '"Noto Serif SC", "Songti SC", serif',
            textShadow: '0 2px 12px rgba(0, 0, 0, 0.9)',
            whiteSpace: 'nowrap',
          }}
        >
          {CONDENSING_COPY[index]}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}
