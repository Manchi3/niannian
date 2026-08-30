import { useEffect, useLayoutEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useSpring,
  useMotionValueEvent,
  animate,
  type PanInfo,
} from 'framer-motion';
import { useDiaryStore } from '../stores/diaryStore';
import { useNavStore } from '../stores/navStore';
import { useChatStore } from '../stores/chatStore';
import { useUiStore } from '../stores/uiStore';
import { formatDate } from '../utils/helpers';
import type { Diary } from '../types';
import { useDiaryImage } from '../hooks/useDiaryImage';
import { useReviewStore } from '../stores/reviewStore';
import AmbientBackground from './AmbientBackground';
import RingCursor from './RingCursor';
import { useAutoHideUI } from '../hooks/useAutoHideUI';
import AuthEntry from './AuthEntry';

/**
 * DiaryGallery — the "回到我的记忆" memory page.
 *
 * Round 42: search below logo + three real view modes + 4s auto-hide.
 * Round 43: particle cloud removed, 3s sync auto-hide (Logo shares the
 *           uiStore flag), filters centered, stack → hover highlight.
 * Round 44:
 *   - Pure-image cards everywhere (no beige caption bars).
 *   - Stack (叠影): precise hover with three-fold hit insurance, spring
 *     transitions + pointer parallax, bottom meta line follows hover.
 *   - Corridor (长廊): pure images + bottom meta line, cover-flow kept.
 *   - Grid (网格): hover floats title/date INSIDE the image (no bg block)
 *     + subtle golden ring glow.
 *   - Custom dot-and-ring cursor (RingCursor) + cursor:none on the page.
 *   - AmbientBackground (halo + floating stars, breathing) — always on,
 *     NOT affected by the 3s chrome auto-hide.
 *   - Filter buttons: dim idle / slightly brighter hover / gold selected.
 */
type Filter = 'all' | 'pending' | 'talking' | 'done';
type ViewMode = 'corridor' | 'stack' | 'grid';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '未开始' },
  { key: 'talking', label: '对话中' },
  { key: 'done', label: '已成念' },
];
const MODES: { key: ViewMode; label: string; icon: string }[] = [
  { key: 'corridor', label: '长廊', icon: 'M3 7h18M3 12h12M3 17h8' },
  { key: 'stack', label: '叠影', icon: 'M5 4h11v16H5zM9 8h11v12' },
  { key: 'grid', label: '网格', icon: 'M3.75 3.75h6.5v6.5h-6.5zM13.75 3.75h6.5v6.5h-6.5zM3.75 13.75h6.5v6.5h-6.5zM13.75 13.75h6.5v6.5h-6.5z' },
];

/** "2026.08.14" — dotted date for the bottom meta line. */
function formatDotDate(ts: number): string {
  const d = new Date(ts);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

/**
 * Round 48 (sharpness): ORIGINAL-image-first rendering. The old thumbnails
 * (~100px) upscaled into 420px cards were the main blur source. useDiaryImage
 * resolves the FULL-SIZE original (OPFS / 'idb:') to an object URL; the
 * ~100px thumbnail is only a transient fallback while the original loads.
 */
function GalleryImage({
  d,
  thumbUrl,
  alt,
}: {
  d: Diary;
  thumbUrl?: string;
  alt: string;
}): React.ReactElement {
  const { url } = useDiaryImage(d);
  const src = url || thumbUrl;
  if (!src) {
    return (
      <div
        className="flex h-full w-full items-center justify-center font-mono text-xs"
        style={{ color: 'rgba(245, 230, 200, 0.5)', background: 'rgba(255, 255, 255, 0.03)' }}
      >
        无缩略图
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      draggable={false}
      decoding="async"
      className="block h-full w-full object-cover"
    />
  );
}

/** Pure image card (Round 48 — fills its parent box; the parent defines the
 *  shape: corridor 420×560, stack 360×460 fixed, grid aspect-ratio 4/3). */
function ImageCard({
  d,
  thumbUrl,
  onClick,
}: {
  d: Diary;
  thumbUrl?: string;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      className="block h-full w-full overflow-hidden rounded-lg text-left"
      style={{
        padding: 0,
        border: 'none',
        background: 'transparent',
      }}
    >
      <GalleryImage d={d} thumbUrl={thumbUrl} alt={d.title} />
    </button>
  );
}

/**
 * Round 48 — measure a stage element (ResizeObserver) so card geometry can
 * adapt to the available space: corridor card height and stack deck bias
 * derive from it. size starts 0 before first measure → callers guard.
 */
function useStageSize(): [React.RefObject<HTMLDivElement>, { w: number; h: number }] {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (): void => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

/** Single bottom meta line shared by corridor + stack (200ms fade/slide). */
function BottomMetaLine({
  d,
  index,
  total,
}: {
  d: Diary | undefined;
  index: number;
  total: number;
}): React.ReactElement {
  return (
    <div
      data-testid="bottom-meta"
      className="pointer-events-auto mt-5 flex h-8 items-center justify-center px-6"
    >
      <AnimatePresence mode="wait">
        {d ? (
          <motion.div
            key={d.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="flex items-center gap-2 whitespace-nowrap font-mono text-xs"
            style={{ color: 'rgba(232, 221, 208, 0.75)' }}
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: 'rgba(212, 168, 83, 0.85)' }} />
            <span style={{ color: 'rgba(245, 230, 200, 0.95)' }}>{d.title}</span>
            <span style={{ color: 'rgba(232, 221, 208, 0.55)' }}>{formatDotDate(d.createdAt)}</span>
            <span style={{ color: 'rgba(232, 221, 208, 0.45)' }}>· {index} / {total} · 点击翻开</span>
          </motion.div>
        ) : (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="font-mono text-xs"
            style={{ color: 'rgba(245, 230, 200, 0.5)' }}
          >
            暂无日记，回到首页上传第一张吧
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Cover-flow (长廊) — Round 47: classic Cover Flow with CLEAR GAPS + drag.
 *   - Card: fixed 320×240 (4:3), spacing 380px per step (380 > 320 →
 *     60px gap, cards never overlap).
 *   - Current card scale 1 / opacity 1 / brightness 1; neighbours scale
 *     0.72, opacity 0.55 (|dist|=1) or 0.25, brightness(0.6).
 *   - zIndex = 100 − |dist|; spring transition (280/26) for buttery wheel
 *     switching.
 *   - Round 47 FIX (jump on wheel at the edges): ALL cards are always
 *     rendered — the old |dist| ≤ 2 culling made boundary cards pop in/out
 *     of the render tree and visibly teleport. dist = i − idx is strictly
 *     LINEAR (no modulo, no wrap-around); far cards just sit off-screen
 *     (stage overflow-hidden).
 *   - Round 47: DRAG to switch — a full-stage drag layer carries
 *     dragX (motion value); on release, offset ≥ 80px flips one step and
 *     the layer springs back to 0. Coexists with the wheel.
 *   - Click a non-current card → switches to it; click the current card →
 *     opens the diary.
 */
const CORRIDOR_CARD_W = 420; // Round 48: 320 → 420
const CORRIDOR_CARD_H_MAX = 560; // 3:4 portrait (420×560) when the stage allows
const CORRIDOR_STEP = 520; // Round 48: 380 → 520 (520 > 420 → ≥100px gap)

function CorridorView({
  items,
  thumbs,
  idx,
  setIdx,
  openDiary,
  uiHidden,
}: {
  items: Diary[];
  thumbs: Map<string, string>;
  idx: number;
  setIdx: (i: number) => void;
  openDiary: (d: Diary) => void;
  uiHidden: boolean;
}): React.ReactElement {
  const n = items.length;
  const current = items[idx];
  const lastWheel = useRef(0);
  const dragX = useMotionValue(0);
  // Round 47: framer's drag does NOT suppress the native click that fires
  // after pointerup — a stray click would open/switch a card. The flag is
  // set in onDragStart (BEFORE the click, whatever framer's internal
  // ordering) and cleared 150ms after the drag ends.
  const draggingRef = useRef(false);
  // Round 48: card height adapts to the stage (420×560 on tall stages,
  // gracefully shorter on short ones — the image is object-fit:cover so
  // any box stays sharp).
  const [stageRef, stageSize] = useStageSize();
  const cardH = Math.max(280, Math.min(CORRIDOR_CARD_H_MAX, (stageSize.h || 600) - 16));

  const onWheel = (e: React.WheelEvent<HTMLDivElement>): void => {
    const now = Date.now();
    if (now - lastWheel.current < 120) return; // throttle: one step per scroll
    lastWheel.current = now;
    if (e.deltaY > 0) setIdx(Math.min(idx + 1, n - 1));
    else if (e.deltaY < 0) setIdx(Math.max(idx - 1, 0));
  };

  const onDragStart = (): void => {
    draggingRef.current = true;
  };

  const onDragEnd = (_: unknown, info: PanInfo): void => {
    const threshold = 80;
    if (info.offset.x < -threshold) setIdx(Math.min(idx + 1, n - 1));
    else if (info.offset.x > threshold) setIdx(Math.max(idx - 1, 0));
    // Snap the strip back to the centered (current) card.
    animate(dragX, 0, { type: 'spring', stiffness: 300, damping: 30 });
    // Keep swallowing the post-drag click for a short window.
    window.setTimeout(() => { draggingRef.current = false; }, 150);
  };

  return (
    <div
      className="pointer-events-auto flex h-full flex-col items-center justify-center overflow-hidden"
      onWheel={onWheel}
    >
      <div ref={stageRef} className="relative h-[min(66vh,600px)] w-full overflow-hidden">
        {/* Drag layer — the whole strip follows the pointer while dragging,
            then springs back to 0 after onDragEnd snaps the index. */}
        <motion.div
          className="absolute inset-0"
          style={{ x: dragX, touchAction: 'none' }}
          drag="x"
          dragElastic={0.08}
          dragMomentum={false}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        >
          {items.map((d, i) => {
            // Strictly linear distance — NO modulo / wrap-around. Far cards
            // sit beyond the stage and are hidden by overflow-hidden.
            const dist = i - idx;
            const isCurrent = dist === 0;
            return (
              <motion.div
                key={d.id}
                className="absolute left-1/2 top-1/2"
                style={{
                  width: CORRIDOR_CARD_W,
                  height: cardH,
                  marginLeft: -CORRIDOR_CARD_W / 2,
                  marginTop: -cardH / 2,
                  zIndex: 100 - Math.abs(dist),
                  // Round 48: NO permanent will-change/backface/translateZ —
                  // a permanent GPU rasterization layer softens large photos.
                  // Animations stay buttery without it.
                }}
                animate={{
                  x: dist * CORRIDOR_STEP, // 520 > 420 → ≥100px gap
                  scale: isCurrent ? 1 : 0.75,
                  opacity: isCurrent ? 1 : Math.abs(dist) === 1 ? 0.55 : 0.25,
                  // Round 48: current card gets NO filter at all (even
                  // brightness(1) forces a filter pass); dimming only on
                  // non-current cards.
                  filter: isCurrent ? 'none' : 'brightness(0.6)',
                }}
                transition={{ type: 'spring', stiffness: 280, damping: 26 }}
              >
                <ImageCard
                  d={d}
                  thumbUrl={thumbs.get(d.id)}
                  onClick={() => {
                    if (draggingRef.current) return; // post-drag stray click
                    if (isCurrent) openDiary(d);
                    else setIdx(i);
                  }}
                />
              </motion.div>
            );
          })}
        </motion.div>
      </div>
      {/* Bottom chrome — meta line + 翻开这一天 button (auto-hides) */}
      <div
        className="flex flex-col items-center"
        style={{
          opacity: uiHidden ? 0 : 1,
          transition: uiHidden ? 'opacity 800ms ease-out' : 'opacity 400ms ease-in',
          pointerEvents: uiHidden ? 'none' : 'auto',
        }}
      >
        <BottomMetaLine d={current} index={idx + 1} total={n} />
        {current && (
          <button
            onClick={() => openDiary(current)}
            className="mt-1 rounded-full px-6 py-2 font-mono text-sm"
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              color: 'rgba(232, 221, 208, 0.85)',
              border: '1px solid rgba(212, 168, 83, 0.25)',
              transition: 'all 200ms',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.14)';
              e.currentTarget.style.borderColor = 'rgba(212, 168, 83, 0.5)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
              e.currentTarget.style.borderColor = 'rgba(212, 168, 83, 0.25)';
            }}
          >
            ✦ 翻开这一天
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Stack (叠影) — Round 50: rel CONTINUOUS model + cascade ripple + book-shelf
 * 3D tilt (replaces Round 49's whole-deck slide).
 *   - p (motion value, 0..n−1) = the FRONT card position; the wheel steps it
 *     by ±1 (110ms throttle, clamped) and useSpring(p) smooths it so
 *     collision + bottom-meta read LIVE fractional positions. Each card's
 *     depth = i − p.
 *   - CASCADE: depth < 0 cards (already left) fly far down-left and fade to
 *     0 with delay 0 — the front card and the second card both START
 *     immediately, but the front card travels 420px (gap keeps growing until
 *     gone) while the second card only advances ONE staircase slot; cards
 *     deeper in the stack start later (delay = min(depth,5)·0.07s) and so
 *     appear to move less — a water ripple front-to-back. Everyone settles
 *     on exact staircase slots (no cumulative error). Scroll up plays it in
 *     reverse until all cards are stacked at depth ≥ 0 (offset 0 = stacked
 *     tight, STOP — no wrap).
 *   - ADAPTIVE STEP (no clipping at any count): stepX = min(90, max(40,
 *     W·0.42/(n−1))) from the MEASURED stage width W (useStageSize +
 *     ResizeObserver); stepY = min(70, stepX·0.78). A secondary clamp keeps
 *     ANCHOR_X + (n−1)·stepX + CARD_W/2 < W/2 − 40.
 *   - BOOK-SHELF TILT: each card rotateY = tilt (negative → right edge
 *     rotates away from the viewer), stronger with more cards (n≥6: −22,
 *     n≥4: −16, else −10); the container has perspective: 1400. Hovered card
 *     straightens (rotateY 0) + scale 1.08 + lift 24 + z 100; other
 *     in-stack cards dim to 0.35; gone cards (depth < 0) never respond.
 *   - COLLISION: container-level rect test on LIVE smoothed coords
 *     (sp.get()), starting at i = max(0, ceil(pv)) — the front layer is the
 *     topmost; width is the rotateY-projected width (cos), height unchanged.
 *     Blank bands never fire. Cards are pointer-events:none; container
 *     onClick opens the hovered card; onMouseLeave clears hover.
 *   - Bottom meta: hovered ?? round(sp) — the front card of the live
 *     position.
 */
const STACK_CARD_W = 360; // fixed box (collision exact)
const STACK_CARD_H = 460;
const STACK_ANCHOR_X = -120; // front card anchor (slightly bottom-left)
const STACK_ANCHOR_Y = 40;
const STACK_LEAVE_X = -380; // gone card fly-off distance (up-left, 更符合翻页直觉)
const STACK_LEAVE_Y = 250;
const STACK_MAX_STEP_X = 85;
const STACK_MIN_STEP_X = 45;
const STACK_CASCADE_DELAY = 0.06; // per-depth transition delay (ripple, 稍快)
// MUST be a stable module-level reference: useSpring restarts its internal
// animation whenever the config object identity changes — an inline object
// would restart the spring on EVERY render (hover moves, wheel steps) and
// the smoothed position would never converge for collision/meta reads.
// 丝滑优化：提高 stiffness 让翻页更干脆，damping 稍高减少果冻感
const STACK_P_SPRING = { stiffness: 150, damping: 28 };

/** Round 50: one stack card — cascade target + book-shelf tilt + hover + 鼠标跟随 3D. */
function StackCard({
  i,
  depth,
  n,
  stepX,
  stepY,
  tilt,
  isH,
  anyH,
  mouseOffset,
  d,
  thumbUrl,
  onClick,
}: {
  i: number;
  depth: number;
  n: number;
  stepX: number;
  stepY: number;
  tilt: number;
  isH: boolean;
  anyH: boolean;
  mouseOffset: { x: number; y: number };
  d: Diary;
  thumbUrl?: string;
  onClick: () => void;
}): React.ReactElement {
  const gone = depth < 0;
  // Gone cards fly far left-down + transparent (delay 0, immediate). In-stack
  // cards target EXACTLY ONE staircase slot ahead of their current depth.
  const targetX = gone ? STACK_ANCHOR_X + STACK_LEAVE_X : STACK_ANCHOR_X + depth * stepX;
  const targetY = gone ? STACK_ANCHOR_Y + STACK_LEAVE_Y : STACK_ANCHOR_Y - depth * stepY;
  const baseOpacity = gone ? 0 : depth === 0 ? 1 : Math.max(1 - depth * 0.08, 0.4);
  // Cascade: deeper cards start later → ripple (front moves most & first).
  const delay = gone ? 0 : Math.min(depth, 5) * STACK_CASCADE_DELAY;
  // 丝滑优化：鼠标跟随 3D 倾斜 — hover 时完全跟随，非 hover 时微弱跟随
  const rotateY = isH ? mouseOffset.x : tilt + mouseOffset.x * 0.3;
  const rotateX = isH ? -mouseOffset.y : -mouseOffset.y * 0.15;
  return (
    <motion.div
      className="absolute left-1/2 top-1/2"
      style={{
        width: STACK_CARD_W,
        height: STACK_CARD_H,
        marginLeft: -STACK_CARD_W / 2,
        marginTop: -STACK_CARD_H / 2,
        pointerEvents: 'none',
        transformStyle: 'preserve-3d',
      }}
      animate={{
        x: targetX,
        y: targetY - (isH ? 24 : 0),
        rotateY,
        rotateX,
        rotate: 0,
        scale: isH ? 1.08 : 1,
        // Gone cards stay invisible; hover wins (1); else other in-stack 0.35.
        opacity: gone ? 0 : isH ? 1 : anyH ? 0.35 : baseOpacity,
        zIndex: isH ? 100 : n - i,
        boxShadow: isH
          ? '0 0 30px rgba(212, 168, 83, 0.28)'
          : '0 8px 24px rgba(0, 0, 0, 0.4)',
      }}
      transition={{ type: 'spring', stiffness: 350, damping: 30, delay }}
    >
      <ImageCard d={d} thumbUrl={thumbUrl} onClick={onClick} />
    </motion.div>
  );
}

/**
 * Session-scoped "first reveal already played" flag. Lives at module scope
 * (NOT inside StackView's component state) so that switching view modes or
 * leaving and re-entering the gallery never replays the sequential reveal
 * animation — it runs exactly once per page load.
 */
let stackRevealDone = false;

function StackView({
  items,
  thumbs,
  openDiary,
  uiHidden,
}: {
  items: Diary[];
  thumbs: Map<string, string>;
  openDiary: (d: Diary) => void;
  uiHidden: boolean;
}): React.ReactElement {
  // Round 50: p = continuous FRONT-card position (motion value, 0..n−1).
  // The wheel steps p by ±1 (clamped); useSpring smooths it so collision
  // and the bottom meta read LIVE fractional positions. The cascade ripple
  // comes from per-card transition delays derived from the DISCRETE depth
  // (mirrored into activeIdx state so React re-renders + re-arms springs).
  const [hovered, setHovered] = useState<number | null>(null);
  const [activeIdx, setActiveIdx] = useState(0); // discrete mirror of p
  const [bottomIdx, setBottomIdx] = useState(0); // live round(sp) for meta
  const lastWheel = useRef(0);
  const [stageRef, stageSize] = useStageSize();
  // 丝滑优化：鼠标跟随 3D 倾斜
  const [mouseOffset, setMouseOffset] = useState({ x: 0, y: 0 });

  const n = items.length;

  // Round 51: first-entry sequential reveal — cards appear one by one
  // (180ms apart, front-to-back) only on the very first StackView entry this
  // session. stackRevealDone persists at module scope so mode switches or
  // gallery re-entry never replay it; n ≤ 1 skips the animation entirely.
  const hasRevealed = useRef(stackRevealDone);
  const [revealedCount, setRevealedCount] = useState<number>(() =>
    hasRevealed.current || n <= 1 ? n : 0,
  );
  const [revealing, setRevealing] = useState<boolean>(() => !hasRevealed.current && n > 1);

  const p = useMotionValue(0);
  const sp = useSpring(p, STACK_P_SPRING);

  // Keep p in range when the deck shrinks (filter/sort) — clamp only.
  useEffect(() => {
    const v = Math.min(p.get(), n - 1);
    p.set(v);
    setActiveIdx(v);
  }, [n, p]);

  // Sequential reveal timer: bump revealedCount one card every 180ms until
  // all cards are shown, then lock the flag for the whole session.
  useEffect(() => {
    if (hasRevealed.current || n <= 1 || !revealing) {
      hasRevealed.current = true;
      stackRevealDone = true;
      setRevealing(false);
      setRevealedCount(n);
      return;
    }
    if (revealedCount >= n) {
      hasRevealed.current = true;
      stackRevealDone = true;
      setRevealing(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setRevealedCount((c) => Math.min(c + 1, n));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [n, revealedCount, revealing]);

  // Live bottom-meta index = round of the smoothed position.
  useMotionValueEvent(sp, 'change', (v) => {
    const r = Math.max(0, Math.min(n - 1, Math.round(v)));
    setBottomIdx((prev) => (prev === r ? prev : r));
  });

  // Adaptive staircase step from the MEASURED stage width W (useStageSize /
  // ResizeObserver): any count (7–10+) keeps the LAST card fully on screen.
  // stepX = min(90, max(40, W·0.42/(n−1))), with a secondary clamp ensuring
  // ANCHOR_X + (n−1)·stepX + CARD_W/2 < W/2 − 40.
  const W = stageSize.w || 1600;
  let stepX = Math.min(STACK_MAX_STEP_X, Math.max(STACK_MIN_STEP_X, (W * 0.42) / Math.max(n - 1, 1)));
  const maxStepX = (W / 2 - 40 - STACK_ANCHOR_X - STACK_CARD_W / 2) / Math.max(n - 1, 1);
  if (maxStepX > 0) stepX = Math.min(stepX, maxStepX);
  stepX = Math.max(STACK_MIN_STEP_X, Math.min(stepX, STACK_MAX_STEP_X));
  const stepY = Math.min(70, stepX * 0.78);
  // Book-shelf tilt: stronger as the row grows. Negative → right edge rotates
  // away; hovered cards straighten (rotateY 0).
  const tilt = n >= 6 ? -22 : n >= 4 ? -16 : -10;

  // Wheel: down (deltaY > 0) → p + 1 (front card leaves, cascade ripples
  // back through the stack); up (deltaY < 0) → p − 1 (reverse ripple until
  // all stacked at depth ≥ 0 — STOP, no wrap). 80ms throttle (丝滑优化：更跟手).
  const onWheel = (e: React.WheelEvent<HTMLDivElement>): void => {
    const now = Date.now();
    if (now - lastWheel.current < 80) return; // throttle: one step per scroll (110→80ms)
    lastWheel.current = now;
    const next = e.deltaY > 0
      ? Math.min(p.get() + 1, n - 1)
      : Math.max(p.get() - 1, 0);
    p.set(next);
    setActiveIdx(next);
  };

  // Collision on LIVE (smoothed) coordinates — pv may be fractional mid-
  // animation, so rects follow it continuously. Start from ceil(pv) (the
  // front layer is the topmost); gone cards (rel < 0) never hit. Width is
  // the rotateY-projected width (cos), height unchanged. NOTE: mx/my AND
  // cx/cy are BOTH relative to the container CENTER (no rect.width/2 on the
  // card side — mixing systems offset every hit by half the stage).
  // 丝滑优化：同时计算鼠标跟随 3D 倾斜
  const handleStackMouseMove = (e: React.MouseEvent<HTMLDivElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left - rect.width / 2;
    const my = e.clientY - rect.top - rect.height / 2;
    // 丝滑优化：计算鼠标相对于容器中心的归一化偏移 (-0.5 ~ 0.5)
    const normX = mx / (rect.width / 2);
    const normY = my / (rect.height / 2);
    setMouseOffset({ x: normX * 4, y: normY * 2 }); // ±4° / ±2° 倾斜
    const pv = sp.get();
    const projHalfW = (STACK_CARD_W * Math.cos((Math.abs(tilt) * Math.PI) / 180)) / 2;
    const halfH = STACK_CARD_H / 2;
    let hitIdx: number | null = null;
    for (let i = Math.max(0, Math.ceil(pv)); i < n; i++) {
      const rel = i - pv;
      if (rel < 0) continue;
      const cx = STACK_ANCHOR_X + rel * stepX; // relative to container center
      const cy = STACK_ANCHOR_Y - rel * stepY;
      if (
        mx >= cx - projHalfW && mx <= cx + projHalfW &&
        my >= cy - halfH && my <= cy + halfH
      ) {
        hitIdx = i;
        break; // topmost (front) wins — matches the visual z-order
      }
    }
    setHovered(hitIdx);
  };

  const displayIdx = hovered ?? bottomIdx;
  const active = items[displayIdx];

  return (
    <div
      className="pointer-events-auto flex h-full flex-col items-center justify-center overflow-visible"
      onWheel={revealing ? undefined : onWheel}
      onMouseLeave={
        revealing
          ? undefined
          : () => {
              setHovered(null);
              setMouseOffset({ x: 0, y: 0 }); // 丝滑优化：鼠标离开时重置 3D 倾斜
            }
      }
    >
      <div
        ref={stageRef}
        className="relative h-[min(72vh,640px)] w-full"
        style={{ perspective: 1400, pointerEvents: revealing ? 'none' : undefined }}
        onMouseMove={revealing ? undefined : handleStackMouseMove}
        onClick={
          revealing
            ? undefined
            : () => {
                if (hovered !== null) openDiary(items[hovered]);
              }
        }
      >
        {items.map((d, i) => {
          // Round 51: cards appear front-to-back, one every 180ms on the
          // first entry — unrevealed indices are not rendered at all.
          if (i >= revealedCount) return null;
          const depth = i - activeIdx; // discrete depth → cascade delay
          return (
            <motion.div
              key={`reveal-${d.id}`}
              className="absolute inset-0"
              style={{ pointerEvents: 'none' }}
              initial={
                revealing && i === revealedCount - 1
                  ? { opacity: 0, scaleX: 0.3, y: 20 }
                  : false
              }
              animate={{ opacity: 1, scaleX: 1, y: 0 }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
            >
              <StackCard
                key={d.id}
                i={i}
                depth={depth}
                n={n}
                stepX={stepX}
                stepY={stepY}
                tilt={tilt}
                isH={hovered === i}
                anyH={hovered !== null}
                mouseOffset={mouseOffset}
                d={d}
                thumbUrl={thumbs.get(d.id)}
                onClick={() => openDiary(d)}
              />
            </motion.div>
          );
        })}
        {/* Interaction blocker while the reveal animation is running — no
            hover detection, no clicks, no wheel flipping mid-reveal. */}
        {revealing && <div className="absolute inset-0 z-[999]" aria-hidden="true" />}
      </div>
      {/* Bottom chrome — auto-hides with the 3s chrome fade (uiHidden) */}
      <div
        className="flex flex-col items-center"
        style={{
          opacity: uiHidden ? 0 : 1,
          transition: uiHidden ? 'opacity 800ms ease-out' : 'opacity 400ms ease-in',
          pointerEvents: uiHidden ? 'none' : 'auto',
        }}
      >
        <BottomMetaLine d={active} index={displayIdx + 1} total={n} />
        {active && (
          <button
            onClick={() => openDiary(active)}
            className="mt-1 rounded-full px-6 py-2 font-mono text-sm"
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              color: 'rgba(232, 221, 208, 0.85)',
              border: '1px solid rgba(212, 168, 83, 0.25)',
              transition: 'all 200ms',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.14)';
              e.currentTarget.style.borderColor = 'rgba(212, 168, 83, 0.5)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
              e.currentTarget.style.borderColor = 'rgba(212, 168, 83, 0.25)';
            }}
          >
            ✦ 翻开这一天
          </button>
        )}
      </div>
    </div>
  );
}

/** Grid (网格): CSS-grid overview; hover floats title/date inside the image. */
function GridView({
  items,
  thumbs,
  openDiary,
  goUpload,
}: {
  items: Diary[];
  thumbs: Map<string, string>;
  openDiary: (d: Diary) => void;
  goUpload: () => void;
}): React.ReactElement {
  return (
    <div className="pointer-events-auto h-full overflow-y-auto px-6 py-6 sm:px-10" style={{ scrollbarWidth: 'thin' }}>
      <div className="mb-4 flex items-center justify-between">
        <span className="font-mono text-xs" style={{ color: 'rgba(232, 221, 208, 0.6)' }}>
          {items.length} 段记忆
        </span>
        <span className="font-mono text-xs" style={{ color: 'rgba(232, 221, 208, 0.45)' }}>
          按最近排序
        </span>
      </div>
      <div
        className="grid gap-5 pb-8"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }} // Round 48: 220 → 300
      >
        <button
          onClick={goUpload}
          className="flex min-h-[180px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed"
          style={{ borderColor: 'rgba(245, 230, 200, 0.35)', color: 'rgba(245, 230, 200, 0.8)', background: 'rgba(245, 230, 200, 0.04)' }}
        >
          <div className="flex h-11 w-11 items-center justify-center rounded-full" style={{ background: 'rgba(245, 230, 200, 0.1)' }}>
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15M4.5 12h15" />
            </svg>
          </div>
          <span className="font-mono text-sm">下一张照片</span>
        </button>
        {items.map((d) => (
          <button
            key={d.id}
            onClick={() => openDiary(d)}
            className="group relative block w-full overflow-hidden rounded-lg text-left transition-all duration-200 hover:scale-[1.02] hover:shadow-[0_0_0_1px_rgba(212,168,83,0.35),0_0_22px_rgba(212,168,83,0.22)]"
            style={{
              padding: 0,
              border: 'none',
              background: 'transparent',
              aspectRatio: '4 / 3',
              opacity: 0.92,
            }}
          >
            <GalleryImage d={d} thumbUrl={thumbs.get(d.id)} alt={d.title} />
            {/* Hover float text — INSIDE the image, no background block */}
            <span className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-0.5 p-3 text-left opacity-0 transition-opacity duration-200 group-hover:opacity-100">
              <span
                className="line-clamp-1"
                style={{
                  color: 'rgba(255, 255, 255, 0.92)',
                  fontSize: 13,
                  lineHeight: 1.3,
                  textShadow: '0 1px 8px rgba(0, 0, 0, 0.6)',
                }}
              >
                {d.title}
              </span>
              <span style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: 11, textShadow: '0 1px 8px rgba(0, 0, 0, 0.6)' }}>
                {formatDotDate(d.createdAt)}
              </span>
            </span>
          </button>
        ))}
      </div>
      {items.length === 0 && (
        <div className="pt-10 text-center font-mono text-sm" style={{ color: 'rgba(245, 230, 200, 0.5)' }}>
          暂无日记，回到首页上传第一张吧
        </div>
      )}
    </div>
  );
}

export default function DiaryGallery(): React.ReactElement {
  const { diaryList, loadDiaries, isLoadingList } = useDiaryStore();
  const { goTo } = useNavStore();
  const messages = useChatStore((s) => s.messages);

  const [filter, setFilter] = useState<Filter>('all');
  const [filterHover, setFilterHover] = useState<string | null>(null);
  const [modeHover, setModeHover] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('corridor');
  const [sort, setSort] = useState<'recent' | 'oldest'>('recent');
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
  // Round 42: chrome (header/footer) fades out after stillness.
  // Round 43: 4s → 3s, and the hidden flag is PUBLISHED to the shared
  // uiStore so the global Logo fades in/out in perfect sync.
  const setGalleryChromeHidden = useUiStore((s) => s.setGalleryChromeHidden);
  const uiHidden = useAutoHideUI(3000, setGalleryChromeHidden);

  useEffect(() => {
    loadDiaries();
  }, [loadDiaries]);

  useEffect(() => {
    const m = new Map<string, string>();
    for (const d of diaryList) {
      if (d.thumbnailBlob && !m.has(d.id)) {
        m.set(d.id, URL.createObjectURL(d.thumbnailBlob));
      }
    }
    setThumbs(m);
    return () => {
      m.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [diaryList]);

  const visible = useMemo(() => {
    let list = diaryList;
    if (filter !== 'all') {
      list = list.filter((d) => {
        const len = d.chatHistory?.length ?? 0;
        if (filter === 'pending') return len === 0;
        if (filter === 'talking') return len > 0 && !d.content;
        return len > 0 && !!d.content;
      });
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (d) =>
          d.title.toLowerCase().includes(q) ||
          d.content.toLowerCase().includes(q),
      );
    }
    list = [...list].sort((a, b) =>
      sort === 'recent' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt,
    );
    return list;
  }, [diaryList, filter, query, sort]);

  const totalDays = new Set(diaryList.map((d) => formatDate(d.createdAt))).size;
  const totalSegments = diaryList.reduce((sum, d) => sum + (d.chatHistory?.length ?? 1), 0);

  const openDiary = useCallback((d: Diary) => {
    useReviewStore.getState().openCard(d.id);
  }, []);

  const goUpload = useCallback(() => {
    goTo('chat');
  }, [goTo]);

  // Round 42: corridor shares a wheel-driven current index. Stack no longer
  // keeps an index (Round 43 — hover-driven, no wheel flipping).
  const [corridorIdx, setCorridorIdx] = useState(0);
  useEffect(() => {
    setCorridorIdx(0);
  }, [viewMode]);

  // Chrome (non-image) opacity + pointer events.
  const chromeStyle: React.CSSProperties = {
    opacity: uiHidden ? 0 : 1,
    transition: uiHidden ? 'opacity 800ms ease-out' : 'opacity 400ms ease-in',
    pointerEvents: uiHidden ? 'none' : 'auto',
  };

  return (
    <div
      className="gallery-root relative min-h-screen w-full overflow-hidden"
      style={{ background: '#080605' }}
    >
      {/* Round 44: shared ambience — halo + floating stars, breathing. ALWAYS
          on (not part of the chrome, unaffected by the 3s auto-hide). */}
      <AmbientBackground breathing />
      {/* Round 44: custom dot-and-ring cursor; system arrow hidden below. */}
      <RingCursor />
      <style>{`.gallery-root, .gallery-root * { cursor: none !important; }`}</style>

      <div className="relative z-10 flex min-h-screen flex-col">
        {/* === Top bar (chrome — auto-hides) === */}
        <header
          className="pointer-events-auto flex flex-col gap-3 px-6 pt-[76px] pb-4 sm:px-10"
          style={chromeStyle}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Search */}
            <div
              className="flex items-center gap-2 rounded-full px-4 py-2"
              style={{ background: 'rgba(255, 255, 255, 0.04)', border: '1px solid rgba(255, 255, 255, 0.08)' }}
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="rgba(232, 221, 208, 0.5)" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M10.5 18a7.5 7.5 0 100-15 7.5 7.5 0 000 15z" />
              </svg>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索记忆·对话·日记"
                className="w-40 bg-transparent text-xs placeholder:text-warm-white/30 focus:outline-none sm:w-56"
                style={{ color: 'rgba(232, 221, 208, 0.85)' }}
              />
            </div>

            {/* View modes (长廊/叠影/网格) + sort */}
            <div className="flex items-center gap-3">
              <div
                className="flex items-center gap-1 rounded-full px-1.5 py-1"
                style={{ background: 'rgba(255, 255, 255, 0.04)', border: '1px solid rgba(255, 255, 255, 0.08)' }}
              >
                {MODES.map((m) => {
                  const active = viewMode === m.key;
                  const hovering = modeHover === m.key;
                  // Round 45: same three-state brightness as the filters —
                  // dim idle / slightly brighter hover / gold selected.
                  const strokeColor = active
                    ? 'rgba(212, 168, 83, 0.95)'
                    : hovering
                      ? 'rgba(232, 221, 208, 0.85)'
                      : 'rgba(232, 221, 208, 0.4)';
                  const bg = active
                    ? 'rgba(212, 168, 83, 0.18)'
                    : hovering
                      ? 'rgba(255, 255, 255, 0.06)'
                      : 'rgba(255, 255, 255, 0.02)';
                  return (
                    <button
                      key={m.key}
                      onClick={() => setViewMode(m.key)}
                      title={m.label}
                      aria-label={`${m.label}模式`}
                      onMouseEnter={() => setModeHover(m.key)}
                      onMouseLeave={() => setModeHover(null)}
                      className="flex h-7 w-7 items-center justify-center rounded-full transition-all duration-200"
                      style={{ background: bg }}
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke={strokeColor} strokeWidth={1.6}>
                        <path strokeLinecap="round" strokeLinejoin="round" d={m.icon} />
                      </svg>
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => setSort(sort === 'recent' ? 'oldest' : 'recent')}
                className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs"
                style={{ background: 'rgba(255, 255, 255, 0.04)', border: '1px solid rgba(255, 255, 255, 0.08)', color: 'rgba(232, 221, 208, 0.7)' }}
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 4.5h13.5M3 9.75h9M3 15h6M3 20.25h3M16.5 12l3 3m0 0l3-3m-3 3V3" />
                </svg>
                {sort === 'recent' ? '最近' : '最早'}
              </button>
              {/* Round Auth: account entry — hollow person (guest) or
                  circular avatar (signed in). Mounted LAST in the header's
                  right button group (P0-9). */}
              <AuthEntry />
            </div>
          </div>

          {/* Filters — Round 43: centered at top. Round 44: three brightness
              tiers — dim idle / slightly brighter hover / gold selected. */}
          <nav
            className="flex w-fit items-center gap-1 self-center rounded-full px-1.5 py-1"
            style={{ background: 'rgba(255, 255, 255, 0.04)', border: '1px solid rgba(255, 255, 255, 0.08)' }}
          >
            {FILTERS.map((f) => {
              const active = filter === f.key;
              const hovering = filterHover === f.key;
              return (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  onMouseEnter={() => setFilterHover(f.key)}
                  onMouseLeave={() => setFilterHover(null)}
                  className="rounded-full px-3.5 py-1 text-xs transition-all duration-200"
                  style={{
                    background: active
                      ? 'rgba(212, 168, 83, 0.18)'
                      : hovering
                        ? 'rgba(255, 255, 255, 0.06)'
                        : 'rgba(255, 255, 255, 0.02)',
                    color: active
                      ? 'rgba(212, 168, 83, 0.95)'
                      : hovering
                        ? 'rgba(232, 221, 208, 0.85)'
                        : 'rgba(232, 221, 208, 0.4)',
                    border: active ? '1px solid rgba(212, 168, 83, 0.45)' : '1px solid transparent',
                  }}
                >
                  {f.label}
                </button>
              );
            })}
          </nav>
        </header>

        {/* === Content area — diary images NEVER hide === */}
        <main className="relative flex-1 overflow-hidden">
          {isLoadingList ? (
            <div className="flex h-full items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-white/60" />
            </div>
          ) : (
            <AnimatePresence mode="wait">
              {viewMode === 'corridor' && (
                <motion.div
                  key="corridor"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="h-full"
                >
                  <CorridorView
                    items={visible}
                    thumbs={thumbs}
                    idx={corridorIdx}
                    setIdx={setCorridorIdx}
                    openDiary={openDiary}
                    uiHidden={uiHidden}
                  />
                </motion.div>
              )}
              {viewMode === 'stack' && (
                <motion.div
                  key="stack"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="h-full"
                >
                  <StackView items={visible} thumbs={thumbs} openDiary={openDiary} uiHidden={uiHidden} />
                </motion.div>
              )}
              {viewMode === 'grid' && (
                <motion.div
                  key="grid"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="h-full"
                >
                  <GridView items={visible} thumbs={thumbs} openDiary={openDiary} goUpload={goUpload} />
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </main>

        {/* === Footer (chrome — auto-hides) === */}
        <footer className="pointer-events-auto flex flex-col items-center gap-4 px-6 pb-8 sm:px-10" style={chromeStyle}>
          <p className="font-mono text-xs" style={{ color: 'rgba(232, 221, 208, 0.55)' }}>
            和念念的第 {totalDays || 0} 天 · 已记下 {totalSegments} 段
            <span className="ml-2 inline-block h-1 w-1 rounded-full align-middle" style={{ background: 'rgba(212, 168, 83, 0.55)' }} />
            <span className="ml-2">{messages.length} 段对话进行中</span>
          </p>
        </footer>
      </div>

      {/* 翻开日记现由全局 MemoryCardModal 承接（reviewStore 驱动） */}
    </div>
  );
}
