import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useChatStore } from '../stores/chatStore';
import { useAppStore } from '../stores/appStore';
import ChatInputBar from './ChatInputBar';
import CondenseButton from './CondenseButton';

/**
 * Props for the ChatPanel component.
 */
interface ChatPanelProps {
  /** Callback when the user sends a message. */
  onSend?: (text: string) => void;
  /** Called when the condense button is clicked. */
  onCondense?: () => void;
  /** Whether the condense request is in flight. */
  isCondensing?: boolean;
  /** Whether the current phase allows condensing. */
  canCondense?: boolean;
  /**
   * Round 53: when false, the message area starts hidden (opacity 0) and is
   * meant to fade in after the particle picture finishes forming (review
   * entry). Input bar + condense button are NOT affected by this flag.
   */
  messagesVisible?: boolean;
  /**
   * Round 54: ids of the history messages present when the review gate opens.
   * ONLY these bubbles get the staggered fade-in (opacity + slight rise);
   * messages sent AFTER the reveal appear immediately. Empty for normal
   * entries (no stagger).
   */
  revealIds?: string[];
}

/**
 * Round 22 — Layout metrics (unchanged geometry).
 *
 * Bubble history area (full mode):
 *   - Starts right below the top Tab (top: 112px), ends just above the
 *     input bar (bottom: 104px).
 *   - flex column with justify-content: flex-end → the LATEST message sits
 *     at the very bottom (like a normal chat app); older messages stack
 *     upward. overflow-y: auto lets the user scroll back through history.
 *   - pointer-events: none on the whole area (Round 21: so the particle
 *     canvas underneath receives pointer events — scatter/click work while
 *     hovering over the bubbles). Wheel scrolling over the area is
 *     re-implemented with a capture-phase window listener.
 *
 * Round 22 — visual rework (⑦):
 *   - AI replies: NO bubble container — left-aligned plain serif text.
 *   - User messages: right-aligned translucent pill bubble.
 *   - The LATEST AI reply is revealed with a local typewriter effect
 *     (~35ms/char) with a blinking cursor; during typing the send button is
 *     disabled (input stays editable).
 *   - While the network stream is in flight (before the reply "arrives"),
 *     4 stardust dots float where the answer will appear (⑥).
 */
const BUBBLE_AREA_MAX_W = 'min(56vw, 560px)';
/** Bottom input container max width — spec 图六/图七: ~720px. */
const INPUT_MAX_W = '720px';
/** Top of the bubble history area — just below the 对话/日记 Tab. */
const BUBBLE_TOP = '112px';
/** Bottom of the bubble history area — just above the input bar. */
const BUBBLE_BOTTOM = '104px';
/** Distance from the viewport bottom to the input bar baseline. */
const INPUT_BOTTOM = '24px';
/** Bottom of the single-mode bubble — just above the input bar top. */
const SINGLE_BOTTOM = '104px';

/** Typewriter reveal speed (ms per character). */
const TYPEWRITER_SPEED_MS = 35;

/**
 * TypewriterText — reveals `text` one character at a time (~35ms/char),
 * showing a blinking cursor while typing. Calls onStart() once when it
 * begins and onDone() once when fully revealed. Parent keys this by message
 * id so each message only types once.
 */
function TypewriterText({
  text,
  onStart,
  onTick,
  onDone,
}: {
  text: string;
  onStart?: () => void;
  onTick?: () => void;
  onDone?: () => void;
}): React.ReactElement {
  const [count, setCount] = useState(0);
  const startedRef = useRef(false);
  const doneRef = useRef(false);

  useEffect(() => {
    if (!startedRef.current) {
      startedRef.current = true;
      onStart?.();
    }
    if (count >= text.length) {
      if (!doneRef.current) {
        doneRef.current = true;
        onDone?.();
      }
      return;
    }
    const id = setTimeout(() => {
      setCount((c) => c + 1);
      onTick?.();
    }, TYPEWRITER_SPEED_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, text]);

  return (
    <span>
      {text.slice(0, count)}
      {count < text.length && <span className="typing-cursor" />}
    </span>
  );
}

/**
 * ThinkDots — 4 stardust dots (2 white / 2 gold) drifting inside a
 * 70×28px zone with independent durations/delays (⑥).
 */
function ThinkDots(): React.ReactElement {
  const dots = [
    { size: 5, color: '#ffffff', dur: '2.2s', delay: '0s' },
    { size: 4, color: '#d4a853', dur: '2.8s', delay: '0.3s' },
    { size: 6, color: '#ffffff', dur: '2.4s', delay: '0.6s' },
    { size: 4, color: '#d4a853', dur: '3.1s', delay: '0.9s' },
  ];
  return (
    <div className="think-dots" aria-hidden="true">
      {dots.map((d, i) => (
        <span
          key={i}
          className="think-dot"
          style={{
            width: d.size,
            height: d.size,
            background: d.color,
            animationDuration: d.dur,
            animationDelay: d.delay,
            marginTop: -d.size / 2,
          }}
        />
      ))}
    </div>
  );
}

/**
 * VoiceDraft — the LIVE, non-persisted transcript bubble shown while the user
 * is holding the voice button. Distinct (semi-transparent, with a sound-wave
 * icon + "识别中…" label) from a real user message so the user can tell the
 * difference. It is rendered only from store state — never added to the
 * message list — so it triggers no AI reply and is discarded on ESC.
 */
function VoiceDraft({
  text,
  recording,
}: {
  text: string;
  recording: boolean;
}): React.ReactElement {
  return (
    <div className="voice-draft-bubble">
      <span className="voice-draft-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" d="M4 10v4M8 6v12M12 3v18M16 6v12M20 10v4" />
        </svg>
      </span>
      <div className="voice-draft-body">
        <span className="voice-draft-label">识别中…</span>
        <span className="voice-draft-text">
          {text || ''}
          {recording && <span className="voice-cursor" />}
        </span>
      </div>
    </div>
  );
}

/**
 * ChatPanel — bottom-centered chat overlay over the particle image.
 *
 * Round 21 behavior kept: the overlay is pointer-transparent except the
 * actual controls; full mode renders all history messages bottom-aligned;
 * single mode shows only the latest message pinned above the input.
 */
export default function ChatPanel({
  onSend,
  onCondense,
  isCondensing = false,
  canCondense = false,
  messagesVisible = true,
  revealIds = [],
}: ChatPanelProps): React.ReactElement {
  const { messages, streamingContent, isStreaming } = useChatStore();
  const markTyped = useChatStore((s) => s.markTyped);
  const voiceTranscript = useChatStore((s) => s.voiceTranscript);
  const isVoiceRecording = useChatStore((s) => s.isVoiceRecording);
  const textDisplayMode = useAppStore((s) => s.textDisplayMode);

  // --- Typewriter state: typingId is set while the latest AI reply is being
  // typed out. While typing, sending is disabled (send button only).
  const [typingId, setTypingId] = useState<string | null>(null);
  const isTyping = typingId !== null;
  // Bump on every typewriter tick so the auto-scroll effect re-runs.
  const [, setTick] = useState(0);

  // Auto-scroll the message history container to the latest message.
  const bubbleScrollRef = useRef<HTMLDivElement>(null);

  // --- Re-focus the input after a reply finishes typing, so the user can keep
  //     chatting without clicking the mouse (Round 23 fix). Only steals focus
  //     when the user isn't actively editing another field.
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const focusInput = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const active = document.activeElement as HTMLElement | null;
    const editing =
      active instanceof HTMLElement &&
      (active.tagName === 'TEXTAREA' ||
        active.tagName === 'INPUT' ||
        active.isContentEditable);
    if (active === document.body || !editing) {
      el.focus();
    }
  }, []);
  useEffect(() => {
    const el = bubbleScrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, streamingContent, textDisplayMode, typingId, messagesVisible]);

  // full mode → ALL messages; single mode → only the last one
  const historyMessages =
    textDisplayMode === 'full'
      ? messages
      : textDisplayMode === 'single'
        ? messages.slice(-1)
        : [];

  const lastMessage = historyMessages.length > 0
    ? historyMessages[historyMessages.length - 1]
    : null;

  // The typewriter only runs for the LATEST assistant message AND only if it
  // has not already been revealed (Round 23: `typed` flag prevents replay
  // when ChatPanel is remounted after a view switch — the global chatStore
  // keeps `typed`, so completed messages render as plain text immediately).
  const isLatestAssistant = (msgId: string, role: string): boolean =>
    role === 'assistant' && msgId === lastMessage?.id;

  const shouldTypewrite = (msgId: string, role: string, typed?: boolean): boolean =>
    !typed && isLatestAssistant(msgId, role);

  // Pure opacity fade — no transform, so nothing ever shifts sideways.
  const fadeProps = {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: { duration: 0.25, ease: 'easeOut' as const },
  };

  // Round 21 — Wheel scroll compensation.
  useEffect(() => {
    if (textDisplayMode !== 'full') return;
    const el = bubbleScrollRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent): void => {
      const rect = el.getBoundingClientRect();
      if (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      ) {
        return; // outside the bubble history → normal wheel behavior
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      el.scrollTop += e.deltaY;
    };

    window.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () => {
      window.removeEventListener('wheel', onWheel, { capture: true });
    };
  }, [textDisplayMode]);

  // Round 21: the condense button appears when the phase allows it, enough
  // conversation exists, AND text is not hidden.
  const showCondense = canCondense && messages.length >= 2 && textDisplayMode !== 'hidden';
  // The input bar is hidden in 'hidden' mode (pure particle view).
  const showInput = textDisplayMode !== 'hidden';

  return (
    <>
      {/* === Message Area — fixed geometry, pointer-transparent.
          full: bottom-aligned scrollable history.
          single: empty here (the single bubble is pinned above the input).
          hidden: empty. */}
      <div
        className="pointer-events-none fixed left-1/2 z-20 w-full -translate-x-1/2"
        style={{
          top: BUBBLE_TOP,
          bottom: BUBBLE_BOTTOM,
          maxWidth: BUBBLE_AREA_MAX_W,
          boxSizing: 'border-box',
          paddingLeft: '1rem',
          paddingRight: '1rem',
          // Round 55: the wrapper stays fully opaque; the per-bubble motion
          // below carries the hide/reveal (gated on `messagesVisible`), so the
          // whole block never fades as one — only individual bubbles stagger.
          opacity: 1,
          transition: 'none',
        }}
        aria-hidden={textDisplayMode === 'hidden'}
      >
        <div
          ref={bubbleScrollRef}
          className="flex h-full w-full flex-col gap-3 overflow-y-auto"
          style={{ scrollbarGutter: 'stable' }}
        >
          {/* Spacer that pushes the message stack to the bottom */}
          <div className="mt-auto shrink-0" aria-hidden="true" />
          <AnimatePresence initial={false}>
            {/* full mode — every message, AI left / user right, oldest on
                top, latest at the bottom. History messages loaded via the
                review gate (ids in `revealIds`) fade in one-by-one with a
                slight upward rise + 60ms stagger; everything else (normal
                entry, or messages sent after the reveal) appears instantly. */}
            {textDisplayMode === 'full' &&
              historyMessages.map((msg) => {
                const typewriter = shouldTypewrite(msg.id, msg.role, msg.typed);
                const isReveal = revealIds.includes(msg.id);
                const revealIndex = isReveal ? revealIds.indexOf(msg.id) : 0;
                return (
                  <motion.div
                    key={msg.id}
                    // Round 55: visibility is gated on `messagesVisible`
                    // (synchronous, derived from messageRevealPending) so text
                    // never paints before the particle picture finishes. Only
                    // the STAGGER timing uses revealIds; the hidden/shown state
                    // no longer depends on it.
                    initial={messagesVisible ? false : { opacity: 0, y: 12 }}
                    animate={
                      messagesVisible
                        ? { opacity: 1, y: 0 }
                        : { opacity: 0, y: 12 }
                    }
                    transition={
                      messagesVisible && isReveal
                        ? {
                            duration: 0.45,
                            delay: revealIndex * 0.06,
                            ease: 'easeOut' as const,
                          }
                        : { duration: 0 }
                    }
                    className={`max-w-[85%] shrink-0 ${
                      msg.role === 'user' ? 'self-end' : 'self-start'
                    }`}
                  >
                    {msg.role === 'user' ? (
                      <div className="user-bubble">{msg.content}</div>
                    ) : (
                      <div className="ai-reply-text">
                        {typewriter ? (
                          <TypewriterText
                            text={msg.content}
                            onStart={() => setTypingId(msg.id)}
                            onTick={() => setTick((t) => t + 1)}
                            onDone={() => {
                              markTyped(msg.id);
                              setTypingId((cur) => (cur === msg.id ? null : cur));
                              focusInput();
                            }}
                          />
                        ) : (
                          msg.content
                        )}
                      </div>
                    )}
                  </motion.div>
                );
              })}

            {/* Voice input draft bubble (full mode) — shows the live
                interim transcript while the user is holding the voice button.
                Non-persisted; never triggers an AI reply. */}
            {textDisplayMode === 'full' && (isVoiceRecording || voiceTranscript) && (
              <motion.div
                key="voice-draft"
                {...fadeProps}
                className="max-w-[85%] shrink-0 self-end"
              >
                <VoiceDraft text={voiceTranscript} recording={isVoiceRecording} />
              </motion.div>
            )}

            {/* Thinking-state stardust dots (full mode) — shown while the
                reply is still arriving from the network. */}
            {textDisplayMode === 'full' && isStreaming && (
              <motion.div
                key="thinking"
                {...fadeProps}
                className="shrink-0 self-start"
              >
                <ThinkDots />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* === Single-mode bubble — pinned just above the input bar ===
          Round 22: while the AI is replying show the stardust dots at the
          answer position; once the reply arrives, type it out (AI) or show
          it plainly (user). */}
      {textDisplayMode === 'single' && (
        <div
          className="pointer-events-none fixed left-1/2 z-20 w-full -translate-x-1/2"
          style={{
            bottom: SINGLE_BOTTOM,
            maxWidth: BUBBLE_AREA_MAX_W,
            boxSizing: 'border-box',
            paddingLeft: '1rem',
            paddingRight: '1rem',
            opacity: messagesVisible ? 1 : 0,
            transition: 'opacity 0.7s ease-out',
          }}
        >
          {isVoiceRecording || voiceTranscript ? (
            <div className="ml-auto max-w-[85%]">
              <VoiceDraft text={voiceTranscript} recording={isVoiceRecording} />
            </div>
          ) : isStreaming ? (
            <div className="mr-auto">
              <ThinkDots />
            </div>
          ) : lastMessage ? (
            <div
              className={`max-w-[85%] ${
                lastMessage.role === 'user' ? 'ml-auto' : 'mr-auto'
              }`}
            >
              {lastMessage.role === 'user' ? (
                <div className="user-bubble">{lastMessage.content}</div>
              ) : (
                <div className="ai-reply-text">
                  {shouldTypewrite(lastMessage.id, lastMessage.role, lastMessage.typed) ? (
                    <TypewriterText
                      text={lastMessage.content}
                      onStart={() => setTypingId(lastMessage.id)}
                      onTick={() => setTick((t) => t + 1)}
                      onDone={() => {
                        markTyped(lastMessage.id);
                        setTypingId((cur) => (cur === lastMessage.id ? null : cur));
                        focusInput();
                      }}
                    />
                  ) : (
                    lastMessage.content
                  )}
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* === Bottom Input + Condense container — viewport-centered, ~720px ===
          Round 57 (图六/图七): a SINGLE container so the "✦ 凝聚记忆" capsule
          and the input bar stay locked in the same box. The capsule is
          right-aligned (justify-end) on a row ABOVE the input, so it never
          jumps when the keyboard/voice input cross-fades underneath it. The
          mode-toggle (🎤/⌨) stays an independent circular button outside the
          bar (handled inside ChatInputBar).
          Pointer-events are disabled only while condensing, so the user can't
          type into the invisible input. */}
      {showInput && (
        <div
          className="fixed bottom-0 left-1/2 z-20 w-full -translate-x-1/2"
          style={{
            maxWidth: INPUT_MAX_W,
            bottom: INPUT_BOTTOM,
            paddingLeft: '1rem',
            paddingRight: '1rem',
            boxSizing: 'border-box',
            pointerEvents: isCondensing ? 'none' : 'auto',
          }}
        >
          {/* Condense capsule — top-right, directly above the input bar. */}
          {showCondense && (
            <div
              className="mb-3 flex justify-end"
              style={{ pointerEvents: isCondensing ? 'none' : 'auto' }}
            >
              <CondenseButton
                onClick={onCondense}
                isLoading={isCondensing}
                isThinking={isStreaming}
              />
            </div>
          )}
          <ChatInputBar
            inputRef={inputRef}
            sendDisabled={isStreaming || isTyping}
            onSend={onSend}
          />
        </div>
      )}
    </>
  );
}
