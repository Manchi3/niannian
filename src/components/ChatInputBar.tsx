import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useChatStore } from '../stores/chatStore';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import ChatInput from './ChatInput';
import VoiceWaveform from './VoiceWaveform';

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

function isTypingInInput(): boolean {
  const active = document.activeElement as HTMLElement | null;
  if (!active) return false;
  return (
    active.tagName === 'TEXTAREA' ||
    active.tagName === 'INPUT' ||
    active.isContentEditable
  );
}

/**
 * ChatInputBar — unified text / voice input bar.
 *
 * Renders a keyboard input (ChatInput) or a hold-to-talk voice bar depending on
 * the current mode. The right end always hosts a toggle button to switch mode.
 *
 * Voice mode:
 *   - Press and hold the bar, or hold Space (when no text field is focused).
 *   - While holding, an animated waveform plays and the live transcript is
 *     shown in a draft bubble by the parent ChatPanel.
 *   - Release / silence auto-sends the transcript; if nothing was said, a
 *     brief "这次好像没说话" hint appears.
 *   - ESC cancels the current recording.
 */
export default function ChatInputBar({
  inputRef,
  sendDisabled = false,
  onSend,
}: ChatInputBarProps): React.ReactElement {
  const [mode, setMode] = useState<'text' | 'voice'>('text');

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

  const finalizeRecording = useCallback(
    (finalText: string) => {
      if (silenceTimerRef.current) {
        window.clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }

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
    startRecording();
  }, [isSupported, isVoiceRecording, sendDisabled, setShowVoiceEmpty, setVoiceTranscript, setVoiceRecording, startRecording]);

  const stopVoice = useCallback(() => {
    if (!isVoiceRecording) return;
    stopRecording();
  }, [isVoiceRecording, stopRecording]);

  const cancelVoice = useCallback(() => {
    if (silenceTimerRef.current) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    abortRecording();
    setVoiceRecording(false);
    setVoiceTranscript('');
    setShowVoiceEmpty(false);
  }, [abortRecording, setVoiceRecording, setVoiceTranscript, setShowVoiceEmpty]);

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

  // Cleanup timers on unmount.
  useEffect(() => {
    return () => {
      if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current);
      if (emptyTimerRef.current) window.clearTimeout(emptyTimerRef.current);
    };
  }, []);

  const switchMode = useCallback(
    (next: 'text' | 'voice') => {
      if (isVoiceRecording) {
        cancelVoice();
      }
      setMode(next);
    },
    [isVoiceRecording, cancelVoice],
  );

  const modeToggleButton = (
    <motion.button
      type="button"
      whileTap={{ scale: 0.9 }}
      onClick={() => switchMode(mode === 'text' ? 'voice' : 'text')}
      disabled={sendDisabled}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-warm-white/60 transition-colors hover:bg-white/5 hover:text-warm-white"
      aria-label={mode === 'text' ? '切换到语音输入' : '切换到键盘输入'}
      title={mode === 'text' ? '切换到语音输入' : '切换到键盘输入'}
    >
      {mode === 'text' ? (
        // Microphone icon
        <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 11a7 7 0 01-14 0M12 15a3 3 0 003-3V6a3 3 0 00-6 0v6a3 3 0 003 3z"
          />
        </svg>
      ) : (
        // Keyboard icon
        <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path strokeLinecap="round" d="M7 10h.01M10 10h.01M13 10h.01M16 10h.01M7 14h10" />
        </svg>
      )}
    </motion.button>
  );

  return (
    <div
      className="flex items-center gap-2 rounded-full px-4 py-2"
      style={{
        background: 'rgba(15, 12, 9, 0.65)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        boxShadow: '0 4px 24px rgba(0, 0, 0, 0.3)',
      }}
    >
      <div className="relative min-w-0 flex-1">
        <AnimatePresence mode="wait" initial={false}>
          {mode === 'text' ? (
            <motion.div
              key="text"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex items-center gap-2"
            >
              <ChatInput
                inputRef={inputRef}
                sendDisabled={sendDisabled}
                onSend={onSend}
              />
            </motion.div>
          ) : (
            <motion.div
              key="voice"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <button
                type="button"
                className={`voice-hold-btn flex w-full items-center justify-center gap-3 rounded-full py-2 text-sm outline-none transition-colors select-none ${
                  isVoiceRecording ? 'voice-recording' : ''
                } ${showVoiceEmpty ? 'voice-empty' : ''}`}
                style={{
                  color: showVoiceEmpty
                    ? 'rgba(232, 96, 96, 0.9)'
                    : 'rgba(232, 221, 208, 0.85)',
                }}
                disabled={sendDisabled || !isSupported}
                aria-label={isVoiceRecording ? '正在录音，松开结束' : '按住说话'}
                onMouseDown={(e) => {
                  e.preventDefault();
                  startVoice();
                }}
                onMouseUp={(e) => {
                  e.preventDefault();
                  stopVoice();
                }}
                onMouseLeave={(e) => {
                  if (isVoiceRecording) {
                    e.preventDefault();
                    stopVoice();
                  }
                }}
                onTouchStart={(e) => {
                  e.preventDefault();
                  startVoice();
                }}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  stopVoice();
                }}
              >
                {isVoiceRecording ? (
                  <>
                    <span className="pointer-events-none shrink-0">
                      <VoiceWaveform />
                    </span>
                    <span className="pointer-events-none shrink-0 text-xs tracking-wide">
                      按住说话（按 ESC 取消）
                    </span>
                  </>
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
      </div>

      {modeToggleButton}
    </div>
  );
}
