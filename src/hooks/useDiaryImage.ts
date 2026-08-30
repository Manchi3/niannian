import { useEffect, useState } from 'react';
import type { Diary } from '../types';
import { useDiaryStore } from '../stores/diaryStore';

/**
 * useDiaryImage — resolve a diary's ORIGINAL image to a displayable object
 * URL. Handles loading state and revokes the URL on unmount / change to
 * avoid leaks (single ownership of the object URL).
 *
 * @param diary the diary whose original image to show (may be null)
 * @returns { url, loading } — url is '' while loading or when no image.
 */
export function useDiaryImage(diary: Diary | null): {
  url: string;
  loading: boolean;
} {
  const getOriginalImage = useDiaryStore((s) => s.getOriginalImage);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!diary) {
      setUrl('');
      setLoading(false);
      return;
    }
    let revoked = false;
    let objectUrl = '';
    setLoading(true);
    getOriginalImage(diary)
      .then((blob) => {
        if (revoked || !blob || blob.size === 0) return;
        objectUrl = URL.createObjectURL(blob);
        if (!revoked) setUrl(objectUrl);
      })
      .catch(() => {
        // no image — leave url empty
      })
      .finally(() => {
        if (!revoked) setLoading(false);
      });
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl('');
      setLoading(false);
    };
  }, [diary, getOriginalImage]);

  return { url, loading };
}
