import { useEffect } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';

/**
 * RingCursor — a custom dot-and-ring cursor (Round 44, fixed in Round 45).
 *
 * Outer ring: ~28px, 1px white semi-transparent circle.
 * Center dot: 4px solid warm-white dot.
 *
 * Round 45 fix (BUG): the old code fed the hover flag (0/1) straight into
 * `scale` via useSpring — so on blank areas the flag was 0 and the ring
 * scaled to 0, i.e. the cursor INVISIBLY disappeared everywhere except over
 * clickable elements. Now the flag is MAPPED to `1 + flag·0.25` (idle scale
 * is always 1, hover grows to 1.25). The ring is ALWAYS visible:
 *   - No conditional visibility / opacity logic anywhere.
 *   - Initial position = viewport center (so it shows before the first move).
 * - Tracks the pointer 1:1 via motion values (NO delay — always follows).
 * - `pointer-events: none` + `z-index: 999` so it never intercepts input
 *   and floats above every layer.
 *
 * Mount it once per page that hides the system cursor (the memory gallery
 * hides its arrow via `.gallery-root, .gallery-root * { cursor: none }`).
 */
export default function RingCursor(): React.ReactElement {
  const x = useMotionValue(-100);
  const y = useMotionValue(-100);
  const hover = useMotionValue(0); // 0 = idle, 1 = over a clickable
  // Round 45: 0/1 → scale 1/1.25 (idle NEVER 0). Spring smooths the jump.
  const ringScale = useTransform(
    useSpring(hover, { stiffness: 300, damping: 25 }),
    (v) => 1 + v * 0.25,
  );

  useEffect(() => {
    // Start at the viewport center so the cursor is visible immediately.
    x.set(window.innerWidth / 2);
    y.set(window.innerHeight / 2);

    const onMove = (e: PointerEvent): void => {
      x.set(e.clientX);
      y.set(e.clientY);
    };
    const onOver = (e: MouseEvent): void => {
      const t = e.target as Element | null;
      const clickable = !!t?.closest?.(
        'button, input, textarea, a, [role="button"], [data-ui]',
      );
      hover.set(clickable ? 1 : 0);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('mouseover', onOver, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('mouseover', onOver);
    };
  }, [x, y, hover]);

  return (
    <motion.div
      aria-hidden="true"
      className="pointer-events-none fixed left-0 top-0 z-[999]"
      style={{ x, y }}
    >
      <div className="-translate-x-1/2 -translate-y-1/2">
        {/* Outer ring — scales 1 → 1.25 when hovering clickables */}
        <motion.div
          className="relative flex items-center justify-center"
          style={{ scale: ringScale }}
        >
          <div
            className="rounded-full"
            style={{
              width: 28,
              height: 28,
              border: '1px solid rgba(255, 255, 255, 0.5)',
            }}
          />
          {/* Center dot */}
          <div
            className="absolute rounded-full"
            style={{
              width: 4,
              height: 4,
              background: 'rgba(255, 250, 240, 0.95)',
              boxShadow: '0 0 6px rgba(255, 250, 240, 0.5)',
            }}
          />
        </motion.div>
      </div>
    </motion.div>
  );
}
