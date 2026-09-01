/**
 * audioMeter — a single shared microphone level meter for the voice-input
 * feature.
 *
 * The Web Speech API (see hooks/useSpeechRecognition.ts) runs its OWN separate
 * recognition stream, so to show a *real* volume-driven waveform and to make
 * the particle image sway with the voice we need raw audio samples. We grab
 * them here via getUserMedia + Web Audio AnalyserNode and expose a normalized
 * [0, 1] level, updated every animation frame.
 *
 * IMPORTANT: this module is the ONLY place that opens a second mic stream. It
 * is deliberately kept OUTSIDE the particle engine and every other red-line
 * file — the level it produces is consumed purely as a view-layer signal
 * (waveform bars + a container transform), so the particle engine itself is
 * never touched.
 */

let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let mediaStream: MediaStream | null = null;
let rafId: number | null = null;
let timeData: Uint8Array<ArrayBuffer> | null = null;

/** Latest normalized RMS level (0 = silent, 1 = loud). */
let currentLevel = 0;
/** Latest raw RMS of the time-domain signal (0 = silent). */
let currentRms = 0;
/**
 * R65: shared voice ENVELOPE (0..1). Both the waveform (VoiceWaveform) and the
 * particle "light-touch" dispersion read THIS single value so they stay in
 * perfect sync. Computed every frame with an asymmetric attack/release so the
 * response is instant on onset (no perceptible delay) and soft on release.
 * Lives in a module-level variable — NEVER in React state — so consumers can
 * read it straight from their own rAF loop without triggering a re-render.
 */
let currentEnv = 0;
/** Whether the meter is currently running (mic acquired, rAF looping). */
let active = false;
/** Set when stop() is requested while an async start() is still in flight. */
let stopRequested = false;

/** Pull one RMS sample and normalize it into [0, 1]. */
function computeFrame(): void {
  if (!analyser || !timeData) {
    rafId = requestAnimationFrame(computeFrame);
    return;
  }
  analyser.getByteTimeDomainData(timeData);
  let sumSquares = 0;
  for (let i = 0; i < timeData.length; i++) {
    const v = (timeData[i] - 128) / 128; // center at 0, range -1..1
    sumSquares += v * v;
  }
  const rms = Math.sqrt(sumSquares / timeData.length);
  currentRms = rms;
  // RMS of speech is small; scale up so normal speaking clamps near 1 — kept
  // for backward-compat (getAudioLevel) and any legacy consumer.
  currentLevel = Math.min(1, rms * 3.4);

  // R65: shared envelope. target = (rms / 0.15)^0.7, clamped to [0,1] — a
  // soft-knee so whispers (low rms) still lift the line a little, loud speech
  // saturates. Asymmetric smoothing:
  //   attack  k=0.5  → reaches target in 1–2 frames  (sensitive, ~zero delay)
  //   release k=0.08 → ~0.4 s gentle settle back to rest (no click, no snap)
  const target = Math.min(1, Math.pow(rms / 0.15, 0.7));
  const k = target > currentEnv ? 0.5 : 0.08;
  currentEnv += (target - currentEnv) * k;

  rafId = requestAnimationFrame(computeFrame);
}

/** Start the meter. No-op if already active or mic is unavailable. */
export async function startAudioMeter(): Promise<void> {
  if (active) return;
  stopRequested = false;
  if (!navigator.mediaDevices?.getUserMedia) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // A stop() may have arrived while we were awaiting permission.
    if (stopRequested) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    mediaStream = stream;
    const Ctor: typeof AudioContext =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    audioContext = new Ctor();
    const source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    // Round 58: heavier built-in smoothing so the raw time-domain samples are
    // already low-passed before VoiceWaveform applies its own temporal filter.
    analyser.smoothingTimeConstant = 0.85;
    source.connect(analyser);
    timeData = new Uint8Array(analyser.fftSize);
    active = true;
    rafId = requestAnimationFrame(computeFrame);
  } catch {
    // Mic denied / unavailable — callers degrade gracefully (flat waveform).
    active = false;
  }
}

/** Stop the meter and release the microphone + AudioContext. */
export function stopAudioMeter(): void {
  stopRequested = true;
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }
  if (audioContext) {
    audioContext.close().catch(() => undefined);
    audioContext = null;
  }
  analyser = null;
  timeData = null;
  currentLevel = 0;
  currentRms = 0;
  currentEnv = 0;
  active = false;
}

/** Latest normalized level (0..1). Safe to call before start(). */
export function getAudioLevel(): number {
  return currentLevel;
}

/**
 * R65: the shared voice envelope (0..1). Safe to call before start() — returns
 * 0 when the meter is inactive. Both VoiceWaveform and the particle dispersion
 * read this every frame; it is updated inside the meter's own rAF loop, never
 * via React state, so there is no re-render latency between the two consumers.
 */
export function getAudioEnv(): number {
  return currentEnv;
}

/** Latest raw RMS of the time-domain signal. Safe to call before start(). */
export function getAudioRms(): number {
  return currentRms;
}

/**
 * Sample the latest time-domain waveform into `count` evenly-spaced points,
 * each normalized to [-1, 1]. Returns an array of zeros when the meter is
 * inactive. Used by VoiceWaveform to draw a SINGLE flowing curve (图五) — the
 * raw shape of the voice, not a bar graph.
 */
export function getWaveform(count: number): number[] {
  const out = new Array<number>(count).fill(0);
  if (!analyser || !timeData) return out;
  const len = timeData.length;
  for (let i = 0; i < count; i++) {
    const idx = Math.floor((i / (count - 1)) * (len - 1));
    out[i] = (timeData[idx] - 128) / 128; // center at 0, range -1..1
  }
  return out;
}

/** Whether the meter is currently running. */
export function isAudioMeterActive(): boolean {
  return active;
}
