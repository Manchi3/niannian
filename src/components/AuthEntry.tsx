import { useAuthStore } from '../stores/authStore';

/**
 * AuthEntry — the top-right account entry rendered inside ChatMainView's
 * top bar and DiaryGallery's header (P0-9).
 *
 *   - Signed out (or still booting) → grey hollow person outline; clicking
 *     opens the AuthModal.
 *   - Signed in → circular real avatar (or the nickname's first char when
 *     no avatar); clicking opens the ProfileEditor layer directly (the old
 *     UserMenu dropdown is gone — Round Nav).
 *
 * The full "avatar + nickname + 登出" combo for the landing page is the
 * separately exported <LandingAuthBadge /> (same visual language).
 */
export default function AuthEntry(): React.ReactElement {
  const user = useAuthStore((s) => s.user);
  const status = useAuthStore((s) => s.status);
  const setAuthModalOpen = useAuthStore((s) => s.setAuthModalOpen);
  const setProfileOpen = useAuthStore((s) => s.setProfileOpen);

  // During boot we render an invisible spacer so the top bar does not shift
  // once the session resolves to an avatar.
  if (status === 'boot' && !user) {
    return <span className="inline-block h-8 w-8" aria-hidden="true" />;
  }

  if (!user) {
    return (
      <button
        type="button"
        onClick={() => setAuthModalOpen(true)}
        className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-white/5"
        style={{
          color: 'rgba(232, 221, 208, 0.45)',
          border: '1px solid rgba(232, 221, 208, 0.3)',
        }}
        aria-label="登录 / 注册"
        title="登录 / 注册"
      >
        {/* Grey hollow person outline (stroke only) */}
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="8" r="4" />
          <path d="M4.5 20c0-3.3 3.4-5.2 7.5-5.2s7.5 1.9 7.5 5.2" />
        </svg>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setProfileOpen(true)}
      className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full transition-all hover:ring-2"
      style={{
        border: '1px solid rgba(212, 168, 83, 0.45)',
        boxShadow: '0 0 12px rgba(212, 168, 83, 0.18)',
        background: 'rgba(255, 255, 255, 0.06)',
      }}
      aria-label="编辑资料"
      title={user.nickname}
    >
      {user.avatar ? (
        <img
          key={user.avatar}
          src={user.avatar}
          alt={user.nickname}
          className="h-full w-full object-cover"
        />
      ) : (
        <span
          className="flex h-full w-full items-center justify-center text-xs font-medium"
          style={{ color: 'rgba(245, 230, 200, 0.9)' }}
        >
          {user.nickname.slice(0, 1)}
        </span>
      )}
    </button>
  );
}

/**
 * LandingAuthBadge — the top-right account combo for the landing page
 * (Round Nav, 图二). Fixed at right-6 top-6 (same zone as the Logo on the
 * left); z-50 so it floats above the particle background.
 *
 *   - Signed out (or still booting) → grey hollow person outline; clicking
 *     opens the AuthModal (existing flow).
 *   - Signed in → horizontal row (gap 8–12px, vertically centered):
 *       · 36px circular avatar (real avatar / first char of nickname),
 *       · white nickname,
 *       · independent "登出" capsule (thin grey border, transparent bg,
 *         grey-white text, hover brightens).
 *   - Clicking the avatar OR the nickname opens the ProfileEditor layer.
 *   - "登出" calls authStore.logout() (clears token → reload → guest).
 *
 * Only the login-state combo / hollow person lives here — no sliders,
 * keyboard or vortex icon groups (they stay in ChatMainView / DiaryGallery).
 */
export function LandingAuthBadge(): React.ReactElement {
  const user = useAuthStore((s) => s.user);
  const status = useAuthStore((s) => s.status);
  const setAuthModalOpen = useAuthStore((s) => s.setAuthModalOpen);
  const setProfileOpen = useAuthStore((s) => s.setProfileOpen);
  const logout = useAuthStore((s) => s.logout);

  // During boot we render an invisible spacer so the corner does not shift
  // once the session resolves.
  if (status === 'boot' && !user) {
    return <span className="fixed right-8 top-6 z-50 inline-block h-9 w-9" aria-hidden="true" />;
  }

  if (!user) {
    return (
      <button
        type="button"
        onClick={() => setAuthModalOpen(true)}
        className="fixed right-8 top-6 z-50 flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-white/5"
        style={{
          color: 'rgba(232, 221, 208, 0.45)',
          border: '1px solid rgba(232, 221, 208, 0.3)',
        }}
        aria-label="登录 / 注册"
        title="登录 / 注册"
      >
        {/* Grey hollow person outline (stroke only) */}
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="8" r="4" />
          <path d="M4.5 20c0-3.3 3.4-5.2 7.5-5.2s7.5 1.9 7.5 5.2" />
        </svg>
      </button>
    );
  }

  return (
    <div
      className="fixed right-8 top-6 z-50 flex items-center"
      style={{ gap: '20px' }}
    >
      {/* Avatar + nickname — both open the ProfileEditor layer */}
      <button
        type="button"
        onClick={() => setProfileOpen(true)}
        className="flex items-center transition-opacity hover:opacity-85"
        style={{ gap: '16px' }}
        aria-label="编辑资料"
        title="编辑资料"
      >
        <span
          className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full"
          style={{
            border: '1px solid rgba(212, 168, 83, 0.45)',
            boxShadow: '0 0 12px rgba(212, 168, 83, 0.18)',
            background: 'rgba(255, 255, 255, 0.06)',
          }}
        >
          {user.avatar ? (
            <img
              key={user.avatar}
              src={user.avatar}
              alt={user.nickname}
              className="h-full w-full object-cover"
            />
          ) : (
            <span
              className="flex h-full w-full items-center justify-center text-xs font-medium"
              style={{ color: 'rgba(245, 230, 200, 0.9)' }}
            >
              {user.nickname.slice(0, 1)}
            </span>
          )}
        </span>
        <span
          className="text-sm"
          style={{
            color: 'rgba(255, 255, 255, 0.95)',
            textShadow: '0 1px 8px rgba(0, 0, 0, 0.5)',
            userSelect: 'none',
            WebkitUserSelect: 'none',
          }}
        >
          {user.nickname}
        </span>
      </button>

      {/* Independent logout capsule — thin grey border, transparent, hover
          brightens slightly */}
      <button
        type="button"
        onClick={logout}
        className="rounded-full px-5 py-2 text-sm transition-colors hover:bg-white/10"
        style={{
          border: '1px solid rgba(232, 221, 208, 0.35)',
          color: 'rgba(232, 221, 208, 0.75)',
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }}
      >
        登出
      </button>
    </div>
  );
}
