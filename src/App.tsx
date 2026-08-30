import { useEffect } from 'react';
import { useNavStore } from './stores/navStore';
import { useAppStore } from './stores/appStore';
import { useAuthStore } from './stores/authStore';
import Logo from './components/Logo';
import LandingPage, { todayQuote } from './components/LandingPage';
import DiaryGallery from './components/DiaryGallery';
import ChatMainView from './components/ChatMainView';
import AuthModal from './components/AuthModal';
import ProfileEditor from './components/ProfileEditor';
import MemoryModal from './components/MemoryModal';
import MemoryCardModal from './components/MemoryCardModal';
import ToastContainer from './components/ToastContainer';

/**
 * App — top-level router (Round 22).
 *
 *   currentView (from navStore):
 *     'landing' → LandingPage    (date + slogan + 2 CTAs over ellipse particles)
 *     'chat'    → ChatMainView   (existing Round 21 chat/particle flow, untouched)
 *     'gallery' → DiaryGallery   (polaroid horizontal card stream + search/filter)
 *
 *   Logo (top-left) is rendered globally:
 *     - Always visible on 'landing'
 *     - Auto-hides 3s after pointer stillness on other views
 *     - Reappears immediately on the next mousemove
 *     - Click → force-return to 'landing' (goHome)
 *
 * Round Auth:
 *   - On mount, restoreSession() resolves the token (if any) via GET /me;
 *     afterwards the uid-namespaced prefs/config are reloaded and diaries
 *     are re-pulled under the real uid (no reload needed for boot restore).
 *   - AuthModal / ProfileEditor / MemoryModal are mounted globally here —
 *     each renders itself via createPortal(document.body) and only shows
 *     when its store switch is on.
 *
 * The chat page's phase state machine, particle code, shaders, constants,
 * atmosphere panel, etc. live entirely in ChatMainView and are NOT
 * modified by this router.
 */
export default function App(): React.ReactElement {
  const currentView = useNavStore((s) => s.currentView);
  // Round 26 (bug④): key the chat view on the conversation id so a new round
  // (fresh id minted by startNewRound) fully remounts it — wiping any stale
  // local state from the previous photo.
  const conversationId = useAppStore((s) => s.conversationId);

  // Dynamic tab title — reuse todayQuote (driven by DAILY_QUOTES) from
  // LandingPage so the tab always matches the same daily quote shown at
  // the bottom of the landing page. todayQuote is deterministic per day,
  // so calling it once on mount is enough.
  useEffect(() => {
    document.title = `念念 — ${todayQuote()}`;
  }, []);

  // Round Auth: restore the session once on startup.
  useEffect(() => {
    void useAuthStore.getState().restoreSession();
  }, []);

  return (
    <>
      {/* Global top-left logo — always rendered, auto-hides on non-landing */}
      <Logo />

      {/* View switch — only one view is mounted at a time */}
      {currentView === 'landing' && <LandingPage />}
      {currentView === 'chat' && <ChatMainView key={conversationId} />}
      {currentView === 'gallery' && <DiaryGallery />}

      {/* Round Auth: global overlays (each self-portals to document.body) */}
      <AuthModal />
      <ProfileEditor />
      <MemoryModal />
      <MemoryCardModal />

      {/* Global toast stack — must live at the router level so toasts
          (devCode hints, auth errors, …) render on EVERY view, including
          landing. ChatMainView no longer mounts its own copy. */}
      <ToastContainer />
    </>
  );
}
