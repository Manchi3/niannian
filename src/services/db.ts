// STORAGE INTERNALS — only src/stores/diaryStore.ts may import this module.
import { openDB, type IDBPDatabase } from 'idb';
import type { Diary } from '../types';

/**
 * IndexedDB wrapper using the `idb` library.
 *
 * Per-account isolation (D1): the database NAME is derived from the uid —
 *   - guest       → 'particle_diary_db' (legacy name → existing guest data
 *                   stays put, zero migration)
 *   - any user    → `particle_diary_${uid}`
 *
 * DB-level isolation makes cross-account reads structurally impossible.
 * Object Store (each DB): diaries
 *   keyPath: "id" (string UUID, no auto-increment)
 *   Indexes: "by_createdAt" → createdAt, "by_date" → date
 */

const DB_VERSION = 1;
const STORE_NAME = 'diaries';

/** Map of database-name → open connection promise (per-DB cache). */
const dbPromises = new Map<string, Promise<IDBPDatabase>>();

/** DB name for a uid: guest keeps the legacy name; others get a suffix. */
export function dbNameFor(uid: string): string {
  return uid === 'guest' ? 'particle_diary_db' : `particle_diary_${uid}`;
}

/**
 * Open (or create) the IndexedDB database for a uid.
 * Cached per DB name so subsequent calls return the same connection.
 */
function getDB(uid: string = 'guest'): Promise<IDBPDatabase> {
  const name = dbNameFor(uid);
  let p = dbPromises.get(name);
  if (!p) {
    p = openDB(name, DB_VERSION, {
      upgrade(db) {
        // Create the object store if it doesn't exist
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('by_createdAt', 'createdAt');
          store.createIndex('by_date', 'date');
        }
      },
    });
    dbPromises.set(name, p);
  }
  return p;
}

/**
 * Save (create or update) a diary entry in IndexedDB.
 * @param uid — account namespace (default 'guest')
 */
export async function saveDiary(diary: Diary, uid: string = 'guest'): Promise<void> {
  const db = await getDB(uid);
  await db.put(STORE_NAME, diary);
}

/**
 * Retrieve a single diary by its ID.
 * @param uid — account namespace (default 'guest')
 */
export async function getDiary(id: string, uid: string = 'guest'): Promise<Diary | null> {
  const db = await getDB(uid);
  const result = await db.get(STORE_NAME, id);
  return (result as Diary) ?? null;
}

/**
 * Retrieve all diaries, sorted by createdAt descending (newest first).
 * @param uid — account namespace (default 'guest')
 */
export async function getAllDiaries(uid: string = 'guest'): Promise<Diary[]> {
  const db = await getDB(uid);
  const all = await db.getAllFromIndex(STORE_NAME, 'by_createdAt');
  // getAllFromIndex returns ascending by createdAt; reverse for newest first
  return (all as Diary[]).sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Delete a diary by its ID.
 * @param uid — account namespace (default 'guest')
 */
export async function deleteDiary(id: string, uid: string = 'guest'): Promise<void> {
  const db = await getDB(uid);
  await db.delete(STORE_NAME, id);
}
