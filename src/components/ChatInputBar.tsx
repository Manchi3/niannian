import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useChatStore } from '../stores/chatStore';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import ChatInput from './ChatInput';
import VoiceWaveform from './VoiceWaveform';
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
}

/** After this many ms with no speech result, auto-stop the recording. */
const SILENCE_TIMEOUT_MS = 2500;
/** How long the "这次好像没说话" empty-state hint stays visible. */
const EMPTY_HINT_DURATION_MS = 1500;
/** localStorage key for the persisted input mode. */
const MODE_STORAGE_KEY = 'nn_input_mode';

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
 *   circular ⌨ button that switches back to keyboard mode. The "✦ 凝聚记忆"
 *   capsule sits centered ABOVE this bar (rendered by the parent ChatPanel).
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
}: ChatInputBarProps): React.ReactElement {
  const [mode, setMode] = useState<InputMode>(readPersistedMode);

  const {
    voiceTranscript,
    isVoiceRecording,
    showVoiceEmpty,
    setVoiceTranscript,
    setVoiceRecording,
    setShowVoiceEmpty,
  } = useChatStore();

  const silenceTimerRef = useRef<number | null>(null);
  const emptyTimerRef = useRef<number | null>(null);
  /** Pointer-y at the moment the hold started (for swipe-up detection). */
  const holdStartYRef = useRef<number | null>(null);
  /** Whether a hold is currently active (so pointerup/move can finalize). */
  const holdActiveRef = useRef(false);
  /** A swipe-up / pointer-leave cancels the in-flight recording. */
  const SWIPE_UP_THRESHOLD_PX = 70;
  /**
   * Round 60: guard against the message being sent TWICE — once by
   * `stopVoice` (synchronous, using the latest voiceTranscript) and once
   * again by `useSpeechRecognition.onend` (asynchronous, fires ~50-100ms
   * after `recognition.stop()`). The first call sets the flag; the second
   * call short-circuits. Flag auto-clears after 250ms so a fresh recording
   * can finalize normally.
   */
  const finalizedRef = useRef(false);

  const finalizeRecording = useCallback(
    (finalText: string) => {
      if (finalizedRef.current) return;
      finalizedRef.current = true;
      window.setTimeout(() => {
        finalizedRef.current = false;
      }, 250);

      if (silenceTimerRef.current) {
        window.clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      stopAudioMeter();

      const trimmed = finalText.trim();
      if (trimmed) {
        onSend?.(trimmed);
      } else if (isVoiceRecording) {
        setShowVoiceEmpty(true);
      }

      setVoiceTranscript('');
      setVoiceRecording(false);
    },
    [onSend, isVoiceRecording, setVoiceTranscript, setVoiceRecording, setShowVoiceEmpty],
  );

  const { isSupported, startRecording, stopRecording, abortRecording } = useSpeechRecognition({
    onTranscript: (text) => {
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
      stopAudioMeter();
      setVoiceRecording(false);
      setVoiceTranscript('');
      setShowVoiceEmpty(true);
    },
  });

  const startVoice = useCallback(() => {
    if (!isSupported || isVoiceRecording || sendDisabled) return;
    setShowVoiceEmpty(false);
    setVoiceTranscript('');
    setVoiceRecording(true);
    void startAudioMeter();
    startRecording();
  }, [isSupported, isVoiceRecording, sendDisabled, setShowVoiceEmpty, setVoiceTranscript, setVoiceRecording, startRecording]);

  const stopVoice = useCallback(() => {
    if (!isVoiceRecording) return;
    // Round 60: send the message IMMEDIATELY using the latest voiceTranscript
    // (which includes any in-flight interim text). We don't wait for
    // recognition.onend (which fires ~50-100ms later) — the user expects
    // "松开立即发". The pending onend will still fire, but finalizedRef
    // short-circuits its finalizeRecording() call so no duplicate is sent.
    finalizeRecording(voiceTranscript);
    // Tell the recognition engine to wind down. onend is a no-op for us now.
    stopRecording();
  }, [isVoiceRecording, voiceTranscript, finalizeRecording, stopRecording]);

  const cancelVoice = useCallback(() => {
    if (silenceTimerRef.current) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
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
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && mode === 'voice' && !isTypingInInput() && !isVoiceRecording) {
        e.preventDefault();
        startVoice();
      }
      if (e.code === 'Escape' && isVoiceRecording) {
        e.preventDefault();
        cancelVoice();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && isVoiceRecording) {
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
  }, [mode, isVoiceRecording, startVoice, stopVoice, cancelVoice]);

  // Cleanup timers + mic on unmount.
  useEffect(() => {
    return () => {
      if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current);
      if (emptyTimerRef.current) window.clearTimeout(emptyTimerRef.current);
      stopAudioMeter();
    };
  }, []);

  const switchMode = useCallback(
    (next: InputMode) => {
      if (next === mode) return;
      // End any in-flight recording before switching layouts.
      if (isVoiceRecording) {
        cancelVoice();
      }
      try {
        localStorage.setItem(MODE_STORAGE_KEY, next);
      } catch {
        // Ignore storage failures (private mode etc.).
      }
      setMode(next);
    },
    [mode, isVoiceRecording, cancelVoice],
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
      {/* Outer row: the input (keyboard pill or voice hold-bar) + the always
          visible mode-toggle circular button. The row is centered; in keyboard
          mode the pill is flex-1 (full width), in voice mode the hold-bar is a
          fixed 500×50 pill so it no longer spans the bottom (Round 58). */}
      <div className="flex items-center justify-center gap-3">
        <AnimatePresence mode="wait" initial={false}>
          {mode === 'keyboard' ? (
            <motion.div
              key="keyboard"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="flex min-w-0 flex-1 items-center"
            >
              <div
                className="flex w-full items-center gap-2 rounded-full px-4 py-2"
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
            </motion.div>
          ) : (
            <motion.div
              key="voice"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="flex items-center"
            >
              <button
                type="button"
                className={`voice-hold-btn flex items-center justify-center gap-3 rounded-full text-sm outline-none transition-colors select-none ${
                  isVoiceRecording ? 'voice-recording' : ''
                } ${showVoiceEmpty ? 'voice-empty' : ''}`}
                style={{
                  width: '500px',
                  maxWidth: '100%',
                  height: '50px',
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
                {isVoiceRecording ? (
                  <span className="pointer-events-none shrink-0">
                    <VoiceWaveform />
                  </span>
                ) : showVoiceEmpty ? (
                  <span className="pointer-events-none text-sm">这次好像没说话</span>
                ) : (
                  <>
                    <svg
                      className="pointer-events-none h-4 w-4 shrink-0"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.8}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M19 11a7 7 0 01-14 0M12 15a3 3 0 003-3V6a3 3 0 00-6 0v6a3 3 0 003 3z"
                      />
                    </svg>
                    <span className="pointer-events-none text-sm">按住说话 / 空格键</span>
                  </>
                )}
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {modeToggleButton}
      </div>
    </div>
  );
}
