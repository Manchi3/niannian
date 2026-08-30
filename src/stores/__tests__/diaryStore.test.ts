/**
 * DiaryStore Tests — CRUD Operations
 *
 * Verifies that diary entries can be created, read, updated, and
 * deleted through the diary store. Uses a mocked db module for
 * store-level logic testing, ensuring full test isolation.
 *
 * The actual IndexedDB persistence is tested separately in db.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Diary, Message } from '../../types';

// ---------------------------------------------------------------------------
// Mock the db module to isolate store logic from IndexedDB
// ---------------------------------------------------------------------------
const mockSaveDiary = vi.fn();
const mockGetDiary = vi.fn();
const mockGetAllDiaries = vi.fn();
const mockDeleteDiary = vi.fn();

vi.mock('../../services/db', () => ({
  saveDiary: (...args: unknown[]) => mockSaveDiary(...args),
  getDiary: (...args: unknown[]) => mockGetDiary(...args),
  getAllDiaries: (...args: unknown[]) => mockGetAllDiaries(...args),
  deleteDiary: (...args: unknown[]) => mockDeleteDiary(...args),
}));

vi.mock('../../services/imageStore', () => ({
  saveOriginalImage: async () => null, // force 'idb:' downgrade in tests
  getOriginalImage: async () => null,
  deleteOriginalImage: async () => undefined,
}));

// Import after mock setup
import { useDiaryStore } from '../diaryStore';

// Helper to create a mock diary
function createMockDiary(overrides: Partial<Diary> = {}): Diary {
  const now = Date.now();
  return {
    _schemaVersion: 2,
    id: `test-diary-${Math.random().toString(36).slice(2)}`,
    title: '测试日记',
    date: '2026-08-12',
    content: '这是一篇测试日记的内容。',
    chatHistory: [
      {
        id: 'msg-1',
        role: 'user',
        content: '你好',
        timestamp: now,
      },
      {
        id: 'msg-2',
        role: 'assistant',
        content: '你好呀！',
        timestamp: now + 1000,
      },
    ] as Message[],
    imageRef: null,
    thumbnailBlob: new Blob(['thumb-data'], { type: 'image/jpeg' }),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('diaryStore — CRUD Operations', () => {
  beforeEach(() => {
    // Reset store state
    useDiaryStore.setState({
      diaryList: [],
      currentDiary: null,
      isLoadingList: false,
    });

    // Reset mock implementations
    mockSaveDiary.mockReset();
    mockGetDiary.mockReset();
    mockGetAllDiaries.mockReset();
    mockDeleteDiary.mockReset();

    // Default mock implementations
    mockSaveDiary.mockResolvedValue(undefined);
    mockDeleteDiary.mockResolvedValue(undefined);
    mockGetAllDiaries.mockResolvedValue([]);
    mockGetDiary.mockResolvedValue(null);
  });

  describe('Initial State', () => {
    it('should have empty diaryList', () => {
      expect(useDiaryStore.getState().diaryList).toEqual([]);
    });

    it('should have null currentDiary', () => {
      expect(useDiaryStore.getState().currentDiary).toBe(null);
    });

    it('should not be loading initially', () => {
      expect(useDiaryStore.getState().isLoadingList).toBe(false);
    });
  });

  describe('saveDiary (Create)', () => {
    it('should call db.saveDiary with the diary and the current uid', async () => {
      const diary = createMockDiary();

      await useDiaryStore.getState().saveDiary(diary);

      expect(mockSaveDiary).toHaveBeenCalledWith(diary, 'guest');
    });

    it('should add the diary to diaryList', async () => {
      const diary = createMockDiary();

      await useDiaryStore.getState().saveDiary(diary);

      expect(useDiaryStore.getState().diaryList).toHaveLength(1);
      expect(useDiaryStore.getState().diaryList[0].id).toBe(diary.id);
    });

    it('should set the saved diary as currentDiary', async () => {
      const diary = createMockDiary();

      await useDiaryStore.getState().saveDiary(diary);

      expect(useDiaryStore.getState().currentDiary?.id).toBe(diary.id);
    });
  });

  describe('saveDiary (Update)', () => {
    it('should update an existing diary in-place', async () => {
      const diary = createMockDiary({ title: '原标题' });
      await useDiaryStore.getState().saveDiary(diary);

      // Update the diary
      const updated = { ...diary, title: '修改后的标题', updatedAt: Date.now() };
      await useDiaryStore.getState().saveDiary(updated);

      expect(useDiaryStore.getState().diaryList).toHaveLength(1);
      expect(useDiaryStore.getState().diaryList[0].title).toBe('修改后的标题');
    });

    it('should not add a new entry when updating existing diary', async () => {
      const diary = createMockDiary();
      await useDiaryStore.getState().saveDiary(diary);

      const updated = { ...diary, content: '新内容' };
      await useDiaryStore.getState().saveDiary(updated);

      expect(useDiaryStore.getState().diaryList).toHaveLength(1);
    });
  });

  describe('loadDiaries', () => {
    it('should load diaries sorted by createdAt descending (newest first)', async () => {
      const old = createMockDiary({ id: 'old', createdAt: 1000 });
      const newer = createMockDiary({ id: 'newer', createdAt: 3000 });
      const mid = createMockDiary({ id: 'mid', createdAt: 2000 });

      // db.getAllDiaries returns them in ascending order (as getAllFromIndex would)
      mockGetAllDiaries.mockResolvedValue([old, mid, newer]);

      await useDiaryStore.getState().loadDiaries();

      const list = useDiaryStore.getState().diaryList;
      expect(list).toHaveLength(3);
      expect(list[0].id).toBe('newer');
      expect(list[1].id).toBe('mid');
      expect(list[2].id).toBe('old');
    });

    it('should set isLoadingList during loading', async () => {
      mockGetAllDiaries.mockResolvedValue([]);

      const promise = useDiaryStore.getState().loadDiaries();

      // While loading, isLoadingList should be true
      expect(useDiaryStore.getState().isLoadingList).toBe(true);

      await promise;

      expect(useDiaryStore.getState().isLoadingList).toBe(false);
    });

    it('should handle empty database', async () => {
      mockGetAllDiaries.mockResolvedValue([]);

      await useDiaryStore.getState().loadDiaries();

      expect(useDiaryStore.getState().diaryList).toEqual([]);
    });

    it('should set isLoadingList to false even if an error occurs', async () => {
      mockGetAllDiaries.mockRejectedValue(new Error('DB error'));

      await expect(useDiaryStore.getState().loadDiaries()).rejects.toThrow('DB error');

      expect(useDiaryStore.getState().isLoadingList).toBe(false);
    });
  });

  describe('deleteDiary', () => {
    it('should call db.deleteDiary with the id and the current uid', async () => {
      const diary = createMockDiary();
      await useDiaryStore.getState().saveDiary(diary);

      await useDiaryStore.getState().deleteDiary(diary.id);

      expect(mockDeleteDiary).toHaveBeenCalledWith(diary.id, 'guest');
    });

    it('should remove a diary from the list', async () => {
      const diary = createMockDiary();
      await useDiaryStore.getState().saveDiary(diary);

      expect(useDiaryStore.getState().diaryList).toHaveLength(1);

      await useDiaryStore.getState().deleteDiary(diary.id);

      expect(useDiaryStore.getState().diaryList).toHaveLength(0);
    });

    it('should clear currentDiary if the deleted one was current', async () => {
      const diary = createMockDiary();
      await useDiaryStore.getState().saveDiary(diary);

      expect(useDiaryStore.getState().currentDiary?.id).toBe(diary.id);

      await useDiaryStore.getState().deleteDiary(diary.id);

      expect(useDiaryStore.getState().currentDiary).toBe(null);
    });

    it('should not clear currentDiary if a different one was deleted', async () => {
      const diary1 = createMockDiary({ id: 'd1' });
      const diary2 = createMockDiary({ id: 'd2' });

      await useDiaryStore.getState().saveDiary(diary1);
      await useDiaryStore.getState().saveDiary(diary2);

      useDiaryStore.getState().setCurrentDiary(diary1);

      await useDiaryStore.getState().deleteDiary(diary2.id);

      expect(useDiaryStore.getState().currentDiary?.id).toBe('d1');
    });
  });

  describe('getDiary', () => {
    it('should fetch a diary by ID and set as current', async () => {
      const diary = createMockDiary({ id: 'fetch-test' });
      mockGetDiary.mockResolvedValue(diary);

      const result = await useDiaryStore.getState().getDiary('fetch-test');

      expect(mockGetDiary).toHaveBeenCalledWith('fetch-test', 'guest');
      expect(result).not.toBeNull();
      expect(result?.id).toBe('fetch-test');
      expect(useDiaryStore.getState().currentDiary?.id).toBe('fetch-test');
    });

    it('should return null for non-existent diary', async () => {
      mockGetDiary.mockResolvedValue(null);

      const result = await useDiaryStore.getState().getDiary('does-not-exist');

      expect(result).toBeNull();
      expect(useDiaryStore.getState().currentDiary).toBe(null);
    });
  });

  describe('updateCurrentDiary', () => {
    it('should update title and content of current diary', () => {
      const diary = createMockDiary({ title: '原标题', content: '原内容' });
      useDiaryStore.getState().setCurrentDiary(diary);

      useDiaryStore.getState().updateCurrentDiary({
        title: '新标题',
        content: '新内容',
      });

      const current = useDiaryStore.getState().currentDiary;
      expect(current?.title).toBe('新标题');
      expect(current?.content).toBe('新内容');
    });

    it('should update updatedAt timestamp', () => {
      const diary = createMockDiary({ updatedAt: 1000 });
      useDiaryStore.getState().setCurrentDiary(diary);

      useDiaryStore.getState().updateCurrentDiary({ title: 'Updated' });

      const current = useDiaryStore.getState().currentDiary;
      expect(current?.updatedAt).toBeGreaterThan(1000);
    });

    it('should do nothing if currentDiary is null', () => {
      useDiaryStore.getState().setCurrentDiary(null);

      useDiaryStore.getState().updateCurrentDiary({ title: 'test' });

      expect(useDiaryStore.getState().currentDiary).toBe(null);
    });

    it('should only update provided fields, preserving others', () => {
      const diary = createMockDiary({ title: '原标题', content: '原内容' });
      useDiaryStore.getState().setCurrentDiary(diary);

      // Only update title
      useDiaryStore.getState().updateCurrentDiary({ title: '新标题' });

      const current = useDiaryStore.getState().currentDiary;
      expect(current?.title).toBe('新标题');
      expect(current?.content).toBe('原内容'); // preserved
    });
  });
});
