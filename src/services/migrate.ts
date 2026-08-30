import {
  CURRENT_SCHEMA_VERSION,
  type Diary,
  type Message,
} from '../types';
import { saveOriginalImage } from './imageStore';

/**
 * migrateDiary — record-level lazy migration.
 *
 * v1 → v2: the original image (imageBlob) moves out of IndexedDB into
 * OPFS. If OPFS is unavailable the blob is kept in-place via the 'idb:'
 * downgrade path (legacyImageBlob). Any record without a _schemaVersion is
 * treated as v1.
 *
 * Returns a NEW migrated Diary object (the raw input is not mutated).
 * Migration failures never throw to the caller's read path — the raw
 * record is returned unchanged so reads stay non-blocking.
 *
 * @param raw — raw record read from storage
 * @param uid — account namespace passed through to the OPFS save (default
 *              'guest'); ensures images land in the correct per-uid dir.
 */
export async function migrateDiary(raw: unknown, uid: string = 'guest'): Promise<Diary> {
  const d = raw as Partial<Diary> & Record<string, unknown>;
  const current = (d as Diary)._schemaVersion;

  // Already current → as-is.
  if (current === CURRENT_SCHEMA_VERSION) {
    return d as Diary;
  }

  // Anything else (undefined = v1, or an unknown older version) → v2.
  try {
    const oldImageBlob = d.imageBlob as Blob | undefined;
    const legacyImageBlob = d.legacyImageBlob as Blob | undefined;
    const oldImageRef = d.imageRef as string | null | undefined;

    let imageRef: string | null = null;
    let legacy: Blob | undefined;

    if (oldImageRef === 'idb:' && legacyImageBlob) {
      // Already downgraded by an earlier attempt — keep as-is.
      imageRef = 'idb:';
      legacy = legacyImageBlob;
    } else if (oldImageBlob && oldImageBlob.size > 0) {
      // v1 record: move the original into OPFS (or downgrade to 'idb:').
      const ref = await saveOriginalImage((d as Diary).id, oldImageBlob, uid);
      if (ref) {
        imageRef = ref;
      } else {
        imageRef = 'idb:';
        legacy = oldImageBlob;
      }
    } else if (oldImageRef && oldImageRef.startsWith('opfs:')) {
      // Already v2-shaped (partial upgrade) — keep the ref.
      imageRef = oldImageRef;
    }
    // else: no original image → imageRef stays null.

    const migrated: Diary = {
      _schemaVersion: CURRENT_SCHEMA_VERSION,
      id: (d as Diary).id,
      title: (d as Diary).title ?? '',
      date: (d as Diary).date ?? '',
      content: (d as Diary).content ?? '',
      chatHistory: ((d as Diary).chatHistory ?? []) as Message[],
      thumbnailBlob: d.thumbnailBlob as Blob | undefined,
      imageRef,
      legacyImageBlob: legacy,
      tags: d.tags as string[] | undefined,
      mood: d.mood as string | undefined,
      createdAt: (d as Diary).createdAt ?? Date.now(),
      updatedAt: (d as Diary).updatedAt ?? Date.now(),
    };
    return migrated;
  } catch {
    // Migration must never block reads — return the raw record unmodified.
    return d as Diary;
  }
}
