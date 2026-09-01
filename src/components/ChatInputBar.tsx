import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { motion } from 'framer-motion';
import { useChatStore } from '../stores/chatStore';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import ChatInput from './ChatInput';
import VoiceWaveform from './VoiceWaveform';
import CondenseButton from './CondenseButton';
import { startAudioMeter, stopAudioMeter } from '../utils/audioMeter';

interface ChatInputBarProps {
  /** Ref to the underlying textarea (passed through to ChatInput). */
  inputRef?: RefObject<HTMLTextAreaElement>;
  /**
   * Whether ONLY the send button is disabled while the input stays editable.
   * Used during streaming + typewriter.
   */
  sendDisabled?: boolean;
  /** Callback when the user sends a message (text or finalized voice). */
  onSend?: (text: string) => void;
  /**
   * R62: click handler for the condense capsule (now lives to the right of
   * the mode-toggle inside this bar — see `showCondense`).
   */
  onCondense?: () => void;
  /** R62: whether a condense request is currently in flight. */
  isCondensing?: boolean;
  /**
   * R62: whether the condense capsule should currently be visible. Computed
   * upstream as `canCondense && messages.length >= 2 && textDisplayMode
   * !== 'hidden'`. When false, the capsule is omitted entirely (the
   * mode-toggle circular button keeps its place at the right edge).
   */
  showCondense?: boolean;
}

/** After this many ms with no speech result, auto-stop the recording. */
const SILENCE_TIMEOUT_MS = 2500;
/** How long the "这次好像没说话" empty-state hint stays visible. */
const EMPTY_HINT_DURATION_MS = 1500;
/**
 * R64: anti-double-send window. ONE release can fire TWO handlers (pointerup
 * + spacebar keyup) and the late recognition `onend` is a third potential
 * trigger. Any send attempt that lands inside this window after a successful
 * one is dropped. Only voice sends go through this lock — keyboard sends
 * (ChatInput → onSend) are untouched, so they still appear instantly.
 */
const SEND_LOCK_MS = 300;
/**
 * R64: how long the "same sentence twice" dedupe stays armed. A late `onend`
 * lands at most ~1s after the release, so 1.5s covers every duplicate that
 * belongs to the SAME utterance — while still letting the user legitimately
 * say the same short word again later ("好" … "好") without it being
 * swallowed. An unbounded content check would drop the second "好" forever,
 * because it stays the newest user message until the next one is sent.
 */
const DUPE_WINDOW_MS = 1500;
/** localStorage key for the persisted input mode. */
const MODE_STORAGE_KEY = 'nn_input_mode';

/**
 * R68: bottom-bar two-unit layout constants. Every size here is FIXED so that
 * switching keyboard↔voice never resizes Unit A (the centered group) → its
 * center pixel is invariant and the mode-toggle button never moves. Unit B
 * (凝聚记忆) is anchored to Unit A's right edge + CONDENSE_GAP; because Unit A
 * width is a constant, Unit B's left coordinate (computed in the JSX) is also a
 * constant, so it never recomputes or shifts on switch. The two modes swap
 * INSIDE the fixed 500×50 box, so neither the dialog pill nor the voice bar can
 * push any sibling around.
 */
const INPUT_AREA_W = 500; // fixed input/voice box width (matches the voice bar)
const INPUT_AREA_H = 50; // fixed height (matches the voice bar)
const TOGGLE_W = 44; // mode-toggle circular button (h-11 w-11)
const UNIT_GAP = 12; // gap-3 between Unit A children / between A and B
const UNIT_A_W = INPUT_AREA_W + UNIT_GAP + TOGGLE_W; // 556 (constant)
const CONDENSE_GAP = UNIT_GAP; // 12px gap from Unit A right edge to 凝聚记忆

type InputMode = 'keyboard' | 'voice';

function isTypingInInput(): boolean {
  const active = document.activeElement as HTMLElement | null;
  if (!active) return false;
  return (
    active.tagName === 'TEXTAREA' ||
    active.tagName === 'INPUT' ||
    active.isContentEditable
  );
}

function readPersistedMode(): InputMode {
  try {
    const v = localStorage.getItem(MODE_STORAGE_KEY);
    return v === 'voice' || v === 'keyboard' ? v : 'keyboard';
  } catch {
    return 'keyboard';
  }
}

/**
 * ChatInputBar — unified text / voice input bar.
 *
 * keyboard mode: long text input (flex-1) with an inline circular send (↑)
 *   button + an external circular 🎤 button that switches to voice mode.
 * voice mode: a hold-to-talk bar ("🎤 按住说话 / 空格键") + an external
 *   circular ⌨ button that switches back to keyboard mode.
 *
 * R62: the "✦ 凝聚记忆" capsule (formerly rendered ABOVE this bar by the
 * parent ChatPanel) now sits INLINE — immediately to the right of the
 * mode-toggle circular button — in the same bottom row as the input. The
 * outer flex row is `gap-3` so the input pill, the circular toggle, and
 * the capsule get even spacing. Visibility is gated on `showCondense`.
 *
 * Recording state (hold the bar / Space / the mic button):
 *   - the bar turns into a real-time audio waveform (single flowing line);
 *   - the live transcript shows ONLY in the chat-area draft bubble (no
 *     floating pill above the input);
 *   - release / silence auto-sends the transcript; nothing said → a brief
 *     "这次好像没说话" hint; ESC cancels without sending.
 *
 * The mic level for the waveform is shared with the particle-image sway via
 * the audioMeter module (one getUserMedia stream, reused by both).
 */
export default function ChatInputBar({
  inputRef,
  sendDisabled = false,
  onSend,
  onCondense,
  isCondensing = false,
  showCondense = false,
}: ChatInputBarProps): React.ReactElement {
  const [mode, setMode] = useState<InputMode>(readPersistedMode);

  /**
   * R64: per-field selectors instead of the old whole-store `useChatStore()`
   * subscription. The whole-store form re-rendered this bar on EVERY
   * streaming chunk, which re-created `startVoice` / `stopVoice` dozens of
   * times per reply and re-registered the global key listeners each time —
   * a stale-closure factory. Narrow selectors keep the handlers stable.
   */
  const voiceTranscript = useChatStore((s) => s.voiceTranscript);
  const isVoiceRecording = useChatStore((s) => s.isVoiceRecording);
  const showVoiceEmpty = useChatStore((s) => s.showVoiceEmpty);
  const setVoiceTranscript = useChatStore((s) => s.setVoiceTranscript);
  const setVoiceRecording = useChatStore((s) => s.setVoiceRecording);
  const setShowVoiceEmpty = useChatStore((s) => s.setShowVoiceEmpty);
  // R62: read isStreaming once so the condense capsule knows when to show its
  // stardust ring (any time the assistant reply is in flight — same condition
  // ChatPanel used in R57). Kept as a top-level selector to avoid the
  // re-render cost of subscribing inside a child component.
  const isStreaming = useChatStore((s) => s.isStreaming);

  const silenceTimerRef = useRef<number | null>(null);
  const emptyTimerRef = useRef<number | null>(null);
  /** Pointer-y at the moment the hold started (for swipe-up detection). */
  const holdStartYRef = useRef<number | null>(null);
  /** Whether a hold is currently active (so pointerup/move can finalize). */
  const holdActiveRef = useRef(false);
  /** A swipe-up / pointer-leave cancels the in-flight recording. */
  const SWIPE_UP_THRESHOLD_PX = 70;
  /**
   * Round 60 + R63: guard against the message being sent TWICE — once by
   * `stopVoice` (synchronous, using the latest voiceTranscript) and once
   * again by the late `useSpeechRecognition.onend`.
   *
   * R63 root cause: this used to be a 250ms auto-clearing flag. But
   * `recognition.stop()` is ASYNCHRONOUS — Chrome only fires `onend` after
   * its speech service returns the final result, which routinely takes
   * 300ms-1s+ on a slow network. Past 250ms the flag was already cleared,
   * so the late onend happily sent the same sentence a second time.
   * The flag is now cleared at the START of the next hold cycle instead
   * (see `startVoice`), never by a timer.
   */
  const finalizedRef = useRef(false);
  /**
   * R63: set when this cycle finalized with EMPTY text (the user released
   * before any transcript had arrived). Only in that case is a late `onend`
   * allowed through as a rescue — otherwise a fast speaker's words would be
   * silently lost. The rescue can happen at most once per cycle.
   */
  const emptyFinalizedRef = useRef(false);
  /**
   * R64: mirrors `isVoiceRecording` as a REF so the asynchronous ASR
   * callbacks can be rejected the instant a hold-release cycle ends.
   *
   * This is the root cause of the "permanent leftover draft bubble":
   * `recognition.stop()` is asynchronous, so an `onresult` event can land
   * AFTER `finalizeRecording()` had already cleared `voiceTranscript`. That
   * late event wrote the transcript straight back into the store while
   * `isVoiceRecording` was already `false`, and the draft bubble — whose old
   * render condition was `isVoiceRecording || voiceTranscript` — then
   * rendered forever. Worse: the old render layer hid the last user message
   * while a stale transcript was present, which is exactly why keyboard
   * messages disappeared until the AI reply arrived.
   */
  const recordingActiveRef = useRef(false);
  /**
   * R64: the last successful voice send — timestamp + exact text. Drives the
   * double-send time lock and the "same sentence twice" dedupe.
   */
  const sendLockRef = useRef<{ at: number; text: string }>({ at: 0, text: '' });

  /**
   * R64: the ONE and only place a voice utterance is turned into a real
   * message. Everything below happens inside a single event handler, so
   * React 18 batches all of it into ONE render — there is never an
   * intermediate frame showing two bubbles (draft + real) or zero bubbles
   * (draft already gone, real not yet in the store).
   *
   * Order matters:
   *   ① recording off      → the draft bubble disappears in THIS frame
   *   ② interim cleared    → nothing can resurrect it on the next frame
   *   ③ empty result       → no bubble, no send (brief hint only)
   *   ④ double-send lock   → pointerup / spacebar keyup / late onend
   *   ⑤ real message in    → store append
   *   ⑥ AI reply triggered → `onSend` does both ⑤ and ⑥
   */
  const commitSend = useCallback(
    (rawText: string, showEmptyHint = false) => {
      const finalText = rawText.trim();

      // ① + ② — kill the draft bubble and its source text.
      recordingActiveRef.current = false;
      setVoiceRecording(false);
      setVoiceTranscript('');
      setShowVoiceEmpty(showEmptyHint);

      if (silenceTimerRef.current) {
        window.clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      stopAudioMeter();

      // ③ — nothing said → no bubble, no request.
      if (!finalText) return;

      // ④ — anti-double-send.
      const now = Date.now();
      const lock = sendLockRef.current;
      // 4a. time lock: spacebar keyup + pointerup for the SAME release.
      if (now - lock.at < SEND_LOCK_MS) return;
      // 4b. same-sentence dedupe: the newest user message already in the
      //     store is literally this text AND it is what we last sent → the
      //     late onend trying to deliver it a second time.
      //     Time-bounded by DUPE_WINDOW_MS so that saying the same short
      //     word again a moment later is still a real, sendable message.
      if (now - lock.at < DUPE_WINDOW_MS && finalText === lock.text) {
        const msgs = useChatStore.getState().messages;
        let lastUserText = '';
        for (let i = msgs.length - 1; i >= 0; i--) {
          if (msgs[i].role === 'user') {
            lastUserText = msgs[i].content.trim();
            break;
          }
        }
        if (lastUserText === finalText) return;
      }

      sendLockRef.current = { at: now, text: finalText };

      // ⑤ + ⑥ — append the real user message and start the AI reply. The
      // store append is synchronous, so the user bubble paints in this very
      // render (no waiting for the assistant).
      onSend?.(finalText);
    },
    [onSend, setVoiceTranscript, setVoiceRecording, setShowVoiceEmpty],
  );

  const finalizeRecording = useCallback(
    (finalText: string) => {
      if (finalizedRef.current) {
        // A second finalize for the SAME hold-release cycle.
        // `stopVoice` already sent synchronously → this is the duplicate.
        // Drop it, UNLESS the first pass had nothing to send.
        if (!emptyFinalizedRef.current) return;
        const lateText = finalText.trim();
        if (!lateText) return;
        emptyFinalizedRef.current = false; // rescue exactly once
        commitSend(lateText);
        return;
      }
      finalizedRef.current = true;

      const trimmed = finalText.trim();
      if (!trimmed) {
        // Nothing to send yet — but the late onend may still deliver the
        // real transcript, so leave the rescue door open.
        emptyFinalizedRef.current = true;
      }
      commitSend(trimmed, !trimmed);
    },
    [commitSend],
  );

  const { isSupported, startRecording, stopRecording, abortRecording } = useSpeechRecognition({
    onTranscript: (text) => {
      // R64: reject transcripts that arrive after the cycle ended.
      // `recognition.stop()` is asynchronous — an `onresult` can land 300ms+
      // after the user released the button, i.e. after `commitSend()` already
      // cleared `voiceTranscript`. Without this guard that stale text was
      // written back into the store and the draft bubble (and the render
      // layer's "hide the last user message" hack along with it) came back to
      // life and stayed at the bottom of the chat forever.
      if (!recordingActiveRef.current) return;
      setVoiceTranscript(text);
      // Reset silence timer on every recognized speech result.
      if (silenceTimerRef.current) {
        window.clearTimeout(silenceTimerRef.current);
      }
      silenceTimerRef.current = window.setTimeout(() => {
        stopRecording();
      }, SILENCE_TIMEOUT_MS);
    },
    onEnd: (finalText) => {
      finalizeRecording(finalText);
    },
    onError: () => {
      if (silenceTimerRef.current) {
        window.clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      recordingActiveRef.current = false;
      stopAudioMeter();
      setVoiceRecording(false);
      setVoiceTranscript('');
      setShowVoiceEmpty(true);
    },
  });

  const startVoice = useCallback(() => {
    // R64: gate on the synchronous REF, not the (one-render-late) store flag.
    // Spacebar auto-repeat fires keydown many times per second; with a state
    // gate two `startRecording()` calls could slip through before the first
    // `setVoiceRecording(true)` was ever committed, leaving an orphan
    // recognition session whose late results resurrected the draft bubble.
    if (!isSupported || recordingActiveRef.current || sendDisabled) return;
    // R63: reset the per-cycle finalize guards HERE (not on a timer) — this
    // is the only point where a fresh hold-release cycle begins.
    finalizedRef.current = false;
    emptyFinalizedRef.current = false;
    // R64: open the gate that lets ASR results update the transcript.
    recordingActiveRef.current = true;
    setShowVoiceEmpty(false);
    setVoiceTranscript('');
    setVoiceRecording(true);
    void startAudioMeter();
    startRecording();
  }, [isSupported, sendDisabled, setShowVoiceEmpty, setVoiceTranscript, setVoiceRecording, startRecording]);

  const stopVoice = useCallback(() => {
    // R64: ref gate again — a *very* fast tap (pointerdown + pointerup inside
    // one frame) used to be swallowed here, because `isVoiceRecording` was
    // still false in this closure. The recording then never stopped: the mic
    // light stayed on and the draft bubble hung around.
    if (!recordingActiveRef.current) return;
    // Round 60: send the message IMMEDIATELY using the latest voiceTranscript
    // (which includes any in-flight interim text). We don't wait for
    // recognition.onend (which can lag 300ms-1s+ behind stop()) — the user
    // expects "松开立即发". The pending onend will still fire, but
    // finalizedRef short-circuits its finalizeRecording() call so no
    // duplicate is sent. R63: that flag is no longer time-based, so a slow
    // onend can no longer slip past it (see finalizedRef's comment).
    // R64: read the transcript LIVE from the store instead of the render
    // closure. An `onresult` that lands in the same batch as the release
    // would otherwise be missed and the older text sent instead.
    finalizeRecording(useChatStore.getState().voiceTranscript);
    // Tell the recognition engine to wind down. onend is a no-op for us now.
    stopRecording();
  }, [finalizeRecording, stopRecording]);

  const cancelVoice = useCallback(() => {
    if (silenceTimerRef.current) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    // R64: close the transcript gate FIRST so results from the aborted
    // session can never re-populate `voiceTranscript`.
    recordingActiveRef.current = false;
    abortRecording();
    stopAudioMeter();
    setVoiceRecording(false);
    setVoiceTranscript('');
    setShowVoiceEmpty(false);
  }, [abortRecording, setVoiceRecording, setVoiceTranscript, setShowVoiceEmpty]);

  // --- Pointer handlers for the hold-to-talk bar (图六/图七).
  // Normal release → finalize + send. Swipe-up / pointer leaving the bar /
  // ESC → discard (cancel). All three are "cancel" per spec ④.
  const onHoldPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      holdStartYRef.current = e.clientY;
      holdActiveRef.current = true;
      startVoice();
    },
    [startVoice],
  );

  const onHoldPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!holdActiveRef.current) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const outside =
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom;
      const swipedUp =
        holdStartYRef.current !== null &&
        holdStartYRef.current - e.clientY > SWIPE_UP_THRESHOLD_PX;
      if (outside || swipedUp) {
        // Move out / swipe up → discard this recording.
        holdActiveRef.current = false;
        holdStartYRef.current = null;
        cancelVoice();
      }
    },
    [cancelVoice],
  );

  const onHoldPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!holdActiveRef.current) return;
      e.preventDefault();
      holdActiveRef.current = false;
      holdStartYRef.current = null;
      stopVoice(); // finalize → send (or show empty hint)
    },
    [stopVoice],
  );

  const onHoldPointerCancel = useCallback(() => {
    if (!holdActiveRef.current) return;
    holdActiveRef.current = false;
    holdStartYRef.current = null;
    cancelVoice();
  }, [cancelVoice]);

  // Auto-clear the empty-speech hint after a short delay.
  useEffect(() => {
    if (!showVoiceEmpty) return;
    if (emptyTimerRef.current) {
      window.clearTimeout(emptyTimerRef.current);
    }
    emptyTimerRef.current = window.setTimeout(() => {
      setShowVoiceEmpty(false);
    }, EMPTY_HINT_DURATION_MS);
    return () => {
      if (emptyTimerRef.current) {
        window.clearTimeout(emptyTimerRef.current);
      }
    };
  }, [showVoiceEmpty, setShowVoiceEmpty]);

  // Global keyboard controls for voice mode.
  useEffect(() => {
    // R64: all three branches test `recordingActiveRef` (synchronous) rather
    // than the store flag. Besides fixing the fast-tap case, this makes the
    // spacebar keyup a THIRD anti-double-send layer: once a release has been
    // committed the ref is already false, so a duplicate keyup (or a keyup
    // right after a pointerup for the same release) is a no-op.
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.code === 'Space' &&
        mode === 'voice' &&
        !isTypingInInput() &&
        !recordingActiveRef.current
      ) {
        e.preventDefault();
        startVoice();
      }
      if (e.code === 'Escape' && recordingActiveRef.current) {
        e.preventDefault();
        cancelVoice();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && recordingActiveRef.current) {
        e.preventDefault();
        stopVoice();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [mode, startVoice, stopVoice, cancelVoice]);

  /**
   * R64: fallback safety net — a transcript may never outlive the recording
   * that produced it. Any exit path we forgot to cover (mode switch, view
   * switch, review entry, unmount, an ASR error we didn't handle...) is
   * caught here, so a stale draft text can never survive into the next frame.
   */
  useEffect(() => {
    if (isVoiceRecording) return;
    // Not recording → the ASR gate must be shut and the draft text gone.
    // (Re-syncing the ref here also guarantees voice can never get stuck in
    // a "ref says recording, store says idle" state, which would silently
    // block every future hold.)
    recordingActiveRef.current = false;
    if (voiceTranscript) {
      setVoiceTranscript('');
    }
  }, [isVoiceRecording, voiceTranscript, setVoiceTranscript]);

  // Cleanup timers + mic + voice UI state on unmount.
  useEffect(() => {
    return () => {
      if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current);
      if (emptyTimerRef.current) window.clearTimeout(emptyTimerRef.current);
      recordingActiveRef.current = false;
      stopAudioMeter();
      // R64: never leave a half-open recording state behind when the bar
      // unmounts (view switch / entering review) — otherwise the draft bubble
      // would reappear on the next mount.
      setVoiceRecording(false);
      setVoiceTranscript('');
      setShowVoiceEmpty(false);
    };
  }, [setVoiceRecording, setVoiceTranscript, setShowVoiceEmpty]);

  const switchMode = useCallback(
    (next: InputMode) => {
      if (next === mode) return;
      // R64: ALWAYS run the full cancel path before switching layouts — even
      // when `isVoiceRecording` is already false, because a stale transcript
      // can still be sitting in the store (that was the leftover bubble).
      cancelVoice();
      try {
        localStorage.setItem(MODE_STORAGE_KEY, next);
      } catch {
        // Ignore storage failures (private mode etc.).
      }
      setMode(next);
    },
    [mode, cancelVoice],
  );

  const modeToggleButton = (
    <motion.button
      type="button"
      whileTap={{ scale: 0.9 }}
      onClick={() => switchMode(mode === 'keyboard' ? 'voice' : 'keyboard')}
      disabled={sendDisabled}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-warm-white/60 transition-colors hover:bg-white/5 hover:text-warm-white"
      aria-label={mode === 'keyboard' ? '切换到语音输入' : '切换到键盘输入'}
      title={mode === 'keyboard' ? '切换到语音输入' : '切换到键盘输入'}
    >
      {mode === 'keyboard' ? (
        // Microphone icon
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 11a7 7 0 01-14 0M12 15a3 3 0 003-3V6a3 3 0 00-6 0v6a3 3 0 003 3z"
          />
        </svg>
      ) : (
        // Keyboard icon
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path strokeLinecap="round" d="M7 10h.01M10 10h.01M13 10h.01M16 10h.01M7 14h10" />
        </svg>
      )}
    </motion.button>
  );

  return (
    <div className="relative w-full">
      {/* R68 — Unit A: [input/voice] + [toggle], centered as one whole at the
          screen bottom. FIXED width (UNIT_A_W) so keyboard↔voice switching never
          resizes the box → its center pixel never moves and the toggle button
          stays put. The two modes swap INSIDE a fixed 500×50 box (opacity-only
          fade), so neither the dialog pill nor the voice bar can shift anything. */}
      <div
        className="absolute bottom-0 left-1/2 flex -translate-x-1/2 items-center"
        style={{ width: UNIT_A_W, height: INPUT_AREA_H, gap: UNIT_GAP }}
      >
        {/* [input/voice] fixed box — content switches by mode, box never resizes */}
        <div
          className="relative shrink-0"
          style={{ width: INPUT_AREA_W, height: INPUT_AREA_H }}
        >
          <motion.div
            key={mode}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="relative h-full w-full"
          >
            {mode === 'keyboard' ? (
              <div
                className="flex h-full w-full items-center gap-2 rounded-full px-4"
                style={{
                  background: 'rgba(15, 12, 9, 0.65)',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  boxShadow: '0 4px 24px rgba(0, 0, 0, 0.3)',
                }}
              >
                <ChatInput
                  inputRef={inputRef}
                  sendDisabled={sendDisabled}
                  onSend={onSend}
                />
              </div>
            ) : (
              <button
                type="button"
                className={`voice-hold-btn relative flex h-full w-full items-center justify-center gap-3 rounded-full text-sm outline-none transition-colors select-none ${
                  isVoiceRecording ? 'voice-recording' : ''
                } ${showVoiceEmpty ? 'voice-empty' : ''}`}
                style={{
                  color: showVoiceEmpty
                    ? 'rgba(232, 96, 96, 0.9)'
                    : 'rgba(232, 221, 208, 0.85)',
                  touchAction: 'none',
                }}
                disabled={sendDisabled || !isSupported}
                aria-label={
                  isVoiceRecording
                    ? '正在录音，松开结束；上滑或移出取消'
                    : '长按说话'
                }
                onPointerDown={onHoldPointerDown}
                onPointerMove={onHoldPointerMove}
                onPointerUp={onHoldPointerUp}
                onPointerLeave={onHoldPointerCancel}
                onPointerCancel={onHoldPointerCancel}
              >
                {/* Bug 1 fix (R66): the flowing waveform appears ONLY while the
                    button is held (recording === true). At rest the bar shows a
                    faint static hint — no line, no rAF, no analyser. */}
                {isVoiceRecording ? (
                  <VoiceWaveform recording={isVoiceRecording} />
                ) : showVoiceEmpty ? (
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm">
                    这次好像没说话
                  </span>
                ) : (
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm">
                    按住说话 / 空格键
                  </span>
                )}
              </button>
            )}
          </motion.div>
        </div>

        {modeToggleButton}
      </div>

      {/* R68 — Unit B: 凝聚记忆, anchored to Unit A's RIGHT edge + fixed gap.
          Its left = 50% (screen center) + half of Unit A + gap → a CONSTANT
          viewport coordinate. Because Unit A's width is fixed, this coordinate
          is constant, so 凝聚记忆 never recomputes or moves when the mode
          switches. It does NOT participate in Unit A's centering. */}
      {showCondense && (
        <span
          className="absolute bottom-0 flex items-center"
          style={{
            left: `calc(50% + ${UNIT_A_W / 2 + CONDENSE_GAP}px)`,
            height: INPUT_AREA_H,
            pointerEvents: isCondensing ? 'none' : 'auto',
          }}
        >
          <CondenseButton
            onClick={onCondense}
            isLoading={isCondensing}
            isThinking={isStreaming}
          />
        </span>
      )}
    </div>
  );
}
