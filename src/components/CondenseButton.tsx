import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';

/**
 * Round 28 (①A): base orbit period of the stardust ring, in seconds.
 * Lowered from 5s → 3s so the particles trace the capsule ~1.67× faster
 * (within the requested 1.5–2× range), giving a "thinking harder" feel.
 * Per-particle ±10% jitter (`p.speed`) and breath/float are unchanged.
 */
const RING_BASE_LOOP_SECONDS = 3;

/**
 * Round 29 (①): particle dissipation window, in ms. The stardust ring keeps
 * orbiting the capsule border and extinguishes ember-by-ember over exactly
 * this long, triggered by the `thinking` flip (true→false). 1600ms sits
 * inside the requested 1~2s range. The per-particle fadeDelay(0~900) +
 * fadeDuration(400~700) upper bound (900+700 = 1600) aligns the last ember to
 * this window. NOTE (Round 46 ①): this constant governs ONLY the particle ring
 * now — the button's own show/hide uses the asymmetric FADE_IN_MS /
 * FADE_OUT_MS below, so changing the button timing never touches the ~1.6s
 * particle dissolve.
 */
const DISSOLVE_MS = 1600;
/** Round 46 (①): the condense button's two INDEPENDENT show/hide durations.
 *  Appear (thinking ends) eases in slowly over FADE_IN_MS (1.5s) so it "blooms"
 *  in roughly sync with the extinguishing stardust; disappear (re-entering
 *  thinking) fades out crisply in FADE_OUT_MS (0.5s) so the snap back into the
 *  thinking state feels quick. Deliberately NOT shared with DISSOLVE_MS. */
const FADE_IN_MS = 1500;
const FADE_OUT_MS = 500;
/** Round 29: quick brightness restore (ms) when a dissipation is interrupted
 *  by a fresh "thinking" state — avoids a hard flicker back to full opacity. */
const RESTORE_FADE_MS = 100;

/** Stadium (capsule) perimeter point at parameter t∈[0,1), clockwise.
 *  Top line L→R, right semicircle T→B, bottom line R→L, left semicircle B→T. */
function stadiumPoint(
  t: number,
  W: number,
  H: number,
): { x: number; y: number } {
  const R = H / 2;
  const a = W - 2 * R;
  const b = Math.PI * R;
  const L = 2 * a + 2 * b;
  let s = (((t % 1) + 1) % 1) * L;
  if (s < a) {
    // top straight line, left → right
    return { x: R + s, y: 0 };
  } else if (s < a + b) {
    // right semicircle, top → bottom
    const theta = -Math.PI / 2 + (s - a) / R;
    return { x: W - R + R * Math.cos(theta), y: R + R * Math.sin(theta) };
  } else if (s < 2 * a + b) {
    // bottom straight line, right → left
    return { x: W - R - (s - a - b), y: H };
  } else {
    // left semicircle, bottom → top
    const theta = Math.PI / 2 + (s - 2 * a - b) / R;
    return { x: R + R * Math.cos(theta), y: R + R * Math.sin(theta) };
  }
}

interface RingParticle {
  id: number;
  t0: number;
  size: number;
  alpha: number;
  speed: number;
  breathDur: number;
  breathPhase: number;
  color: string;
  gap: boolean;
  /** Vertical float amplitude in px (3~6) — adds liveliness on top of orbit. */
  amp: number;
  /** Vertical float frequency in Hz (0.8~1.5), per-particle. */
  freq: number;
  /** Vertical float phase in radians (0~2π), per-particle. */
  floatPhase: number;
  /** Round 29: delay before THIS particle starts fading (0 ~ 1200ms). */
  fadeDelay: number;
  /** Round 29: how long THIS particle takes to fade out (400 ~ 800ms). */
  fadeDuration: number;
}

type RingPhase = 'active' | 'dissipating';

/** Hollow particle ring tracing the button's capsule outline, clockwise.
 *  - active: full opacity, steady orbit (thinking state).
 *  - dissipating: keeps orbiting the SAME path at the SAME size, but each
 *    particle fades out independently at its own random fadeDelay/fadeDuration,
 *    one ember at a time, until the whole ring is gone (~1.5–2s). */
function CondenseParticleRing({ phase }: { phase: RingPhase }): React.ReactElement {
  const containerRef = useRef<HTMLSpanElement>(null);
  const nodeRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const rafRef = useRef<number | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  // Keep the live phase readable inside the rAF closure without re-subscribing.
  const phaseRef = useRef<RingPhase>(phase);
  const prevPhaseRef = useRef<RingPhase>(phase);
  // Timestamps for the dissipation / restore ramps (ms). null = not started.
  const dissipateStartRef = useRef<number | null>(null);
  const restoreStartRef = useRef<number | null>(null);

  // One-time random attributes — NEVER re-randomized per frame (no flicker).
  const particles = useMemo<RingParticle[]>(() => {
    const N = 28; // 26~30
    const arr: RingParticle[] = [];
    for (let i = 0; i < N; i++) {
      const gap = Math.random() < 0.08; // occasional small gaps
      const v = Math.round(180 + Math.random() * 75); // light grey → white
      arr.push({
        id: i,
        t0: (((i + (Math.random() - 0.5) * 0.6) / N) % 1 + 1) % 1, // even base + jitter
        size: 2 + Math.random() * 4, // 2~6px
        alpha: 0.25 + Math.random() * 0.75, // 0.25~1.0
        speed: 1 + (Math.random() * 0.2 - 0.1), // ±10%
        breathDur: 1500 + Math.random() * 1500, // 1.5~3s
        breathPhase: Math.random() * Math.PI * 2,
        color: `rgb(${v}, ${v}, ${v})`,
        gap,
        amp: 3 + Math.random() * 3, // 3~6px gentle float
        freq: 0.8 + Math.random() * 0.7, // 0.8~1.5Hz
        floatPhase: Math.random() * Math.PI * 2,
        // Round 29 (①): staggered lifetimes aligned to DISSOLVE_MS (1600ms).
        // Max = 900 + 700 = 1600, so the last ember is gone exactly when the
        // button finishes fading in — both animations share the same window.
        fadeDelay: Math.random() * 900, // 0 ~ 900ms
        fadeDuration: 400 + Math.random() * 300, // 400 ~ 700ms
      });
    }
    return arr;
  }, []);

  // Drive phase transitions: reset the relevant ramp timestamp on change.
  useEffect(() => {
    phaseRef.current = phase;
    if (prevPhaseRef.current !== phase) {
      if (phase === 'dissipating') {
        // Begin a fresh dissipation; lazily stamped on the first frame.
        dissipateStartRef.current = null;
        restoreStartRef.current = null;
      } else {
        // active again (incl. interrupt mid-dissipation): quick 100ms restore.
        restoreStartRef.current = performance.now();
        dissipateStartRef.current = null;
      }
      prevPhaseRef.current = phase;
    }
  }, [phase]);

  // Measure container size (== button size).
  useEffect(() => {
    const measure = (): void => {
      const el = containerRef.current;
      if (el) setDims({ w: el.clientWidth, h: el.clientHeight });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Animation loop.
  useEffect(() => {
    if (dims.w === 0 || dims.h === 0) return;
    const W = dims.w;
    const H = dims.h;
    const start = performance.now();
    const loop = (now: number): void => {
      const elapsed = (now - start) / 1000;
      const phaseNow = phaseRef.current;
      if (phaseNow === 'dissipating' && dissipateStartRef.current === null) {
        dissipateStartRef.current = now; // stamp first dissipation frame
      }
      for (const p of particles) {
        const node = nodeRefs.current[p.id];
        if (!node) continue;
        // ~RING_BASE_LOOP_SECONDS s per orbit (unchanged from active state —
        // Round 29 keeps the SAME trajectory & speed while fading).
        const t = (((p.t0 + (elapsed / RING_BASE_LOOP_SECONDS) * p.speed) % 1) + 1) % 1;
        const pt = stadiumPoint(t, W, H);
        // Gentle vertical float (perpendicular to the orbit path) for a
        // living, breathing feel — independent of speed jitter & breath.
        const floatOffset = p.amp * Math.sin(elapsed * 2 * Math.PI * p.freq + p.floatPhase);
        const x = pt.x - p.size / 2;
        const y = pt.y - p.size / 2 + floatOffset;
        const breath = p.gap
          ? 0
          : 0.7 + 0.3 * Math.sin((now / p.breathDur) * Math.PI * 2 + p.breathPhase);

        // --- Opacity: base breath, then phase-specific fade ---
        let op = breath * p.alpha;
        if (phaseNow === 'dissipating') {
          const e = now - (dissipateStartRef.current ?? now);
          const local = e - p.fadeDelay;
          // clamp(1 - (e - fadeDelay)/fadeDuration, 0, 1): full until its
          // delay, then linearly to 0 over its own fadeDuration.
          const fadeFactor = local <= 0 ? 1 : Math.max(0, 1 - local / p.fadeDuration);
          op *= fadeFactor;
        } else if (restoreStartRef.current !== null) {
          // active after an interrupt: ramp 0→1 over RESTORE_FADE_MS (no pop).
          op *= Math.min(1, (now - restoreStartRef.current) / RESTORE_FADE_MS);
        }

        node.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        node.style.opacity = String(op);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [dims, particles]);

  return (
    <span ref={containerRef} className="condense-ring-inner" aria-hidden="true">
      {particles.map((p) => (
        <span
          key={p.id}
          ref={(el) => {
            nodeRefs.current[p.id] = el;
          }}
          className="condense-ring-dot"
          style={{
            width: p.size,
            height: p.size,
            background: p.color,
            boxShadow: `0 0 ${p.size}px ${p.color}`,
          }}
        />
      ))}
    </span>
  );
}

interface CondenseButtonProps {
  /** Click handler. */
  onClick?: () => void;
  /** Whether the condense operation is in progress. */
  isLoading?: boolean;
  /** Whether the AI is thinking (streaming a reply) — button orbits. */
  isThinking?: boolean;
  /** Whether the button is disabled (e.g., not enough messages). */
  disabled?: boolean;
}

/**
 * CondenseButton — capsule button that sits NEXT TO the bottom input bar.
 *
 * - Normal state: translucent white capsule, white ✦ icon, "凝聚记忆" text.
 * - Thinking / condensing state: the normal button is kept in the layout but
 *   rendered at opacity 0 (no visible fill/border/text); a hollow ring of
 *   stardust particles traces the capsule outline clockwise via rAF.
 * - Round 29: when thinking ends, the stardust does NOT shrink or converge
 *   into the button. It keeps orbiting the capsule border at the same size,
 *   while each particle independently fades out at its own random
 *   fadeDelay/fadeDuration — embers extinguishing one by one over ~1.5–2s —
 *   then the (already-visible) clean button remains. If thinking restarts
 *   mid-dissipation, the particles instantly resume the active orbit with a
 *   100ms brightness restore (no flicker).
 */
export default function CondenseButton({
  onClick,
  isLoading = false,
  isThinking = false,
  disabled = false,
}: CondenseButtonProps): React.ReactElement {
  const thinking = isThinking || isLoading; // active "busy" → particle ring
  const busy = thinking || disabled;

  // Round 29: keep the ring mounted through its dissipation window so the
  // embers can finish fading after `thinking` has already gone false.
  const [dissipating, setDissipating] = useState(false);
  const dissipateTimerRef = useRef<number | null>(null);
  const prevThinkingRef = useRef(thinking);

  useEffect(() => {
    if (prevThinkingRef.current === thinking) return; // mount / no-change guard
    prevThinkingRef.current = thinking;
    if (dissipateTimerRef.current !== null) {
      clearTimeout(dissipateTimerRef.current);
      dissipateTimerRef.current = null;
    }
    if (thinking) {
      // Re-entered thinking (incl. interrupt mid-dissipation): stop fading.
      setDissipating(false);
    } else {
      // Thinking just ended → embers keep orbiting and slowly extinguish.
      setDissipating(true);
      dissipateTimerRef.current = window.setTimeout(() => {
        setDissipating(false); // all embers out → unmount the ring
        dissipateTimerRef.current = null;
      }, DISSOLVE_MS);
    }
  }, [thinking]);

  // Clear any pending timer on unmount.
  useEffect(
    () => () => {
      if (dissipateTimerRef.current !== null) clearTimeout(dissipateTimerRef.current);
    },
    [],
  );

  // The ring is shown while thinking OR while it's still extinguishing.
  const showRing = thinking || dissipating;
  const ringPhase: RingPhase = thinking ? 'active' : 'dissipating';

  return (
    <span className="condense-btn-wrap">
      <motion.button
        whileTap={busy ? undefined : { scale: 0.97 }}
        whileHover={busy ? undefined : { scale: 1.03 }}
        // Round 46 (①): the button's show/hide is ASYMMETRIC and independent
        // of the particle dissipation. When thinking ends (→ appear) it eases
        // in slowly over FADE_IN_MS (1.5s, easeOut), blooming in roughly sync
        // with the ~1.6s stardust extinction. When thinking restarts
        // (→ disappear) it fades out crisply over FADE_OUT_MS (0.5s, easeIn),
        // so re-entering the thinking state feels snappy. The particle ring
        // keeps its own DISSOLVE_MS (1.6s) — untouched. pointer-events track
        // visibility so the hidden (opacity 0) button never captures clicks;
        // it springs back to 'auto' the moment thinking ends (fade-in start).
        initial={false}
        animate={{ opacity: thinking ? 0 : 1 }}
        transition={{
          duration: thinking ? FADE_OUT_MS / 1000 : FADE_IN_MS / 1000,
          ease: thinking ? 'easeIn' : 'easeOut',
        }}
        style={{ pointerEvents: thinking ? 'none' : 'auto' }}
        onClick={onClick}
        disabled={busy}
        className="condense-btn"
        aria-label="凝聚记忆"
      >
        <span className="condense-star">✦</span>
        <span>凝聚记忆</span>
      </motion.button>

      {showRing && <CondenseParticleRing phase={ringPhase} />}
    </span>
  );
}
