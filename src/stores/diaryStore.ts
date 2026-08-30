import { create } from 'zustand';
import {
  CURRENT_SCHEMA_VERSION,
  type Diary,
} from '../types';
import * as db from '../services/db';
import { migrateDiary } from '../services/migrate';
import {
  saveOriginalImage,
  getOriginalImage as loadOriginalImage,
  deleteOriginalImage,
} from '../services/imageStore';
import { currentUid } from '../utils/uid';

/**
 * Diary state managed by Zustand.
 *
 * Round 41: the ONLY module allowed to import services/db (storage
 * internals). Reads run lazy migration (v1 → v2) and write back; saves
 * route the original image through OPFS (imageStore) and keep only a
 * thumbnail in IndexedDB.
 *
 * Account isolation: every storage call passes currentUid() so the
 * IndexedDB database / OPFS directory resolve to the active account
 * (guest keeps the legacy names — existing data stays put).
 */
interface DiaryState {
  /** All saved diaries, sorted by createdAt descending. */
  diaryList: Diary[];
  /** Currently viewed / edited diary. */
  currentDiary: Diary | null;
  /** Whether the diary list is loading. */
  isLoadingList: boolean;

  /** Load all diaries (migrating + writing back stale records). */
  loadDiaries: () => Promise<void>;
  /** Save a diary; originalBlob (if any) is stored via OPFS first. */
  saveDiary: (diary: Diary, originalBlob?: Blob | null) => Promise<void>;
  /** Delete a diary: remove its OPFS original first, then the record. */
  deleteDiary: (id: string) => Promise<void>;
  /** Fetch a single diary by ID (migrating + writing back if stale). */
  getDiary: (id: string) => Promise<Diary | null>;
  /** Resolve the original image blob for a diary (OPFS or legacy). */
  getOriginalImage: (diary: Diary) => Promise<Blob | null>;
  /** Set the currently active diary. */
  setCurrentDiary: (diary: Diary | null) => void;
  /** Update the current diary's title and content (e.g. after editing). */
  updateCurrentDiary: (updates: Partial<Pick<Diary, 'title' | 'content'>>) => void;
}

/**
 * Lazy migration + best-effort write-back. Never throws: on write-back
 * failure the migrated value is still returned (the next read retries).
 */
async function migrateAndPersist(diary: Diary): Promise<Diary> {
  const uid = currentUid();
  const migrated = await migrateDiary(diary, uid);
  if (migrated !== diary) {
    try {
      await db.saveDiary(migrated, uid);
    } catch {
      // write-back failed — non-blocking; next read will retry
    }
  }
  return migrated;
}

export const useDiaryStore = create<DiaryState>((set, get) => ({
  diaryList: [],
  currentDiary: null,
  isLoadingList: false,

  loadDiaries: async () => {
    set({ isLoadingList: true });
    try {
      const raw = await db.getAllDiaries(currentUid());
      const migrated = await Promise.all(raw.map(migrateAndPersist));
      // Sort by createdAt descending (newest first)
      migrated.sort((a, b) => b.createdAt - a.createdAt);
      set({ diaryList: migrated });
    } finally {
      set({ isLoadingList: false });
    }
  },

  saveDiary: async (diary, originalBlob = null) => {
    // Round 41: original image goes to OPFS first; the record keeps only
    // a ref (or the downgraded legacy blob when OPFS is unavailable).
    const uid = currentUid();
    const hasOriginal =
      originalBlob && originalBlob.size > 0 ? originalBlob : null;
    let record: Diary = {
      ...diary,
      _schemaVersion: CURRENT_SCHEMA_VERSION,
    };
    if (hasOriginal) {
      const ref = await saveOriginalImage(record.id, hasOriginal, uid);
      record.imageRef = ref ?? 'idb:';
      record.legacyImageBlob = ref ? undefined : hasOriginal;
    } else if (!record.imageRef) {
      record.imageRef = null;
    }
    await db.saveDiary(record, uid);
    const existingIndex = get().diaryList.findIndex((d) => d.id === record.id);
    if (existingIndex >= 0) {
      // Update existing entry
      set((state) => {
        const newList = [...state.diaryList];
        newList[existingIndex] = record;
        newList.sort((a, b) => b.createdAt - a.createdAt);
        return { diaryList: newList, currentDiary: record };
      });
    } else {
      // Insert new entry
      set((state) => {
        const newList = [record, ...state.diaryList];
        return { diaryList: newList, currentDiary: record };
      });
    }
  },

  deleteDiary: async (id) => {
    const uid = currentUid();
    // Clean up the OPFS original first so no orphan files are left.
    const existing = get().diaryList.find((d) => d.id === id);
    if (existing) {
      await deleteOriginalImage(existing, uid);
    } else {
      const stored = await db.getDiary(id, uid);
      if (stored) await deleteOriginalImage(stored, uid);
    }
    await db.deleteDiary(id, uid);
    set((state) => ({
      diaryList: state.diaryList.filter((d) => d.id !== id),
      currentDiary: state.currentDiary?.id === id ? null : state.currentDiary,
    }));
  },

  getDiary: async (id) => {
    const stored = await db.getDiary(id, currentUid());
    if (!stored) return null;
    const diary = await migrateAndPersist(stored);
    set({ currentDiary: diary });
    return diary;
  },

  getOriginalImage: async (diary) => loadOriginalImage(diary, currentUid()),

  setCurrentDiary: (diary) => set({ currentDiary: diary }),

  updateCurrentDiary: (updates) =>
    set((state) => {
      if (!state.currentDiary) return state;
      const updated: Diary = {
        ...state.currentDiary,
        ...updates,
        updatedAt: Date.now(),
      };
      return { currentDiary: updated };
    }),
}));
