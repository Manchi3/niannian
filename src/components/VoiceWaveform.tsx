import { useEffect, useRef } from 'react';
import { getAudioLevel, getWaveform } from '../utils/audioMeter';

/**
 * VoiceWaveform — a SINGLE flowing sound-wave line (图五), NOT vertical bars.
 *
 * One SVG <path> whose `d` attribute is rebuilt every frame from the mic's
 * raw time-domain samples (audioMeter.getWaveform), smoothed with a
 * Catmull-Rom → cubic-bezier pass so the line flows. At silence the mic data
 * is flat, so a faint slow sine keeps the line "alive"; when the user speaks
 * the real waveform dominates and the curve rises and falls with the voice.
 *
 * Thin, light, translucent white with a faint gold glow — no fill, no bars.
 * Motion is imperative (rAF + refs); the parent input bar never re-renders
 * per frame. The mic stream itself is opened/released by the audioMeter
 * module (one getUserMedia, also shared with the particle burst) — this
 * component only reads samples.
 */

const POINT_COUNT = 44;
const VIEW_W = 100;
const VIEW_H = 26;
const MID_Y = 13;
const AMP = 10;

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

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const loop = (now: number): void => {
      const level = getAudioLevel(); // 0..1
      const samples = getWaveform(POINT_COUNT); // raw shape, -1..1
      const t = (now - start) / 1000;
      // Faint idle breathing so the line is never dead-flat at silence;
      // fades out as the real voice grows.
      const idle = 1 - Math.min(1, level * 3);
      const values = samples.map(
        (s, i) => s + Math.sin(t * 1.6 + i * 0.5) * 0.05 * idle,
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
