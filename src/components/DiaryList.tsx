import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDiaryStore } from '../stores/diaryStore';
import { formatDate } from '../utils/helpers';
import type { Diary } from '../types';

/**
 * Props for the DiaryList component.
 */
interface DiaryListProps {
  /** Callback when a diary is selected for review. */
  onSelectDiary: (diary: Diary) => void;
  /** Callback when the user wants to create a new diary (go back to upload). */
  onNew?: () => void;
  /** Round 18: callback when the user clicks the top-left 返回 button. */
  onBack?: () => void;
}

/**
 * DiaryList — displays saved diaries in reverse chronological order.
 *
 * Round 18:
 *   - Added an explicit "返回" button at the top-left to close the list
 *     and return to whatever view the user came from (main particle view,
 *     idle upload, etc.) via onBack.
 *   - The "+写新日记" button on the top-right keeps its onNew behavior.
 */
export default function DiaryList({
  onSelectDiary,
  onNew,
  onBack,
}: DiaryListProps): React.ReactElement {
  const { diaryList, loadDiaries, deleteDiary, isLoadingList } = useDiaryStore();
  const [thumbnailUrls, setThumbnailUrls] = useState<Map<string, string>>(new Map());
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Load diaries on mount
  useEffect(() => {
    loadDiaries();
  }, [loadDiaries]);

  // Create object URLs for thumbnails
  useEffect(() => {
    const urls = new Map<string, string>();
    for (const diary of diaryList) {
      if (diary.thumbnailBlob) {
        urls.set(diary.id, URL.createObjectURL(diary.thumbnailBlob));
      }
    }
    setThumbnailUrls(urls);

    // Cleanup object URLs on unmount
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [diaryList]);

  /**
   * Handle diary selection — transition to review phase.
   */
  const handleSelect = useCallback(
    (diary: Diary) => {
      onSelectDiary(diary);
    },
    [onSelectDiary],
  );

  /**
   * Handle delete with confirmation.
   */
  const handleDelete = useCallback(
    async (id: string) => {
      await deleteDiary(id);
      setConfirmDeleteId(null);
    },
    [deleteDiary],
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: 'easeOut' }}
      className="relative z-10 mx-auto max-w-3xl px-6 py-12"
    >
      {/* Top nav row — back (left) + brand (center) + new (right) */}
      <div className="mb-2 flex items-center">
        <button
          onClick={() => onBack?.()}
          className="flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs transition-colors hover:bg-white/5"
          style={{
            borderColor: 'rgba(255, 255, 255, 0.15)',
            color: 'rgba(232, 221, 208, 0.6)',
          }}
          aria-label="返回"
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
      </div>

      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="font-serif text-2xl text-warm-white/80" style={{ color: 'rgba(232, 221, 208, 0.8)' }}>
            我的日记
          </h1>
          <p className="mt-1 text-sm text-warm-white/30">
            {diaryList.length > 0 ? `共 ${diaryList.length} 篇` : '还没有日记'}
          </p>
        </div>

        {/* New diary button */}
        {onNew && (
          <button
            onClick={onNew}
            className="flex items-center gap-2 rounded-full border px-5 py-2 text-sm transition-colors hover:bg-white/5"
            style={{
              borderColor: 'rgba(212, 168, 83, 0.5)',
              color: 'rgba(212, 168, 83, 1)',
            }}
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
                d="M12 4.5v15m7.5-7.5h-15"
              />
            </svg>
            写新日记
          </button>
        )}
      </div>

      {/* Loading state */}
      {isLoadingList && (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-gold/20 border-t-gold" />
        </div>
      )}

      {/* Empty state */}
      {!isLoadingList && diaryList.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="flex flex-col items-center justify-center py-20"
        >
          <svg
            className="mb-4 h-16 w-16 text-warm-white/10"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
            />
          </svg>
          <p className="text-sm text-warm-white/30">还没有日记，上传一张照片开始吧</p>
        </motion.div>
      )}

      {/* Diary list */}
      {!isLoadingList && diaryList.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {diaryList.map((diary, index) => (
            <motion.div
              key={diary.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05, duration: 0.4 }}
              onClick={() => handleSelect(diary)}
              className="group relative flex cursor-pointer items-center gap-4 rounded-2xl border border-white/5 bg-white/5 p-4 transition-all hover:border-gold-muted hover:bg-white/10"
              style={{
                background: 'rgba(255, 255, 255, 0.03)',
                borderColor: 'rgba(255, 255, 255, 0.05)',
              }}
            >
              {/* Thumbnail */}
              <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg">
                {thumbnailUrls.get(diary.id) ? (
                  <img
                    src={thumbnailUrls.get(diary.id)}
                    alt={diary.title}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-white/5">
                    <svg
                      className="h-6 w-6 text-warm-white/20"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M18 18.75h.008v.008H18v-.008z"
                      />
                    </svg>
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="flex-1 overflow-hidden">
                <h3 className="truncate font-serif text-base text-warm-white/80">
                  {diary.title}
                </h3>
                <p className="mt-1 text-xs text-warm-white/30">
                  {formatDate(diary.createdAt)}
                </p>
                <p className="mt-1 line-clamp-2 text-xs text-warm-white/40">
                  {diary.content.slice(0, 60)}...
                </p>
              </div>

              {/* Delete button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDeleteId(diary.id);
                }}
                className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-transparent text-warm-white/20 opacity-0 transition-all hover:bg-red-500/20 hover:text-red-400 group-hover:opacity-100"
                aria-label="删除"
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
                    d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                  />
                </svg>
              </button>
            </motion.div>
          ))}
        </div>
      )}

      {/* Delete confirmation dialog */}
      <AnimatePresence>
        {confirmDeleteId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{
              background: 'rgba(8, 6, 5, 0.8)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
            }}
            onClick={() => setConfirmDeleteId(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="glass-panel mx-6 max-w-sm rounded-2xl p-6 text-center"
            >
              <p className="font-serif text-lg text-warm-white/80">
                确定删除这篇日记吗？
              </p>
              <p className="mt-2 text-sm text-warm-white/40">
                删除后无法恢复
              </p>
              <div className="mt-6 flex justify-center gap-4">
                <button
                  onClick={() => setConfirmDeleteId(null)}
                  className="rounded-full border px-6 py-2 text-sm"
                  style={{
                    borderColor: 'rgba(255, 255, 255, 0.2)',
                    color: 'rgba(232, 221, 208, 0.6)',
                  }}
                >
                  取消
                </button>
                <button
                  onClick={() => handleDelete(confirmDeleteId)}
                  className="rounded-full px-6 py-2 text-sm"
                  style={{
                    background: 'rgba(239, 68, 68, 0.8)',
                    color: '#fff',
                  }}
                >
                  删除
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
