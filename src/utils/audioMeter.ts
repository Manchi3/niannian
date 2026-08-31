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
  // RMS of speech is small; scale up so normal speaking clamps near 1, then
  // apply a gentle soft-knee so whispers still register a little motion.
  const normalized = Math.min(1, rms * 3.4);
  currentLevel = normalized;
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
    analyser.smoothingTimeConstant = 0.6;
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
  active = false;
}

/** Latest normalized level (0..1). Safe to call before start(). */
export function getAudioLevel(): number {
  return currentLevel;
}

/** Whether the meter is currently running. */
export function isAudioMeterActive(): boolean {
  return active;
}
