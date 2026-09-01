import { useEffect, useRef } from 'react';
import { getAudioEnv, getWaveform } from '../utils/audioMeter';

/**
 * VoiceWaveform — a synthetic "flowing water" wave (R65).
 *
 * R60–R62 drew a single synthetic sine whose amplitude was modulated by a slow
 * RMS scalar. At idle (R62) the amplitude was deliberately near-zero, so the
 * bar read as a flat thread; and because the shape was a smooth textbook sine
 * with NO voice-driven detail, even loud speech looked like a gently breathing
 * band rather than "flowing water". The user perceived it as a straight line.
 *
 * R65 — flowing synthetic wave:
 *   - The line is ALWAYS driven by a time phase `t` that advances every frame,
 *     so it flows continuously even at silence (never a frozen straight line).
 *   - Amplitude has a small IDLE floor (always visible motion) plus a VOICE
 *     term scaled by the shared envelope `env` (from audioMeter) — so speaking
 *     clearly enlarges the wave while silence keeps a small drifting ripple.
 *   - A lightly-smoothed voice DETAIL term (raw time-domain samples, coeff
 *     0.28) adds organic ripples on top of the smooth sines ONLY while speaking,
 *     giving it the "water surface" texture instead of a perfect sine.
 *   - 2–3 overlapping strokes (phase-shifted, different opacity) read as soft
 *     silk ribbons layered on water. Rounded crests via Catmull-Rom → bezier.
 *   - No fill, no vertical bars, optional glow.
 *
 * The component is mounted ONLY while the button is held (recording === true) —
 * Bug 1 fix: at rest (keyboard mode, or voice mode while NOT held) there is NO
 * line and NO rAF running. It reads the shared env directly (module ref), never
 * React state, so there is no throttle.
 */

const N = 28; // control points across the bar (24–32 per spec)
const VIEW_W = 240;
const VIEW_H = 44;
const MID_Y = 22; // center line, in px (viewBox units ≈ px via preserveAspectRatio)

/** Amplitude constants (in px / viewBox units). */
const IDLE_A = 2.5; // primary idle excursion — small but visible flow
const IDLE_B = 1.5; // secondary idle excursion
const VOICE_A = 12; // voice-driven excursion at env = 1 (~10–14px per spec)
const DETAIL_A = 5; // raw voice-texture excursion (~4–6px per spec)

/** Spatial frequencies: full-width wave counts. */
const K1 = 2 * Math.PI * 2; // ~2 crests across the bar
const K2 = 2 * Math.PI * 3.5; // ~3.5 crests (counter phase)

/**
 * Phase speeds (rad/sec). The spec gave s1≈0.035, s2≈0.05 — read as per-frame
 * at 60fps these are ≈2.1 / 3.0 rad/s, which is the visible "flow" we want.
 * Opposite signs (s1 +, s2 −) make the two waves slide in opposite directions,
 * which is what reads as water currents crossing.
 */
const S1 = 0.035 * 60; // ≈2.1 rad/s
const S2 = 0.05 * 60; // ≈3.0 rad/s

/** Temporal low-pass on the raw voice samples (0.25–0.3 per spec). */
const DETAIL_SMOOTH = 0.28;

/** Normalized x positions (0 → 1 across the bar). */
const XS: number[] = Array.from({ length: N }, (_, i) => i / (N - 1));

/** The 3 strokes: phase offset + opacity + stroke width. */
const STROKES: { phase: number; opacity: number; width: number }[] = [
  { phase: 0, opacity: 0.85, width: 1.8 },
  { phase: 0.6, opacity: 0.4, width: 1.2 },
  { phase: 1.2, opacity: 0.25, width: 1.0 },
];

/**
 * Catmull-Rom → cubic-bezier smoothing. `ys` are y values in px (viewBox
 * units); x is spread evenly across VIEW_W. C¹ continuity → rounded crests,
 * no kinks, no sawtooth.
 */
function buildSmoothPath(ys: number[]): string {
  const n = ys.length;
  if (n < 2) return '';
  const pts = ys.map((y, i) => ({ x: XS[i] * VIEW_W, y }));
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

/** One stroke's y values at control point i for phase `ph` and envelope `env`. */
function strokeValues(
  i: number,
  ph: number,
  env: number,
  detail: number,
): number {
  const x = XS[i];
  return (
    MID_Y +
    Math.sin(x * K1 + tRef.current * S1 + ph) * (IDLE_A + env * VOICE_A * 0.6) +
    Math.sin(x * K2 - tRef.current * S2 + 1.7 + ph) * (IDLE_B + env * VOICE_A * 0.4) +
    detail * DETAIL_A * env
  );
}

// t is module-shared so strokeValues() (called from the rAF) can read it
// without being re-created every frame.
const tRef = { current: 0 };

export default function VoiceWaveform({
  recording,
}: {
  recording: boolean;
}): React.ReactElement | null {
  const pathRefs = [
    useRef<SVGPathElement>(null),
    useRef<SVGPathElement>(null),
    useRef<SVGPathElement>(null),
  ];
  // Per-point low-passed raw voice samples (the "detail" term).
  const detailBufRef = useRef<number[]>(new Array<number>(N).fill(0));

  useEffect(() => {
    // Bug 1 fix: rAF runs ONLY while the button is held. At rest the component
    // is not mounted, so this effect never starts and no analyser is read.
    if (!recording) return;
    // Reset phase + detail buffer on each press so frame 1 doesn't jump from a
    // stale leftover phase, and the first wave is clean.
    tRef.current = 0;
    detailBufRef.current.fill(0);
    let raf = 0;
    const start = performance.now();

    const loop = (now: number): void => {
      const t = (now - start) / 1000;
      tRef.current = t;

      // Shared envelope (0..1). Direct module read — no React state, no throttle.
      const env = getAudioEnv();

      // Raw voice shape, lightly smoothed per point → organic ripple texture.
      // getWaveform returns zeros when the mic is inactive, so detail is 0 at
      // idle and only appears while actually speaking.
      const raw = getWaveform(N);
      const detailBuf = detailBufRef.current;
      for (let i = 0; i < N; i++) {
        detailBuf[i] += (raw[i] - detailBuf[i]) * DETAIL_SMOOTH;
      }

      for (let s = 0; s < STROKES.length; s++) {
        const stroke = STROKES[s];
        const path = pathRefs[s].current;
        if (!path) continue;
        const ys: number[] = new Array<number>(N);
        for (let i = 0; i < N; i++) {
          ys[i] = strokeValues(i, stroke.phase, env, detailBuf[i]);
        }
        path.setAttribute('d', buildSmoothPath(ys));
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [recording]);

  // Bug 1 fix: render nothing when not recording — the bar shows a static hint
  // instead (see ChatInputBar). The SVG is fully unmounted, so no stray line
  // or rAF lingers at rest.
  if (!recording) return null;

  return (
    <svg
      className="voice-wave-path"
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {STROKES.map((stroke, s) => (
        <path
          key={s}
          ref={pathRefs[s]}
          d=""
          fill="none"
          stroke="rgba(232, 221, 208, 1)"
          strokeWidth={stroke.width}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={stroke.opacity}
        />
      ))}
    </svg>
  );
}
