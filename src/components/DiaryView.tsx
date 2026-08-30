import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import type { Diary } from '../types';
import { formatDate, formatDateISO } from '../utils/helpers';
import DiaryEditor from './DiaryEditor';

/**
 * Props for the DiaryView component.
 */
interface DiaryViewProps {
  /** The diary to display. */
  diary: Diary;
  /** Callback when the user saves an edit. */
  onSave?: (updates: { title: string; content: string }) => void;
  /** Callback when the user clicks "返回" (back). */
  onBack?: () => void;
  /** Whether to show the back button (default: true). */
  showBack?: boolean;
  /** Optional: variant for different layouts.
   *  - 'card'  : glass card centered on screen (default)
   *  - 'inline': bare content without card chrome, used inside 日记 tab.
   */
  variant?: 'card' | 'inline';
}

/**
 * DiaryView — displays a diary with title, date, and content.
 *
 * Round 18:
 *   - variant='inline' renders no card chrome, just the typography stack —
 *     used when DiaryView is embedded inside the 日记 tab content area.
 *   - variant='card'  (default) keeps the original centered glass card
 *     used by the standalone review flow.
 */
export default function DiaryView({
  diary,
  onSave,
  onBack,
  showBack = true,
  variant = 'card',
}: DiaryViewProps): React.ReactElement {
  const [isEditing, setIsEditing] = useState(false);

  // Generate an object URL for the thumbnail so it can be displayed
  // alongside the diary content. Cleaned up on unmount or when diary changes.
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);

  useEffect(() => {
    if (diary.thumbnailBlob && diary.thumbnailBlob.size > 0) {
      const url = URL.createObjectURL(diary.thumbnailBlob);
      setThumbnailUrl(url);
      return () => {
        URL.revokeObjectURL(url);
      };
    }
    setThumbnailUrl(null);
  }, [diary.id, diary.thumbnailBlob]);

  /**
   * Handle save from the editor — propagate to parent and exit edit mode.
   */
  const handleSave = (updates: { title: string; content: string }) => {
    onSave?.(updates);
    setIsEditing(false);
  };

  // --- Edit Mode ---
  if (isEditing) {
    return (
      <DiaryEditor
        diary={diary}
        onSave={handleSave}
        onCancel={() => setIsEditing(false)}
      />
    );
  }

  // Inline variant: no card, no thumbnail above title (keeps image visible
  // behind), typography laid out vertically centered on screen.
  //
  // Round 22 readability rework (①): over the dimmed particle backdrop the
  // diary needs strong contrast — gradient serif title, spaced date line,
  // large body text with heavy shadows, max width 640px centered.
  if (variant === 'inline') {
    const date = new Date(diary.createdAt ? diary.createdAt : Date.parse(diary.date) || Date.now());
    const dateLine = `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
    const paragraphs = (diary.content || '')
      .split(/\n+/)
      .map((p) => p.trim())
      .filter(Boolean);
    const body = paragraphs.length > 0 ? paragraphs : [(diary.content || '').trim()];

    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="relative z-10 mx-auto flex min-h-[70vh] w-full max-w-[640px] flex-col items-center px-6 py-12"
      >
        {showBack && onBack && (
          <button
            onClick={onBack}
            className="absolute left-6 top-6 flex items-center gap-1 text-sm transition-colors hover:text-gold"
            style={{ color: 'rgba(232, 221, 208, 0.4)' }}
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            返回
          </button>
        )}

        {/* Title — gradient serif, filter drop-shadow (NOT text-shadow) */}
        <motion.h1
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="diary-title-gradient"
        >
          {diary.title}
        </motion.h1>

        {/* Date — centered, spaced, flanked by 60px gradient dashes */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.4 }}
          className="mt-6 flex w-full items-center justify-center"
          style={{ gap: '16px' }}
        >
          <span className="diary-date-line" aria-hidden="true" />
          <span className="diary-date-text">{dateLine}</span>
          <span className="diary-date-line diary-date-line-right" aria-hidden="true" />
        </motion.div>

        {/* Content — paragraphs with 28px spacing, heavy shadow */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.6 }}
          className="mt-10 w-full"
        >
          {body.map((paragraph, i) => (
            <p key={i} className="diary-body-paragraph">
              {paragraph}
            </p>
          ))}
        </motion.div>

        {/* Edit button */}
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.4 }}
          onClick={() => setIsEditing(true)}
          className="mt-10 rounded-full border px-6 py-2 text-sm transition-colors hover:bg-white/5"
          style={{
            borderColor: 'rgba(255, 255, 255, 0.2)',
            color: 'rgba(232, 221, 208, 0.6)',
          }}
        >
          编辑
        </motion.button>
      </motion.div>
    );
  }

  // --- Card variant (default; original behavior) ---
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: 'easeOut' }}
      className="relative z-10 mx-auto max-w-2xl px-6 py-12"
    >
      {/* Back button */}
      {showBack && (
        <button
          onClick={onBack}
          className="mb-8 flex items-center gap-1 text-sm transition-colors hover:text-gold"
          style={{ color: 'rgba(232, 221, 208, 0.4)' }}
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 19.5L8.25 12l7.5-7.5"
            />
          </svg>
          返回
        </button>
      )}

      {/* Diary content card with particle-friendly glass styling */}
      <article
        className="rounded-3xl p-8 md:p-12"
        style={{
          // Darker semi-transparent background so particles show through
          // while maintaining text readability
          background: 'rgba(15, 12, 9, 0.55)',
          // Reduced blur (6px vs 12px) to let particle colors bleed through
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          // Subtle gold-tinted border
          border: '1px solid rgba(212, 168, 83, 0.15)',
          // Soft shadow for depth separation from particle background
          boxShadow:
            '0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.03)',
        }}
      >
        {/* Thumbnail image (if available) */}
        {thumbnailUrl && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.15, duration: 0.5 }}
            className="mb-6 flex justify-center"
          >
            <img
              src={thumbnailUrl}
              alt="日记原图缩略图"
              className="rounded-xl object-cover"
              style={{
                width: '80px',
                height: '80px',
                border: '1px solid rgba(212, 168, 83, 0.2)',
                opacity: 0.85,
              }}
            />
          </motion.div>
        )}

        {/* Title */}
        <motion.h1
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.5 }}
          className="font-serif text-3xl font-medium md:text-4xl"
          style={{ color: 'rgba(232, 221, 208, 0.95)' }}
        >
          {diary.title}
        </motion.h1>

        {/* Date */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.5 }}
          className="mt-3 flex items-center gap-3"
        >
          <span
            className="text-sm"
            style={{ color: 'rgba(212, 168, 83, 0.7)' }}
          >
            {formatDateISO(diary.createdAt ? diary.createdAt : Date.parse(diary.date) || Date.now())}
          </span>
          <span className="text-xs" style={{ color: 'rgba(232, 221, 208, 0.25)' }}>
            {formatDate(diary.createdAt || Date.now())}
          </span>
        </motion.div>

        {/* Divider */}
        <motion.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ delay: 0.5, duration: 0.7 }}
          className="my-6 h-px origin-left"
          style={{
            background:
              'linear-gradient(to right, rgba(212, 168, 83, 0.4), transparent)',
          }}
        />

        {/* Content */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.7 }}
          className="diary-content whitespace-pre-wrap font-serif text-base leading-loose"
          style={{ color: 'rgba(232, 221, 208, 0.82)' }}
        >
          {diary.content}
        </motion.div>
      </article>

      {/* Actions */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8, duration: 0.5 }}
        className="mt-6 flex justify-center gap-4"
      >
        <button
          onClick={() => setIsEditing(true)}
          className="rounded-full border px-6 py-2 text-sm transition-colors hover:bg-white/5"
          style={{
            borderColor: 'rgba(255, 255, 255, 0.2)',
            color: 'rgba(232, 221, 208, 0.6)',
          }}
        >
          编辑
        </button>
      </motion.div>
    </motion.div>
  );
}
