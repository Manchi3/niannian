import type { Diary } from '../types';

/**
 * imageStore — ORIGINAL diary images live in the Origin Private File
 * System (OPFS), not IndexedDB (keeps IDB records small; thumbnails stay
 * in IDB via db.ts).
 *
 * Per-account isolation (D2): the OPFS DIRECTORY name is derived from uid —
 *   - guest       → 'diary-images' (legacy name → zero migration)
 *   - any user    → `diary-images-${uid}`
 *
 * Reference formats stored on Diary.imageRef:
 *   'opfs:<filename>' — original is an OPFS file (file itself is a Blob)
 *   'idb:'            — OPFS unavailable/failed, original was downgraded
 *                       into Diary.legacyImageBlob (IndexedDB)
 *   null              — no original image
 *
 * Feature detection: if navigator.storage?.getDirectory is missing (older
 * browsers / non-secure context), every OPFS call returns null → callers
 * fall back to the 'idb:' path automatically.
 */

/** OPFS directory name for a uid: guest keeps the legacy name. */
export function dirNameFor(uid: string): string {
  return uid === 'guest' ? 'diary-images' : `diary-images-${uid}`;
}

/** Map blob mime → file extension. */
function extFor(blob: Blob): string {
  const t = blob.type;
  if (t.includes('jpeg') || t.includes('jpg')) return 'jpg';
  if (t.includes('png')) return 'png';
  if (t.includes('webp')) return 'webp';
  return 'img';
}

/** OPFS available? (secure context + API present) */
function opfsAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory;
}

/** Lazily resolved root handles, keyed by directory name (per-uid cache). */
const dirPromises = new Map<string, Promise<FileSystemDirectoryHandle | null>>();

function getDir(uid: string = 'guest'): Promise<FileSystemDirectoryHandle | null> {
  if (!opfsAvailable()) return Promise.resolve(null);
  const key = dirNameFor(uid);
  let p = dirPromises.get(key);
  if (!p) {
    p = navigator.storage
      .getDirectory()
      .then((root) => root.getDirectoryHandle(key, { create: true }))
      .catch(() => null);
    dirPromises.set(key, p);
  }
  return p;
}

/**
 * Save the original image to OPFS.
 * @returns 'opfs:<filename>' on success; null when OPFS is unavailable or
 *          the write fails (caller should downgrade to 'idb:').
 * @param uid — account namespace (default 'guest')
 */
export async function saveOriginalImage(
  id: string,
  blob: Blob,
  uid: string = 'guest',
): Promise<string | null> {
  if (blob.size === 0) return null;
  try {
    const dir = await getDir(uid);
    if (!dir) return null;
    const filename = `${id}.${extFor(blob)}`;
    const handle = await dir.getFileHandle(filename, { create: true });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return `opfs:${filename}`;
  } catch {
    return null; // downgrade path
  }
}

/**
 * Resolve a diary's original image blob.
 *   'opfs:xx' → read the OPFS file (the file itself is a Blob)
 *   'idb:'    → diary.legacyImageBlob ?? null
 *   null      → null
 * @param uid — account namespace (default 'guest')
 */
export async function getOriginalImage(
  diary: Diary,
  uid: string = 'guest',
): Promise<Blob | null> {
  const ref = diary.imageRef;
  if (!ref) return null;
  if (ref.startsWith('opfs:')) {
    try {
      const dir = await getDir(uid);
      if (!dir) return null;
      const filename = ref.slice('opfs:'.length);
      const handle = await dir.getFileHandle(filename);
      return await handle.getFile();
    } catch {
      return null;
    }
  }
  // 'idb:' — downgraded original inside the record
  return diary.legacyImageBlob ?? null;
}

/**
 * Delete the original image (OPFS file only; 'idb:' blobs die with the
 * record). Failures are swallowed to avoid orphaning the delete flow.
 * @param uid — account namespace (default 'guest')
 */
export async function deleteOriginalImage(diary: Diary, uid: string = 'guest'): Promise<void> {
  const ref = diary.imageRef;
  if (!ref || !ref.startsWith('opfs:')) return;
  try {
    const dir = await getDir(uid);
    if (!dir) return;
    const filename = ref.slice('opfs:'.length);
    await dir.removeEntry(filename, { recursive: false });
  } catch {
    // ignore — orphan files are harmless; deletion must not block
  }
}
