import { useEffect, useState } from 'react';
import { useNavStore } from '../stores/navStore';
import { useUiStore } from '../stores/uiStore';
import { useAuthStore } from '../stores/authStore';

/**
 * Global logo (top-left) — visible on every page.
 *
 * Behavior:
 *   - Click → go back one step in the navStore back stack (overlay closes
 *     first, then views pop back toward 'landing'; empty stack = no-op).
 *   - On 'landing' the logo is ALWAYS visible.
 *   - On 'gallery' (memory list) the logo is driven by the SHARED
 *     uiStore.galleryChromeHidden state — published by DiaryGallery's
 *     useAutoHideUI — so it fades out / back in EXACTLY in sync with the
 *     page chrome (search, filters, view buttons, footer). No independent
 *     timer on this view (Round 43).
 *   - On 'chat' it keeps its own 3s stillness auto-hide (Round 22 design,
 *     ChatMainView untouched).
 *   - Fade matches the gallery chrome: 800ms ease-out to hide, 400ms
 *     ease-in to reappear — visually identical to header/footer.
 *
 * Visual:
 *   - KaiTi calligraphic brand mark (30.4px).
 *   - On hover the entire label (incl. the ✦ glyph) brightens to full
 *     opacity white with a soft warm glow — a clear "clickable" cue.
 */
const AUTO_HIDE_MS = 3000;

export default function Logo(): React.ReactElement {
  const { currentView, goBack } = useNavStore();
  const galleryHidden = useUiStore((s) => s.galleryChromeHidden);
  const user = useAuthStore((s) => s.user);
  const [moving, setMoving] = useState(true);
  const [hovered, setHovered] = useState(false);

  // Round Auth: brand label is dynamic — "念念" for guests, "{昵称} 的念念"
  // for signed-in users (P0-9). Live-syncs on profile edits (no reload).
  const brandLabel = user ? `${user.nickname} 的念念` : '念念';

  // Reset hide state every time the view changes (Logo reappears on entry).
  useEffect(() => {
    setMoving(true);
  }, [currentView]);

  // Independent auto-hide timer — ONLY on the chat view. The gallery view
  // is driven by the shared uiStore (DiaryGallery's useAutoHideUI); the
  // landing view keeps the logo always visible.
  useEffect(() => {
    if (currentView !== 'chat') return;

    let timer: ReturnType<typeof setTimeout> | undefined;

    const onMove = (): void => {
      setMoving(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setMoving(false), AUTO_HIDE_MS);
    };

    if (timer) clearTimeout(timer);
    timer = setTimeout(() => setMoving(false), AUTO_HIDE_MS);

    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('mousedown', onMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mousedown', onMove);
      if (timer) clearTimeout(timer);
    };
  }, [currentView]);

  const visible =
    currentView === 'landing'
      ? true
      : currentView === 'gallery'
        ? !galleryHidden
        : moving;

  // Round 43: fade timings match the gallery chrome exactly — 800ms out,
  // 400ms in — so the logo never lags the header/footer.
  const transition = visible
    ? 'opacity 400ms ease-in'
    : 'opacity 800ms ease-out';

  // Hover styling: brighter white + warm glow vs. the restful dim state.
  const labelColor = hovered
    ? 'rgba(255, 252, 245, 1)'
    : 'rgba(245, 230, 200, 0.7)';
  const glyphColor = hovered
    ? 'rgba(255, 225, 175, 1)'
    : 'rgba(212, 168, 83, 0.92)';
  const labelShadow = hovered
    ? '0 0 14px rgba(245, 230, 200, 0.55), 0 0 28px rgba(212, 168, 83, 0.18)'
    : 'none';
  const glyphShadow = hovered
    ? '0 0 10px rgba(255, 225, 175, 0.7)'
    : 'none';

  return (
    <button
      onClick={goBack}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-label="返回上一步"
      className="fixed left-6 top-6 z-50 select-none"
      style={{
        opacity: visible ? 1 : 0,
        transition,
        pointerEvents: visible ? 'auto' : 'none',
      }}
    >
      <span
        className="flex items-center gap-2.5 tracking-wide"
        style={{
          // Round 29: 38px (×2 of original). Round 30: ×0.8 → 30.4px and
          // switched to KaiTi (楷体) for a calligraphic feel.
          fontFamily: '"KaiTi", "STKaiti", "楷体", serif',
          fontSize: '30.4px',
          letterSpacing: '0.04em',
          lineHeight: 1.1,
          color: labelColor,
          textShadow: labelShadow,
          transition: 'color 0.3s ease, text-shadow 0.3s ease',
        }}
      >
        <span
          style={{
            fontSize: '32px',
            color: glyphColor,
            textShadow: glyphShadow,
            transition: 'color 0.3s ease, text-shadow 0.3s ease',
          }}
        >
          ✦
        </span>
        <span>{brandLabel}</span>
      </span>
    </button>
  );
}
