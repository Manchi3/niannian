import { useEffect, useRef } from 'react';

/**
 * AmbientBackground — the warm golden halo + slow floating dust/stars that
 * give the app its candle-lit atmosphere (Round 44, extracted from the
 * Landing page's background so the memory gallery can share it).
 *
 * Composition:
 *   1. Halo — the center-gold radial gradient (same stops as the old
 *      Landing root-div gradient; center pinned to `centerY` when given).
 *      On `breathing` it gently swells (opacity 0.8↔1 / scale 1↔1.06,
 *      ~7s ease-in-out) to read as "向外扩散".
 *   2. Stars — the free-floating dust layer (identical parameters to the
 *      star layer inside EllipseParticles: 90 stars, upward drift, sin sway,
 *      twinkle pulse, respawn at the bottom). Drawn on a transparent
 *      full-viewport canvas.
 *
 * Props:
 *   centerY  — halo vertical center (px); defaults to 45% of the viewport.
 *   haloOnly — render ONLY the halo (used on the Landing page, where
 *              EllipseParticles already draws its own star layer — mounting
 *              this component there must NOT double the stars).
 *   breathing — gentle halo swell (used on the memory gallery).
 *
 * The whole layer is pointer-events:none and z-0, so it never blocks input
 * and never interferes with the 3s auto-hide (it is NOT part of the chrome).
 */

// ---- Star layer parameters — identical to EllipseParticles.tsx ----
const STAR_COUNT = 90;
const STAR_VY_MIN = 0.13;
const STAR_VY_MAX = 0.48;
const STAR_AMP_MIN = 0.3;
const STAR_AMP_MAX = 1.5;
const STAR_FREQ_MIN = 0.0008;
const STAR_FREQ_MAX = 0.0024;

interface Star {
  x: number;
  y: number;
  vy: number;
  ampX: number;
  freqX: number;
  phase: number;
  r: number;
  alpha: number;
  pulsePhase: number;
  color: string;
}

export default function AmbientBackground({
  centerY = 0,
  haloOnly = false,
  breathing = false,
}: {
  centerY?: number;
  haloOnly?: boolean;
  breathing?: boolean;
}): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (haloOnly) return; // no star canvas needed on the landing page
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let dpr = window.devicePixelRatio || 1;
    let width = window.innerWidth;
    let height = window.innerHeight;

    const resize = (): void => {
      dpr = window.devicePixelRatio || 1;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    // ---- Stars (same init as EllipseParticles) ----
    const stars: Star[] = [];
    for (let i = 0; i < STAR_COUNT; i++) {
      const r = Math.random();
      const color =
        r < 0.6 ? 'rgba(245, 230, 200, 1)' : r < 0.85 ? 'rgba(212, 168, 83, 1)' : 'rgba(255, 250, 240, 1)';
      stars.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vy: STAR_VY_MIN + Math.random() * (STAR_VY_MAX - STAR_VY_MIN),
        ampX: STAR_AMP_MIN + Math.random() * (STAR_AMP_MAX - STAR_AMP_MIN),
        freqX: STAR_FREQ_MIN + Math.random() * (STAR_FREQ_MAX - STAR_FREQ_MIN),
        phase: Math.random() * Math.PI * 2,
        r: 0.75 + Math.random() * 3.0,
        alpha: 0.3 + Math.random() * 0.5,
        pulsePhase: Math.random() * Math.PI * 2,
        color,
      });
    }

    let raf = 0;
    let lastT = performance.now();
    let frame = 0;
    const tick = (now: number): void => {
      const dt = Math.min((now - lastT) / 16.67, 2.5);
      lastT = now;
      frame++;

      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, width, height);

      ctx.globalCompositeOperation = 'lighter';
      for (const s of stars) {
        s.y -= s.vy * dt;
        s.x += Math.sin(s.phase + frame * s.freqX) * s.ampX * dt;
        if (s.y < -8) {
          s.y = height + 8;
          s.x = Math.random() * width;
          s.phase = Math.random() * Math.PI * 2;
        }
        const pulse = s.alpha * (0.7 + 0.3 * Math.sin(s.pulsePhase + frame * 0.012));
        ctx.globalAlpha = pulse;
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [haloOnly]);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
    >
      {/* Halo — candle-gold radial gradient, optional gentle breathing */}
      <div
        className="absolute inset-0"
        style={
          breathing
            ? {
                background: `radial-gradient(ellipse 105% 82.5% at 50% ${
                  centerY > 0 ? centerY : 45
                }px, rgba(120, 90, 45, 0.26) 0%, rgba(60, 45, 25, 0.12) 45%, rgba(10, 8, 6, 0) 100%)`,
                animation: 'ambient-halo-breathe 7s ease-in-out infinite alternate',
              }
            : {
                background: `radial-gradient(ellipse 105% 82.5% at 50% ${
                  centerY > 0 ? centerY : 45
                }px, rgba(120, 90, 45, 0.26) 0%, rgba(60, 45, 25, 0.12) 45%, rgba(10, 8, 6, 0) 100%)`,
              }
        }
      />
      {/* Stars (skipped when haloOnly — the Landing page already has them) */}
      {!haloOnly && (
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full"
          aria-hidden="true"
        />
      )}
      <style>{`
        @keyframes ambient-halo-breathe {
          0%   { opacity: 0.8; transform: scale(1); }
          100% { opacity: 1;   transform: scale(1.06); }
        }
      `}</style>
    </div>
  );
}
