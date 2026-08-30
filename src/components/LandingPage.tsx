import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import EllipseParticles from './EllipseParticles';
import AmbientBackground from './AmbientBackground';
import { LandingAuthBadge } from './AuthEntry';
import { useNavStore } from '../stores/navStore';
import { useAppStore } from '../stores/appStore';
import { useToastStore } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import { validateImageFile } from '../utils/helpers';

/**
 * LandingPage — the home page shown first.
 *
 * Layout (vertical, centered):
 *   - Date line           — "8月13日 · 周四" (small, low-opacity)
 *   - Cycling slogan      — large serif, 3s cross-fade through 3 phrases
 *   - Primary CTA         — "回到我的记忆" (white solid pill + ✨)
 *   - Secondary CTA       — "继续上传"   (transparent + white border + ↑)
 *
 * Background: an independent warm-toned ellipse particle cloud
 * (EllipseParticles). Clicking the primary CTA opens the diary gallery;
 * the secondary CTA jumps to the existing chat/upload flow.
 */

/** Slogans, cycled every 3s with cross-fade. */
const SLOGANS = [
  '今天过得怎么样',
  '不好发朋友圈可以跟我分享',
  '不急，我们慢慢说',
];

/**
 * Daily quotes — one short healing line per day, chosen deterministically
 * by the calendar day (day-of-year % length). Same day → same quote;
 * next day → a different one. All are single-line and short enough to fit
 * on any screen without wrapping.
 */
const DAILY_QUOTES = [
  '把今天存成值得翻起的回忆',
  '日子很慢，记得也很慢',
  '有些事，说出来就轻了',
  '我在这儿，不急',
  '风把故事吹到了这里',
  '今晚的月亮也替你记着',
  '慢慢来，好事都在路上',
  '愿意说，我就愿意听',
  '时间会把难过写成温柔的旧事',
  '你的话，我都好好收着',
  '天冷了，记得添一件温柔',
  '翻到这一页，就再读一遍',
];

/**
 * Pick today's quote: uses the serial day number (days since epoch) so it
 * is stable within a day and advances by exactly one each day.
 */
export function todayQuote(): string {
  const d = new Date();
  const serial = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
  return DAILY_QUOTES[serial % DAILY_QUOTES.length];
}

const SLOGAN_INTERVAL_MS = 4000; // Round 27: 3s → 4s (fade timings unchanged)

/** Format "8月13日 · 周四" (Chinese weekday name). */
function formatToday(): string {
  const d = new Date();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const wd = weekdays[d.getDay()];
  return `${m}月${day}日 · ${wd}`;
}

/** Round 33: hollow-outline sparkles (lucide "sparkles" path, stroke-only).
 *  Color follows currentColor (deep warm grey on the primary button). */
function SparklesIcon(): React.ReactElement {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flex: 'none', display: 'block' }}
      aria-hidden="true"
    >
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
      <path d="M20 3v4" />
      <path d="M22 5h-4" />
      <path d="M4 17v2" />
      <path d="M5 18H3" />
    </svg>
  );
}

export default function LandingPage(): React.ReactElement {
  const goTo = useNavStore((s) => s.goTo);
  const showToast = useToastStore((s) => s.showToast);
  const user = useAuthStore((s) => s.user);
  const setAuthModalOpen = useAuthStore((s) => s.setAuthModalOpen);
  const [sloganIndex, setSloganIndex] = useState(0);
  const [date, setDate] = useState<string>(formatToday());
  const [quote] = useState<string>(todayQuote());
  // Round 42: "继续上传" skips the intermediate upload page — opens the
  // system file picker directly; the picked file is handed to ChatMainView
  // via appStore.pendingImageFile, which processes it on mount.
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const handleUploadClick = useCallback(() => {
    uploadInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0] ?? null;
      e.target.value = ''; // allow re-selecting the same file next time
      if (!file) return;
      const err = validateImageFile(file);
      if (err) {
        showToast(err, { kind: 'error', duration: 4000 });
        return;
      }
      // Round 26 (bug④): start a fresh round — reset phase / chat history /
      // stale image and mint a new conversationId — THEN jump to chat. The
      // new id remounts ChatMainView via App's key, so the previous round's
      // state never leaks in (no old conversation, no black screen).
      useAppStore.getState().startNewRound(file);
      goTo('chat');
    },
    [goTo, showToast],
  );
  // Round 33: hover state for the primary button's soft white glow halo.
  const [primaryHover, setPrimaryHover] = useState(false);
  // Round 27-29: measure the date line's vertical center (cloud center) and
  // the slogan text's BOTTOM edge (cloud bottom constraint) so the particle
  // cloud wraps the date + slogan and its bottom edge touches the text
  // bottom.
  const dateRef = useRef<HTMLParagraphElement>(null);
  const sloganRef = useRef<HTMLHeadingElement>(null);
  const [cloudCenterY, setCloudCenterY] = useState(0);
  const [sloganBottom, setSloganBottom] = useState(0);
  // Round 47: the slogan's text-zone dimming was REMOVED — the "background
  // box" users saw behind the copy was NOT a LandingPage container style
  // (grep: zero background/backdrop on the text container) but the particle
  // system's zonal dimming driven by this textRect prop (TEXT_ZONE_MUL
  // 0.24). EllipseParticles.tsx is frozen, so we simply STOP passing the
  // rect → particles render uniformly behind the text; readability is kept
  // with text-shadows instead.
  const measure = useCallback(() => {
    if (dateRef.current) {
      const r = dateRef.current.getBoundingClientRect();
      setCloudCenterY(r.top + r.height / 2);
    }
    if (sloganRef.current) {
      // Range gives the actual glyph bounding box (not the full-width h1).
      const range = document.createRange();
      range.selectNodeContents(sloganRef.current);
      const rr = range.getBoundingClientRect();
      setSloganBottom(rr.bottom);
    }
  }, []);

  useEffect(() => {
    // Measure after first paint + on resize.
    const raf = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    // Round 33: re-measure once web fonts finish loading — font metrics can
    // shift the slogan rect; the particle lerp smooths the transition.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(measure).catch(() => undefined);
    }
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  useEffect(() => {
    // Re-measure after every render (slogan cross-fades every 4s change the
    // text width/position).
    const t1 = setTimeout(measure, 350);
    const t2 = setTimeout(measure, 800);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  });

  // Cycle slogan every 3s
  useEffect(() => {
    const id = setInterval(() => {
      setSloganIndex((i) => (i + 1) % SLOGANS.length);
    }, SLOGAN_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  // Refresh date at midnight (cheapest correctness — full reload not needed)
  useEffect(() => {
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
    const ms = nextMidnight.getTime() - now.getTime();
    const id = setTimeout(() => setDate(formatToday()), ms);
    return () => clearTimeout(id);
  }, [date]);

  return (
    /* Round 24-30: center-gold radial gradient background. Round 30: the
       gradient's center is pinned to the particle cloud center (cx = 50%,
       cy = cloudCenterY) so the glow is always concentric with the disc.
       Round 32: outer radius ×1.5 (ellipse 70% 55% → 105% 82.5%) and the
       stops flattened (0% → 0.26 / 45% → 0.12 / 100% transparent) so the
       glow spreads wider & softer instead of hugging the middle.
       Round 44: the halo moved into <AmbientBackground haloOnly /> (visual
       identical — halo only; the floating stars stay inside EllipseParticles
       so nothing is doubled). Root keeps just the base near-black. */
    <div
      className="relative min-h-screen w-full overflow-hidden"
      style={{ background: '#0a0806' }}
    >
      {/* Round Nav: top-right account badge — signed in shows the
          "avatar + nickname + 登出" combo (click avatar/nickname opens the
          ProfileEditor; 登出 logs out); guests see the hollow person icon
          which opens the AuthModal. No slider/keyboard/vortex icon groups
          live here. */}
      <LandingAuthBadge />
      <AmbientBackground haloOnly centerY={cloudCenterY} />
      {/* Round 42: hidden picker — "继续上传" opens this directly (skips the
          intermediate upload page); the file is handed to ChatMainView. */}
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleFileChange}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
      />
      {/* Ellipse particle background — centered on the date line; radius
          fitted so the bottom edge touches the slogan bottom; receives the
          slogan rect so particles under the text fade out (分区透明度). */}
      <EllipseParticles
        centerY={cloudCenterY}
        textBottom={sloganBottom}
      />

      {/* Center content — vertically centered.
          Round 27-28: gap tightened so date & slogan sit close together. */}
      <div className="pointer-events-none relative z-10 flex min-h-screen flex-col items-center justify-center px-6">
        <div className="pointer-events-auto flex w-full max-w-2xl flex-col items-center gap-4 text-center">

          {/* Date — Round 25: no text-selection cursor, default arrow.
              Round 27: ref'd so the particle cloud centers on this line.
              Round 35: bright warm-white + KaiTi (unified with the logo)
              + a faint warm glow shadow so it floats above the cloud. */}
          <motion.p
            ref={dateRef}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="text-xs tracking-[0.18em]"
            style={{
              fontFamily: '"KaiTi", "STKaiti", "楷体", serif',
              color: 'rgba(255, 244, 224, 0.92)',
              textShadow: '0 0 8px rgba(255, 220, 160, 0.25)',
              userSelect: 'none',
              WebkitUserSelect: 'none',
              cursor: 'default',
            }}
          >
            {date}
          </motion.p>

          {/* Slogan — cross-fade every 3s (Round 24: PURE opacity fade,
              no movement; the element position never changes).
              Round 25: font size dropped ~24% and made fully responsive so
              the longest line "不好发朋友圈可以跟我分享" NEVER overflows —
              container gets max-width guard + padding, text is nowrap. */}
          {/* IMPORTANT: parent div MUST have an explicit width (w-full) so the
              absolutely-positioned h1 has room to lay out horizontally.
              Otherwise flex-col items-center collapses the wrapper to 0
              width and the text wraps one character per line (vertical). */}
          <div className="relative w-full min-h-[4.5rem] sm:min-h-[5.5rem]">
            <AnimatePresence mode="wait">
              <motion.h1
                ref={sloganRef}
                key={sloganIndex}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                // exit 0.5s → enter 0.7s: old line fades out, then the new
                // one fades in. No x/y transform anywhere.
                transition={{ duration: 0.7, ease: 'easeInOut' }}
                className="absolute inset-0 flex items-center justify-center whitespace-nowrap text-center"
                style={{
                  // Serif stack + slightly wide tracking
                  fontFamily: "'Noto Serif SC', 'Songti SC', 'STSong', 'SimSun', serif",
                  letterSpacing: '0.06em',
                  // Responsive: smaller than before, auto-shrinks on narrow
                  // screens so no character ever gets clipped.
                  fontSize: 'clamp(24px, 4.2vw, 42px)',
                  lineHeight: 1.2,
                  maxWidth: '100%',
                  padding: '0 0.75rem',
                  boxSizing: 'border-box',
                  // Vertical metallic gradient text: bright white → silver
                  background:
                    'linear-gradient(180deg, #ffffff 0%, #ececec 45%, #9f9f9f 100%)',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  color: 'transparent',
                  // Round 47: particles are no longer dimmed behind the
                  // text — a soft dark shadow keeps it readable on the cloud.
                  textShadow: '0 2px 12px rgba(0, 0, 0, 0.5)',
                  userSelect: 'none',
                  WebkitUserSelect: 'none',
                  cursor: 'default',
                }}
              >
                {SLOGANS[sloganIndex]}
              </motion.h1>
            </AnimatePresence>
          </div>

          {/* CTAs — Round Auth: signed-in users keep the original two
              buttons (回到我的记忆 / 继续上传); guests see the P0-10 pair:
              白色实心「从一张照片开始」(选图后以 guest 进粒子聊天页) +
              透明细灰边「登录已有账号」(打开登录/注册弹窗). */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut', delay: 0.2 }}
            className="flex flex-col items-center gap-4"
            style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
          >
            {user ? (
              <>
                {/* Primary — PURE WHITE pill.
                    Round 32: slim capsule (13px 30px / 15px / 999px).
                    Round 33: inline-flex + line-height 1 → icon/text perfectly
                    centered; solid #ffffff; hover = soft two-layer white glow
                    (0 0 24px 6px + 0 0 64px 20px, 0.35s ease), no hard stroke;
                    hollow sparkles SVG (currentColor). */}
                <button
                  onClick={() => goTo('gallery')}
                  onMouseEnter={() => setPrimaryHover(true)}
                  onMouseLeave={() => setPrimaryHover(false)}
                  className="flex items-center justify-center rounded-full font-mono transition-all duration-300 hover:scale-[1.02]"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    lineHeight: '1',
                    padding: '13px 30px',
                    fontSize: '15px',
                    borderRadius: '999px',
                    background: '#ffffff',
                    color: '#2b2620',
                    cursor: 'pointer',
                    boxShadow: primaryHover
                      ? '0 0 24px 6px rgba(255,255,255,0.35), 0 0 64px 20px rgba(255,255,255,0.16)'
                      : '0 0 0 0 rgba(255,255,255,0)',
                    transition: 'box-shadow 0.35s ease',
                  }}
                >
                  <SparklesIcon />
                  <span>回到我的记忆</span>
                </button>

                {/* Secondary — outlined pill (Round 32: 10px 26px / 14px / 999px).
                    Round 33: same inline-flex centering fix; icon flex:none.
                    Round 42: opens the file picker directly (skips upload page). */}
                <button
                  onClick={handleUploadClick}
                  className="flex items-center justify-center rounded-full font-mono transition-all duration-300 hover:bg-white/5"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    lineHeight: '1',
                    padding: '10px 26px',
                    fontSize: '14px',
                    borderRadius: '999px',
                    border: '1px solid rgba(245, 230, 200, 0.45)',
                    color: 'rgba(245, 230, 200, 0.85)',
                    cursor: 'pointer',
                  }}
                >
                  <svg
                    style={{ width: '17px', height: '17px', flex: 'none', display: 'block' }}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5M12 5L7 10M12 5L17 10" />
                  </svg>
                  <span>继续上传</span>
                </button>
              </>
            ) : (
              <>
                {/* Guest primary — white solid pill, upload icon:
                    pick a photo → straight into the particle chat as guest. */}
                <button
                  onClick={handleUploadClick}
                  onMouseEnter={() => setPrimaryHover(true)}
                  onMouseLeave={() => setPrimaryHover(false)}
                  className="flex items-center justify-center rounded-full font-mono transition-all duration-300 hover:scale-[1.02]"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    lineHeight: '1',
                    padding: '13px 30px',
                    fontSize: '15px',
                    borderRadius: '999px',
                    background: '#ffffff',
                    color: '#2b2620',
                    cursor: 'pointer',
                    boxShadow: primaryHover
                      ? '0 0 24px 6px rgba(255,255,255,0.35), 0 0 64px 20px rgba(255,255,255,0.16)'
                      : '0 0 0 0 rgba(255,255,255,0)',
                    transition: 'box-shadow 0.35s ease',
                  }}
                >
                  <svg
                    style={{ width: '17px', height: '17px', flex: 'none', display: 'block' }}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5M12 5L7 10M12 5L17 10" />
                  </svg>
                  <span>从一张照片开始</span>
                </button>

                {/* Guest secondary — transparent thin grey border, login icon:
                    opens the login/register dialog. */}
                <button
                  onClick={() => setAuthModalOpen(true)}
                  className="flex items-center justify-center rounded-full font-mono transition-all duration-300 hover:bg-white/5"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    lineHeight: '1',
                    padding: '10px 26px',
                    fontSize: '14px',
                    borderRadius: '999px',
                    border: '1px solid rgba(200, 195, 185, 0.35)',
                    color: 'rgba(220, 215, 205, 0.8)',
                    cursor: 'pointer',
                  }}
                >
                  <svg
                    style={{ width: '17px', height: '17px', flex: 'none', display: 'block' }}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="8" r="4" />
                    <path d="M4.5 20c0-3.3 3.4-5.2 7.5-5.2s7.5 1.9 7.5 5.2" />
                  </svg>
                  <span>登录已有账号</span>
                </button>
              </>
            )}
          </motion.div>
        </div>
      </div>

      {/* === Daily quote (Round 25) — pinned to the bottom, deterministic
          by calendar day, no text-selection cursor. === */}
      <p
        className="pointer-events-none absolute bottom-6 left-1/2 z-10 w-full -translate-x-1/2 whitespace-nowrap text-center"
        style={{
          fontFamily: "'Noto Serif SC', 'Songti SC', 'STSong', 'SimSun', serif",
          fontSize: '13px',
          letterSpacing: '0.04em',
          color: 'rgba(220, 210, 195, 0.55)',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          cursor: 'default',
        }}
      >
        {quote}
      </p>
    </div>
  );
}