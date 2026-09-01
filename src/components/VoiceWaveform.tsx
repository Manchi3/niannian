import { useEffect, useRef } from 'react';
import { getAudioLevel } from '../utils/audioMeter';

/**
 * VoiceWaveform — a SINGLE silk-line waveform (Round 60).
 *
 * Round 59 was wrong: it used 60 sample points + per-point time-domain raw
 * samples + Catmull-Rom. Even with 0.08 temporal low-pass, each point's
 * amplitude is driven by the live analyser, so the 60 points chase 60
 * different values → looks like a "bristly rope" with little spikes. NOT a
 * silk line.
 *
 * Round 60 — silk-line physics:
 *   - FEW control points (7). Catmull-Rom across 7 points is mathematically
 *     smooth: the curve CANNOT have kinks. No spikes possible.
 *   - SINGLE driving wave: y[i] = sin(t*ω + x[i]*φ) * amp. Every point sits
 *     on the SAME sinusoid at a different phase offset → the whole curve
 *     moves coherently as one silk ribbon. (ω, φ) is tuned so we see ~2
 *     crests across the 500px bar, matching the reference image.
 *   - "+x" sign: the right edge leads the left → "右边的轨迹带动左边的
 *     轨迹" (image #5). t grows → the SAME crest slides leftward across
 *     the bar; viewers read this as "a bullet flying through the silk".
 *   - A second slower counter-phase wave is added for visual depth so the
 *     curve never looks like a perfect textbook sine.
 *   - Amplitude responds VERY slowly (lerp 0.045) — voice volume nudges
 *     the curve's HEIGHT, not its shape. Idle = 32% height, peak speech
 *     = 120% height. The transition is gradual ("缓慢的变").
 *   - Idle 32% keeps the line visibly alive even at silence.
 *   - We DON'T pull raw per-point samples from getWaveform() anymore — that
 *     was the source of the spikes. The mic level is read as a SINGLE
 *     number and applied as a slow amplitude modulator.
 */

const POINT_COUNT = 7; // 7 control points → 6 Catmull-Rom segments, geometrically silk.
const VIEW_W = 200;
const VIEW_H = 36;
const MID_Y = 18;
const AMP = 7; // peak vertical excursion in viewBox units (pixels).

/** Normalized x position of each control point (0 → 1 across the bar). */
const X_POSITIONS: number[] = Array.from({ length: POINT_COUNT }, (_, i) =>
  i / (POINT_COUNT - 1),
);

/** Slow amplitude envelope — voice acts as height, not shape. */
const AMP_IDLE = 0.32; // baseline "wind" (silk still drifts)
const AMP_PEAK = 1.2; // peak height during loud speech
/** Temporal lerp for the amplitude envelope. 0.045 ≈ 22 frames to reach 95%
 *  → voice changes roll in gently, no hard jumps. */
const AMP_LERP = 0.045;

/** Time-evolution speeds (rad / s). */
const WAVE_OMEGA = 0.6; // primary wave's phase rate (slide speed)
const DRIFT_OMEGA = 0.25; // secondary drift's phase rate
/** Spatial frequencies (radians across x=0..1). */
const WAVE_FREQ = 4.5; // ~1.4 visible crests across the bar
const DRIFT_FREQ = 1.5; // ½ opposite-direction crest

/**
 * Catmull-Rom → cubic-bezier smoothing of `values`. With only 7 control
 * points this produces a guaranteed-silk curve; the bezier control points
 * are derived from the local slope so consecutive segments share tangent
 * directions (C¹ continuity) — no kinks, no spikes.
 */
function buildSmoothPath(values: number[]): string {
  const n = values.length;
  if (n < 2) return '';
  const pts = values.map((v, i) => ({
    x: X_POSITIONS[i] * VIEW_W,
    y: MID_Y - v * AMP,
  }));
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]; // mirror at start
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2; // mirror at end
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
  // Persistent smoothed amplitude — updates every frame with the lerp.
  const ampRef = useRef(AMP_IDLE);
  // Last write time — used to compute a stable dt regardless of raf jitter.
  const lastTimeRef = useRef<number | null>(null);

  useEffect(() => {
    let raf = 0;
    const start = performance.now();

    const loop = (now: number): void => {
      // --- Time: a single global phase t (seconds since mount). ---
      const t = (now - start) / 1000;

      // --- Mic level → target amplitude (slow envelope). ---
      const level = getAudioLevel(); // 0..1
      const target = AMP_IDLE + Math.min(1, level) * (AMP_PEAK - AMP_IDLE);
      // Exponential lerp. We use a 60Hz-tuned 0.045 → ~370ms to reach 95%
      // of a step. Voice changes glide in — never "snaps".
      ampRef.current += (target - ampRef.current) * AMP_LERP;
      const amp = ampRef.current;

      // --- Build the 7 control points. All driven by the SAME sinusoid;
      //     each point is a phase-shifted sample. ---
      // primary wave: y = sin(t*ω + x*φ) — right edge leads left → silk
      //              crests slide LEFTWARD as t grows, the visual reads
      //              as "right pushes left into a flowing ribbon".
      // secondary:    y = sin(t*ω_d - x*φ_d) — slower, opposite direction,
      //              small amplitude → depth, prevents textbook-sine look.
      const values = X_POSITIONS.map(
        (x) =>
          Math.sin(t * WAVE_OMEGA + x * WAVE_FREQ) * 0.78 * amp +
          Math.sin(t * DRIFT_OMEGA - x * DRIFT_FREQ) * 0.32 * amp,
      );

      const path = pathRef.current;
      if (path) path.setAttribute('d', buildSmoothPath(values));
      lastTimeRef.current = now;
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
