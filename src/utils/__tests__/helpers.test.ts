/**
 * Helpers Tests — Utility Functions
 *
 * Tests image file validation, date formatting, UUID generation,
 * and other utility functions.
 */
import { describe, it, expect } from 'vitest';
import {
  generateId,
  formatDate,
  formatDateISO,
  formatTime,
  validateImageFile,
  clamp,
  lerp,
  formatFileSize,
  isPlaceholderTitle,
  deriveFallbackTitle,
  resolveDiaryTitle,
} from '../helpers';
import { MAX_IMAGE_SIZE } from '../constants';
import type { Message } from '../../types';

describe('helpers — Utility Functions', () => {
  // ---------------------------------------------------------------------------
  // generateId
  // ---------------------------------------------------------------------------
  describe('generateId', () => {
    it('should return a string', () => {
      const id = generateId();
      expect(typeof id).toBe('string');
    });

    it('should generate unique ids', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateId());
      }
      expect(ids.size).toBe(100);
    });

    it('should produce a UUID-like format (36 chars with dashes)', () => {
      const id = generateId();
      // UUID v4 format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });
  });

  // ---------------------------------------------------------------------------
  // formatDate
  // ---------------------------------------------------------------------------
  describe('formatDate', () => {
    it('should format a timestamp as Chinese date string', () => {
      const ts = new Date(2026, 7, 12).getTime(); // Aug 12, 2026
      const result = formatDate(ts);
      expect(result).toBe('2026年8月12日');
    });

    it('should format January 1st correctly', () => {
      const ts = new Date(2026, 0, 1).getTime(); // Jan 1, 2026
      const result = formatDate(ts);
      expect(result).toBe('2026年1月1日');
    });

    it('should format December 31st correctly', () => {
      const ts = new Date(2026, 11, 31).getTime(); // Dec 31, 2026
      const result = formatDate(ts);
      expect(result).toBe('2026年12月31日');
    });
  });

  // ---------------------------------------------------------------------------
  // formatDateISO
  // ---------------------------------------------------------------------------
  describe('formatDateISO', () => {
    it('should format as YYYY-MM-DD', () => {
      const ts = new Date(2026, 7, 12).getTime();
      const result = formatDateISO(ts);
      expect(result).toBe('2026-08-12');
    });

    it('should pad month and day with zeros', () => {
      const ts = new Date(2026, 0, 5).getTime(); // Jan 5
      const result = formatDateISO(ts);
      expect(result).toBe('2026-01-05');
    });

    it('should handle single digit month and day', () => {
      const ts = new Date(2026, 2, 9).getTime(); // Mar 9
      const result = formatDateISO(ts);
      expect(result).toBe('2026-03-09');
    });
  });

  // ---------------------------------------------------------------------------
  // formatTime
  // ---------------------------------------------------------------------------
  describe('formatTime', () => {
    it('should format as HH:MM', () => {
      const ts = new Date(2026, 7, 12, 14, 30).getTime();
      const result = formatTime(ts);
      expect(result).toBe('14:30');
    });

    it('should pad hours and minutes with zeros', () => {
      const ts = new Date(2026, 7, 12, 9, 5).getTime();
      const result = formatTime(ts);
      expect(result).toBe('09:05');
    });

    it('should format midnight as 00:00', () => {
      const ts = new Date(2026, 7, 12, 0, 0).getTime();
      const result = formatTime(ts);
      expect(result).toBe('00:00');
    });
  });

  // ---------------------------------------------------------------------------
  // validateImageFile
  // ---------------------------------------------------------------------------
  describe('validateImageFile', () => {
    it('should accept JPG files', () => {
      const file = new File(['data'], 'test.jpg', { type: 'image/jpeg' });
      expect(validateImageFile(file)).toBeNull();
    });

    it('should accept PNG files', () => {
      const file = new File(['data'], 'test.png', { type: 'image/png' });
      expect(validateImageFile(file)).toBeNull();
    });

    it('should accept WebP files', () => {
      const file = new File(['data'], 'test.webp', { type: 'image/webp' });
      expect(validateImageFile(file)).toBeNull();
    });

    it('should reject GIF files', () => {
      const file = new File(['data'], 'test.gif', { type: 'image/gif' });
      const error = validateImageFile(file);
      expect(error).not.toBeNull();
      expect(error).toContain('JPG');
    });

    it('should reject BMP files', () => {
      const file = new File(['data'], 'test.bmp', { type: 'image/bmp' });
      const error = validateImageFile(file);
      expect(error).not.toBeNull();
    });

    it('should reject files larger than 10MB', () => {
      // Create a file that's exactly MAX_IMAGE_SIZE + 1
      const largeContent = new Uint8Array(MAX_IMAGE_SIZE + 1);
      const file = new File([largeContent], 'test.jpg', { type: 'image/jpeg' });
      const error = validateImageFile(file);
      expect(error).not.toBeNull();
      expect(error).toContain('10MB');
    });

    it('should accept files exactly at 10MB limit', () => {
      const content = new Uint8Array(MAX_IMAGE_SIZE);
      const file = new File([content], 'test.jpg', { type: 'image/jpeg' });
      const error = validateImageFile(file);
      expect(error).toBeNull();
    });

    it('should accept files just under 10MB', () => {
      const content = new Uint8Array(MAX_IMAGE_SIZE - 1);
      const file = new File([content], 'test.jpg', { type: 'image/jpeg' });
      const error = validateImageFile(file);
      expect(error).toBeNull();
    });

    it('should use file extension as fallback when MIME type is missing', () => {
      // Some browsers may not set MIME type for certain files
      const file = new File(['data'], 'test.jpg', { type: '' });
      const error = validateImageFile(file);
      expect(error).toBeNull();
    });

    it('should reject files with unknown extension when MIME type is missing', () => {
      const file = new File(['data'], 'test.xyz', { type: '' });
      const error = validateImageFile(file);
      expect(error).not.toBeNull();
    });

    it('should accept .jpeg extension as fallback', () => {
      const file = new File(['data'], 'test.jpeg', { type: '' });
      const error = validateImageFile(file);
      expect(error).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // clamp
  // ---------------------------------------------------------------------------
  describe('clamp', () => {
    it('should return value when within range', () => {
      expect(clamp(5, 0, 10)).toBe(5);
    });

    it('should clamp to minimum', () => {
      expect(clamp(-5, 0, 10)).toBe(0);
    });

    it('should clamp to maximum', () => {
      expect(clamp(15, 0, 10)).toBe(10);
    });

    it('should handle equal min and max', () => {
      expect(clamp(5, 5, 5)).toBe(5);
    });

    it('should handle negative ranges', () => {
      expect(clamp(-3, -10, -1)).toBe(-3);
      expect(clamp(-15, -10, -1)).toBe(-10);
      expect(clamp(0, -10, -1)).toBe(-1);
    });
  });

  // ---------------------------------------------------------------------------
  // lerp
  // ---------------------------------------------------------------------------
  describe('lerp', () => {
    it('should interpolate at t=0 (returns a)', () => {
      expect(lerp(0, 10, 0)).toBe(0);
    });

    it('should interpolate at t=1 (returns b)', () => {
      expect(lerp(0, 10, 1)).toBe(10);
    });

    it('should interpolate at t=0.5 (returns midpoint)', () => {
      expect(lerp(0, 10, 0.5)).toBe(5);
    });

    it('should handle negative values', () => {
      expect(lerp(-10, 10, 0.5)).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // formatFileSize
  // ---------------------------------------------------------------------------
  describe('formatFileSize', () => {
    it('should format bytes', () => {
      expect(formatFileSize(500)).toBe('500 B');
    });

    it('should format kilobytes', () => {
      expect(formatFileSize(1024)).toBe('1.0 KB');
    });

    it('should format megabytes', () => {
      expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
    });

    it('should format fractional megabytes', () => {
      expect(formatFileSize(1024 * 1024 * 1.5)).toBe('1.5 MB');
    });
  });

  // ---------------------------------------------------------------------------
  // isPlaceholderTitle (Round 18)
  // ---------------------------------------------------------------------------
  describe('isPlaceholderTitle', () => {
    it('should treat "无题" as a placeholder', () => {
      expect(isPlaceholderTitle('无题')).toBe(true);
    });

    it('should treat empty / whitespace titles as placeholders', () => {
      expect(isPlaceholderTitle('')).toBe(true);
      expect(isPlaceholderTitle('   ')).toBe(true);
      expect(isPlaceholderTitle(null)).toBe(true);
      expect(isPlaceholderTitle(undefined)).toBe(true);
    });

    it('should treat "日记一则" and "未命名" as placeholders', () => {
      expect(isPlaceholderTitle('日记一则')).toBe(true);
      expect(isPlaceholderTitle('未命名')).toBe(true);
    });

    it('should NOT treat meaningful titles as placeholders', () => {
      expect(isPlaceholderTitle('海边的风')).toBe(false);
      expect(isPlaceholderTitle('深夜的旧友')).toBe(false);
      expect(isPlaceholderTitle('夏天')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // deriveFallbackTitle (Round 18)
  // ---------------------------------------------------------------------------
  describe('deriveFallbackTitle', () => {
    const mkMsg = (role: 'user' | 'assistant', content: string): Message => ({
      id: `m-${role}-${content.length}`,
      role,
      content,
      timestamp: 1,
    });

    it('should take the first user message and prefix with "的回忆"', () => {
      const messages = [
        mkMsg('user', '今天去了海边，看了日落'),
        mkMsg('assistant', '听起来很美'),
      ];
      const title = deriveFallbackTitle(messages);
      // "今天去了海边看了日落" → head(8) but snap back to avoid trailing "了"
      // → "今天去了海边看" → + "的回忆" → "今天去了海边看的回忆"
      expect(title).toBe('今天去了海边看的回忆');
      expect(title.length).toBeGreaterThan(0);
      expect(title.endsWith('的回忆')).toBe(true);
    });

    it('should strip punctuation and trim whitespace', () => {
      const messages = [mkMsg('user', '  海边？海浪！风。  ')];
      const title = deriveFallbackTitle(messages);
      expect(title).toBe('海边海浪风的回忆');
    });

    it('should fall back to assistant message when no user messages', () => {
      const messages = [mkMsg('assistant', 'AI在思考')];
      const title = deriveFallbackTitle(messages);
      expect(title).toBe('AI在思考的回忆');
    });

    it('should return dated placeholder when there are no usable messages', () => {
      const title = deriveFallbackTitle([]);
      // Format: "M月D日的回忆"
      expect(title.endsWith('日的回忆')).toBe(true);
      expect(title.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // resolveDiaryTitle (Round 18)
  // ---------------------------------------------------------------------------
  describe('resolveDiaryTitle', () => {
    const messages: Message[] = [
      { id: 'm1', role: 'user', content: '今天去海边', timestamp: 1 },
    ];

    it('should keep a meaningful title when provided', () => {
      expect(resolveDiaryTitle('深夜的旧友', messages)).toBe('深夜的旧友');
    });

    it('should fall back to deriveFallbackTitle when title is missing', () => {
      expect(resolveDiaryTitle('', messages)).toBe('今天去海边的回忆');
      expect(resolveDiaryTitle(null, messages)).toBe('今天去海边的回忆');
      expect(resolveDiaryTitle(undefined, messages)).toBe('今天去海边的回忆');
    });

    it('should fall back when title is a placeholder', () => {
      expect(resolveDiaryTitle('无题', messages)).toBe('今天去海边的回忆');
      expect(resolveDiaryTitle('日记', messages)).toBe('今天去海边的回忆');
      expect(resolveDiaryTitle('日记一则', messages)).toBe('今天去海边的回忆');
    });

    it('should trim whitespace from kept titles', () => {
      expect(resolveDiaryTitle('  深夜的旧友  ', messages)).toBe('深夜的旧友');
    });
  });
});
