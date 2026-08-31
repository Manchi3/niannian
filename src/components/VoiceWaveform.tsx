import { useEffect, useRef } from 'react';
import { getAudioLevel } from '../utils/audioMeter';

/**
 * VoiceWaveform — a row of vertical bars whose heights track the REAL
 * microphone level (via audioMeter.getAudioLevel, sampled every frame).
 *
 * When silent the bars keep a gentle idle breathing motion; when the user
 * speaks they grow with the volume. All motion is imperative (rAF + refs) so
 * the parent input bar never re-renders per frame.
 */
const BAR_COUNT = 5;
const IDLE_HEIGHT = 4; // px at silence
const MAX_REACTIVE = 20; // px added at full volume

export default function VoiceWaveform(): React.ReactElement {
  const refs = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const loop = (now: number): void => {
      const level = getAudioLevel(); // 0..1
      const t = (now - start) / 1000;
      for (let i = 0; i < BAR_COUNT; i++) {
        const el = refs.current[i];
        if (!el) continue;
        // Per-bar phase offset → the idle state looks alive, not static.
        const phase = Math.sin(t * 6 + i * 0.9);
        const idle = IDLE_HEIGHT + (phase + 1) * 1.5; // 4~7px gentle drift
        // Reactive height scaled by volume; outer bars move a touch more.
        const edgeBoost = 1 + Math.abs(i - (BAR_COUNT - 1) / 2) * 0.15;
        const reactive = level * MAX_REACTIVE * (0.6 + 0.4 * Math.abs(phase));
        const h = idle + reactive * edgeBoost;
        el.style.height = `${h.toFixed(1)}px`;
        el.style.opacity = (0.45 + level * 0.55).toFixed(2);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="voice-waveform-bars" aria-hidden="true">
      {Array.from({ length: BAR_COUNT }).map((_, i) => (
        <span
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          className="voice-wave-bar"
        />
      ))}
    </div>
  );
}
