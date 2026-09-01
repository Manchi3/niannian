import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ChatInputBar from '../ChatInputBar';
import { useChatStore } from '../../stores/chatStore';

/**
 * Regression tests for Round 63 — "voice input sends the same message twice".
 *
 * These drive the REAL ChatInputBar (pointer down → speech results → pointer
 * up), with only the microphone meter and the browser's SpeechRecognition
 * replaced by mocks. The mock lets each test choose exactly when the
 * recognition's `onend` fires, which is the whole point: in real Chrome
 * `stop()` is asynchronous and `onend` can land hundreds of milliseconds
 * AFTER the user released the button.
 */

vi.mock('../../utils/audioMeter', () => ({
  startAudioMeter: vi.fn(async () => {}),
  stopAudioMeter: vi.fn(),
  getAudioLevel: () => 0.5,
  getAudioEnv: () => 0,
  getAudioRms: () => 0,
  getWaveform: (n: number) => new Array(n).fill(0),
  isAudioMeterActive: () => false,
}));

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

function emitResult(inst: MockRecognition, resultIndex: number, results: ResultSpec[]) {
  act(() => {
    inst.onresult?.({ resultIndex, results: toResults(results) });
  });
}

/** Speak one final result into the given recognition instance. */
function speak(inst: MockRecognition, text: string) {
  emitResult(inst, 0, [{ isFinal: true, transcript: text }]);
}

beforeEach(() => {
  MockRecognition.instances = [];
  vi.stubGlobal('SpeechRecognition', MockRecognition);
  // Start directly in voice mode so we don't have to wait out the
  // AnimatePresence mode="wait" transition between the two layouts.
  localStorage.setItem('nn_input_mode', 'voice');
  useChatStore.setState({
    messages: [],
    voiceTranscript: '',
    isVoiceRecording: false,
    showVoiceEmpty: false,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

function setup() {
  const onSend = vi.fn();
  render(<ChatInputBar onSend={onSend} />);
  const hold = document.querySelector('.voice-hold-btn') as HTMLElement;
  return { onSend, hold };
}

/**
 * R64 harness — like `setup()`, but `onSend` also APPENDS the user message to
 * the store, exactly like the real chain does
 * (ChatMainView.handleSendMessage → useChat.sendMessage → addMessage, which
 * is synchronous and happens before any network call). Needed because the
 * "same sentence twice" dedupe inspects the newest user message in the store.
 */
function setupWithStore() {
  const onSend = vi.fn((text: string) => {
    const n = useChatStore.getState().messages.length;
    useChatStore.getState().addMessage({
      id: `m${n}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    });
  });
  const view = render(<ChatInputBar onSend={onSend} />);
  const hold = document.querySelector('.voice-hold-btn') as HTMLElement;
  return { onSend, hold, view };
}

describe('ChatInputBar voice send — R63 duplicate-send guards', () => {
  it('sends once even when onend arrives long after the release', async () => {
    const { onSend, hold } = setup();

    fireEvent.pointerDown(hold);
    const inst = MockRecognition.instances[0];
    speak(inst, '你好');

    // Release → sends synchronously (so it feels instant).
    fireEvent.pointerUp(hold);
    expect(onSend).toHaveBeenCalledExactlyOnceWith('你好');

    // R63 bug: the old guard was a flag that auto-cleared after 250ms.
    // Chrome's onend routinely lands later than that (it waits for the
    // speech service to return the final result), so it slipped past the
    // flag and re-sent the same sentence. This wait is what makes the test
    // a genuine regression test — without it the old code would pass.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    act(() => inst.onend?.());

    expect(onSend).toHaveBeenCalledTimes(1);
  }, 10000);

  it('sends once even when onend arrives after a whole new hold cycle', async () => {
    const { onSend, hold } = setup();

    // --- cycle 1 --------------------------------------------------------
    fireEvent.pointerDown(hold);
    const first = MockRecognition.instances[0];
    speak(first, '第一句');
    fireEvent.pointerUp(hold);
    expect(onSend).toHaveBeenCalledExactlyOnceWith('第一句');

    // Cycle 1's onend is still in flight (past the old 250ms guard window).
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });

    // --- cycle 2 starts before cycle 1's onend lands --------------------
    fireEvent.pointerDown(hold);
    const second = MockRecognition.instances[1];
    speak(second, '第二句');
    fireEvent.pointerUp(hold);
    expect(onSend).toHaveBeenCalledTimes(2);
    expect(onSend).toHaveBeenLastCalledWith('第二句');

    // Both stale onends fire now — neither may produce a third message.
    act(() => first.onend?.());
    act(() => second.onend?.());

    expect(onSend).toHaveBeenCalledTimes(2);
    expect(onSend.mock.calls.map((c) => c[0])).toEqual(['第一句', '第二句']);
  }, 10000);

  it('lets a late result rescue a fast release (nothing was sent yet)', () => {
    const { onSend, hold } = setup();

    fireEvent.pointerDown(hold);
    const inst = MockRecognition.instances[0];

    // Released before any transcript arrived → empty finalize.
    fireEvent.pointerUp(hold);
    expect(onSend).not.toHaveBeenCalled();
    expect(useChatStore.getState().showVoiceEmpty).toBe(true);

    // The recognition belatedly returns the real words.
    speak(inst, '刚说的话');
    act(() => inst.onend?.());

    // Rescued exactly once — the user does not lose their sentence.
    expect(onSend).toHaveBeenCalledExactlyOnceWith('刚说的话');

    // A further onend cannot send it again.
    act(() => inst.onend?.());
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('does not send at all when the recording is cancelled (swipe / ESC)', () => {
    const { onSend, hold } = setup();

    fireEvent.pointerDown(hold);
    const inst = MockRecognition.instances[0];
    speak(inst, '这句要被丢掉');

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
    });

    expect(onSend).not.toHaveBeenCalled();

    act(() => inst.onend?.());
    expect(onSend).not.toHaveBeenCalled();
  });

  it('still sends via the silence auto-stop path (no manual release)', async () => {
    const { onSend, hold } = setup();

    fireEvent.pointerDown(hold);
    const inst = MockRecognition.instances[0];
    speak(inst, '说完停了两秒半');

    // Wait out SILENCE_TIMEOUT_MS (2500ms) — the auto-stop calls
    // stopRecording() only, so the send depends entirely on the late onend.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 2700));
    });

    act(() => inst.onend?.());

    expect(onSend).toHaveBeenCalledExactlyOnceWith('说完停了两秒半');
  }, 10000);
});

/**
 * Regression tests for Round 64 — the reported bug was three-fold:
 *   1. after a voice release the SAME sentence showed up twice (the real
 *      user bubble + the temporary draft bubble);
 *   2. that draft bubble then stayed pinned to the bottom of the chat
 *      forever, across further turns and mode switches;
 *   3. keyboard-sent messages did not appear until the AI reply arrived.
 *
 * Root causes: a late `onresult` wrote the transcript back into the store
 * AFTER the release (so `voiceTranscript` was never really empty), and the
 * render layer hid the newest user message while a transcript was present.
 * These tests pin down the store-side half of the contract: once a release
 * has been committed, NOTHING may leave voice state dirty.
 */
describe('ChatInputBar voice send — R64 leftover-draft & double-send guards', () => {
  it('leaves no draft state behind after a normal release', () => {
    const { onSend, hold } = setupWithStore();

    fireEvent.pointerDown(hold);
    const inst = MockRecognition.instances[0];
    speak(inst, '今天天气不错');
    // "边说边逐字出字" must keep working — the draft text is live mid-hold.
    expect(useChatStore.getState().voiceTranscript).toBe('今天天气不错');
    expect(useChatStore.getState().isVoiceRecording).toBe(true);

    fireEvent.pointerUp(hold);

    expect(onSend).toHaveBeenCalledExactlyOnceWith('今天天气不错');
    // The draft's BOTH render conditions are now false → bubble cannot exist.
    expect(useChatStore.getState().isVoiceRecording).toBe(false);
    expect(useChatStore.getState().voiceTranscript).toBe('');
  });

  it('a late onresult cannot resurrect the draft (the leftover-bubble root cause)', () => {
    const { hold } = setupWithStore();

    fireEvent.pointerDown(hold);
    const inst = MockRecognition.instances[0];
    speak(inst, '说完就松手');
    fireEvent.pointerUp(hold);
    expect(useChatStore.getState().voiceTranscript).toBe('');

    // Watch EVERY store transition from here on, not just the end state: a
    // transcript that is written and then cleaned up by the fallback effect
    // still paints a draft bubble for a frame — which is precisely the
    // flicker/leftover the user reported. Nothing may write it at all.
    const dirty: string[] = [];
    const unsubscribe = useChatStore.subscribe((s) => {
      if (s.voiceTranscript) dirty.push(s.voiceTranscript);
    });

    // Chrome delivers one more result AFTER stop() — the old code wrote this
    // straight back into the store and the bubble came back for good.
    emitResult(inst, 1, [{ isFinal: false, transcript: '迟到的识别结果' }]);
    act(() => inst.onend?.());
    unsubscribe();

    expect(dirty).toEqual([]);
    expect(useChatStore.getState().voiceTranscript).toBe('');
    expect(useChatStore.getState().isVoiceRecording).toBe(false);
  });

  it('spacebar keyup + pointerup for ONE release sends exactly once', () => {
    const { onSend, hold } = setupWithStore();

    fireEvent.pointerDown(hold);
    speak(MockRecognition.instances[0], '一次释放两个事件');

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
    });
    fireEvent.pointerUp(hold);

    expect(onSend).toHaveBeenCalledExactlyOnceWith('一次释放两个事件');
    expect(useChatStore.getState().messages).toHaveLength(1);
  });

  it('spacebar auto-repeat opens only ONE recognition session', () => {
    setupWithStore();

    // Held-down Space repeats keydown many times per second. All of them land
    // in the same React batch here, so the store flag is still `false` for
    // every one of them — only the synchronous ref gate can stop them.
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    });

    expect(MockRecognition.instances).toHaveLength(1);
  });

  it('press → speak → release inside ONE React batch still sends the words', () => {
    const { onSend, hold } = setupWithStore();

    // A very fast tap: React has not re-rendered in between, so the render
    // closure still believes `isVoiceRecording === false` and
    // `voiceTranscript === ''`. Both must be read from the ref / the store.
    act(() => {
      fireEvent.pointerDown(hold);
      MockRecognition.instances[0].onresult?.({
        resultIndex: 0,
        results: toResults([{ isFinal: true, transcript: '快说快放' }]),
      });
      fireEvent.pointerUp(hold);
    });

    expect(onSend).toHaveBeenCalledExactlyOnceWith('快说快放');
    expect(useChatStore.getState().isVoiceRecording).toBe(false);
    expect(useChatStore.getState().voiceTranscript).toBe('');
  });

  it('switching to keyboard mode cancels the hold and clears the draft', () => {
    const { onSend, hold } = setupWithStore();

    fireEvent.pointerDown(hold);
    speak(MockRecognition.instances[0], '切模式前说的话');

    fireEvent.click(screen.getByLabelText('切换到键盘输入'));

    expect(onSend).not.toHaveBeenCalled();
    expect(useChatStore.getState().isVoiceRecording).toBe(false);
    expect(useChatStore.getState().voiceTranscript).toBe('');
  });

  it('unmounting (view switch / review entry) clears voice state', () => {
    const { hold, view } = setupWithStore();

    fireEvent.pointerDown(hold);
    speak(MockRecognition.instances[0], '离开页面时还在说');

    view.unmount();

    expect(useChatStore.getState().isVoiceRecording).toBe(false);
    expect(useChatStore.getState().voiceTranscript).toBe('');
  });

  it('three utterances produce exactly three messages', async () => {
    const { onSend, hold } = setupWithStore();

    for (const line of ['第一句话', '第二句话', '第三句话']) {
      fireEvent.pointerDown(hold);
      speak(MockRecognition.instances[MockRecognition.instances.length - 1], line);
      fireEvent.pointerUp(hold);
      // Clear the 300ms double-send window before the next hold.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 350));
      });
    }

    expect(onSend).toHaveBeenCalledTimes(3);
    expect(onSend.mock.calls.map((c) => c[0])).toEqual(['第一句话', '第二句话', '第三句话']);
    expect(useChatStore.getState().messages).toHaveLength(3);
  }, 10000);

  it('the same short word can be said again once the dedupe window passed', async () => {
    const { onSend, hold } = setupWithStore();

    fireEvent.pointerDown(hold);
    speak(MockRecognition.instances[0], '好');
    fireEvent.pointerUp(hold);
    expect(onSend).toHaveBeenCalledTimes(1);

    // Past DUPE_WINDOW_MS (1500ms) the content check disarms, so a genuine
    // repeat is a real message again — an unbounded check swallowed it
    // forever, because '好' stays the newest user message.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1600));
    });

    fireEvent.pointerDown(hold);
    speak(MockRecognition.instances[1], '好');
    fireEvent.pointerUp(hold);

    expect(onSend).toHaveBeenCalledTimes(2);
    expect(useChatStore.getState().messages.map((m) => m.content)).toEqual(['好', '好']);
  }, 10000);
});
