import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSpeechRecognition } from '../useSpeechRecognition';

/**
 * Regression tests for Round 63 — "voice input sends the same message twice".
 *
 * Real Chrome behaviour these tests pin down:
 *   - `recognition.stop()` is ASYNCHRONOUS. `onend` only fires once the
 *     speech service returns the final result, which can lag 300ms-1s+.
 *   - A stale recognition instance can still fire `onend` / `onresult`
 *     after a newer session has already been started.
 *
 * The mock below lets a test decide exactly WHEN each instance's callbacks
 * fire, so those timings are deterministic instead of flaky.
 */

interface ResultSpec {
  isFinal: boolean;
  transcript: string;
}

class MockRecognition {
  static instances: MockRecognition[] = [];

  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onresult: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;

  constructor() {
    MockRecognition.instances.push(this);
  }
  start() {}
  stop() {}
  abort() {}
}

function toResults(list: ResultSpec[]) {
  const arr: Record<number, unknown> & { length: number } = { length: list.length };
  list.forEach((r, i) => {
    arr[i] = { isFinal: r.isFinal, 0: { transcript: r.transcript } };
  });
  return arr;
}

/** Simulate the browser delivering a slice of results. */
function emitResult(inst: MockRecognition, resultIndex: number, results: ResultSpec[]) {
  inst.onresult?.({ resultIndex, results: toResults(results) });
}

beforeEach(() => {
  MockRecognition.instances = [];
  vi.stubGlobal('SpeechRecognition', MockRecognition);
});

describe('useSpeechRecognition — R63 duplicate-send guards', () => {
  it('reports isSupported when the SpeechRecognition constructor exists', () => {
    const { result } = renderHook(() => useSpeechRecognition());
    expect(result.current.isSupported).toBe(true);
  });

  it('R63: a stale instance\'s late onend is ignored after a new session starts', () => {
    const onEnd = vi.fn();
    const { result } = renderHook(() => useSpeechRecognition({ onEnd }));

    // --- cycle 1: user speaks, then releases -----------------------------
    act(() => result.current.startRecording());
    const first = MockRecognition.instances[0];
    act(() => emitResult(first, 0, [{ isFinal: true, transcript: '你好' }]));

    // The hook is told to wind down. Chrome has NOT fired onend yet.
    act(() => result.current.stopRecording());

    // --- cycle 2 starts BEFORE cycle 1's onend arrives (slow network) ----
    act(() => result.current.startRecording());
    const second = MockRecognition.instances[1];
    act(() => emitResult(second, 0, [{ isFinal: true, transcript: '世界' }]));

    // Now the STALE first instance finally delivers its onend. Without the
    // identity guard this called onEnd('你好') a second time → duplicate.
    act(() => first.onend?.());
    expect(onEnd).not.toHaveBeenCalled();

    // The current instance's onend still works normally.
    act(() => second.onend?.());
    expect(onEnd).toHaveBeenCalledExactlyOnceWith('世界');
  });

  it('R63: a deliberately stopped session still delivers its final text', () => {
    // This is the ONLY send path for the 2.5s silence auto-stop — if the
    // identity guard were too aggressive it would silently swallow speech.
    const onEnd = vi.fn();
    const { result } = renderHook(() => useSpeechRecognition({ onEnd }));

    act(() => result.current.startRecording());
    const inst = MockRecognition.instances[0];
    act(() => emitResult(inst, 0, [{ isFinal: true, transcript: '识别到的内容' }]));

    act(() => result.current.stopRecording());

    // onend arrives late (this is the silent-auto-stop path).
    act(() => inst.onend?.());
    expect(onEnd).toHaveBeenCalledExactlyOnceWith('识别到的内容');

    // A second, spurious onend from the same instance cannot deliver twice.
    act(() => inst.onend?.());
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('R63: abort() discards everything — no onEnd, even if onend fires', () => {
    const onEnd = vi.fn();
    const { result } = renderHook(() => useSpeechRecognition({ onEnd }));

    act(() => result.current.startRecording());
    const inst = MockRecognition.instances[0];
    act(() => emitResult(inst, 0, [{ isFinal: true, transcript: '上滑取消' }]));

    act(() => result.current.abortRecording());
    act(() => inst.onend?.());

    expect(onEnd).not.toHaveBeenCalled();
  });

  it('R63: a stale instance\'s onresult cannot leak into the new session', () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useSpeechRecognition({ onTranscript }));

    act(() => result.current.startRecording());
    const first = MockRecognition.instances[0];
    act(() => result.current.startRecording());
    const second = MockRecognition.instances[1];

    // Late result from the abandoned first session.
    act(() => emitResult(first, 0, [{ isFinal: true, transcript: '上一轮的话' }]));
    expect(onTranscript).not.toHaveBeenCalled();

    // The live session still works.
    act(() => emitResult(second, 0, [{ isFinal: true, transcript: '这一轮的话' }]));
    expect(onTranscript).toHaveBeenCalledExactlyOnceWith('这一轮的话');
  });

  it('honours resultIndex so already-counted finals are not concatenated twice', () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useSpeechRecognition({ onTranscript }));

    act(() => result.current.startRecording());
    const inst = MockRecognition.instances[0];

    // Real Chrome always delivers the CUMULATIVE results array, with
    // `resultIndex` pointing at the first NEW entry. Once an entry is final
    // it stays at its index and resultIndex advances past it.
    act(() =>
      emitResult(inst, 0, [{ isFinal: true, transcript: '今天' }]),
    );
    expect(onTranscript).toHaveBeenLastCalledWith('今天');

    act(() =>
      emitResult(inst, 1, [
        { isFinal: true, transcript: '今天' },
        { isFinal: true, transcript: '天气不错' },
      ]),
    );
    expect(onTranscript).toHaveBeenLastCalledWith('今天天气不错');

    act(() =>
      emitResult(inst, 2, [
        { isFinal: true, transcript: '今天' },
        { isFinal: true, transcript: '天气不错' },
        { isFinal: true, transcript: '啊' },
      ]),
    );
    // The older finals must NOT be re-counted, otherwise this would read
    // "今天今天天气不错啊" — the original "sentence recognized twice" bug.
    expect(onTranscript).toHaveBeenLastCalledWith('今天天气不错啊');
    expect(onTranscript).toHaveBeenCalledTimes(3);
  });

  it('interim results replace (not accumulate) and append after the finals', () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useSpeechRecognition({ onTranscript }));

    act(() => result.current.startRecording());
    const inst = MockRecognition.instances[0];

    act(() => emitResult(inst, 0, [{ isFinal: true, transcript: '我去' }]));
    expect(onTranscript).toHaveBeenLastCalledWith('我去');

    // Chrome rewrites the interim entry in place at the same index.
    act(() =>
      emitResult(inst, 1, [
        { isFinal: true, transcript: '我去' },
        { isFinal: false, transcript: '骑' },
      ]),
    );
    expect(onTranscript).toHaveBeenLastCalledWith('我去骑');

    act(() =>
      emitResult(inst, 1, [
        { isFinal: true, transcript: '我去' },
        { isFinal: false, transcript: '骑车' },
      ]),
    );
    // Must be "我去骑车", never "我去骑骑车".
    expect(onTranscript).toHaveBeenLastCalledWith('我去骑车');
  });
});
