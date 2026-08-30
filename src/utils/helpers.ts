import { ACCEPTED_IMAGE_TYPES, ACCEPTED_IMAGE_EXTENSIONS, MAX_IMAGE_SIZE } from './constants';
import type { Message } from '../types';

/**
 * Utility helper functions for Particle Diary.
 */

/**
 * Generate a UUID v4 using the Web Crypto API.
 * Falls back to a timestamp-based UUID if crypto.randomUUID is unavailable.
 */
export function generateId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for older browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Format a timestamp into a human-readable date string.
 * @param timestamp — Unix timestamp in milliseconds
 * @returns Formatted date string (e.g., "2026年8月12日")
 */
export function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${year}年${month}月${day}日`;
}

/**
 * Format a timestamp into an ISO 8601 date string (YYYY-MM-DD).
 * @param timestamp — Unix timestamp in milliseconds
 * @returns Date string in YYYY-MM-DD format
 */
export function formatDateISO(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Format a timestamp into a time string (HH:MM).
 * @param timestamp — Unix timestamp in milliseconds
 * @returns Time string in HH:MM format
 */
export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Format a timestamp for a memory's meta line:
 * "2026.08.16 12:52 · 周日" (dotted date + time + Chinese weekday).
 * @param timestamp — Unix timestamp in milliseconds
 * @returns Meta string used by the long-term memory list
 */
export function formatDotDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  const p = (n: number): string => String(n).padStart(2, '0');
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return `${date.getFullYear()}.${p(date.getMonth() + 1)}.${p(date.getDate())} ${p(
    date.getHours(),
  )}:${p(date.getMinutes())} · ${weekdays[date.getDay()]}`;
}

/**
 * Format a timestamp into a relative time string (e.g., "刚刚", "3分钟前").
 * @param timestamp — Unix timestamp in milliseconds
 * @returns Human-readable relative time
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 10) return '刚刚';
  if (seconds < 60) return `${seconds}秒前`;
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 30) return `${days}天前`;
  return formatDate(timestamp);
}

/**
 * Validate an image file against accepted types and size limits.
 * @param file — The File object to validate
 * @returns An error message string if invalid, null if valid
 */
export function validateImageFile(file: File): string | null {
  // Check file type by MIME type
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type as (typeof ACCEPTED_IMAGE_TYPES)[number])) {
    // Fallback: check by file extension
    const ext = '.' + (file.name.split('.').pop() ?? '').toLowerCase();
    if (!ACCEPTED_IMAGE_EXTENSIONS.includes(ext as (typeof ACCEPTED_IMAGE_EXTENSIONS)[number])) {
      return '仅支持 JPG、PNG、WebP 格式的图片';
    }
  }

  // Check file size
  if (file.size > MAX_IMAGE_SIZE) {
    return '图片大小不能超过 10MB';
  }

  return null;
}

/**
 * Convert a Blob to a base64 data URI.
 * @param blob — The Blob to convert
 * @returns A Promise resolving to a data URI string
 */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read blob as data URL'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Convert a Blob to an HTMLImageElement.
 * @param blob — The Blob to convert
 * @returns A Promise resolving to an HTMLImageElement
 */
export function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      // Image data is now decoded into the element — safe to release the object URL
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image from blob'));
    };
    img.src = url;
  });
}

/**
 * Clamp a value between a minimum and maximum.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Linear interpolation between two values.
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Format file size in bytes to a human-readable string.
 * @param bytes — File size in bytes
 * @returns Human-readable size (e.g., "1.5 MB")
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Round 18: Title fallback
// ---------------------------------------------------------------------------

/**
 * Heuristic list of "placeholder" titles that indicate the AI returned
 * something unhelpful. We use this to decide whether to fall back to
 * the client-side title generator.
 */
const PLACEHOLDER_TITLE_PATTERNS: RegExp[] = [
  /^无题$/,
  /^无题[·\-—\s]*[\u4e00-\u9fa5]{0,4}$/, // "无题·xxx"
  /^日记$/,
  /^日记一则$/,
  /^未命名$/,
  /^untitled$/i,
  /^\s*$/,
];

/**
 * Returns true when the supplied title looks like a placeholder the AI
 * generated because it couldn't come up with a real one.
 */
export function isPlaceholderTitle(title: string | null | undefined): boolean {
  if (!title) return true;
  const trimmed = title.trim();
  if (!trimmed) return true;
  return PLACEHOLDER_TITLE_PATTERNS.some((p) => p.test(trimmed));
}

/**
 * Strip punctuation characters common in chat (commas, periods, question
 * marks, Chinese full-width equivalents) to derive a clean key phrase.
 */
function cleanChatText(raw: string): string {
  return raw
    // Includes ASCII punctuation + full-width Chinese punctuation:
    //   , , . 。 ; ; : ： ! ! ? ? — — " " ' ' ` ` ~ ~
    //   ( ) ( ) [ ] [ ] { } { } < > < > / \ / \ | | _ + = *
    .replace(
      /[\s,。，．;；:：!！?？—－_＿__'"''"`\``~～\/＼|｜+＋=＝*＊<＞《》【】()()\[\]｛｝{}<>]/g,
      '',
    )
    .trim();
}

/**
 * Pick a short window from the start of the cleaned CJK string.
 *
 * - Caps the length at `max` characters.
 * - Snaps back from the cap to drop any trailing Chinese aspect particles
 *   ("了", "的", "着", "过") so the appended suffix reads naturally.
 * - Otherwise leaves the string as-is.
 */
function headWindow(cleaned: string, max: number): string {
  if (cleaned.length <= max) return cleaned;
  let end = max;
  // Try to avoid stranded particles by walking back 1-3 chars past the cap
  // looking for a "clean" boundary.
  for (let back = 1; back <= 3 && end - back > Math.max(1, max - 4); back++) {
    const tail = cleaned.charAt(end - back);
    if (tail !== '了' && tail !== '的' && tail !== '着' && tail !== '过') {
      end = end - back + 1; // include the safe character
      break;
    }
  }
  return cleaned.slice(0, end);
}

/**
 * Local fallback title generator.
 *
 * Strategy (in priority order):
 *   1. Take the user's first user-role message, strip punctuation,
 *      take the first ~8 characters.
 *   2. If that's empty, take the first AI response and do the same.
 *   3. If still empty, return timestamped "今天的回忆".
 *
 * The result is always a non-empty string.
 */
export function deriveFallbackTitle(messages: Message[]): string {
  const userFirst = messages.find((m) => m.role === 'user');
  const assistantFirst = messages.find((m) => m.role === 'assistant');
  const candidate = userFirst ?? assistantFirst;
  if (candidate) {
    const cleaned = cleanChatText(candidate.content);
    if (cleaned.length > 0) {
      const head = headWindow(cleaned, 8);
      return `${head}的回忆`;
    }
  }
  // Final fallback — dated placeholder
  const now = new Date();
  return `${now.getMonth() + 1}月${now.getDate()}日的回忆`;
}

/**
 * Resolve a diary title: prefer `provided`, fall back to `deriveFallbackTitle`
 * when `provided` is missing or a placeholder.
 */
export function resolveDiaryTitle(
  provided: string | null | undefined,
  messages: Message[],
): string {
  if (!isPlaceholderTitle(provided)) {
    return provided!.trim();
  }
  return deriveFallbackTitle(messages);
}

// ---------------------------------------------------------------------------
// Round 22: condense result validation + local fallback template
// ---------------------------------------------------------------------------

/**
 * A condense result is only writable when the title is a real (non
 * placeholder) string AND the body contains at least one non-empty
 * paragraph. This is the guard that prevents "blank diary" records.
 */
export function isValidCondenseResult(
  result: { title?: string | null; content?: string | null } | null | undefined,
): boolean {
  if (!result) return false;
  const title = typeof result.title === 'string' ? result.title.trim() : '';
  const content = typeof result.content === 'string' ? result.content.trim() : '';
  if (!title || isPlaceholderTitle(title)) return false;
  const paragraphs = content
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  return paragraphs.length >= 1;
}

/**
 * Build a guaranteed-non-empty diary from the local chat history when the
 * LLM condense keeps failing. The title is derived from the conversation
 * (image/first message). The body is a calm, generic first-person reflection
 * that NEVER transcribes the user's own words (no "我聊起「…」" chat-log
 * style) — it is only a last-resort safety net, never the primary output.
 */
export function buildFallbackDiary(messages: Message[]): {
  title: string;
  content: string;
} {
  const title = deriveFallbackTitle(messages) || '今天的碎片';
  const content =
    '今天有些话没说出口，但看着这张照片，心里是安静的。' +
    '日子就是这样，一点点过去，留下一点光。';
  return { title, content };
}

/**
 * Round 29 (③): relaxed gate for the condense result. Only the three core
 * rules survive — the diary must be (1) non-empty, (2) ≥40 characters, and
 * (3) written in the first person (我 / 咱 / 咱们). The old over-strict
 * "forbidden words" regex (聊起 / 「」 / 你说 / 我们 / 咱 …) that wrongly
 * killed perfectly good first-person diaries has been REMOVED. Tone, emotion
 * and persona are enforced purely by the system prompt, never by a client
 * gate — so a normal "咱们今天…" diary is no longer mis-flagged.
 *
 * @returns true when the diary is acceptable to persist.
 */
export function isDiaryAcceptable(content: string | null | undefined): boolean {
  if (!content) return false;
  const trimmed = content.trim();
  if (trimmed.length < 40) return false; // non-empty + long enough
  // First person: 我 / 咱 / 咱们 (also covers 我的 / 我们 / 咱们)
  return /[我咱]/.test(trimmed) || trimmed.includes('咱们');
}
