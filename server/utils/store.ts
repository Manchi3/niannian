/**
 * JSON data store for the Particle Diary server.
 *
 * Guarantees:
 *   - Atomic writes: write to `<file>.<pid>.<ts>.tmp` then rename() over the
 *     target — a crash mid-write can never leave a truncated JSON file.
 *   - In-process file locks: a per-key promise chain serialises concurrent
 *     read-modify-write cycles so parallel requests cannot overwrite each
 *     other's changes (users.json / memories.json are shared files).
 *
 * Data layout (server/data/):
 *   - users.json                 — global account index
 *   - <uid>/memories.json        — per-account long-term memories
 *
 * All functions accept an optional base dir / file path so unit tests can
 * point them at a temporary directory without touching real data.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Memory, StoredUser } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Root data directory (overridable via env for tests / deployments). */
export const DATA_DIR = process.env.PARTICLE_DIARY_DATA_DIR
  ? path.resolve(process.env.PARTICLE_DIARY_DATA_DIR)
  : path.resolve(__dirname, '../data');

/** Path to the global users.json account index. */
export const USERS_FILE = path.join(DATA_DIR, 'users.json');

/** In-process promise-chain locks, keyed by lock name. */
const locks = new Map<string, Promise<unknown>>();

/**
 * Serialise `fn` behind the lock named `key`. The returned promise settles
 * with fn's result; the internal chain is kept alive regardless of outcome.
 */
export function withFileLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = (locks.get(key) ?? Promise.resolve()) as Promise<unknown>;
  const run = prev.then(fn, fn);
  // Keep the chain alive even if `run` rejects — the next caller must not
  // inherit a rejected tail.
  locks.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

/** Read + parse a JSON file. Returns null when missing or unparsable. */
export async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Atomically write a JSON file (tmp + rename). Creates parent directories.
 * Never partially writes the destination.
 */
export async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmp, filePath);
}

// ---------------------------------------------------------------------------
// Users (global account index)
// ---------------------------------------------------------------------------

/** Read all users from a given users file (default: server/data/users.json). */
export async function readUsersFile(filePath: string = USERS_FILE): Promise<StoredUser[]> {
  return (await readJson<StoredUser[]>(filePath)) ?? [];
}

/** Atomically persist a full user list to a given users file. */
export async function writeUsersFile(users: StoredUser[], filePath: string = USERS_FILE): Promise<void> {
  await withFileLock(`users:${filePath}`, async () => {
    await writeJsonAtomic(filePath, users);
  });
}

/** Convenience: read the default users file. */
export async function getUsers(): Promise<StoredUser[]> {
  return readUsersFile();
}

/**
 * Insert (or replace by id) a user in the default users file.
 * The read-modify-write cycle runs under the users file lock.
 */
export async function saveUser(user: StoredUser): Promise<void> {
  await withFileLock(`users:${USERS_FILE}`, async () => {
    const users = await getUsers();
    const idx = users.findIndex((u) => u.id === user.id);
    if (idx >= 0) {
      users[idx] = user;
    } else {
      users.push(user);
    }
    await writeJsonAtomic(USERS_FILE, users);
  });
}

// ---------------------------------------------------------------------------
// Memories (per-uid)
// ---------------------------------------------------------------------------

/** Read all memories for a uid (default: under server/data/<uid>/memories.json). */
export async function readMemories(uid: string, baseDir: string = DATA_DIR): Promise<Memory[]> {
  return (await readJson<Memory[]>(path.join(baseDir, uid, 'memories.json'))) ?? [];
}

/** Atomically persist a memory list for a uid (under the uid file lock). */
export async function saveMemories(
  uid: string,
  list: Memory[],
  baseDir: string = DATA_DIR,
): Promise<void> {
  const filePath = path.join(baseDir, uid, 'memories.json');
  await withFileLock(`memories:${filePath}`, async () => {
    await writeJsonAtomic(filePath, list);
  });
}
