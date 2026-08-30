import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuthStore } from '../stores/authStore';
import { useNavStore } from '../stores/navStore';
import { useToastStore } from '../stores/toastStore';
import { formatDotDateTime } from '../utils/helpers';
import type { Memory } from '../types';

/**
 * MemoryModal — long-term memory window (P0-13 / P0-14).
 * Rendered via createPortal(document.body) at z-90.
 *
 * Layout (vertical card, ~40% width / ~75% height):
 *   - Header: "WHAT NIANNIAN REMEMBERS · 共 N 件" (live count) + ×
 *   - Sub-head: gold ✦ + "小念记得" + muted right caption
 *   - List: gold star + vertical thread, white text, grey meta
 *     ("你亲手写下的 · 2026.08.16 12:52 · 周日")
 *   - Click an item → delete sub-panel: text/meta blurred, capsule button
 *     "按住 让它忘掉"; long-press ~1.2s fills dark red left→right (rAF);
 *     release early cancels; full press deletes (item fades out, count -1).
 *   - Footer: input "告诉小念一件关于你的事..." + gold ↑ send; below the
 *     small grey line "它只会记住你亲口说的，不会替你猜测".
 */

const HOLD_MS = 1200;

export default function MemoryModal(): React.ReactElement {
  const open = useAuthStore((s) => s.memoryOpen);
  const setMemoryOpen = useAuthStore((s) => s.setMemoryOpen);
  const memories = useAuthStore((s) => s.memories);
  const memoriesLoading = useAuthStore((s) => s.memoriesLoading);
  const loadMemories = useAuthStore((s) => s.loadMemories);
  const addMemory = useAuthStore((s) => s.addMemory);
  const deleteMemory = useAuthStore((s) => s.deleteMemory);
  const showToast = useToastStore((s) => s.showToast);

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Load memories each time the window opens.
  useEffect(() => {
    if (open) {
      void loadMemories();
      setText('');
      setExpandedId(null);
    }
  }, [open, loadMemories]);

  // Round Nav: keep the back stack in sync — opening pushes an 'memory'
  // overlay marker, closing removes it (so the Logo "back" can close this
  // modal first).
  useEffect(() => {
    const nav = useNavStore.getState();
    if (open) nav.openOverlay('memory');
    else nav.closeOverlay('memory');
  }, [open]);

  const handleClose = useCallback(() => {
    setMemoryOpen(false);
  }, [setMemoryOpen]);

  const handleSend = useCallback(async () => {
    const t = text.trim();
    if (!t) return;
    setSending(true);
    try {
      await addMemory(t);
      setText('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '保存失败';
      showToast(msg, { kind: 'error', duration: 3500 });
    } finally {
      setSending(false);
    }
  }, [text, addMemory, showToast]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[90] flex items-center justify-center px-4"
          style={{
            background: 'rgba(8, 6, 5, 0.72)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
          }}
          onClick={handleClose}
        >
          <motion.div
            initial={{ scale: 0.96, y: 12, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.96, y: 12, opacity: 0 }}
            transition={{ duration: 0.24, ease: 'easeOut' }}
            className="relative flex w-full max-w-md flex-col overflow-hidden rounded-3xl"
            style={{
              width: 'min(92vw, 420px)',
              height: 'min(78vh, 640px)',
              background: 'rgba(24, 18, 13, 0.98)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              boxShadow: '0 32px 96px rgba(0, 0, 0, 0.6)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 pb-3 pt-5">
              <div className="font-mono text-[11px] uppercase tracking-[0.18em]" style={{ color: 'rgba(212, 168, 83, 0.85)' }}>
                WHAT NIANNIAN REMEMBERS · 共 {memories.length} 件
              </div>
              <button
                type="button"
                onClick={handleClose}
                className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-white/10"
                style={{ color: 'rgba(232, 221, 208, 0.45)' }}
                aria-label="关闭"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Sub-head */}
            <div className="flex items-end justify-between px-6 pb-4">
              <div className="flex items-center gap-2">
                <span style={{ color: 'rgba(212, 168, 83, 0.95)' }}>✦</span>
                <span
                  className="text-xl"
                  style={{ fontFamily: '"KaiTi", "STKaiti", "楷体", serif', color: 'rgba(245, 235, 218, 0.96)' }}
                >
                  小念记得
                </span>
              </div>
              <span className="text-[11px]" style={{ color: 'rgba(232, 221, 208, 0.4)' }}>
                这些是它一直放在心里的、关于你的事
              </span>
            </div>

            {/* Divider */}
            <div style={{ height: 1, background: 'rgba(255, 255, 255, 0.07)' }} />

            {/* List */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {memoriesLoading && memories.length === 0 ? (
                <div className="py-10 text-center text-xs" style={{ color: 'rgba(232, 221, 208, 0.35)' }}>
                  正在翻开它的记忆...
                </div>
              ) : memories.length === 0 ? (
                <div className="py-10 text-center">
                  <div className="text-xs" style={{ color: 'rgba(232, 221, 208, 0.35)' }}>
                    小念还没有关于你的记忆
                  </div>
                  <div className="mt-1 text-[11px]" style={{ color: 'rgba(232, 221, 208, 0.25)' }}>
                    在下面告诉它一件关于你的事吧
                  </div>
                </div>
              ) : (
                <div className="space-y-0">
                  {memories.map((m) => (
                    <MemoryItem
                      key={m.id}
                      memory={m}
                      expanded={expandedId === m.id}
                      onToggle={() => setExpandedId((cur) => (cur === m.id ? null : m.id))}
                      onDelete={async () => {
                        setExpandedId(null);
                        await deleteMemory(m.id);
                      }}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Footer — input + send */}
            <div className="border-t px-6 pb-6 pt-4" style={{ borderColor: 'rgba(255, 255, 255, 0.07)' }}>
              <div className="flex items-center gap-3 rounded-2xl px-4 py-2.5" style={{ background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                      void handleSend();
                    }
                  }}
                  placeholder="告诉小念一件关于你的事..."
                  className="w-full bg-transparent text-sm placeholder:text-warm-white/30"
                  style={{ color: 'rgba(245, 235, 218, 0.92)' }}
                  maxLength={500}
                />
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={sending || !text.trim()}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all hover:opacity-85 disabled:opacity-40"
                  style={{ background: 'rgba(212, 168, 83, 0.95)', color: '#2b2620', boxShadow: '0 4px 14px rgba(212, 168, 83, 0.3)' }}
                  aria-label="发送记忆"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 19V5M12 5L7 10M12 5L17 10" />
                  </svg>
                </button>
              </div>
              <div className="mt-2.5 text-center text-[11px]" style={{ color: 'rgba(232, 221, 208, 0.3)' }}>
                它只会记住你亲口说的，不会替你猜测
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// MemoryItem — star + thread + text + meta, click-to-expand delete sub-panel
// ---------------------------------------------------------------------------

function MemoryItem({
  memory,
  expanded,
  onToggle,
  onDelete,
}: {
  memory: Memory;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => Promise<void>;
}): React.ReactElement {
  const [progress, setProgress] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const rafRef = useRef<number>(0);
  const startRef = useRef<number>(0);
  const progressRef = useRef(0);
  const cancelledRef = useRef(false);

  // Cleanup rAF on unmount.
  useEffect(() => {
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const startPress = useCallback(() => {
    if (deleting) return;
    cancelledRef.current = false;
    progressRef.current = 0;
    setProgress(0);
    startRef.current = performance.now();
    const tick = (now: number): void => {
      if (cancelledRef.current) return;
      const p = Math.min(1, (now - startRef.current) / HOLD_MS);
      progressRef.current = p;
      setProgress(p);
      if (p >= 1) {
        setDeleting(true);
        void onDelete().catch(() => {
          setDeleting(false);
          setProgress(0);
        });
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [deleting, onDelete]);

  const cancelPress = useCallback(() => {
    cancelledRef.current = true;
    cancelAnimationFrame(rafRef.current);
    progressRef.current = 0;
    setProgress(0);
  }, []);

  return (
    <div className="relative">
      {/* Star + vertical thread */}
      <div className="flex gap-3">
        <div className="flex w-3 shrink-0 flex-col items-center">
          <span className="mt-1 text-[10px]" style={{ color: 'rgba(212, 168, 83, 0.9)' }}>
            ✦
          </span>
          <span className="mt-1 w-px flex-1" style={{ background: 'rgba(212, 168, 83, 0.18)' }} />
        </div>

        <button
          type="button"
          onClick={onToggle}
          className="mb-4 w-full rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-white/[0.03]"
        >
          <p
            className="text-sm leading-relaxed"
            style={{
              color: 'rgba(245, 235, 218, 0.92)',
              filter: expanded ? 'blur(3px)' : 'none',
              opacity: expanded ? 0.45 : 1,
              transition: 'filter 0.25s ease, opacity 0.25s ease',
            }}
          >
            {memory.text}
          </p>
          <p
            className="mt-1 text-[11px]"
            style={{
              color: 'rgba(232, 221, 208, 0.4)',
              filter: expanded ? 'blur(2px)' : 'none',
              opacity: expanded ? 0.3 : 1,
              transition: 'filter 0.25s ease, opacity 0.25s ease',
            }}
          >
            {memory.source} · {formatDotDateTime(memory.createdAt)}
          </p>
        </button>
      </div>

      {/* Delete sub-panel */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            <div
              className="mb-4 ml-6 rounded-2xl px-4 py-3.5"
              style={{ background: 'rgba(255, 255, 255, 0.04)', border: '1px solid rgba(255, 255, 255, 0.06)' }}
            >
              <div className="mb-2 text-center text-[11px]" style={{ color: 'rgba(232, 221, 208, 0.4)' }}>
                确定要让小念忘记这条吗？
              </div>
              {/* Hold-to-delete capsule */}
              <button
                type="button"
                disabled={deleting}
                onPointerDown={startPress}
                onPointerUp={cancelPress}
                onPointerLeave={cancelPress}
                onPointerCancel={cancelPress}
                onContextMenu={(e) => e.preventDefault()}
                className="relative w-full select-none overflow-hidden rounded-full py-2.5 text-xs transition-colors"
                style={{
                  background: 'rgba(120, 30, 26, 0.16)',
                  border: '1px solid rgba(180, 60, 50, 0.4)',
                  color: 'rgba(245, 180, 170, 0.95)',
                  touchAction: 'none',
                  WebkitUserSelect: 'none',
                }}
              >
                {/* Dark-red progress fill (left → right) */}
                <span
                  className="absolute left-0 top-0 h-full"
                  style={{
                    width: `${progress * 100}%`,
                    background: 'rgba(140, 30, 24, 0.85)',
                    transition: 'none',
                  }}
                  aria-hidden="true"
                />
                <span className="relative z-10">{deleting ? '正在忘记...' : '按住 让它忘掉'}</span>
              </button>
              <div className="mt-1.5 text-center text-[10px]" style={{ color: 'rgba(232, 221, 208, 0.3)' }}>
                长按约 1.2 秒 · 中途松开可取消
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
