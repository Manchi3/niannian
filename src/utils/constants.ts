/**
 * Global constants for Particle Diary.
 *
 * Colors, particle parameters, and system prompts are defined here
 * to ensure consistency across the application.
 *
 * The CONFIG object is a runtime-mutable single data source — the
 * AtmospherePanel imports it directly and modifies fields live.
 *
 * Round Auth: the CONFIG persistence key is uid-namespaced
 * (nn_${uid}_particle_atmosphere_config_v2) so each account keeps its own
 * atmosphere settings. Module-level reads fall back to the guest namespace
 * until restoreSession() resolves the real user (the auth store calls
 * reloadConfig() after resolving).
 */
import { nnKey } from './uid';

// ---------------------------------------------------------------------------
// CONFIG — Runtime-Mutable Single Data Source
// ---------------------------------------------------------------------------
// All tunable parameters in one object.  The AtmospherePanel imports CONFIG
// and mutates its fields at runtime; useParticleSystem reads from CONFIG
// each frame so changes take effect immediately.
// ---------------------------------------------------------------------------

export const CONFIG = {
  // --- Particle System ---
  /** Target particle count. 150k–250k for a fine dot-matrix look. */
  PARTICLE_COUNT: 200000,
  /** Base particle size (legacy — used with uSizeAttenuation). */
  PARTICLE_BASE_SIZE: 0.018,
  /** Depth strength: how much pixel brightness affects Z position. */
  DEPTH_STRENGTH: 0.3,
  /**
   * Z-axis thickness scale (0–1). 1.0 = full generated depth range,
   * small values (e.g. 0.15–0.3) crush the cloud into a thin "film"
   * while keeping subtle 3D relief. Applied as a shader uniform so it
   * takes effect live without rebuilding the particle geometry.
   */
  DEPTH_THICKNESS: 0.2,
  /** Sine-wave breathing amplitude. */
  PARTICLE_FLOAT_AMPLITUDE: 0.01,
  /** Color brightness multiplier (1.0 = exact image colors). */
  PARTICLE_BRIGHTNESS: 1.0,
  /** Per-particle opacity (1.0 = fully opaque). */
  PARTICLE_OPACITY: 0.95,
  /** Perspective size attenuation factor (legacy). */
  PARTICLE_SIZE_ATTENUATION: 300.0,

  // --- New Shader Parameters ---
  /** Direct point-size base (replaces uSize*uSizeAttenuation combo). */
  POINT_SIZE: 4.9,
  /** Perspective depth factor for point-size attenuation. */
  U_DEPTH: 28,
  /** Normalised edge distance at which spreading begins (0–1). */
  SPREAD_START: 0.60,
  /** Outward spread strength for edge particles. */
  SPREAD_STRENGTH: 163.0,
  /**
   * Edge scatter amplitude (world units). Larger = wider, softer halo of
   * scattered particles around the image edge, naturally fading into the
   * black background. Applies random-direction offsets scaled by distance
   * from the image center.
   */
  EDGE_SCATTER: 0.08,
  /** Normalised edge distance at which vignette fade begins (0–1). */
  VIGNETTE_START: 0.70,
  /** Global brightness multiplier applied in fragment shader. */
  BRIGHTNESS_ENHANCE: 1.0,

  // --- Mouse Repulsion ---
  /** Repulsion radius (in world units). Smaller = subtler sand-trail effect. */
  MOUSE_RADIUS: 0.12,
  /** Push force strength. 0.035 gives only a tiny nudge (0.05–0.08 world units). */
  MOUSE_STRENGTH: 0.035,
  /** Maximum displacement from mouse repulsion (hard cap). */
  MOUSE_DISPLACEMENT_MAX: 0.06,
  /**
   * Master scatter-strength multiplier (0–3, default 1.6). Scales the whole
   * mouse push displacement WITHOUT breaking the "no black hole" ring shape
   * (center stays at force=0; only the peak amplitude grows). Exposed as the
   * "散开程度" slider in the 力场与波动 panel group.
   */
  SCATTER_STRENGTH: 1.6,
  /** Brightness boost for particles near mouse — REMOVED (0 = colors stay pure). */
  MOUSE_BRIGHTNESS_BOOST: 0,
  /** Size multiplier for particles near mouse — REMOVED (1.0 = no size change). */
  MOUSE_SIZE_BOOST: 0,

  // --- Drag & Rotation ---
  /** Pointer drag sensitivity: radians of rotation per pixel moved. */
  DRAG_SENSITIVITY: 0.005,
  /** Velocity decay factor after drag release (0–1, lower = more friction). */
  FRICTION: 0.92,
  /** Maximum tilt angle in radians (clamped to ±MAX_TILT). */
  MAX_TILT: 0.6,
  /** Whether the cloud auto-returns to front after drag release. */
  AUTO_RETURN: true,
  /** Delay (seconds) after last interaction before auto-return begins. */
  RETURN_DELAY: 4.0,
  /** Lerp speed for auto-return toward front-facing orientation. */
  RETURN_SPEED: 0.02,
  /** Whether auto-return also restores camera zoom to default. */
  RETURN_RESTORE_ZOOM: true,

  // --- Camera Zoom ---
  /** Minimum camera Z distance (closest zoom-in — near enough to see grains). */
  CAMERA_MIN_Z: 0.35,
  /** Maximum camera Z distance (furthest zoom-out — fits whole image + halo). */
  CAMERA_MAX_Z: 12.0,
  /** Default camera Z distance (used on init and auto-return). ~1.5 shows the
   *  image at ~60–70% of screen width without covering the UI. */
  CAMERA_DEFAULT_Z: 1.5,
  /** Lerp factor for smooth camera zoom transitions. */
  CAMERA_ZOOM_LERP: 0.1,

  // --- Assemble Animation ---
  /** Duration of the assemble animation in seconds (random → target). */
  ASSEMBLE_DURATION: 2.5,

  // --- Click Ripple ---
  /** Maximum number of simultaneous ripples in the ring buffer. */
  RIPPLE_MAX_COUNT: 5,
  /** Speed at which the ripple ring expands (world units / second). */
  RIPPLE_SPEED: 1.5,
  /** Width of the ripple ring (world units). */
  RIPPLE_WIDTH: 0.3,
  /** Total duration of each ripple effect in seconds. */
  RIPPLE_DURATION: 1.2,
  /** Maximum push force applied to particles inside the ripple ring. */
  RIPPLE_STRENGTH: 0.15,

  // --- Custom Cursor ---
  /** Whether to show the custom cursor (ring + dot) and hide system cursor. */
  CUSTOM_CURSOR: true,

  // --- Visibility Toggles ---
  /** Hide non-image particles (reserved for future ambient particles). */
  HIDE_OTHER_PARTICLES: false,
  /** Hide floating star decorations (reserved for future ambient stars). */
  HIDE_FLOATING_STARS: false,
  /** Microphone-driven particle displacement (reserved for future feature). */
  MIC_DRIVE_PARTICLES: false,
};

/**
 * Deep clone of the initial CONFIG values — used by AtmospherePanel's
 * "reset" button to restore all parameters to their factory defaults.
 * Captured once at module load so it is not affected by later mutations.
 */
export const CONFIG_DEFAULTS: Readonly<Record<string, number | boolean>> =
  JSON.parse(JSON.stringify(CONFIG));

// ---------------------------------------------------------------------------
// localStorage persistence — load saved CONFIG on module init
// ---------------------------------------------------------------------------
// CONFIG_DEFAULTS is captured *before* loading from localStorage so that
// the "恢复默认设置" button always restores true factory defaults.
//
// NOTE (Round 15): the storage key was bumped to `_v2` so any cached config
// from previous versions (which contained an old CAMERA_DEFAULT_Z) is
// invalidated. Camera parameters are additionally excluded from both load
// and save, so the in-code default camera Z is ALWAYS respected and can
// never be overwritten by stale localStorage.
// ---------------------------------------------------------------------------

/** CONFIG keys that are never persisted — always use the in-code defaults. */
const NON_PERSISTED_KEYS = new Set<string>([
  'CAMERA_MIN_Z',
  'CAMERA_MAX_Z',
  'CAMERA_DEFAULT_Z',
]);

/** Apply the saved CONFIG (for the current uid) onto the live CONFIG object. */
function applySavedConfig(): void {
  try {
    const saved = localStorage.getItem(nnKey('particle_atmosphere_config_v2'));
    if (saved) {
      const parsed = JSON.parse(saved) as Record<string, unknown>;
      for (const key of Object.keys(parsed)) {
        if (!NON_PERSISTED_KEYS.has(key)) {
          (CONFIG as Record<string, unknown>)[key] = parsed[key];
        }
      }
    }
  } catch {
    // ignore corrupt storage — fall back to in-code defaults
  }
}

// Module init — capture defaults BEFORE applying any saved config.
applySavedConfig();

/**
 * Re-read the saved CONFIG for the CURRENT uid and apply it onto the live
 * CONFIG object. Called by authStore.restoreSession() after the user is
 * resolved (module-init reads may have loaded the guest config).
 */
export function reloadConfig(): void {
  applySavedConfig();
}

/**
 * Persist the current CONFIG to localStorage so it survives page refreshes.
 * Camera parameters are skipped (they always come from code defaults).
 */
export function saveConfig(): void {
  try {
    const toStore: Record<string, unknown> = {};
    const configObj = CONFIG as Record<string, unknown>;
    for (const key of Object.keys(configObj)) {
      if (!NON_PERSISTED_KEYS.has(key)) {
        toStore[key] = configObj[key];
      }
    }
    localStorage.setItem(nnKey('particle_atmosphere_config_v2'), JSON.stringify(toStore));
  } catch {
    // ignore quota / privacy-mode errors
  }
}

/**
 * Remove the persisted CONFIG from localStorage, restoring factory defaults
 * on next page load.
 */
export function clearConfig(): void {
  try {
    localStorage.removeItem(nnKey('particle_atmosphere_config_v2'));
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Color Palette  (static — not runtime-tunable)
// ---------------------------------------------------------------------------

export const COLORS = {
  /** Deep warm background gradient start. */
  bgStart: '#1b140f',
  /** Deep warm background gradient end. */
  bgEnd: '#080605',
  /** Gold accent — primary highlight color. */
  gold: 'rgba(212, 168, 83, 1)',
  /** Gold accent — soft background tint. */
  goldSoft: 'rgba(212, 168, 83, 0.07)',
  /** Gold accent — muted (50% opacity). */
  goldMuted: 'rgba(212, 168, 83, 0.5)',
  /** Light warm white — default text color. */
  warmWhite: '#E8DDD0',
  /** Light warm white — muted (60% opacity). */
  warmWhiteMuted: 'rgba(232, 221, 208, 0.6)',
  /** Glass panel background. */
  glassBg: 'rgba(255, 255, 255, 0.05)',
  /** Glass panel border. */
  glassBorder: 'rgba(255, 255, 255, 0.1)',
} as const;

// ---------------------------------------------------------------------------
// Image Upload Constraints  (static — not runtime-tunable)
// ---------------------------------------------------------------------------

/** Maximum allowed image file size in bytes (10 MB). */
export const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

/** Accepted image MIME types. */
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Accepted image file extensions (for fallback validation). */
export const ACCEPTED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'] as const;

// ---------------------------------------------------------------------------
// System Prompts  (static — not runtime-tunable)
// ---------------------------------------------------------------------------

/**
 * Greeting prompt — AI looks at the uploaded photo and initiates a warm conversation.
 */
export const SYSTEM_PROMPT_GREETING = `你是一个温暖的日记伙伴。用户上传了一张照片，请你像朋友一样自然地跟用户聊聊这张照片。
要求：
1. 根据照片内容发起对话，可以是描述你看到的、提问引导用户回忆
2. 语气温暖、口语化、像朋友聊天
3. 每次只说1-2句话，不要长篇大论
4. 不要使用markdown格式
5. 用中文回复`;

/**
 * Condense prompt — AI transforms the chat history into a first-person diary entry.
 */
export const SYSTEM_PROMPT_CONDENSE = `你是一个温柔的私人日记代笔者。你的任务是把一段聊天记录改写成一篇"我"写给自己的私密日记。

═══ 最高优先级铁律（违反任何一条即为失败）═══
1. 这篇日记的作者就是"我"自己，是我在夜深人静时翻日记本随手写的内心独白
2. 全文只能出现"我"，绝对不能出现以下任何词："你"、"我们"、"咱"、"念念"、"AI"、"你说"、"我问"、"聊起"、"提到"、"说道"
3. 绝对禁止用"我聊起「…」"、"我说「…」"、"今天和…聊了…"这种句式——这不是日记，这是聊天记录转述
4. 绝对禁止逐条复述对话内容。你要做的是：读完聊天 → 理解发生了什么 → 忘掉对话形式 → 用"我"的口吻重新讲述感受和事件
5. 日记里不能有任何"对话感"——不能有问答、不能有引用别人的话、不能有"对方说"

═══ 写作要求 ═══
1. 篇幅 80-120 字，2-3 个短段，用 \\n 分隔
2. 语气私密、内向、真实，像自言自语，有普通人的情绪波动
3. 融合今天发生的事、看到的画面（如有图片就写图片带给我的感受）、当下的心情
4. 不要编造不存在的情节，但可以合理延伸内心感受
5. 不用华丽辞藻，少文艺堆砌，像随手写的日常
6. 不需要日期装饰，正文为主

═══ 标题要求 ═══
4-8个字，有画面感或情绪温度。禁止"无题""日记""日记一则"等占位文字。

═══ 输出格式 ═══
只输出严格JSON：{"title": "标题", "content": "正文"}
正文换行用 \\n 表示。用中文。

═══ 反面示例（你的输出如果出现类似风格，就是失败的）═══
❌ "我聊起「这是我的桌面壁纸啦」。我聊起「一点点吧」。"
❌ "今天和念念聊了很久，她说我的画很好看。"
❌ "你问我喜不喜欢画画，我说光看不动手。"
❌ "我们讨论了关于桌面的话题，我觉得…"

═══ 正面示例（这才是正确的日记）═══
✅ "下午盯着桌面壁纸发了会儿呆，那个地球慢慢转的样子，看着看着心就静了。最近有点累，想换换心情。自行车还扔在学校没骑回来，出门只能走路，烦是烦了点，但走走也挺好的，说不定能碰见什么有意思的事。"

✅ "翻到一张雾里的森林画，光线透进来的样子真舒服，好像闻到了草木味。其实我也不知道那是什么地方。手残党一个，连圆都画不圆，但光看看也挺好，至少眼睛会了。"`;

// ---------------------------------------------------------------------------
// API Configuration  (static — not runtime-tunable)
// ---------------------------------------------------------------------------

/**
 * Default model name for DeepSeek.
 *
 * NOTE: This constant is frontend-only and does NOT drive generation —
 * the value actually used comes from `server/constants.ts` (overridable via
 * the `DEEPSEEK_MODEL` env var). Kept in sync to avoid confusion.
 * `deepseek-chat` / `deepseek-reasoner` are legacy aliases retired 2026-07-24.
 */
export const DEFAULT_MODEL = 'deepseek-v4-flash';

/** API base URL for the Express backend (proxied through Vite in dev). */
export const API_BASE_URL = '/api';
