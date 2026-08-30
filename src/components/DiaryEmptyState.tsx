import { motion } from 'framer-motion';
import { useChatStore } from '../stores/chatStore';

interface DiaryEmptyStateProps {
  /** Optional: chat message count to show different copy. */
  messageCount?: number;
}

/**
 * DiaryEmptyState — shown inside the 日记 tab when no diary exists for
 * the current image yet.
 *
 * Guides the user back to the chat view via the tab, and forwards them
 * to the "凝聚记忆" flow once the chat is rich enough.
 */
export default function DiaryEmptyState({
  messageCount,
}: DiaryEmptyStateProps): React.ReactElement {
  const messagesLength = useChatStore((s) => s.messages.length);
  const count = messageCount ?? messagesLength;

  // Friendly copy: encourage after some messages, simpler before
  const guidance =
    count >= 2
      ? '聊得差不多了，可以点右下角的「凝聚记忆」凝合成日记'
      : '去对话里聊聊，再点凝聚记忆生成';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className="relative z-10 mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-6 text-center"
    >
      {/* Quill / paper SVG */}
      <motion.svg
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.1, duration: 0.6 }}
        className="mb-6 h-14 w-14"
        fill="none"
        viewBox="0 0 24 24"
        stroke="rgba(212, 168, 83, 0.55)"
        strokeWidth={1.2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"
        />
      </motion.svg>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.25, duration: 0.5 }}
        className="font-serif text-lg"
        style={{ color: 'rgba(232, 221, 208, 0.78)' }}
      >
        还没有日记
      </motion.p>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.5 }}
        className="mt-3 text-sm leading-relaxed"
        style={{ color: 'rgba(232, 221, 208, 0.45)' }}
      >
        {guidance}
      </motion.p>
    </motion.div>
  );
}
