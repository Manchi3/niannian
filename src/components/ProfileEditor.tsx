import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuthStore } from '../stores/authStore';
import { useNavStore } from '../stores/navStore';
import { useToastStore } from '../stores/toastStore';
import { fileToAvatarDataUrl } from '../utils/avatar';

/**
 * ProfileEditor — full-screen glowing profile layer (P0-12, Round 51).
 * Rendered via createPortal(document.body) at z-80.
 *
 * NO card container: everything floats directly on a blurred dark veil so
 * the page content stays faintly visible behind it. The warm golden avatar
 * glow is the visual hero.
 *
 *   - Avatar: 120px circle with a breathing golden halo (framer-motion
 *     opacity 0.8↔1, 4s). The camera veil only appears on hover: dark
 *     rgba(0,0,0,0.4) overlay + centered white camera icon + a small gold
 *     dot at bottom-right. Clicking (hovered or not) opens a hidden file
 *     picker, compresses to 256×256 (canvas), uploads immediately (PUT
 *     /user/profile) and the top bar / logo re-render live.
 *   - Nickname: gold ✦ + large serif white inline input (borderless,
 *     transparent) + fixed "的念念" suffix; Enter or blur saves.
 *   - Bottom row: 修改登录密码 (expands two inputs + save, success toast)
 *     and 长期记忆 (closes this layer, opens MemoryModal). No logout link —
 *     logout lives in the landing-page capsule (LandingAuthBadge).
 */
export default function ProfileEditor(): React.ReactElement {
  const open = useAuthStore((s) => s.profileOpen);
  const setProfileOpen = useAuthStore((s) => s.setProfileOpen);
  const setMemoryOpen = useAuthStore((s) => s.setMemoryOpen);
  const user = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const updatePassword = useAuthStore((s) => s.updatePassword);
  const showToast = useToastStore((s) => s.showToast);

  const [nickname, setNickname] = useState('');
  const [savingNick, setSavingNick] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [avatarHovered, setAvatarHovered] = useState(false);
  const [showPasswordPanel, setShowPasswordPanel] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Round Nav: keep the back stack in sync — opening pushes an 'profile'
  // overlay marker, closing removes it (so the Logo "back" can close this
  // layer first).
  useEffect(() => {
    const nav = useNavStore.getState();
    if (open) nav.openOverlay('profile');
    else nav.closeOverlay('profile');
  }, [open]);

  // Sync local nickname state whenever the editor opens / user changes.
  useEffect(() => {
    if (open && user) {
      setNickname(user.nickname);
      setShowPasswordPanel(false);
      setNewPassword('');
      setConfirmPassword('');
    }
  }, [open, user]);

  const handleClose = useCallback(() => {
    setProfileOpen(false);
  }, [setProfileOpen]);

  /** "长期记忆" — close this layer, open the MemoryModal. */
  const handleOpenMemory = useCallback(() => {
    setProfileOpen(false);
    setMemoryOpen(true);
  }, [setProfileOpen, setMemoryOpen]);

  const saveNickname = useCallback(async () => {
    if (!user) return;
    const next = nickname.trim();
    if (!next) {
      showToast('昵称不能为空', { kind: 'error', duration: 3000 });
      setNickname(user.nickname);
      return;
    }
    if (next === user.nickname) return;
    setSavingNick(true);
    try {
      await updateProfile({ nickname: next });
      showToast('昵称已更新', { kind: 'success', duration: 2500 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '保存失败';
      showToast(msg, { kind: 'error', duration: 3500 });
      setNickname(user.nickname);
    } finally {
      setSavingNick(false);
    }
  }, [user, nickname, updateProfile, showToast]);

  const handleAvatarChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (uploading) return;
      const file = e.target.files?.[0] ?? null;
      e.target.value = ''; // allow re-selecting the same file
      if (!file || !user) return;
      setUploading(true);
      try {
        const dataUrl = await fileToAvatarDataUrl(file);
        await updateProfile({ avatar: dataUrl });
        showToast('头像已更新', { kind: 'success', duration: 2500 });
      } catch (err) {
        // Round 22: surface upload failures explicitly — never silently
        // swallow a non-2xx response, and never overwrite the existing
        // avatar (authStore only commits on success).
        const detail = err instanceof Error ? err.message : '';
        console.error('[ProfileEditor] avatar upload failed:', err);
        showToast(detail ? `头像更新失败：${detail}` : '头像更新失败', {
          kind: 'error',
          duration: 3500,
        });
      } finally {
        setUploading(false);
      }
    },
    [uploading, user, updateProfile, showToast],
  );

  const savePassword = useCallback(async () => {
    if (!newPassword || newPassword.length < 6) {
      showToast('新密码至少 6 位', { kind: 'error', duration: 3000 });
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast('两次输入的密码不一致', { kind: 'error', duration: 3000 });
      return;
    }
    setSavingPassword(true);
    try {
      await updatePassword(newPassword);
      showToast('密码已更新', { kind: 'success', duration: 2500 });
      setNewPassword('');
      setConfirmPassword('');
      setShowPasswordPanel(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '密码修改失败';
      showToast(msg, { kind: 'error', duration: 3500 });
    } finally {
      setSavingPassword(false);
    }
  }, [newPassword, confirmPassword, updatePassword, showToast]);

  if (!open || !user) return <></>;

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[80] flex items-center justify-center"
      style={{
        background: 'rgba(0, 0, 0, 0.55)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
      }}
      onClick={handleClose}
    >
      {/* Close — thin grey line, white on hover */}
      <button
        type="button"
        onClick={handleClose}
        className="absolute right-5 top-5 z-10 flex h-8 w-8 items-center justify-center rounded-full transition-colors text-[rgba(232,221,208,0.5)] hover:bg-white/5 hover:text-white"
        aria-label="关闭"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Everything floats on the blurred veil — no card container. The
          column is nudged slightly above vertical center. */}
      <div
        className="flex flex-col items-center px-6"
        style={{ marginBottom: '6vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Avatar — 120px, breathing golden halo, camera veil on hover.
            Implemented as a <label> wrapping a visually-hidden (NOT
            display:none) file input: this is the cross-browser-reliable way
            to open the OS file picker. R24 fix: the old `display:none` input
            + programmatic .click() silently failed to open the dialog in
            Safari / some Firefox, so the user could never pick a file. */}
        <label
          onMouseEnter={() => setAvatarHovered(true)}
          onMouseLeave={() => setAvatarHovered(false)}
          className="relative block cursor-pointer rounded-full"
          style={{
            width: 120,
            height: 120,
            padding: 0,
            border: 'none',
            background: 'transparent',
            opacity: uploading ? 0.7 : 1,
          }}
          aria-label="更换头像"
          title="点击更换头像"
        >
          {/* Visually hidden but interactive — label click opens the picker */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleAvatarChange}
            disabled={uploading}
            tabIndex={-1}
            className="absolute"
            style={{
              position: 'absolute',
              width: 1,
              height: 1,
              opacity: 0,
              pointerEvents: 'none',
              left: -9999,
              top: -9999,
            }}
          />

          {/* Breathing warm-gold halo (the visual hero) */}
          <motion.div
            aria-hidden
            className="absolute inset-0 rounded-full"
            animate={{ opacity: [0.8, 1, 0.8] }}
            transition={{ duration: 4, ease: 'easeInOut', repeat: Infinity }}
            style={{
              boxShadow:
                '0 0 60px 20px rgba(212, 168, 83, 0.25), 0 0 120px 40px rgba(212, 168, 83, 0.1)',
            }}
          />
          {user.avatar ? (
            <img
              key={user.avatar}
              src={user.avatar}
              alt={user.nickname}
              className="relative h-full w-full rounded-full object-cover"
            />
          ) : (
            <span
              className="relative flex h-full w-full items-center justify-center rounded-full text-4xl font-medium"
              style={{ color: 'rgba(245, 230, 200, 0.9)', background: 'rgba(255, 255, 255, 0.06)' }}
            >
              {user.nickname.slice(0, 1)}
            </span>
          )}
          {/* Hover veil: dark overlay + centered camera + gold dot */}
          <span
            aria-hidden
            className="absolute inset-0 flex items-center justify-center rounded-full"
            style={{
              background: 'rgba(0, 0, 0, 0.4)',
              opacity: avatarHovered ? 1 : 0,
              transition: 'opacity 200ms ease',
            }}
          >
            <svg
              width={28}
              height={28}
              viewBox="0 0 24 24"
              fill="none"
              stroke="rgba(255,255,255,0.95)"
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z" />
              <circle cx="12" cy="13" r="3.2" />
            </svg>
            <span
              className="absolute"
              style={{
                right: 12,
                bottom: 12,
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: '#d4a853',
                boxShadow: '0 0 8px rgba(212, 168, 83, 0.8)',
              }}
            />
          </span>
        </label>
        {uploading && (
          <div className="mt-2 text-xs" style={{ color: 'rgba(212, 168, 83, 0.8)' }}>
            正在更新头像...
          </div>
        )}

        {/* Nickname inline edit — ✦ + borderless input + fixed 的念念 */}
        <div className="mt-8 flex items-center justify-center" style={{ gap: '10px' }}>
          <span className="shrink-0" style={{ color: 'rgba(212, 168, 83, 0.95)', fontSize: 24 }}>
            ✦
          </span>
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            onBlur={() => void saveNickname()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                (e.target as HTMLInputElement).blur();
              }
            }}
            disabled={savingNick}
            className="bg-transparent outline-none"
            style={{
              fontFamily: '"Noto Serif SC", "Songti SC", serif',
              fontSize: 34,
              lineHeight: 1.3,
              color: 'rgba(255, 250, 240, 0.96)',
              caretColor: 'rgba(212, 168, 83, 1)',
              border: 'none',
              background: 'transparent',
              padding: 0,
              textAlign: 'center',
              width: `${Math.max(nickname.length, 2) + 1}em`,
              minWidth: '3em',
            }}
            aria-label="昵称"
          />
          <span
            className="shrink-0 whitespace-nowrap"
            style={{
              fontFamily: '"Noto Serif SC", "Songti SC", serif',
              fontSize: 34,
              lineHeight: 1.3,
              color: 'rgba(232, 221, 208, 0.75)',
            }}
          >
            的念念
          </span>
        </div>
        <div
          className="mt-2 text-center"
          style={{ fontSize: 12, opacity: 0.5, color: 'rgba(232, 221, 208, 0.6)' }}
        >
          点击此处修改，回车或失焦保存
        </div>

        {/* Bottom entries — 48px under the nickname: 修改登录密码 / 长期记忆 */}
        <div className="mt-12 flex flex-col items-center">
          <div className="flex items-center" style={{ gap: '18px' }}>
            <button
              type="button"
              onClick={() => setShowPasswordPanel((s) => !s)}
              className="text-xs underline underline-offset-4"
              style={{ color: 'rgba(232, 221, 208, 0.45)' }}
            >
              修改登录密码
            </button>
            <button
              type="button"
              onClick={handleOpenMemory}
              className="text-xs underline underline-offset-4"
              style={{ color: 'rgba(232, 221, 208, 0.45)' }}
            >
              长期记忆
            </button>
          </div>

          <AnimatePresence>
            {showPasswordPanel && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                style={{ overflow: 'hidden' }}
              >
                <div className="mt-4 space-y-3" style={{ width: 260 }}>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="新密码（至少 6 位）"
                    className="w-full rounded-xl px-4 py-2.5 text-sm placeholder:text-warm-white/30"
                    style={{
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      color: 'rgba(245, 235, 218, 0.92)',
                    }}
                  />
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="确认新密码"
                    className="w-full rounded-xl px-4 py-2.5 text-sm placeholder:text-warm-white/30"
                    style={{
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      color: 'rgba(245, 235, 218, 0.92)',
                    }}
                  />
                  <button
                    type="button"
                    disabled={savingPassword}
                    onClick={savePassword}
                    className="w-full rounded-full py-2 text-xs transition-all hover:opacity-85 disabled:opacity-50"
                    style={{
                      background: 'rgba(212, 168, 83, 0.16)',
                      border: '1px solid rgba(212, 168, 83, 0.35)',
                      color: 'rgba(212, 168, 83, 0.95)',
                    }}
                  >
                    {savingPassword ? '保存中...' : '保存新密码'}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>,
    document.body,
  );
}
