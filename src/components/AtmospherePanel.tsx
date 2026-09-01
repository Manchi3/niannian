import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CONFIG, CONFIG_DEFAULTS, saveConfig } from '../utils/constants';
import { nnKey } from '../utils/uid';

/**
 * Props for the AtmospherePanel component.
 */
interface AtmospherePanelProps {
  /** Whether the drawer is open. */
  open: boolean;
  /** Callback to close the drawer. */
  onClose: () => void;
  /** Callback to rebuild the particle system (e.g., after density change). */
  onRebuild?: () => void;
}

// ---------------------------------------------------------------------------
// ConfigSlider — labelled range slider that reads from / writes to CONFIG live
// ---------------------------------------------------------------------------

interface SliderProps {
  label: string;
  configKey: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
  /** Decimal places for the live value readout (default: auto from step). */
  digits?: number;
}

function ConfigSlider({
  label,
  configKey,
  min,
  max,
  step,
  unit,
  digits,
}: SliderProps): React.ReactElement {
  const [value, setValue] = useState<number>(
    (CONFIG as Record<string, unknown>)[configKey] as number,
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = parseFloat(e.target.value);
      (CONFIG as Record<string, unknown>)[configKey] = v;
      saveConfig();
      setValue(v);
    },
    [configKey],
  );

  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs" style={{ color: 'rgba(232, 221, 208, 0.6)' }}>
          {label}
        </span>
        <span className="font-mono text-xs" style={{ color: 'rgba(212, 168, 83, 0.8)' }}>
          {digits !== undefined
            ? value.toFixed(digits)
            : value.toFixed(step < 1 ? 2 : 0)}
          {unit ?? ''}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={handleChange}
        className="w-full cursor-pointer"
        style={{
          accentColor: 'rgba(212, 168, 83, 0.8)',
          height: '4px',
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ConfigCheckbox — labelled toggle that reads from / writes to CONFIG live
// ---------------------------------------------------------------------------

interface CheckboxProps {
  label: string;
  configKey: string;
}

function ConfigCheckbox({ label, configKey }: CheckboxProps): React.ReactElement {
  const [checked, setChecked] = useState<boolean>(
    (CONFIG as Record<string, unknown>)[configKey] as boolean,
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      (CONFIG as Record<string, unknown>)[configKey] = e.target.checked;
      saveConfig();
      setChecked(e.target.checked);
    },
    [configKey],
  );

  return (
    <label
      className="mb-2 flex cursor-pointer items-center gap-2"
      style={{ color: 'rgba(232, 221, 208, 0.6)' }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={handleChange}
        className="cursor-pointer"
        style={{ accentColor: 'rgba(212, 168, 83, 0.8)' }}
      />
      <span className="text-xs">{label}</span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// QualitySegmented — segmented buttons for particle density presets
// Persists the selected preset index to localStorage so the highlighted
// button survives panel close/reopen and page refresh.
// ---------------------------------------------------------------------------

const QUALITY_PRESETS = [
  { label: '流畅', multiplier: 0.5 },
  { label: '标准', multiplier: 1 },
  { label: '超清', multiplier: 2 },
  { label: '极致', multiplier: 4 },
] as const;

const BASE_PARTICLE_COUNT = 200000;

/**
 * Round Auth: the active quality preset index is stored per-account
 * (nn_${uid}_particleQuality_v3) — read/written at call time via nnKey().
 *
 * Round 59: key bumped to `_v3` in lockstep with the CONFIG storage key
 * (particle_atmosphere_config_v3). The default density changed from 标准
 * (200k) to 超清 (400k), so a stale saved index would keep highlighting
 * the wrong button. Invalidating it lets the highlighted preset fall back
 * to the derived value below — which now resolves to "超清".
 */
function qualityStorageKey(): string {
  return nnKey('particleQuality_v3');
}

/**
 * Resolve the initial quality index from localStorage, falling back to
 * deriving it from the persisted CONFIG.PARTICLE_COUNT, then to "超清".
 */
function getInitialQualityIndex(): number {
  try {
    const saved = localStorage.getItem(qualityStorageKey());
    if (saved !== null) {
      const idx = parseInt(saved, 10);
      if (idx >= 0 && idx < QUALITY_PRESETS.length) return idx;
    }
  } catch {
    // ignore corrupt storage
  }
  // Fallback: derive from the (possibly persisted) particle count so the
  // highlighted button always matches the actually-rendered density.
  // With the Round 59 default PARTICLE_COUNT = 400000 this resolves to
  // index 2 ("超清", 200000 × 2).
  const idx = QUALITY_PRESETS.findIndex(
    (p) => Math.round(BASE_PARTICLE_COUNT * p.multiplier) === CONFIG.PARTICLE_COUNT,
  );
  return idx >= 0 ? idx : 2;
}

interface QualitySegmentedProps {
  onRebuild?: () => void;
}

function QualitySegmented({ onRebuild }: QualitySegmentedProps): React.ReactElement {
  const [activeIdx, setActiveIdx] = useState<number>(getInitialQualityIndex);

  const handleSelect = (idx: number): void => {
    setActiveIdx(idx);
    const multiplier = QUALITY_PRESETS[idx].multiplier;
    (CONFIG as Record<string, unknown>).PARTICLE_COUNT = Math.round(BASE_PARTICLE_COUNT * multiplier);
    saveConfig();
    try {
      localStorage.setItem(qualityStorageKey(), String(idx));
    } catch {
      // ignore quota / privacy-mode errors
    }
    onRebuild?.();
  };

  return (
    <div className="mb-3">
      <div className="mb-1.5 text-xs" style={{ color: 'rgba(232, 221, 208, 0.6)' }}>
        画质/密度
      </div>
      <div className="flex gap-1">
        {QUALITY_PRESETS.map((preset, idx) => (
          <button
            key={preset.label}
            onClick={() => handleSelect(idx)}
            className="flex-1 rounded-md py-1.5 text-xs transition-all"
            style={{
              background:
                activeIdx === idx
                  ? 'rgba(212, 168, 83, 0.2)'
                  : 'rgba(255, 255, 255, 0.04)',
              border:
                activeIdx === idx
                  ? '1px solid rgba(212, 168, 83, 0.4)'
                  : '1px solid rgba(255, 255, 255, 0.06)',
              color:
                activeIdx === idx
                  ? 'rgba(212, 168, 83, 0.9)'
                  : 'rgba(232, 221, 208, 0.4)',
            }}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="mt-1 text-xs" style={{ color: 'rgba(232, 221, 208, 0.25)' }}>
        {Math.round(BASE_PARTICLE_COUNT * QUALITY_PRESETS[activeIdx].multiplier).toLocaleString()} 粒子 · 已应用
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CollapsibleSection — controlled accordion section.
// The open/close state is owned by AtmospherePanel (single-open accordion):
// clicking one section collapses the others. Smooth height animation via
// AnimatePresence. State is intentionally NOT persisted — the panel always
// opens with the first section ("基础参数") expanded.
// ---------------------------------------------------------------------------

interface CollapsibleSectionProps {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function CollapsibleSection({
  title,
  open,
  onToggle,
  children,
}: CollapsibleSectionProps): React.ReactElement {
  return (
    <div className="mb-1">
      <button
        onClick={onToggle}
        className="mb-2 mt-4 flex w-full items-center justify-between border-b pb-1.5"
        style={{
          borderColor: 'rgba(255, 255, 255, 0.08)',
          color: 'rgba(212, 168, 83, 0.7)',
        }}
      >
        <span className="text-xs font-medium uppercase tracking-wider">{title}</span>
        <svg
          className="h-3 w-3 transition-transform"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AtmospherePanel — main drawer
// ---------------------------------------------------------------------------

export default function AtmospherePanel({
  open,
  onClose,
  onRebuild,
}: AtmospherePanelProps): React.ReactElement {
  const [resetCounter, setResetCounter] = useState(0);
  // Accordion: only ONE section open at a time. Default = first ("basic").
  const [openSection, setOpenSection] = useState<string | null>('basic');

  const toggleSection = useCallback((id: string) => {
    setOpenSection((prev) => (prev === id ? null : id));
  }, []);

  const handleReset = useCallback(() => {
    const defaults = CONFIG_DEFAULTS as Record<string, number | boolean>;
    const configObj = CONFIG as Record<string, unknown>;
    for (const key of Object.keys(defaults)) {
      configObj[key] = defaults[key];
    }
    saveConfig();
    // Clear the persisted quality preset so the segmented control snaps back
    // to the default ("超清", 400k) highlight on next mount.
    try {
      localStorage.removeItem(qualityStorageKey());
    } catch {
      // ignore
    }
    setOpenSection('basic');
    setResetCounter((c) => c + 1);
    onRebuild?.();
  }, [onRebuild]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="pointer-events-auto fixed inset-0 z-40"
            style={{ background: 'rgba(0, 0, 0, 0.3)' }}
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: 320 }}
            animate={{ x: 0 }}
            exit={{ x: 320 }}
            transition={{ type: 'tween', duration: 0.25, ease: 'easeOut' }}
            className="pointer-events-auto fixed right-0 top-0 z-50 flex h-screen flex-col"
            style={{
              width: '320px',
              background: 'rgba(20, 20, 20, 0.85)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              borderRadius: '16px 0 0 16px',
              boxShadow: '-8px 0 32px rgba(0, 0, 0, 0.4)',
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerMove={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between border-b px-5 py-4"
              style={{ borderColor: 'rgba(255, 255, 255, 0.06)' }}
            >
              <span
                className="text-sm font-medium"
                style={{ color: 'rgba(232, 221, 208, 0.85)' }}
              >
                氛围调节
              </span>
              <button
                onClick={onClose}
                className="flex h-6 w-6 items-center justify-center rounded-full transition-colors hover:bg-white/10"
                style={{ color: 'rgba(232, 221, 208, 0.4)' }}
                aria-label="关闭"
              >
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {/* Scrollable content — keyed by resetCounter so that "恢复默认"
                remounts every control, re-reading values from the freshly
                reset CONFIG (instead of stale local component state). */}
            <div key={resetCounter} className="flex-1 overflow-y-auto px-5 py-2">
              {/* === 基础参数 (default open) === */}
              <CollapsibleSection
                title="基础参数"
                open={openSection === 'basic'}
                onToggle={() => toggleSection('basic')}
              >
                <QualitySegmented onRebuild={onRebuild} />
                <ConfigSlider
                  label="粒子大小"
                  configKey="POINT_SIZE"
                  min={1}
                  max={10}
                  step={0.1}
                />
                <ConfigSlider
                  label="3D 深度"
                  configKey="U_DEPTH"
                  min={5}
                  max={50}
                  step={1}
                />
                <ConfigSlider
                  label="厚度"
                  configKey="DEPTH_THICKNESS"
                  min={0.05}
                  max={1}
                  step={0.05}
                />
                <ConfigCheckbox label="隐藏其他粒子图片" configKey="HIDE_OTHER_PARTICLES" />
                <ConfigCheckbox label="隐藏背景浮动星星" configKey="HIDE_FLOATING_STARS" />
                <ConfigCheckbox label="自定义鼠标光标" configKey="CUSTOM_CURSOR" />
              </CollapsibleSection>

              {/* === 力场与波动 (collapsible) === */}
              <CollapsibleSection
                title="力场与波动"
                open={openSection === 'forces'}
                onToggle={() => toggleSection('forces')}
              >
                <ConfigSlider
                  label="悬停斥力半径"
                  configKey="MOUSE_RADIUS"
                  min={0.05}
                  max={0.4}
                  step={0.01}
                />
                <ConfigSlider
                  label="斥力强度"
                  configKey="MOUSE_STRENGTH"
                  min={0.005}
                  max={0.12}
                  step={0.005}
                />
                <ConfigSlider
                  label="散开程度"
                  configKey="SCATTER_STRENGTH"
                  min={0}
                  max={3}
                  step={0.05}
                  digits={1}
                />
                <ConfigSlider
                  label="最大位移"
                  configKey="MOUSE_DISPLACEMENT_MAX"
                  min={0.02}
                  max={0.15}
                  step={0.01}
                />
                <ConfigSlider
                  label="水波寿命"
                  configKey="RIPPLE_DURATION"
                  min={0.3}
                  max={3}
                  step={0.1}
                  unit=" s"
                />
                <ConfigSlider
                  label="水波强度"
                  configKey="RIPPLE_STRENGTH"
                  min={0.02}
                  max={0.5}
                  step={0.01}
                />
              </CollapsibleSection>

              {/* === 高级与回正 (collapsible) === */}
              <CollapsibleSection
                title="高级与回正"
                open={openSection === 'advanced'}
                onToggle={() => toggleSection('advanced')}
              >
                <ConfigSlider
                  label="扩散起始"
                  configKey="SPREAD_START"
                  min={0}
                  max={1}
                  step={0.05}
                />
                <ConfigSlider
                  label="扩散强度"
                  configKey="SPREAD_STRENGTH"
                  min={0}
                  max={300}
                  step={10}
                />
                <ConfigSlider
                  label="边缘散射"
                  configKey="EDGE_SCATTER"
                  min={0}
                  max={0.3}
                  step={0.01}
                />
                <ConfigSlider
                  label="暗角起始"
                  configKey="VIGNETTE_START"
                  min={0.3}
                  max={1}
                  step={0.05}
                />
                <ConfigSlider
                  label="亮度增强"
                  configKey="BRIGHTNESS_ENHANCE"
                  min={0.5}
                  max={2}
                  step={0.05}
                />
                <div className="mb-2 mt-2">
                  <ConfigCheckbox label="自动回正" configKey="AUTO_RETURN" />
                  <ConfigCheckbox label="回正时恢复缩放" configKey="RETURN_RESTORE_ZOOM" />
                </div>
                <ConfigSlider
                  label="回正延迟"
                  configKey="RETURN_DELAY"
                  min={0}
                  max={10}
                  step={0.5}
                  unit=" s"
                />
                <ConfigSlider
                  label="回正速度"
                  configKey="RETURN_SPEED"
                  min={0.005}
                  max={0.1}
                  step={0.005}
                />
              </CollapsibleSection>

              {/* === 语音耦合 (collapsible, placeholder) === */}
              <CollapsibleSection
                title="语音耦合"
                open={openSection === 'voice'}
                onToggle={() => toggleSection('voice')}
              >
                <ConfigCheckbox label="麦克风驱动粒子" configKey="MIC_DRIVE_PARTICLES" />
                <div className="mt-1 text-xs" style={{ color: 'rgba(232, 221, 208, 0.25)' }}>
                  预留功能，后续接入 Web Audio API
                </div>
              </CollapsibleSection>

              {/* === 更多参数 (collapsible) === */}
              <CollapsibleSection
                title="更多参数"
                open={openSection === 'more'}
                onToggle={() => toggleSection('more')}
              >
                <ConfigSlider
                  label="亮度"
                  configKey="PARTICLE_BRIGHTNESS"
                  min={0.3}
                  max={2}
                  step={0.05}
                />
                <ConfigSlider
                  label="不透明度"
                  configKey="PARTICLE_OPACITY"
                  min={0.3}
                  max={1}
                  step={0.01}
                />
                <ConfigSlider
                  label="呼吸幅度"
                  configKey="PARTICLE_FLOAT_AMPLITUDE"
                  min={0}
                  max={0.05}
                  step={0.001}
                />
                <ConfigSlider
                  label="拖拽灵敏度"
                  configKey="DRAG_SENSITIVITY"
                  min={0.001}
                  max={0.02}
                  step={0.001}
                />
                <ConfigSlider
                  label="惯性摩擦"
                  configKey="FRICTION"
                  min={0.8}
                  max={0.99}
                  step={0.01}
                />
                <ConfigSlider
                  label="最大倾斜"
                  configKey="MAX_TILT"
                  min={0.1}
                  max={1.5}
                  step={0.05}
                  unit=" rad"
                />
              </CollapsibleSection>

              {/* === Reset button === */}
              <div className="mt-6 mb-4">
                <button
                  onClick={handleReset}
                  className="w-full rounded-full py-2.5 text-xs transition-all hover:opacity-80"
                  style={{
                    background: 'rgba(212, 168, 83, 0.12)',
                    border: '1px solid rgba(212, 168, 83, 0.25)',
                    color: 'rgba(212, 168, 83, 0.9)',
                  }}
                >
                  恢复默认设置
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
