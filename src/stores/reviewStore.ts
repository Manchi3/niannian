import { create } from 'zustand';

/**
 * reviewStore — drives the "记忆手卷" diary card modal.
 *
 * Replaces the old full-screen DiaryView (reviewing phase) and the
 * DiaryGallery detail modal. Opened from any "翻开日记" entry (DiaryList /
 * gallery corridor·stack·grid). The card reads its diary from
 * diaryStore.diaryList by id, so left/right switching + deletion stay in
 * sync with the underlying list automatically.
 */
interface ReviewState {
  /** Whether the memory-card modal is open. */
  open: boolean;
  /** Id of the diary currently shown in the card (null when closed). */
  diaryId: string | null;
  /** Open the card for a specific diary. */
  openCard: (id: string) => void;
  /** Close the card (also clears the active diary id). */
  closeCard: () => void;
  /** Switch the card to a different diary (left/right navigation). */
  setDiaryId: (id: string) => void;
}

export const useReviewStore = create<ReviewState>((set) => ({
  open: false,
  diaryId: null,
  openCard: (id) => set({ open: true, diaryId: id }),
  closeCard: () => set({ open: false, diaryId: null }),
  setDiaryId: (id) => set({ diaryId: id }),
}));
