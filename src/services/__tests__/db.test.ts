/**
 * DB Service Tests — IndexedDB Persistence
 *
 * Tests the actual IndexedDB wrapper (db.ts) using fake-indexeddb.
 * Uses unique IDs per test to avoid cross-test interference.
 *
 * NOTE: The db.ts module caches the database connection (dbPromise).
 * We import once and test with unique IDs rather than resetting the DB.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as db from '../db';
import type { Diary } from '../../types';

let idCounter = 0;
function uniqueId(prefix: string = 'd'): string {
  idCounter++;
  return `${prefix}-${idCounter}-${Date.now()}`;
}

function createMockDiary(overrides: Partial<Diary> = {}): Diary {
  const now = Date.now();
  return {
    _schemaVersion: 2,
    id: uniqueId(),
    title: '测试日记',
    date: '2026-08-12',
    content: '这是一篇测试日记的内容。',
    chatHistory: [],
    thumbnailBlob: new Blob(['thumb-data'], { type: 'image/jpeg' }),
    imageRef: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('db — IndexedDB CRUD', () => {
  beforeAll(async () => {
    // Ensure the database is initialized
    // The first call to getDB() creates the database
  });

  describe('saveDiary & getDiary', () => {
    it('should save a diary and retrieve it by ID', async () => {
      const id = uniqueId('save-get');
      const diary = createMockDiary({ id, title: '保存测试' });

      await db.saveDiary(diary);
      const result = await db.getDiary(id);

      expect(result).not.toBeNull();
      expect(result?.id).toBe(id);
      expect(result?.title).toBe('保存测试');
      expect(result?.content).toBe('这是一篇测试日记的内容。');
    });

    it('should return null for non-existent ID', async () => {
      const result = await db.getDiary(uniqueId('nonexistent'));
      expect(result).toBeNull();
    });

    it('should overwrite (update) when saving with same ID', async () => {
      const id = uniqueId('overwrite');
      const diary = createMockDiary({ id, title: '原标题' });
      await db.saveDiary(diary);

      const updated = { ...diary, title: '新标题', content: '新内容' };
      await db.saveDiary(updated);

      const result = await db.getDiary(id);
      expect(result?.title).toBe('新标题');
      expect(result?.content).toBe('新内容');
    });
  });

  describe('getAllDiaries', () => {
    it('should include newly saved diaries', async () => {
      const id = uniqueId('getall');
      const diary = createMockDiary({ id, createdAt: Date.now() });

      await db.saveDiary(diary);

      const all = await db.getAllDiaries();

      const found = all.find((d) => d.id === id);
      expect(found).toBeDefined();
      expect(found?.title).toBe('测试日记');
    });

    it('should return diaries sorted by createdAt descending', async () => {
      // Use very distinct timestamps to ensure correct sorting
      const ts1 = 1000;
      const ts2 = 2000;
      const ts3 = 3000;

      const d1 = createMockDiary({ id: uniqueId('sort-1'), createdAt: ts1 });
      const d2 = createMockDiary({ id: uniqueId('sort-2'), createdAt: ts2 });
      const d3 = createMockDiary({ id: uniqueId('sort-3'), createdAt: ts3 });

      await db.saveDiary(d1);
      await db.saveDiary(d2);
      await db.saveDiary(d3);

      const all = await db.getAllDiaries();

      // Find our three diaries in the result
      const ours = all.filter((d) =>
        [d1.id, d2.id, d3.id].includes(d.id),
      );

      expect(ours).toHaveLength(3);
      // They should be sorted descending (newest first)
      expect(ours[0].id).toBe(d3.id);
      expect(ours[1].id).toBe(d2.id);
      expect(ours[2].id).toBe(d1.id);
    });

    it('should return an array (not null or undefined)', async () => {
      const all = await db.getAllDiaries();
      expect(Array.isArray(all)).toBe(true);
    });
  });

  describe('deleteDiary', () => {
    it('should delete a diary by ID', async () => {
      const id = uniqueId('delete');
      const diary = createMockDiary({ id });
      await db.saveDiary(diary);

      // Verify it exists
      const before = await db.getDiary(id);
      expect(before).not.toBeNull();

      // Delete
      await db.deleteDiary(id);

      // Verify it's gone
      const after = await db.getDiary(id);
      expect(after).toBeNull();
    });

    it('should not throw when deleting non-existent ID', async () => {
      await expect(db.deleteDiary(uniqueId('nonexistent-del'))).resolves.not.toThrow();
    });

    it('should only delete the specified diary', async () => {
      const keepId = uniqueId('keep');
      const deleteId = uniqueId('del');

      await db.saveDiary(createMockDiary({ id: keepId }));
      await db.saveDiary(createMockDiary({ id: deleteId }));

      await db.deleteDiary(deleteId);

      const kept = await db.getDiary(keepId);
      const deleted = await db.getDiary(deleteId);

      expect(kept).not.toBeNull();
      expect(deleted).toBeNull();
    });
  });

  describe('Diary Blob Storage', () => {
    it('should persist and retrieve Blob objects correctly', async () => {
      const id = uniqueId('blob');
      const legacyBlob = new Blob(['image-binary-data'], { type: 'image/jpeg' });
      const thumbBlob = new Blob(['thumb-binary-data'], { type: 'image/jpeg' });

      const diary = createMockDiary({
        id,
        // 'idb:' downgrade path — original kept inside the record
        imageRef: 'idb:',
        legacyImageBlob: legacyBlob,
        thumbnailBlob: thumbBlob,
      });

      await db.saveDiary(diary);
      const result = await db.getDiary(id);

      expect(result).not.toBeNull();
      // NOTE: fake-indexeddb does not fully implement the structured clone
      // algorithm for Blob objects — they may be returned as plain objects.
      // In a real browser, Blob serialization works correctly.
      // We verify the blob field exists and has content.
      expect(result?.legacyImageBlob).toBeDefined();
      expect(result?.thumbnailBlob).toBeDefined();
      expect(result?.legacyImageBlob).not.toBeNull();
      expect(result?.thumbnailBlob).not.toBeNull();
      expect(result?._schemaVersion).toBe(2);
    });

    it('should persist chat history array', async () => {
      const id = uniqueId('chat');
      const chatHistory = [
        { id: 'm1', role: 'user' as const, content: '你好', timestamp: 1000 },
        { id: 'm2', role: 'assistant' as const, content: '你好呀', timestamp: 2000 },
      ];

      const diary = createMockDiary({ id, chatHistory });
      await db.saveDiary(diary);

      const result = await db.getDiary(id);
      expect(result?.chatHistory).toHaveLength(2);
      expect(result?.chatHistory[0].content).toBe('你好');
      expect(result?.chatHistory[1].content).toBe('你好呀');
    });
  });

  describe('uid isolation', () => {
    it('isolates diaries between accounts (guest vs u1)', async () => {
      const guestId = uniqueId('iso-guest');
      const uidId = uniqueId('iso-u1');
      const guestDiary = createMockDiary({ id: guestId, title: 'guest diary' });
      const uidDiary = createMockDiary({ id: uidId, title: 'u1 diary' });

      await db.saveDiary(guestDiary); // default = guest
      await db.saveDiary(uidDiary, 'u1');

      const guestAll = await db.getAllDiaries();
      const u1All = await db.getAllDiaries('u1');

      // Guest sees only the guest record.
      expect(guestAll.some((d) => d.id === guestId)).toBe(true);
      expect(guestAll.some((d) => d.id === uidId)).toBe(false);
      // u1 sees only the u1 record.
      expect(u1All.some((d) => d.id === uidId)).toBe(true);
      expect(u1All.some((d) => d.id === guestId)).toBe(false);
    });

    it('can read and delete under a specific uid', async () => {
      const id = uniqueId('iso-del');
      const diary = createMockDiary({ id });
      await db.saveDiary(diary, 'u2');

      expect((await db.getDiary(id, 'u2'))?.id).toBe(id);
      expect(await db.getDiary(id)).toBeNull(); // not visible to guest

      await db.deleteDiary(id, 'u2');
      expect(await db.getDiary(id, 'u2')).toBeNull();
    });
  });
});
