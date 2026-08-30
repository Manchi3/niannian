import { useState, useEffect, useCallback, useRef, type KeyboardEvent, type RefObject } from 'react';
import { motion } from 'framer-motion';

/**
 * Props for the ChatInput component.
 */
interface ChatInputProps {
  /** Ref to the underlying textarea (owned by the parent for re-focus). */
  inputRef?: RefObject<HTMLTextAreaElement>;
  /**
   * Whether ONLY the send button is disabled while the input stays editable.
   * Used during streaming + typewriter — the user may keep typing the next
   * message but cannot send until the current reply is fully handled.
   */
  sendDisabled?: boolean;
  /** Callback when the user sends a message. */
  onSend?: (text: string) => void;
}

/**
 * Round 28 (②B): empty-state placeholder copy that rotates every 4s with a
 * soft cross-fade, set in 楷体 (KaiTi). Implemented as an overlay <span>
 * (NOT the native placeholder attr) so we control the font + fade
 * independently. The native placeholder is left empty to avoid overlap.
 */
const PLACEHOLDERS = [
  '像发消息一样，随便说说…',
  '想到什么，就跟我聊什么…',
];

/**
 * ChatInput — inline message input field with send button.
 *
 * The textarea is NEVER disabled: during streaming/typing only the send
 * button is blocked, so the input keeps focus and the user can keep typing
 * without clicking (Round 23 fix for lost focus after Enter-to-send).
 */
export default function ChatInput({
  inputRef,
  sendDisabled = false,
  onSend,
}: ChatInputProps): React.ReactElement {
  const [text, setText] = useState('');
  // Round 28 (②B): which placeholder line is shown + whether it's mid-fade.
  const [phIndex, setPhIndex] = useState(0);
  const [phVisible, setPhVisible] = useState(true);

  /**
   * Rotate the placeholder every 4s: fade out (300ms) → swap text → fade in.
   * ROTATION CONTINUES even while the input is focused but empty; it only
   * pauses visually when the user has typed something (span is hidden).
   */
  useEffect(() => {
    let alive = true;
    const id = setInterval(() => {
      setPhVisible(false);
      window.setTimeout(() => {
        if (!alive) return;
        setPhIndex((i) => (i + 1) % PLACEHOLDERS.length);
        setPhVisible(true);
      }, 300);
    }, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  /**
   * Send the current text and clear the input, then re-focus immediately.
   */
  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || sendDisabled) return;
    onSend?.(trimmed);
    setText('');
    // Re-focus right after send so the user can keep typing without the mouse.
    inputRef?.current?.focus();
  }, [text, sendDisabled, onSend, inputRef]);

  /**
   * Handle keyboard events: Enter to send, Shift+Enter for newline.
   * preventDefault stops the form default submit (would blur / jump).
   */
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const sendBlocked = sendDisabled || !text.trim();
  // Show the custom placeholder only when the field is empty (focus or not).
  const showPlaceholder = text.length === 0;

  return (
    <>
      <div className="relative flex-1">
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder=""
          className="w-full resize-none bg-transparent px-2 py-2 text-sm placeholder:text-warm-white/30 focus:outline-none"
          style={{
            maxHeight: '80px',
            minHeight: '32px',
            color: 'rgba(232, 221, 208, 0.9)',
          }}
        />
        {showPlaceholder && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute"
            style={{
              left: '0.5rem',
              top: '50%',
              transform: 'translateY(-50%)',
              fontFamily: "'KaiTi', 'STKaiti', 'AR PL UKai CN', 'Noto Serif SC', serif",
              fontSize: '15px',
              color: 'rgba(255, 255, 255, 0.3)',
              opacity: phVisible ? 1 : 0,
              transition: 'opacity 0.3s ease',
            }}
          >
            {PLACEHOLDERS[phIndex]}
          </span>
        )}
      </div>

      {/* Round 28 (②A): transparent circle + up-arrow SVG. Hover fills a soft
          translucent white. All styling lives in .chat-send-btn (index.css);
          the disabled (empty input) state dims to 0.3. */}
      <motion.button
        whileTap={{ scale: 0.92 }}
        onClick={handleSend}
        disabled={sendBlocked}
        className="chat-send-btn flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
        aria-label="发送"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          {/* Up arrow (↑) — Round 19 fix: previously pointed left (←) */}
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 19L12 5M12 5L7 10M12 5L17 10"
          />
        </svg>
      </motion.button>
    </>
  );
}
