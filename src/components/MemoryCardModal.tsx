import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useReviewStore } from '../stores/reviewStore';
import { useDiaryStore } from '../stores/diaryStore';
import { useAppStore } from '../stores/appStore';
import { useChatStore } from '../stores/chatStore';
import { useNavStore } from '../stores/navStore';
import { useDiaryImage } from '../hooks/useDiaryImage';
import { formatDate, formatDateISO, generateId, blobToDataUrl } from '../utils/helpers';
import type { Diary, Message } from '../types';

/**
 * Extract a photo's dominant color (reused from ChatMainView's logic) so the
 * card's outer glow echoes the picture's mood. Same-origin data URLs never
 * taint the canvas, so this is safe for OPFS-resolved object URLs too.
 */
function extractDominantColor(src: string): Promise<{ r: number; g: number; b: number }> {
  return new Promise((resolve) => {
    const fallback = { r: 212, g: 168, b: 83 };
    const img = new Image();
    img.onload = () => {
      try {
        const size = 50;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(fallback);
          return;
        }
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);
        let r = 0;
        let g = 0;
        let b = 0;
        let count = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 128) continue; // skip transparent pixels
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          count += 1;
        }
        if (count === 0) {
          resolve(fallback);
          return;
        }
        resolve({
          r: Math.round(r / count),
          g: Math.round(g / count),
          b: Math.round(b / count),
        });
      } catch {
        resolve(fallback);
      }
    };
    img.onerror = () => resolve(fallback);
    img.src = src;
  });
}

/** A single chat bubble — AI left (deep translucent), user right (brighter). */
function ChatBubble({ msg }: { msg: Message }): React.ReactElement {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className="max-w-[85%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed"
        style={{
          background: isUser ? 'rgba(255, 255, 255, 0.13)' : 'rgba(255, 255, 255, 0.05)',
          border: `1px solid ${
            isUser ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.06)'
          }`,
          color: isUser ? 'rgba(245, 235, 222, 0.92)' : 'rgba(232, 221, 208, 0.78)',
        }}
      >
        {msg.content}
      </div>
    </div>
  );
}

/**
 * Round 53: directional paging slide. `custom` carries the paging direction
 * (+1 = next / -1 = prev) so the outgoing content slides the correct way and
 * the incoming content enters from the opposite side. Used with
 * AnimatePresence mode="wait".
 */
const slideVariants = {
  enter: (d: number): { opacity: number; x: number } => ({
    opacity: 0,
    x: d > 0 ? 48 : -48,
  }),
  center: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.32, ease: 'easeOut' as const },
  },
  exit: (d: number): { opacity: number; x: number; transition: { duration: number; ease: string } } => ({
    opacity: 0,
    x: d > 0 ? -48 : 48,
    transition: { duration: 0.28, ease: 'easeIn' as const },
  }),
};

/**
 * MemoryCardModal — the "记忆手卷" memory-scroll card.
 *
 * A centered two-column card (photo left, info right) that pops over a
 * blurred, darkened diary list. Replaces the old DiaryView (reviewing) and
 * the gallery detail modal. Supports:
 *   - left/right ‹ › arrows + keyboard arrows to page through diaries (loop)
 *   - close via ✕ / backdrop click / Esc (scale 0.96 + fade 200ms out)
 *   - delete with a second confirm (reuses diaryStore.deleteDiary)
 *   - "重温这一天" — restores the diary's conversation into the chat view
 *     (conversationId + image + full chat history) so the user can keep talking
 */
export default function MemoryCardModal(): React.ReactElement {
  const open = useReviewStore((s) => s.open);
  const diaryId = useReviewStore((s) => s.diaryId);
  const closeCard = useReviewStore((s) => s.closeCard);
  const setDiaryId = useReviewStore((s) => s.setDiaryId);
  const diaryList = useDiaryStore((s) => s.diaryList);
  const deleteDiary = useDiaryStore((s) => s.deleteDiary);

  const diary = useMemo(
    () => diaryList.find((d) => d.id === diaryId) ?? null,
    [diaryList, diaryId],
  );
  const { url: imageUrl } = useDiaryImage(diary);

  const index = diaryList.findIndex((d) => d.id === diaryId);
  const total = diaryList.length;

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [glow, setGlow] = useState<{ r: number; g: number; b: number } | null>(null);
  // Round 53: direction of the paging slide (+1 next / -1 prev).
  const [direction, setDirection] = useState(1);

  const goPrev = useCallback(() => {
    if (total === 0) return;
    setDirection(-1);
    const next = (index - 1 + total) % total;
    setDiaryId(diaryList[next].id);
  }, [index, total, diaryList, setDiaryId]);

  const goNext = useCallback(() => {
    if (total === 0) return;
    setDirection(1);
    const next = (index + 1) % total;
    setDiaryId(diaryList[next].id);
  }, [index, total, diaryList, setDiaryId]);

  const handleDelete = useCallback(async () => {
    if (!diary) return;
    await deleteDiary(diary.id);
    setConfirmDelete(false);
    closeCard(); // list empties itself (DiaryList shows the empty state)
  }, [diary, deleteDiary, closeCard]);

  /**
   * 重温这一天 — hand the diary's full conversation back to the chat view:
   *   - restore the SAME conversationId (no new round → history stays linked)
   *   - set the original image (OPFS → dataURL) so the particle glow returns
   *   - load the complete chatHistory into chatStore
   *   - keep currentDiary so the 日记 tab still shows the condensed diary
   * The conversationId change re-keys <ChatMainView>, remounting it clean
   * (local state resets, showList drops) — exactly the fresh-but-prefilled
   * state we want.
   */
  const reviewDiary = useCallback(
    async (d: Diary) => {
      let dataUrl: string | null = null;
      let blob: Blob | null = null;
      try {
        blob = await useDiaryStore.getState().getOriginalImage(d);
        if (blob && blob.size > 0) dataUrl = await blobToDataUrl(blob);
      } catch {
        // no original image — still allow reviewing (just no background glow)
      }
      useChatStore.setState({
        // Round 54: mark every restored history message as already-typed so
        // the typewriter never replays on review (逐字不重播).
        messages: (d.chatHistory ?? []).map((m) => ({ ...m, typed: true })),
        streamingContent: '',
        isStreaming: false,
      });
      useAppStore.setState({
        conversationId: d.conversationId ?? generateId(),
        currentImageDataUrl: dataUrl,
        currentImageBlob: blob,
        phase: 'chatting',
        viewTab: 'chat',
        textDisplayMode: 'full',
        errorMessage: null,
        // Round 54: keep the chat text hidden until the picture forms at
        // NORMAL speed (no fast-forward), then it fades in per-bubble
        // (see ChatMainView + ChatPanel). The picture always forms ONCE.
        messageRevealPending: true,
      });
      useDiaryStore.setState({ currentDiary: d });
      closeCard();
      useNavStore.getState().goTo('chat');
    },
    [closeCard],
  );

  // Keyboard: Esc closes, ← / → page through diaries (loop).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (confirmDelete) setConfirmDelete(false);
        else closeCard();
      } else if (e.key === 'ArrowLeft') {
        goPrev();
      } else if (e.key === 'ArrowRight') {
        goNext();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, confirmDelete, closeCard, goPrev, goNext]);

  // Outer glow echoes the photo's dominant color (brand gold fallback).
  useEffect(() => {
    setGlow(null);
    if (imageUrl) {
      void extractDominantColor(imageUrl).then(setGlow).catch(() => undefined);
    }
  }, [imageUrl]);

  const messages = diary?.chatHistory ?? [];
  const rounds = messages.filter((m) => m.role === 'user').length;
  const stamp = diary?.createdAt || (diary ? Date.parse(diary.date) : 0) || Date.now();

  return (
    <AnimatePresence>
      {open && diary && (
        <motion.div
          key="memory-card-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-center justify-center px-14"
          style={{
            background: 'rgba(8, 6, 5, 0.72)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
          }}
          onClick={closeCard}
        >
          {/* Paging arrows — FIXED to the screen edges, above the card. They
              sit on the dark backdrop, well outside the card, and only show
              when there is more than one diary. */}
          {total > 1 && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  goPrev();
                }}
                aria-label="上一篇"
                className="fixed left-7 top-1/2 z-[60] flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full text-3xl leading-none transition-colors hover:bg-black/70"
                style={{
                  background: 'rgba(0, 0, 0, 0.5)',
                  border: '1px solid rgba(255, 255, 255, 0.14)',
                  color: 'rgba(232, 221, 208, 0.85)',
                }}
              >
                ‹
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  goNext();
                }}
                aria-label="下一篇"
                className="fixed right-7 top-1/2 z-[60] flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full text-3xl leading-none transition-colors hover:bg-black/70"
                style={{
                  background: 'rgba(0, 0, 0, 0.5)',
                  border: '1px solid rgba(255, 255, 255, 0.14)',
                  color: 'rgba(232, 221, 208, 0.85)',
                }}
              >
                ›
              </button>
            </>
          )}

          {/* Card — horizontal: wide > tall. Centered by the overlay flex. */}
          <motion.div
            key="memory-card"
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
            className="relative flex overflow-hidden rounded-[20px]"
            style={{
              // Round 55: lock a strict 3:2 landscape card. Height is derived
              // from aspect-ratio (no explicit height), and the width is also
              // capped by viewport height so short / narrow screens scale the
              // whole card down proportionally instead of overflowing. Card
              // footprint scaled down ~16-20% from the previous 1100px cap
              // so it floats more comfortably on large screens.
              aspectRatio: '3 / 2',
              width: 'min(920px, 86vw, calc(72vh * 1.5))',
              background: 'rgba(20, 16, 12, 0.92)',
              border: '1px solid rgba(212, 168, 83, 0.15)',
              boxShadow: glow
                ? `0 0 60px rgba(${glow.r}, ${glow.g}, ${glow.b}, 0.18), 0 20px 60px rgba(0, 0, 0, 0.6)`
                : '0 0 60px rgba(212, 168, 83, 0.12), 0 20px 60px rgba(0, 0, 0, 0.6)',
            }}
          >
            {/* Directional paging slide — key on diary id, mode="wait" so the
                outgoing content slides out before the incoming slides in. */}
            <AnimatePresence mode="wait" custom={direction} initial={false}>
              <motion.div
                key={diary.id}
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                className="flex w-full"
                style={{ height: '100%' }}
              >
                {/* Left column — photo (≈42%), blurred backdrop + full contain image */}
                <div
                  className="relative shrink-0 overflow-hidden"
                  style={{
                    width: '42%',
                    minHeight: '100%',
                    background: '#0d0a08',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {/* Blurred, scaled copy of the SAME photo fills the empty
                      margins so contain's letterboxing looks intentional. */}
                  {imageUrl && (
                    <div
                      aria-hidden="true"
                      style={{
                        position: 'absolute',
                        inset: 0,
                        backgroundImage: `url("${imageUrl}")`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        filter: 'blur(30px) brightness(0.55) saturate(1.05)',
                        transform: 'scale(1.15)',
                      }}
                    />
                  )}
                  {imageUrl ? (
                    <img
                      src={imageUrl}
                      alt={diary.title}
                      className="relative z-[1] block max-h-full max-w-full object-contain"
                      draggable={false}
                    />
                  ) : (
                    // No original image → warm gradient placeholder
                    <div
                      className="absolute inset-0 z-[1]"
                      style={{
                        background:
                          'linear-gradient(135deg, rgba(212,168,83,0.22), rgba(232,221,208,0.06) 60%, rgba(20,16,12,0.4))',
                      }}
                    />
                  )}
                  {/* Page index capsule — top-left, above everything */}
                  <div
                    className="absolute left-3 top-3 z-[2] rounded-full px-2.5 py-1 font-mono text-[11px]"
                    style={{
                      background: 'rgba(8, 6, 5, 0.55)',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      color: 'rgba(232, 221, 208, 0.85)',
                    }}
                  >
                    {index + 1} / {total}
                  </div>
                </div>

                {/* Right column — info (≈58%) */}
                <div
                  className="flex min-h-0 flex-col"
                  style={{ width: '58%', padding: '22px 24px' }}
                >
                  {/* Top row — meta + delete / close */}
                  <div className="flex items-center justify-between">
                    <span className="text-[11px]" style={{ color: 'rgba(232, 221, 208, 0.45)' }}>
                      记忆手卷 · 收录于 {formatDateISO(stamp)}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setConfirmDelete(true)}
                        aria-label="删除"
                        title="删除"
                        className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-red-500/20"
                        style={{ color: 'rgba(232, 221, 208, 0.4)' }}
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                        </svg>
                      </button>
                      <button
                        onClick={closeCard}
                        aria-label="关闭"
                        title="关闭"
                        className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-white/10"
                        style={{ color: 'rgba(232, 221, 208, 0.4)' }}
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Title */}
                  <h2
                    className="mt-2.5 font-serif text-[21px] font-medium leading-snug"
                    style={{ color: 'rgba(232, 221, 208, 0.95)' }}
                  >
                    {diary.title}
                  </h2>

                  {/* Date row — gold calendar */}
                  <div
                    className="mt-1.5 flex items-center gap-2 text-[13px]"
                    style={{ color: 'rgba(201, 168, 106, 0.9)' }}
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0V11.25c0-.621.504-1.125 1.125-1.125h16.5c.621 0 1.125.504 1.125 1.125v7.5" />
                    </svg>
                    那天是 {formatDate(stamp)}
                  </div>

                  {/* Conversation history + 星卷日记 block — one scrollable
                      stream. The diary block is the LAST child, so it always
                      sits directly under the final chat bubble and scrolls
                      with the wheel (never pinned to the bottom). The 重温 /
                      已成念 controls below stay fixed at the column's bottom. */}
                  <div
                    className="mt-3 flex flex-1 min-h-0 flex-col gap-2 overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  >
                    {messages.length > 0 ? (
                      messages.map((m) => <ChatBubble key={m.id} msg={m} />)
                    ) : (
                      <p
                        className="rounded-lg border border-dashed px-3 py-6 text-center text-xs"
                        style={{
                          borderColor: 'rgba(255, 255, 255, 0.1)',
                          color: 'rgba(232, 221, 208, 0.35)',
                        }}
                      >
                        这段对话没有被完整保存
                      </p>
                    )}

                    {/* 星卷日记 block — end of the scroll stream */}
                    <div
                      className="mt-1 rounded-xl p-3.5"
                      style={{
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        background: 'rgba(255, 255, 255, 0.02)',
                      }}
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-[11px]" style={{ color: 'rgba(212, 168, 83, 0.85)' }}>
                          ✦ 星卷日记
                        </span>
                        <span className="text-[11px]" style={{ color: 'rgba(232, 221, 208, 0.4)' }}>
                          {formatDate(stamp)}
                        </span>
                      </div>
                      <p
                        className="whitespace-pre-wrap"
                        style={{
                          color: 'rgba(232, 221, 208, 0.85)',
                          lineHeight: 1.9,
                          fontSize: '13px',
                        }}
                      >
                        {diary.content}
                      </p>
                    </div>
                  </div>

                  {/* 重温这一天 — pinned to the column bottom (does not scroll) */}
                  <button
                    onClick={() => void reviewDiary(diary)}
                    className="mt-3 w-full rounded-full py-2.5 text-center text-sm font-medium transition-all hover:brightness-105"
                    style={{ background: 'rgba(245, 230, 200, 0.95)', color: '#1b140f' }}
                  >
                    重温这一天
                  </button>

                  {/* 已成念 · N 轮对话 capsule — pinned to the column bottom */}
                  <div
                    className="mt-2.5 self-start rounded-full border px-3 py-1 text-[11px]"
                    style={{
                      borderColor: 'rgba(212, 168, 83, 0.5)',
                      color: 'rgba(212, 168, 83, 0.9)',
                    }}
                  >
                    已成念 · {rounds} 轮对话
                  </div>
                </div>

                {/* Delete confirmation overlay (inside the card) */}
                <AnimatePresence>
                  {confirmDelete && (
                    <motion.div
                      key="confirm"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="absolute inset-0 z-10 flex items-center justify-center"
                      style={{ background: 'rgba(8, 6, 5, 0.82)' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDelete(false);
                      }}
                    >
                      <div
                        className="rounded-2xl p-6 text-center"
                        style={{
                          background: 'rgba(20, 16, 12, 0.96)',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <p className="font-serif text-lg" style={{ color: 'rgba(232, 221, 208, 0.9)' }}>
                          删掉这篇记忆？
                        </p>
                        <p className="mt-2 text-sm" style={{ color: 'rgba(232, 221, 208, 0.4)' }}>
                          删除后无法恢复
                        </p>
                        <div className="mt-6 flex justify-center gap-4">
                          <button
                            onClick={() => setConfirmDelete(false)}
                            className="rounded-full border px-6 py-2 text-sm"
                            style={{
                              borderColor: 'rgba(255, 255, 255, 0.2)',
                              color: 'rgba(232, 221, 208, 0.6)',
                            }}
                          >
                            取消
                          </button>
                          <button
                            onClick={() => void handleDelete()}
                            className="rounded-full px-6 py-2 text-sm"
                            style={{ background: 'rgba(239, 68, 68, 0.8)', color: '#fff' }}
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
