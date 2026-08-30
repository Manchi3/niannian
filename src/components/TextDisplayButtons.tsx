import { useAppStore } from '../stores/appStore';
import { motion } from 'framer-motion';

/**
 * TextDisplayButton — single cycle button in the top-right corner.
 *
 * Round 20: the old three-icon radiogroup is replaced by ONE button that
 * cycles full → single → hidden → full. Only affects the CHAT view.
 *
 * Anti-jitter guarantees:
 *   - The button itself has a FIXED size (h-8 w-8) — its position can
 *     never change when the mode changes.
 *   - The hint text sits in a FIXED-WIDTH container (w-44) with the text
 *     left-aligned — a longer/shorter label never pushes the button.
 *   - Mode switching only changes icon fill/color and text content +
 *     opacity. No transform/left/margin changes anywhere.
 */
type Mode = 'full' | 'single' | 'hidden';

const MODE_ORDER: Mode[] = ['full', 'single', 'hidden'];

/** Hint text shown next to the button for each mode. */
const MODE_HINT: Record<Mode, string> = {
  full: '完整对话 · 点按只看一条',
  single: '单条模式 · 点按隐去对话',
  hidden: '已隐藏 · 点按恢复',
};

/**
 * Mode icon — stroke-based, matches the atmosphere/gear button family.
 * The icon path changes per mode but the button box never moves.
 */
function ModeIcon({ mode }: { mode: Mode }): React.ReactElement {
  const color = 'rgba(212, 168, 83, 0.95)';
  const stroke = 1.75;
  if (mode === 'full') {
    // Three stacked message bubbles — "full conversation"
    return (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke={color} strokeWidth={stroke}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 5.25h12v4.5h-12z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 12.75h12v4.5h-12z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 18.75L4.5 17.25" />
      </svg>
    );
  }
  if (mode === 'single') {
    // One centered bubble with a caption line — "single message"
    return (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke={color} strokeWidth={stroke}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 6.75h14a2 2 0 012 2v5.5a2 2 0 01-2 2H9.5L6 19.25v-3H5a2 2 0 01-2-2v-5.5a2 2 0 012-2z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 9.75h7M8 12.25h5" />
      </svg>
    );
  }
  // hidden — slashed eye / "no text"
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke={color} strokeWidth={stroke}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.59 10.59a2 2 0 002.83 2.83" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.88 5.09A10.94 10.94 0 0112 5c5 0 9 4 10 7a11.18 11.18 0 01-2.16 3.19M6.16 6.16C4.13 7.55 2.59 9.55 1.5 12c1 3 5 7 10.5 7 1.36 0 2.65-.27 3.84-.73" />
    </svg>
  );
}

export default function TextDisplayButton(): React.ReactElement {
  const mode = useAppStore((s) => s.textDisplayMode);
  const setMode = useAppStore((s) => s.setTextDisplayMode);

  // Cycle: full → single → hidden → full
  const cycle = (): void => {
    const idx = MODE_ORDER.indexOf(mode);
    const next = MODE_ORDER[(idx + 1) % MODE_ORDER.length];
    setMode(next);
  };

  return (
    <div className="pointer-events-auto flex items-center gap-2">
      {/* The single cycle button — FIXED 32×32, never moves */}
      <motion.button
        whileTap={{ scale: 0.92 }}
        onClick={cycle}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors duration-200 hover:bg-white/5"
        style={{
          background: 'rgba(212, 168, 83, 0.15)',
          border: '1px solid rgba(212, 168, 83, 0.45)',
        }}
        aria-label="切换文字呈现方式"
        title={MODE_HINT[mode]}
      >
        <ModeIcon mode={mode} />
      </motion.button>

      {/* Hint text — FIXED-WIDTH container, left-aligned, so label length
          can never push the button around. Only opacity/color changes here. */}
      <div
        className="font-mono text-[11px] leading-tight"
        style={{
          width: '11rem',
          color: 'rgba(232, 221, 208, 0.55)',
        }}
      >
        <span style={{ color: 'rgba(212, 168, 83, 0.85)' }}>
          {MODE_HINT[mode]}
        </span>
      </div>
    </div>
  );
}
