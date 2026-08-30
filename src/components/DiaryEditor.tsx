import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import type { Diary } from '../types';

/**
 * Props for the DiaryEditor component.
 */
interface DiaryEditorProps {
  /** The diary being edited. */
  diary: Diary;
  /** Callback when the user saves the edit. */
  onSave: (updates: { title: string; content: string }) => void;
  /** Callback when the user cancels the edit. */
  onCancel: () => void;
}

/**
 * DiaryEditor — editable form for diary title and content.
 *
 * Provides auto-resizing textareas for both title and content.
 * Save propagates the updated values; Cancel reverts to original.
 */
export default function DiaryEditor({
  diary,
  onSave,
  onCancel,
}: DiaryEditorProps): React.ReactElement {
  const [title, setTitle] = useState(diary.title);
  const [content, setContent] = useState(diary.content);

  /**
   * Handle save — validate and propagate.
   */
  const handleSave = useCallback(() => {
    const trimmedTitle = title.trim();
    const trimmedContent = content.trim();

    if (!trimmedTitle || !trimmedContent) return;

    onSave({ title: trimmedTitle, content: trimmedContent });
  }, [title, content, onSave]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className="relative z-10 mx-auto max-w-2xl px-6 py-12"
    >
      <div className="glass-panel rounded-3xl p-8 md:p-12">
        {/* Title input */}
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={20}
          placeholder="日记标题..."
          className="w-full bg-transparent font-serif text-3xl font-medium text-warm-white/90 focus:outline-none md:text-4xl"
          style={{ color: 'rgba(232, 221, 208, 0.9)' }}
        />

        {/* Divider */}
        <div
          className="my-6 h-px"
          style={{
            background:
              'linear-gradient(to right, rgba(212, 168, 83, 0.3), transparent)',
          }}
        />

        {/* Content textarea */}
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="写下你的日记..."
          className="diary-content w-full resize-none bg-transparent font-serif text-base leading-loose text-warm-white/70 focus:outline-none"
          style={{
            color: 'rgba(232, 221, 208, 0.7)',
            minHeight: '300px',
          }}
        />
      </div>

      {/* Action buttons */}
      <div className="mt-6 flex justify-center gap-4">
        <button
          onClick={onCancel}
          className="rounded-full border px-6 py-2 text-sm transition-colors hover:bg-white/5"
          style={{
            borderColor: 'rgba(255, 255, 255, 0.2)',
            color: 'rgba(232, 221, 208, 0.6)',
          }}
        >
          取消
        </button>
        <button
          onClick={handleSave}
          disabled={!title.trim() || !content.trim()}
          className="rounded-full px-8 py-2 text-sm transition-all"
          style={{
            background:
              !title.trim() || !content.trim()
                ? 'rgba(255, 255, 255, 0.05)'
                : 'rgba(212, 168, 83, 1)',
            color: !title.trim() || !content.trim() ? 'rgba(232, 221, 208, 0.2)' : '#1b140f',
            cursor:
              !title.trim() || !content.trim() ? 'not-allowed' : 'pointer',
          }}
        >
          保存
        </button>
      </div>
    </motion.div>
  );
}
