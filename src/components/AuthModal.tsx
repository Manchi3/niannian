import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuthStore } from '../stores/authStore';
import { useNavStore } from '../stores/navStore';
import { useToastStore } from '../stores/toastStore';
import type { ApiError } from '../services/api';

/**
 * AuthModal — login / register dialog (P0-15, PRD §4.7).
 * Rendered via createPortal(document.body) at z-100.
 *
 * Layout: centered large rounded card, left/right split.
 *   Left (~40%) — pure-CSS illustration (night window on the top 60%, a
 *   thin gold divider, and the stacked brand copy on the bottom 40%);
 *   no image assets.
 *   Right — the form: SIGN IN / CREATE ACCOUNT modes with a segmented
 *   [验证码登录 | 密码登录] control, live field validation (red border +
 *   red hint text), dev-code auto-fill, code countdown, password visibility
 *   toggle, and the "忘记密码了?" → code-login hint.
 */

type Mode = 'login' | 'register';
type LoginMethod = 'code' | 'password';

const CODE_RE = /^\d{6}$/;

// ---------------------------------------------------------------------------
// Validation helpers (live, per-field). The backend keeps its own checks in
// server/routes/auth.ts — this layer only drives the frontend UX (red
// borders, red hint text, disabled submit button).
// ---------------------------------------------------------------------------
const isValidContact = (c: string): boolean =>
  c.trim().length > 0 && (c.trim().includes('@') || /^\d{11}$/.test(c.trim()));
const isValidCode = (v: string): boolean => CODE_RE.test(v);
/** Password may be empty (register keeps it optional); when set it needs ≥6 chars. */
const isValidPassword = (v: string): boolean => v.length === 0 || v.length >= 6;
const contactError = (c: string): string | null => {
  if (!c.trim()) return '请输入邮箱或手机号';
  return isValidContact(c) ? null : '格式不正确（手机号 11 位或含 @）';
};
const codeError = (v: string): string | null => {
  if (!v) return '请输入 6 位验证码';
  return isValidCode(v) ? null : '验证码格式不正确';
};
const passwordError = (v: string): string | null =>
  v.length > 0 && v.length < 6 ? '密码至少 6 位' : null;
const nicknameError = (v: string): string | null =>
  v.trim() ? null : '给念念一个称呼吧';

interface FieldErrors {
  contact: string | null;
  code: string | null;
  password: string | null;
  nickname: string | null;
}

const EMPTY_ERRORS: FieldErrors = { contact: null, code: null, password: null, nickname: null };

/** Minimal stroke icon set used by the form fields. */
const FIELD_ICONS = {
  mail: 'M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  shield: 'M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z',
  user: 'M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.5 20.25a7.5 7.5 0 0115 0',
  lock: 'M16.5 10.5V7a4.5 4.5 0 10-9 0v3.5M5.25 10.5h13.5a1.5 1.5 0 011.5 1.5v7.5a1.5 1.5 0 01-1.5 1.5H5.25a1.5 1.5 0 01-1.5-1.5v-7.5a1.5 1.5 0 011.5-1.5z',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 14.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  eyeOff: 'M4 4l16 16M10.6 6.1A9.7 9.7 0 0112 6c6 0 9.5 6 9.5 6a17 17 0 01-2.4 3.2M6.1 6.1A16.7 16.7 0 002.5 12s3.5 6 9.5 6c1.4 0 2.7-.3 3.9-.8M9.9 9.9a3 3 0 004.2 4.2',
} as const;

export default function AuthModal(): React.ReactElement {
  const open = useAuthStore((s) => s.authModalOpen);
  const setAuthModalOpen = useAuthStore((s) => s.setAuthModalOpen);
  const sendCode = useAuthStore((s) => s.sendCode);
  const register = useAuthStore((s) => s.register);
  const login = useAuthStore((s) => s.login);
  const showToast = useToastStore((s) => s.showToast);

  const [mode, setMode] = useState<Mode>('login');
  // Password-only auth. Code login is gone: codes can't be delivered from the
  // hosted environment, and echoing them to the client would let anyone sign
  // in as anyone else. The state is kept (always 'password') so the remaining
  // code plumbing can be lifted later if a mail provider ever becomes usable.
  const [loginMethod, setLoginMethod] = useState<LoginMethod>('password');
  const [contact, setContact] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>(EMPTY_ERRORS);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset form state whenever the modal opens.
  useEffect(() => {
    if (open) {
      setMode('login');
      setLoginMethod('password');
      setContact('');
      setCode('');
      setPassword('');
      setNickname('');
      setShowPassword(false);
      setCountdown(0);
      setSending(false);
      setSubmitting(false);
      setErrors(EMPTY_ERRORS);
    }
  }, [open]);

  // Round Nav: keep the back stack in sync — opening pushes an 'auth'
  // overlay marker, closing removes it (so the Logo "back" can close this
  // modal first).
  useEffect(() => {
    const nav = useNavStore.getState();
    if (open) nav.openOverlay('auth');
    else nav.closeOverlay('auth');
  }, [open]);

  // Clear the countdown timer on unmount.
  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  const startCountdown = useCallback(() => {
    setCountdown(60);
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const handleClose = useCallback(() => {
    setAuthModalOpen(false);
  }, [setAuthModalOpen]);

  /** Live field-change handlers — validate on every keystroke. */
  const handleContactChange = useCallback((v: string) => {
    setContact(v);
    setErrors((prev) => ({ ...prev, contact: contactError(v) }));
  }, []);
  const handleCodeChange = useCallback((v: string) => {
    setCode(v);
    setErrors((prev) => ({ ...prev, code: codeError(v) }));
  }, []);
  const handlePasswordChange = useCallback((v: string) => {
    setPassword(v);
    setErrors((prev) => ({ ...prev, password: passwordError(v) }));
  }, []);
  const handleNicknameChange = useCallback((v: string) => {
    setNickname(v);
    setErrors((prev) => ({ ...prev, nickname: nicknameError(v) }));
  }, []);

  /** Send a verification code — the dev code is auto-filled into the input
   *  (Bug fix: previously only a toast showed it for 6s and the user had to
   *  copy it manually), then the countdown starts. */
  const handleSendCode = useCallback(async () => {
    const c = contact.trim();
    if (!isValidContact(c)) {
      setErrors((prev) => ({ ...prev, contact: contactError(c) }));
      showToast(contactError(c) ?? '请输入有效的邮箱或手机号', { kind: 'error', duration: 3000 });
      return;
    }
    setSending(true);
    try {
      const res = await sendCode(c);
      if (res.devCode) {
        setCode(res.devCode);
        setErrors((prev) => ({ ...prev, code: null }));
        showToast(`验证码已自动填入：${res.devCode}（5 分钟内有效）`, { kind: 'info', duration: 6000 });
      } else {
        showToast('验证码已发送，请查收', { kind: 'success', duration: 3000 });
      }
      startCountdown();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '验证码发送失败';
      showToast(msg, { kind: 'error', duration: 3500 });
    } finally {
      setSending(false);
    }
  }, [contact, sendCode, startCountdown, showToast]);

  /** Live validity of the whole form — drives the disabled submit button. */
  const canSubmit = useMemo(() => {
    if (submitting || !isValidContact(contact)) return false;
    if (mode === 'register') {
      return isValidPassword(password) && nickname.trim().length > 0;
    }
    return password.trim().length > 0;
  }, [submitting, contact, mode, password, nickname]);

  const handleSubmit = useCallback(async () => {
    const c = contact.trim();
    // Fallback validation (double insurance — the submit button is already
    // disabled while the form is invalid, so this rarely runs).
    const localErrors: FieldErrors = { ...EMPTY_ERRORS };
    localErrors.contact = contactError(c);
    if (mode === 'register') {
      localErrors.nickname = nicknameError(nickname);
      localErrors.password = passwordError(password);
    } else if (password.trim().length === 0) {
      localErrors.password = '请输入密码';
    }
    if (localErrors.contact || localErrors.code || localErrors.password || localErrors.nickname) {
      setErrors(localErrors);
      return;
    }
    setSubmitting(true);
    try {
      if (mode === 'register') {
        await register({
          contact: c,
          nickname: nickname.trim() || undefined,
          password,
        });
        // register() triggers window.location.reload() on success
      } else {
        await login({ contact: c, password });
      }
      // login() triggers window.location.reload() on success
    } catch (err) {
      const apiErr = err as ApiError;
      const msg = apiErr?.message ?? (err instanceof Error ? err.message : '操作失败');
      showToast(msg, { kind: 'error', duration: 3500 });
      setSubmitting(false);
    }
  }, [mode, contact, password, nickname, register, login, showToast]);

  const switchToCodeLogin = useCallback(() => {
    setLoginMethod('code');
    setErrors(EMPTY_ERRORS);
    showToast('已切换为验证码登录', { kind: 'info', duration: 2500 });
  }, [showToast]);

  if (!open) return <></>;

  const isLogin = mode === 'login';

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-[100] flex items-center justify-center px-4"
        style={{ background: 'rgba(8, 6, 5, 0.72)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}
        onClick={handleClose}
      >
        <motion.div
          initial={{ scale: 0.96, y: 12, opacity: 0 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          exit={{ scale: 0.96, y: 12, opacity: 0 }}
          transition={{ duration: 0.24, ease: 'easeOut' }}
          className="relative flex w-full max-w-3xl overflow-hidden rounded-3xl"
          style={{
            background: 'rgba(20, 16, 12, 0.98)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            boxShadow: '0 32px 96px rgba(0, 0, 0, 0.6)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* === Left illustration (~40%) === */}
          <div className="relative hidden w-[40%] shrink-0 md:block">
            <IllustrationPanel />
          </div>

          {/* === Right form (~60%) === */}
          <div className="relative flex-1 px-8 py-8 sm:px-10">
            {/* Close */}
            <button
              type="button"
              onClick={handleClose}
              className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-white/10"
              style={{ color: 'rgba(232, 221, 208, 0.45)' }}
              aria-label="关闭"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {/* Title */}
            <div className="mb-6">
              <div
                className="font-mono text-[11px] uppercase tracking-[0.22em]"
                style={{ color: 'rgba(212, 168, 83, 0.8)' }}
              >
                {isLogin ? 'SIGN IN' : 'CREATE ACCOUNT'}
              </div>
              <div
                className="mt-1 text-2xl"
                style={{
                  fontFamily: '"KaiTi", "STKaiti", "楷体", serif',
                  color: 'rgba(245, 235, 218, 0.96)',
                }}
              >
                {isLogin ? '欢迎回来' : '开启念念旅程'}
              </div>
            </div>

            {/* Contact */}
            <Field
              icon={FIELD_ICONS.mail}
              placeholder="邮箱 / 手机号"
              value={contact}
              onChange={handleContactChange}
              type="text"
              error={errors.contact}
            />

            {/* Second field: password for sign-in.
                The code/password segmented control and the "忘记密码了?" →
                code-login escape hatch were removed along with code auth. */}
            {isLogin ? (
              <PasswordField
                value={password}
                onChange={handlePasswordChange}
                show={showPassword}
                onToggle={() => setShowPassword((s) => !s)}
                placeholder="登录密码"
                error={errors.password}
              />
            ) : (
              <>
                <Field
                  icon={FIELD_ICONS.user}
                  placeholder="念念该怎么称呼你？"
                  value={nickname}
                  onChange={handleNicknameChange}
                  type="text"
                  error={errors.nickname}
                />
                <PasswordField
                  value={password}
                  onChange={handlePasswordChange}
                  show={showPassword}
                  onToggle={() => setShowPassword((s) => !s)}
                  placeholder="设置密码（至少 6 位）"
                  error={errors.password}
                />
              </>
            )}

            {/* Submit — disabled until the current mode's form is valid */}
            <button
              type="button"
              disabled={!canSubmit}
              onClick={handleSubmit}
              className="mt-5 w-full rounded-full py-3 font-mono text-sm tracking-[0.2em] transition-all hover:opacity-90 disabled:opacity-50"
              style={{
                background: '#ffffff',
                color: '#2b2620',
                boxShadow: '0 8px 24px rgba(255, 255, 255, 0.12)',
              }}
            >
              {submitting ? '请稍候...' : isLogin ? '登 录' : '开 启 账 户'}
            </button>

            {/* Switch mode */}
            <div className="mt-5 text-center text-xs" style={{ color: 'rgba(232, 221, 208, 0.45)' }}>
              {isLogin ? (
                <>
                  还没有账户？{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setMode('register');
                      setErrors(EMPTY_ERRORS);
                    }}
                    style={{ color: 'rgba(212, 168, 83, 0.9)' }}
                  >
                    创建账户
                  </button>
                </>
              ) : (
                <>
                  已有账户？{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setMode('login');
                      setErrors(EMPTY_ERRORS);
                    }}
                    style={{ color: 'rgba(212, 168, 83, 0.9)' }}
                  >
                    登录
                  </button>
                </>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Left illustration — pure CSS night-window composition.
 *  Three stacked zones (Bug fix: previously the copy overlapped the art):
 *    top 60%  — night window (deep indigo → warm brown radial gradient,
 *               breathing warm glow, 4 window mullions, desk, book spines);
 *    middle   — 1px gold gradient divider (16px transparent side margins);
 *    bottom 40% — brand copy on a dark translucent panel, stacked with
 *               generous spacing (gap 14px), never touching the art above.
 */
function IllustrationPanel(): React.ReactElement {
  return (
    <div className="relative flex h-full min-h-[480px] flex-col overflow-hidden">
      {/* === Top 60% — night window (pure CSS) === */}
      <div
        className="relative h-[60%] shrink-0 overflow-hidden"
        style={{
          background:
            'radial-gradient(ellipse at 38% 22%, rgba(96, 78, 140, 0.62) 0%, rgba(46, 36, 58, 0.9) 45%, rgba(26, 20, 28, 0.96) 70%, rgba(66, 46, 32, 1) 100%)',
        }}
      >
        {/* Soft breathing glow — moon/lamp warmth (2.4s ease, infinite) */}
        <motion.div
          className="absolute left-1/2 top-[24%] h-24 w-24 -translate-x-1/2 rounded-full"
          style={{
            background:
              'radial-gradient(circle, rgba(255, 224, 160, 0.55) 0%, rgba(255, 224, 160, 0.14) 55%, transparent 72%)',
          }}
          animate={{ opacity: [0.8, 1, 0.8] }}
          transition={{ duration: 2.4, ease: 'easeInOut', repeat: Infinity }}
        />
        {/* Warm window-light wash */}
        <div
          className="absolute left-1/2 top-0 h-full w-[66%] -translate-x-1/2"
          style={{
            background:
              'linear-gradient(180deg, rgba(255, 190, 120, 0.12) 0%, rgba(255, 190, 120, 0.04) 45%, rgba(255, 190, 120, 0) 72%)',
          }}
        />
        {/* Window frame — 4 vertical semi-transparent mullions above the desk */}
        <div className="absolute inset-x-0 bottom-[10%] flex h-[52%] justify-around px-6">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-full w-[6px] rounded-sm"
              style={{
                background:
                  'linear-gradient(180deg, rgba(70, 58, 42, 0.85), rgba(44, 36, 26, 0.45))',
                boxShadow: '0 0 16px rgba(255, 190, 120, 0.06)',
              }}
            />
          ))}
        </div>
        {/* Desk top edge */}
        <div
          className="absolute bottom-0 left-0 right-0 h-[10%]"
          style={{
            background:
              'linear-gradient(180deg, rgba(78, 60, 42, 0.95), rgba(44, 33, 23, 0.98))',
            boxShadow: '0 -6px 24px rgba(0, 0, 0, 0.35)',
          }}
        />
        {/* Book spines — bottom right, staggered (warm brown / dark gold /
            ochre), isolated in the art zone so they never cover the copy. */}
        <div className="absolute bottom-[3%] right-[10%] flex items-end gap-1.5" style={{ height: '24%' }}>
          <div className="h-[55%] w-3.5 rounded-sm" style={{ background: 'rgba(168, 118, 74, 0.92)' }} />
          <div className="h-[85%] w-3.5 rounded-sm" style={{ background: 'rgba(190, 152, 84, 0.92)' }} />
          <div className="h-[70%] w-3.5 rounded-sm" style={{ background: 'rgba(142, 88, 60, 0.92)' }} />
        </div>
      </div>

      {/* === Middle — fine gold divider (16px transparent side margins) === */}
      <div
        className="shrink-0"
        style={{
          height: 1,
          margin: '0 16px',
          background:
            'linear-gradient(90deg, transparent 0%, rgba(212, 168, 83, 0.45) 50%, transparent 100%)',
        }}
      />

      {/* === Bottom 40% — brand copy on a dark translucent panel === */}
      <div
        className="flex flex-1 shrink-0 flex-col justify-center px-6 py-5"
        style={{ background: 'rgba(8, 6, 5, 0.55)' }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#d4a853', fontSize: '12px', lineHeight: 1 }}>✦</span>
            <span
              style={{
                color: '#d4a853',
                letterSpacing: '0.3em',
                fontSize: '11px',
                lineHeight: 1,
              }}
            >
              NIAN NIAN
            </span>
          </div>
          <div
            style={{
              fontFamily: '"KaiTi", "STKaiti", "楷体", serif',
              fontSize: '18px',
              color: 'rgba(245, 235, 218, 0.96)',
              fontWeight: 500,
              lineHeight: 1.35,
            }}
          >
            照片会旧，那一天不会
          </div>
          <div style={{ fontSize: '11px', color: 'rgba(232, 221, 208, 0.5)', lineHeight: 1.5 }}>
            「和照片聊聊天，它替你把回忆写成日记。」
          </div>
        </div>
      </div>
    </div>
  );
}

/** Simple labelled input with a leading stroke icon + optional error state. */
function Field({
  icon,
  placeholder,
  value,
  onChange,
  type = 'text',
  error,
}: {
  icon: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  error?: string | null;
}): React.ReactElement {
  const borderColor = error ? 'rgba(220, 80, 80, 0.6)' : 'rgba(255, 255, 255, 0.08)';
  return (
    <div>
      <div
        className="mt-3 flex items-center gap-3 rounded-xl px-4 py-3 transition-colors"
        style={{ background: 'rgba(255, 255, 255, 0.05)', border: `1px solid ${borderColor}` }}
      >
        <svg
          className="h-4 w-4 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="rgba(212, 168, 83, 0.7)"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d={icon} />
        </svg>
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-transparent text-sm placeholder:text-warm-white/30"
          style={{ color: 'rgba(245, 235, 218, 0.92)' }}
        />
      </div>
      {error && (
        <div className="mt-1 pl-1 text-[11px]" style={{ color: 'rgba(220, 100, 100, 0.9)' }}>
          {error}
        </div>
      )}
    </div>
  );
}

/** Code input with inline "获取验证码" button + 60s countdown + error state. */
/**
 * Verification-code input. Currently NOT rendered — code auth was replaced by
 * password-only login (see the note on `loginMethod`). Kept, together with
 * `switchToCodeLogin`, so the flow can be restored if outbound SMTP ever
 * becomes reachable from the host.
 */
function CodeField({
  value,
  onChange,
  countdown,
  sending,
  onSend,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  countdown: number;
  sending: boolean;
  onSend: () => void;
  error?: string | null;
}): React.ReactElement {
  const disabled = countdown > 0 || sending;
  const borderColor = error ? 'rgba(220, 80, 80, 0.6)' : 'rgba(255, 255, 255, 0.08)';
  return (
    <div>
      <div
        className="mt-3 flex items-center gap-3 rounded-xl px-4 py-3 transition-colors"
        style={{ background: 'rgba(255, 255, 255, 0.05)', border: `1px solid ${borderColor}` }}
      >
        <svg
          className="h-4 w-4 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="rgba(212, 168, 83, 0.7)"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d={FIELD_ICONS.shield} />
        </svg>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
          placeholder="验证码"
          className="w-full bg-transparent text-sm placeholder:text-warm-white/30"
          style={{ color: 'rgba(245, 235, 218, 0.92)' }}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={onSend}
          className="shrink-0 text-xs transition-opacity disabled:opacity-50"
          style={{ color: 'rgba(212, 168, 83, 0.9)' }}
        >
          {countdown > 0 ? `重新获取(${countdown}s)` : sending ? '发送中...' : '获取验证码'}
        </button>
      </div>
      {error && (
        <div className="mt-1 pl-1 text-[11px]" style={{ color: 'rgba(220, 100, 100, 0.9)' }}>
          {error}
        </div>
      )}
    </div>
  );
}

/** Password input with visibility toggle + optional footer hint + error state. */
function PasswordField({
  value,
  onChange,
  show,
  onToggle,
  placeholder,
  footer,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
  placeholder: string;
  footer?: React.ReactNode;
  error?: string | null;
}): React.ReactElement {
  const borderColor = error ? 'rgba(220, 80, 80, 0.6)' : 'rgba(255, 255, 255, 0.08)';
  return (
    <div>
      <div
        className="mt-3 flex items-center gap-3 rounded-xl px-4 py-3 transition-colors"
        style={{ background: 'rgba(255, 255, 255, 0.05)', border: `1px solid ${borderColor}` }}
      >
        <svg
          className="h-4 w-4 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="rgba(212, 168, 83, 0.7)"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d={FIELD_ICONS.lock} />
        </svg>
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-transparent text-sm placeholder:text-warm-white/30"
          style={{ color: 'rgba(245, 235, 218, 0.92)' }}
        />
        <button
          type="button"
          onClick={onToggle}
          className="shrink-0"
          style={{ color: 'rgba(232, 221, 208, 0.4)' }}
          aria-label={show ? '隐藏密码' : '显示密码'}
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d={show ? FIELD_ICONS.eyeOff : FIELD_ICONS.eye} />
          </svg>
        </button>
      </div>
      {error && (
        <div className="mt-1 pl-1 text-[11px]" style={{ color: 'rgba(220, 100, 100, 0.9)' }}>
          {error}
        </div>
      )}
      {footer && <div className="mt-1.5 flex justify-end pr-1">{footer}</div>}
    </div>
  );
}
