import { motion } from 'framer-motion';
import type { Message } from '../types';
import { formatTime } from '../utils/helpers';

/**
 * Props for the ChatMessage component.
 */
interface ChatMessageProps {
  /** The message to render. */
  message: Message;
  /** Whether this message is currently streaming (shows cursor). */
  isStreaming?: boolean;
}

/**
 * ChatMessage — renders a single chat message bubble.
 *
 * AI messages are left-aligned with a subtle gold accent.
 * User messages are right-aligned with a warmer background.
 * Streaming messages show a blinking cursor.
 */
export default function ChatMessage({
  message,
  isStreaming = false,
}: ChatMessageProps): React.ReactElement {
  const isUser = message.role === 'user';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`
          max-w-[80%] rounded-2xl px-4 py-3
          ${isUser
            ? 'bg-warm-white/10 text-warm-white rounded-br-sm'
            : 'bg-white/5 text-warm-white/90 rounded-bl-sm border border-white/5'
          }
        `}
        style={{
          background: isUser
            ? 'rgba(232, 221, 208, 0.1)'
            : 'rgba(255, 255, 255, 0.05)',
        }}
      >
        {/* Message content */}
        <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
          {message.content}
          {isStreaming && (
            <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-gold align-middle" />
          )}
        </p>

        {/* Timestamp */}
        {!isStreaming && (
          <p
            className={`mt-1 text-xs ${
              isUser ? 'text-warm-white/30' : 'text-gold-muted'
            }`}
            style={{
              color: isUser
                ? 'rgba(232, 221, 208, 0.3)'
                : 'rgba(212, 168, 83, 0.4)',
            }}
          >
            {formatTime(message.timestamp)}
          </p>
        )}
      </div>
    </motion.div>
  );
}
