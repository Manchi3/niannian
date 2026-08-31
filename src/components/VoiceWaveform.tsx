import { useEffect, useRef } from 'react';
import { getAudioLevel, getWaveform } from '../utils/audioMeter';

/**
 * VoiceWaveform — a SINGLE flowing sound-wave line (图五), NOT vertical bars.
 *
 * One SVG <path> whose `d` is rebuilt every frame. Round 58: the curve is
 * deliberately BIG but GENTLE — a few (20) control points, each smoothed in
 * the TIME dimension with an exponential low-pass (smoothed = 0.85·prev +
 * 0.15·raw), then joined with Catmull-Rom → cubic-bezier so it flows like
 * silk. Peaks are tall (amplitude ×1.5+) but the heavy smoothing kills the
 * high-frequency jitter, so it reads as slow rolling waves, never a sawtooth.
 *
 * At silence the mic data is flat, so a slow LARGE sine keeps the line alive
 * and gently breathing. Thin, light, translucent white with a faint gold glow
 * — no fill, no bars. Motion is imperative (rAF + refs); the parent input bar
 * never re-renders per frame. The mic stream itself is opened/released by the
 * audioMeter module (one getUserMedia, also shared with the particle burst).
 */

/** Fewer control points → coarser but smoother, more "rolling" curve. */
const POINT_COUNT = 20;
const VIEW_W = 100;
const VIEW_H = 32;
const MID_Y = 16;
/** Larger amplitude so peaks read clearly, but the per-point low-pass keeps
 *  the transition gentle (no high-frequency chatter). */
const AMP = 15;
/** Temporal low-pass coefficients (must sum to 1). */
const SMOOTH_KEEP = 0.85;
const SMOOTH_NEW = 0.15;

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
      // Exponential low-pass in the time dimension → kills jitter.
      for (let i = 0; i < POINT_COUNT; i++) {
        smoothed[i] = smoothed[i] * SMOOTH_KEEP + raw[i] * SMOOTH_NEW;
      }
      const t = (now - start) / 1000;
      // Slow, LARGE idle breathing so the line is alive at silence; it fades
      // out as the real voice grows. Low frequency → no chatter.
      const idle = 1 - Math.min(1, level * 2.5);
      const values = smoothed.map(
        (s, i) => s + Math.sin(t * 0.8 + i * 0.45) * 0.18 * idle,
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
