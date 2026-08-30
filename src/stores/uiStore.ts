import { create } from 'zustand';

/**
 * uiStore — cross-component UI visibility state (Round 43).
 *
 * The memory gallery (DiaryGallery) drives `galleryChromeHidden` through
 * useAutoHideUI's onHiddenChange callback; the global Logo reads it so the
 * top-left title fades out / back in IN SYNC with the gallery's chrome
 * (search, filters, view buttons, footer) instead of running its own
 * independent timer on that page.
 */
interface UiState {
  /** True when the gallery's non-image chrome is hidden (pointer stillness). */
  galleryChromeHidden: boolean;
  setGalleryChromeHidden: (hidden: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  galleryChromeHidden: false,
  setGalleryChromeHidden: (hidden) => set({ galleryChromeHidden: hidden }),
}));
