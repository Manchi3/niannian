import { useEffect, useRef } from 'react';
import { getAudioLevel, getWaveform } from '../utils/audioMeter';

/**
 * VoiceWaveform — a SINGLE flowing sound-wave line (Round 59 refinement).
 *
 * Round 58 deliberately made the curve "BIG but GENTLE": few control points
 * (20) + temporal low-pass, so peaks read clearly without high-frequency
 * chatter. Round 59 tightens the visual further to match the reference
 * (image #2/#3): the line must be LONG (it should span nearly the full
 * width of the hold-bar, not a 220px stub), BREATHE slowly even at idle
 * (gentle large sine drift), and ONLY nudge its amplitude with voice —
 * no per-frame "锯齿" jitter.
 *
 * Implementation notes:
 *  - POINT_COUNT was 20 → now 60 (denser samples → smoother Catmull-Rom).
 *  - VIEW_W 100 → 200 + AMP 15 → 18 (more horizontal + vertical room so
 *    the rolling waves fill the bar instead of a short central hump).
 *  - Temporal low-pass tightened: 0.85/0.15 → 0.92/0.08 (only ~8% of new
 *    amplitude leaks through per frame → no sawtooth).
 *  - Idle "breathing" sine is SLOW (0.5 rad/s) and LARGE (×0.35), so the
 *    line is alive even when no one speaks. As voice arrives the idle
 *    contribution softly fades (level·2.0) and the real wave takes over
 *    — speaking only nudges amplitude, the gentle baseline drift remains.
 *  - The actual frequency content is still driven by the live mic; we
 *    just present it as a smooth rolling curve.
 */

/** Plenty of sample points so the curve reads as a continuous line. */
const POINT_COUNT = 60;
/** Wider, slightly taller viewBox (matches the 500px hold-bar aspect). */
const VIEW_W = 200;
const VIEW_H = 36;
const MID_Y = 18;
/** Larger amplitude → peaks read clearly inside the new viewBox. */
const AMP = 18;
/** Temporal low-pass coefficients (must sum to 1). */
const SMOOTH_KEEP = 0.92;
const SMOOTH_NEW = 0.08;

/** Catmull-Rom → cubic-bezier smoothing of the sampled points. */
function buildSmoothPath(values: number[]): string {
  const n = values.length;
  if (n < 2) return '';
  const pts = values.map((v, i) => ({
    x: (i / (n - 1)) * VIEW_W,
    y: MID_Y - v * AMP,
  }));
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d +=
      ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ` +
      `${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ` +
      `${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

export default function VoiceWaveform(): React.ReactElement {
  const pathRef = useRef<SVGPathElement>(null);
  // Persistent smoothed values — updated every frame with the low-pass.
  const smoothedRef = useRef<number[]>(new Array<number>(POINT_COUNT).fill(0));

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const loop = (now: number): void => {
      const level = getAudioLevel(); // 0..1
      const raw = getWaveform(POINT_COUNT); // -1..1
      const smoothed = smoothedRef.current;
      // Exponential low-pass in the time dimension — only a fraction of the
      // new amplitude leaks through, so peaks roll in softly (no jitter).
      for (let i = 0; i < POINT_COUNT; i++) {
        smoothed[i] = smoothed[i] * SMOOTH_KEEP + raw[i] * SMOOTH_NEW;
      }
      const t = (now - start) / 1000;
      // Slow, LARGE idle breathing: keeps the line gently drifting at
      // silence. As voice grows the idle fades, but never fully disappears
      // — the baseline "wind" remains visible underneath the speech.
      const idle = 1 - Math.min(1, level * 2.0);
      // Phase varies per-point to create a long meandering wave front
      // (image #2) rather than one global sine.
      const values = smoothed.map(
        (s, i) =>
          s +
          // Longer period (0.5 vs 0.8) and bigger amplitude (0.35 vs 0.18)
          // → quieter idle motion still feels substantial.
          // NOTE the per-index phase offset of i*0.38 creates a chain of
          // crests along the bar so the curve MEANDERS across the width.
          Math.sin(t * 0.5 + i * 0.38) * 0.35 * idle +
          // A second, even-slower component for slow vertical drift.
          Math.sin(t * 0.22 + i * 0.12) * 0.18 * idle,
      );
      const path = pathRef.current;
      if (path) path.setAttribute('d', buildSmoothPath(values));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <svg
      className="voice-wave-path"
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path ref={pathRef} d="" />
    </svg>
  );
}
