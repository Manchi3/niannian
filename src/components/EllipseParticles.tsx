import { useEffect, useRef } from 'react';

/**
 * EllipseParticles — landing-page particle system (Round 26: polar-disc +
 * perspective squash model).
 *
 * Independent of the main chat-particle system (finalized, untouched).
 *
 * Mental model (the only correct one):
 *   Imagine a FLAT disc lying on a table, viewed from slightly above at an
 *   angle. Perspective squashes the circle into a WIDE, FLAT ellipse. Now
 *   spin that disc around the vertical axis through its center.
 *
 *   - The outline is ALWAYS a flat horizontal ellipse — never a square,
 *     never a ball.
 *   - Particles merely FLOW inside the ellipse: ones near the viewer
 *     (bottom edge) are slightly bigger/brighter, ones far away (top
 *     edge) slightly smaller/dimmer → a real "flat disc spinning" volume.
 *
 * Geometry (per spec):
 *   Step 1 — polar anchors inside the disc (NORMALIZED radius rn ∈ [0, 1.4],
 *     22% are edge-scatter particles multiplied to 1.05~1.4 for a soft halo):
 *     rn base = U^0.6 (denser center, sparser rim); a ∈ [0, 2π);
 *     tiny vertical jitter ±2~4px (flat, not a line).
 *   Step 2 — spin around vertical axis each frame:
 *     a_now = a + theta;  theta += 2π/17 · dt (clockwise, permanent,
 *     mouse-independent; 17 s per revolution).
 *   Step 3 — project the disc to a squashed ellipse:
 *     r = p.rn · R          (R is LERPED toward the measured target)
 *     localX = r·cos(a_now)            (full width)
 *     localY = r·sin(a_now) · SQUASH   (squashed! SQUASH ≈ 0.35)
 *     screenX = cx + localX
 *     screenY = cy + localY + yJitter
 *     depth   = sin(a_now)             (+1 bottom/near, −1 top/far)
 *   Step 4 — restrained depth cue + soft edge feather:
 *     size  = base · (1 + depth·0.25)     (±25%)
 *     alpha = base · (0.6 + depth·0.25) · edgeFade(rn)   (dim far, bright
 *     near; rim thins out, no hard ellipse boundary)
 *     draw order: sort by depth ascending (far first).
 *   Step 5 — spring toward (screenX, screenY) + mouse hole in 2D.
 *
 * Forbidden list honored:
 *   ✔ NOT (x,y,z) cube random anchors
 *   ✔ NOT SQUASH=1 / similar axes
 *   ✔ NOT in-plane 2D rotation (no flat-disc spinning flat)
 *   ✔ NOT exaggerated depth scaling (which would puff it into a ball)
 */

// --- Star layer (background drift) — Round 30: ~1.5× size, ~1.6× speed ---
const STAR_COUNT = 90;
const STAR_VY_MIN = 0.13; // was 0.08 (×1.6)
const STAR_VY_MAX = 0.48; // was 0.30 (×1.6)
const STAR_AMP_MIN = 0.30; // sway scales with speed
const STAR_AMP_MAX = 1.50;
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

// --- Polar disc cloud (Round 34 tuned) ---
/** Round 29: count cut for airiness. Round 34: ×1.5 denser (1080). */
const ELLIPSE_BASE_COUNT = 1080;
/** Perspective squash: 1 = circle, 0 = infinitely flat. 0.35 → ~2.9:1. */
const SQUASH = 0.35;
/** Radius distribution exponent — center-denser, sparse rim. */
const RADIUS_EXP = 0.6;
/** Minimum disc radius (px) — prevents collapse on tiny screens. */
const MIN_RADIUS = 150;
/** Round 34: fallback radius ≈ measured target (238.4 on 1280×800) so the
 *  FIRST frame is already ≈ final size — the lerp only nudges ±3px and the
 *  "grow from small" step is gone entirely. */
const FALLBACK_RADIUS = 235;
/** Round 34: fallback cy ≈ measured date center (298.3) — same reasoning. */
const FALLBACK_CY = 300;
/** Round 33: spring very strong + light damping → ~0.2s "唰地弹回".
 *  Safety valve if particles vibrate/fly out: DAMPING +0.02, MAX_SPEED
 *  clamp 14 — never fix it by lowering the repulsion. */
const SPRING_K = 0.25;
const DAMPING = 0.80;
/** Round 33: big, deep mouse hole. */
const MOUSE_RADIUS = 210;
const MOUSE_REPEL = 36; // Round 32: 24 → ×1.5
/** Round 33: 17 s per revolution — 2π/17 ≈ 0.3696 rad/s. dt is SECONDS
 *  (now−last)/1000, so 3 s ≈ 63° of clearly visible spin. */
const ROTATION_SPEED = (2 * Math.PI) / 17; // rad / second (NOT per frame)
/** Round 33: cap widened so the stronger spring / repulsion isn't clipped. */
const MAX_SPEED = 18; // px/frame
/** Round 31: text-zone dimming coefficient + safety padding around the
 *  text rect (particles near the glyphs fade extra hard). Kept — the cloud
 *  can be brighter overall, but the glyph zone always yields. */
const TEXT_ZONE_MUL = 0.24;
const TEXT_ZONE_PAD = 12; // px
/** Round 33: 22% of particles become EDGE SCATTER — their normalized
 *  radius is multiplied by 1.05~1.4 to drift outside the core disc and
 *  form a soft diffuse halo instead of a hard cut boundary. */
const EDGE_SCATTER_RATIO = 0.22;
const EDGE_SCATTER_MIN = 1.05;
const EDGE_SCATTER_MAX = 1.4;
/**
 * Round 37: CURVE-MORPH entrance. Particles are PINNED to a curve with a
 * fixed parameter s ∈ [0,1]; the curve itself morphs from a double-arc
 * ribbon (form A) into the final ellipse (form B) over 1.8s. Nothing flies
 * independently, nothing overshoots — M uses smoothstep (pure monotonic,
 * mathematically incapable of duang/back/elastic/bounce). The module-level
 * flag makes React StrictMode's double effect invocation unable to replay
 * it: flipped only AFTER the entrance completes (in the tick loop).
 */
let introPlayed = false;
const INTRO_MS = 1800; // entrance duration

/** Round 37: form A — double-arc ribbon. Left arc for s ∈ [0, 0.5],
 *  right arc (mirrored) for s ∈ [0.5, 1]; BOTH meet continuously at
 *  (cx, cy) when s = 0.5. The right arc is sampled CENTER→OUTER so the
 *  two arcs join without a seam.
 *    Left:  P0=(cx−R·1.6, cy−R·0.5)  P1=(cx−R·0.7, cy−R·0.2)  P2=(cx, cy)
 *    Right: mirror of that. */
function ribbonShape(
  s: number,
  cx: number,
  cy: number,
  R: number,
): { x: number; y: number } {
  if (s < 0.5) {
    const t = s * 2; // 0 → 1 (outer end → center)
    const u = 1 - t;
    return {
      x: u * u * (cx - R * 1.6) + 2 * u * t * (cx - R * 0.7) + t * t * cx,
      y: u * u * (cy - R * 0.5) + 2 * u * t * (cy - R * 0.2) + t * t * cy,
    };
  }
  const t = 2 * (1 - s); // 1 → 0 (center → outer end)
  const u = 1 - t;
  return {
    x: u * u * (cx + R * 1.6) + 2 * u * t * (cx + R * 0.7) + t * t * cx,
    y: u * u * (cy - R * 0.5) + 2 * u * t * (cy - R * 0.2) + t * t * cy,
  };
}

/**
 * Round 38: form B is NOT a separate shape anymore. The morph target is
 * each particle's OWN final physical landing spot (p.x, p.y) — the exact
 * coordinates the physics loop uses after the entrance. Round 37's
 * ellipseShape (ang = s·2π → a hollow ellipse RING) was deleted because a
 * ring ≠ the solid center-dense cloud, which caused a hard cut at M=1.
 * Using p.x/p.y makes M=1's drawX/drawY EQUAL to the post-entrance
 * physics coordinates pixel-for-pixel — zero jump, guaranteed.
 */

/** Round 37: smoothstep — the ONLY easing allowed in the entrance. Pure
 *  monotonic (3t²−2t³); mathematically cannot exceed [0,1], so NO
 *  overshoot / duang / back / elastic / bounce. This is a hard red line. */
function smoothstep(x: number): number {
  const c = Math.min(Math.max(x, 0), 1);
  return c * c * (3 - 2 * c);
}

interface Particle {
  /** NORMALIZED polar radius [0, 1.4] — actual px radius = p.rn × current R.
   *  Stored once at init; R changes are LERPED, never re-sampled, so the
   *  cloud scales smoothly without any rebuild/teleport. */
  rn: number;
  /** Initial angle [0, 2π). */
  a: number;
  /** Tiny vertical jitter (±2~4px) — keeps the disc from looking rigid. */
  yJitter: number;
  /** Current screen position + velocity (2D physics). */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Round 34: stable array index — parity decides which silk line the
   *  entrance draws it from (even → left line, odd → right line). */
  idx: number;
  /** Base visual properties (depth-modulated at draw time). */
  baseR: number;
  glowSize: number;
  color: string;
  baseAlpha: number;
  k: number;
  /** Current depth = sin(a_now) — refreshed each frame, used for sort. */
  depth: number;
  /** Round 31: independent twinkle — phase (0..2π) + speed (0.5..2). */
  phase: number;
  twinkleSpeed: number;
}

/** Count: drop to half on low-core devices. */
function pickCount(): number {
  const cores =
    typeof navigator !== 'undefined' && navigator.hardwareConcurrency
      ? navigator.hardwareConcurrency
      : 8;
  return cores <= 4 ? Math.round(ELLIPSE_BASE_COUNT * 0.5) : ELLIPSE_BASE_COUNT;
}

/** Warm gold / champagne / cream palette. */
function warmColor(): string {
  const r = Math.random();
  if (r < 0.55) return `rgba(212, 168, 83, 1)`;
  if (r < 0.85) return `rgba(245, 230, 200, 1)`;
  return `rgba(240, 235, 225, 1)`;
}

/** Pre-rendered white radial glow sprite (cheap additive bloom). */
function makeGlowSprite(): HTMLCanvasElement {
  const size = 32;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255, 245, 220, 1)');
    grad.addColorStop(0.35, 'rgba(255, 238, 205, 0.5)');
    grad.addColorStop(1, 'rgba(255, 238, 205, 0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  return c;
}

/** Module-level singleton — created exactly once, never per frame / per
 *  resize / per StrictMode remount. */
const GLOW_SPRITE = makeGlowSprite();

/**
 * Disc radius TARGET (measurement-driven).
 *   halfY = textBottom − centerY → R = halfY / SQUASH so the ellipse's
 *   bottom edge exactly touches the text bottom (clamped to MIN_RADIUS).
 *   Until a valid textBottom is measured (>0), a SAFE constant radius is
 *   used. The tick loop LERPS the live R toward this target, so measured
 *   step-changes (fallback → first measure → fonts-loaded re-measure)
 *   become smooth ~0.3-0.5s transitions instead of jumps.
 */
function computeRadius(
  cy: number,
  textBottom: number,
  height: number,
  width: number,
): number {
  if (cy > 0 && textBottom > cy) {
    const halfY = textBottom - cy;
    return Math.max(halfY / SQUASH, MIN_RADIUS);
  }
  return FALLBACK_RADIUS;
}

/**
 * Bounding box of the slogan text, in viewport CSS px. Particles whose
 * screen position falls inside this rect are dimmed so the text always
 * stays readable (分区透明度, Round 30).
 */
export interface TextRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * EllipseParticles — landing-page particle system.
 *
 * Props:
 *   centerY — vertical center of the disc (date line), viewport CSS px.
 *   textBottom — bottom edge of the slogan text, viewport CSS px. The disc
 *   radius target derives from these; the live R/cy LERP toward them.
 *   textRect — slogan bounding box; particles inside are drawn dimmer.
 */
export default function EllipseParticles({
  centerY = 0,
  textBottom = 0,
  textRect = null,
}: {
  centerY?: number;
  textBottom?: number;
  textRect?: TextRect | null;
}): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Rotation angle lives in a ref so React StrictMode's double effect
  // invocation can NEVER reset it. Starts at 0, accumulates at the normal
  // angular speed — the entrance animation adds NO extra rotation.
  const thetaRef = useRef(0);
  // Round 40: mouse position persists in a ref. pointermove ONLY writes it
  // (no physics here); the rAF loop reads it every frame and computes the
  // repulsion — so the repulsion never dies when the mouse stops moving.
  const mouseRef = useRef({ x: -9999, y: -9999, active: false });
  // Latest measurements in refs — the animation loop reads them each frame
  // and LERPS toward them; nothing is assigned to R/cy directly.
  const centerYRef = useRef(centerY);
  const textBottomRef = useRef(textBottom);
  const textRectRef = useRef(textRect);
  useEffect(() => {
    centerYRef.current = centerY;
  }, [centerY]);
  useEffect(() => {
    textBottomRef.current = textBottom;
  }, [textBottom]);
  useEffect(() => {
    textRectRef.current = textRect;
  }, [textRect]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let dpr = window.devicePixelRatio || 1;
    let width = window.innerWidth;
    let height = window.innerHeight;

    // ===== Polar disc cloud — particles created EXACTLY ONCE =====
    // Round 33: normalized radii (p.rn × live R each frame) + LERPed R/cy
    // mean the array is never rebuilt — resize/measure only change targets.
    const particles: Particle[] = [];
    const count = pickCount();
    {
      // Initial screen positions use the fallback geometry — Round 34:
      // fallback ≈ measured targets (235 / 300), so the first frame is
      // already ≈ final size (no "grow from small" step).
      const cy0 = FALLBACK_CY;
      const R0 = FALLBACK_RADIUS;
      for (let i = 0; i < count; i++) {
        const rnBase = Math.pow(Math.random(), RADIUS_EXP); // 0..1, dense center
        // Round 33: 22% edge-scatter particles drift to rn 1.05~1.4 (soft halo)
        const rn =
          Math.random() < EDGE_SCATTER_RATIO
            ? rnBase * (EDGE_SCATTER_MIN + Math.random() * (EDGE_SCATTER_MAX - EDGE_SCATTER_MIN))
            : rnBase;
        const ang = Math.random() * Math.PI * 2;
        // Tiny vertical jitter so the disc isn't a rigid geometric line
        const yJitter = (Math.random() * 2 - 1) * 3; // ±3px
        // Disc is flat: its planar coordinates before squash
        const lx = rn * R0 * Math.cos(ang);
        const ly = rn * R0 * Math.sin(ang) * SQUASH;
        const baseR =
          Math.random() < 0.7
            ? 0.4 + Math.random() * 0.9
            : 1.3 + Math.random() * 1.3;
        particles.push({
          rn,
          a: ang,
          yJitter,
          x: width / 2 + lx,
          y: cy0 + ly + yJitter,
          vx: 0,
          vy: 0,
          idx: i,
          baseR,
          glowSize: baseR * 6,
          color: warmColor(),
          // Round 33: 0.68~1.00. Round 34: 0.82 ~ 1.00 — nearly fully lit,
          // additive 'lighter' compositing makes the light points glow.
          baseAlpha: 0.82 + Math.random() * 0.18,
          k: SPRING_K + (Math.random() - 0.5) * 0.03,
          depth: Math.sin(ang),
          // Per-particle twinkle (phase 0..2π, speed 0.5..2).
          phase: Math.random() * Math.PI * 2,
          twinkleSpeed: 0.5 + Math.random() * 1.5,
        });
      }
    }

    const resize = (): void => {
      dpr = window.devicePixelRatio || 1;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Round 33: NO rebuild — particles are normalized; the spring simply
      // pulls them toward the new anchors as R/cy lerp to new targets.
    };
    resize();
    window.addEventListener('resize', resize);

    // ===== Star layer =====
    const stars: Star[] = [];
    const initStars = (): void => {
      stars.length = 0;
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
    };
    initStars();

    // ===== Pointer state (Round 40: events only WRITE the ref; the rAF
    // loop reads it every frame and applies the repulsion. The mouse can
    // stop moving forever — the repulsion keeps working.) =====
    const onMove = (e: PointerEvent): void => {
      mouseRef.current = { x: e.clientX, y: e.clientY, active: true };
    };
    const onLeave = (): void => {
      mouseRef.current = { ...mouseRef.current, active: false };
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerleave', onLeave);

    // ===== Animation loop =====
    let raf = 0;
    let lastT = performance.now();
    let frame = 0;
    // Round 33: LIVE (lerped) disc center/radius — the ONLY writers are the
    // lerp lines below; measurement values are never assigned directly.
    // Round 34: start at ≈measured fallbacks (300 / 235) — first frame is
    // already ≈ final size, so the lerp only nudges ±3px (imperceptible).
    let cy = FALLBACK_CY;
    let R = FALLBACK_RADIUS;
    // One-time entrance (module flag flipped after completion — StrictMode
    // double-mount cannot replay it).
    let introStart = introPlayed ? -1 : performance.now();
    const MAX_SPEED2 = MAX_SPEED * MAX_SPEED;
    const R2 = MOUSE_RADIUS * MOUSE_RADIUS;

    const tick = (now: number): void => {
      // dt: frame-normalized (1 frame = 16.67ms) — physics forces.
      const dt = Math.min((now - lastT) / 16.67, 2.5);
      // dtSec: REAL SECONDS — rotation, so rad/s is literal.
      const dtSec = Math.min((now - lastT) / 1000, 0.15);
      lastT = now;
      frame++;

      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, width, height);

      // Advance rotation — theta lives in a ref (never reset) and IS used
      // for projection below each frame. Round 33: 2π/17 ≈ 0.37 rad/s.
      thetaRef.current += ROTATION_SPEED * dtSec;
      const theta = thetaRef.current;

      // Round 39: CURVE-MORPH entrance. M ∈ [0,1] = morph progress over
      // 1.8s. Easing is ease-out-cubic — steep at the start (motion from
      // frame one, no waiting period), soft landing at the end. Still
      // strictly monotonic ∈ [0,1], zero overshoot (red line intact).
      // Rotation/theta and the R/cy lerp stay completely untouched.
      let M = 1;
      if (introStart >= 0) {
        const t = Math.min((now - introStart) / INTRO_MS, 1);
        M = 1 - Math.pow(1 - t, 3); // ease-out-cubic
        if (t >= 1) {
          introStart = -1;
          introPlayed = true; // entrance completed — never replay
        }
      }
      const starFade = introStart >= 0 ? smoothstep(M / 0.5) : 1;

      // ===== Round 33: LERP the disc center/radius toward measured
      // targets. 0.1/frame → the fallback→first-measure→fonts-measure
      // steps all become smooth ~0.3-0.5s transitions. NO direct
      // assignment of measurement values to R/cy anywhere. =====
      const tCy = centerYRef.current > 0 ? centerYRef.current : FALLBACK_CY;
      const tR = computeRadius(tCy, textBottomRef.current, height, width);
      cy += (tCy - cy) * 0.1;
      R += (tR - R) * 0.1;

      const cx = width / 2;

      // ===== Star layer =====
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
        // Round 37: star layer fades in with the morph progress M.
        ctx.globalAlpha = pulse * starFade;
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // ===== Polar disc — physics =====
      for (const p of particles) {
        // Round 33: actual radius = NORMALIZED rn × live (lerped) R.
        const r = p.rn * R;
        // Spin the particle's angle around the vertical axis
        const aNow = p.a + theta;
        // Project flat disc → squashed ellipse (perspective)
        const localX = r * Math.cos(aNow);
        const localY = r * Math.sin(aNow) * SQUASH;
        const ax = cx + localX;
        const ay = cy + localY + p.yJitter;
        // Depth: +1 bottom/near, −1 top/far
        p.depth = Math.sin(aNow);

        // Spring toward the projected anchor
        p.vx += (ax - p.x) * p.k * dt;
        p.vy += (ay - p.y) * p.k * dt;

        // Round 40: mouse repel — computed EVERY FRAME from the live mouse
        // position (mouseRef), independent of whether the mouse is moving.
        // A resting mouse keeps pushing: dist-based force, no speed/delta
        // dependence, so particles stay pushed open and never collapse.
        const mPos = mouseRef.current;
        if (mPos.active) {
          const dx = p.x - mPos.x;
          const dy = p.y - mPos.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < R2 && d2 > 0.25) {
            const d = Math.sqrt(d2);
            const falloff = 1 - d / MOUSE_RADIUS;         // 0 at edge, 1 at center
            const f = falloff * falloff * MOUSE_REPEL;    // squared falloff
            p.vx += (dx / d) * f * dt;
            p.vy += (dy / d) * f * dt;
          }
        }

        // Damping + speed cap
        p.vx *= DAMPING;
        p.vy *= DAMPING;
        const sp2 = p.vx * p.vx + p.vy * p.vy;
        if (sp2 > MAX_SPEED2) {
          const s = MAX_SPEED / Math.sqrt(sp2);
          p.vx *= s;
          p.vy *= s;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }

      // Depth sort — far (top, depth −1) first, near (bottom, +1) last
      particles.sort((a, b) => a.depth - b.depth);

      // ===== Draw: zonal transparency + twinkle + soft edge feather =====
      ctx.globalCompositeOperation = 'lighter';
      const tRect = textRectRef.current;
      // Expand the text rect by a safety pad so the glyphs' immediate
      // surroundings stay clean too.
      const tz =
        tRect && tRect.top > 0
          ? {
              left: tRect.left - TEXT_ZONE_PAD,
              right: tRect.right + TEXT_ZONE_PAD,
              top: tRect.top - TEXT_ZONE_PAD,
              bottom: tRect.bottom + TEXT_ZONE_PAD,
            }
          : null;

      // Round 37: optional faint guide line = form A itself, drawn while the
      // morph is early (M < 0.5), alpha (0.5 − M)·0.3 — perfectly in sync
      // with the particles because it IS the particle curve (no detached
      // glow). Gone by M = 0.5.
      if (introStart >= 0 && M < 0.5) {
        const gAlpha = (0.5 - M) * 0.3;
        if (gAlpha > 0.01) {
          ctx.globalAlpha = gAlpha;
          ctx.lineWidth = 1.2;
          ctx.strokeStyle = 'rgba(245, 230, 200, 0.9)';
          const SEG = 48;
          ctx.beginPath();
          for (let i = 0; i <= SEG; i++) {
            const A = ribbonShape(i / SEG, cx, cy, R);
            if (i === 0) ctx.moveTo(A.x, A.y);
            else ctx.lineTo(A.x, A.y);
          }
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
      for (const p of particles) {
        const d = p.depth; // −1 .. +1
        // Restrained: size ±25%; alpha float narrowed so the near edge
        // never flares too bright.
        const sizeMul = 1 + d * 0.25;
        const alphaMul = 0.6 + d * 0.25;
        // Round 33: soft edge feather — radial alpha falloff by rn so the
        // rim thins out naturally (no hard ellipse boundary):
        //   rn ≤ 0.7 → 1.0 (no fade); rn = 1.0 → ≈0.57; rn ≥ 1.4 → 0.2.
        const edgeFade = Math.min(Math.max(1 - (p.rn - 0.7) / 0.7, 0.2), 1);

        // Round 39: CURVE MORPH — pinned to a curve morphing from the
        // double-arc ribbon (form A) into the particle's OWN real physical
        // spot (p.x/p.y, form B). Round 38's zero-jump guarantee is kept:
        // every added term (arc bow, flow shift) vanishes exactly at Ms=1,
        // so drawX == p.x when the morph completes. DRAWING ONLY.
        let drawX = p.x;
        let drawY = p.y;
        let introOpacity = 1;
        if (introStart >= 0) {
          const s = count > 1 ? p.idx / (count - 1) : 0; // fixed 0..1
          const fromLeft = s < 0.5;
          // Form A: ribbon arc (unchanged); Form B: the particle's REAL
          // landing spot — the same p.x/p.y the physics loop will use.
          const A = ribbonShape(s, cx, cy, R);
          const Bx = p.x;
          const By = p.y;
          // Round 39: dead-zone-free stagger — at M=0 the s=0 particle
          // already has Ms>0 (motion from frame one), the slowest (s=1)
          // starts by M=0.18. No static waiting period at the opening.
          const Ms = smoothstep(
            Math.min(Math.max((M - s * 0.18) / (1 - 0.18), 0), 1),
          );
          // Round 39: gentle parabolic arc on the fall path. sin(Ms·π) is
          // 0 at Ms=0 AND Ms=1 → start/end positions untouched.
          const arc = Math.sin(Ms * Math.PI);
          const bowX = (fromLeft ? -1 : 1) * arc * R * 0.12; // left arcs bow left
          const bowY = -arc * R * 0.08;                      // slight up-then-down float
          // Round 39: flow "起势" — during the first 20% of the morph the
          // particle first glides ALONG the ribbon (tangent direction) a
          // little before unfurling. (1−Ms)=0 at Ms=1 → zero end offset.
          const S2 = ribbonShape(Math.min(s + 0.01, 1), cx, cy, R);
          const tx = S2.x - A.x;
          const ty = S2.y - A.y;
          const tlen = Math.hypot(tx, ty) || 1;
          const flowShift = (1 - Ms) * smoothstep(M / 0.2) * R * 0.06;
          drawX =
            A.x + (Bx - A.x) * Ms + bowX + (tx / tlen) * flowShift;
          drawY =
            A.y + (By - A.y) * Ms + bowY + (ty / tlen) * flowShift;
          // Round 39: alpha with s-phase — particles light up from the
          // ribbon's two ends toward the middle (flow, not pop-in-all-at-once).
          introOpacity = smoothstep((M - s * 0.1) / 0.2);
        }

        // Text-zone dimming (kept): glyph area always yields.
        let zoneMul = 1;
        if (
          tz &&
          drawX >= tz.left &&
          drawX <= tz.right &&
          drawY >= tz.top &&
          drawY <= tz.bottom
        ) {
          zoneMul = TEXT_ZONE_MUL;
        }
        // Round 35: date-center radial dim — particles near the date line
        // (cx, cy) fade toward 0.35, far particles unaffected. Combined with
        // the text-zone dimming via MIN so the date's backdrop is darkest.
        const ddx = drawX - cx;
        const ddy = drawY - cy;
        const dist = Math.sqrt(ddx * ddx + ddy * ddy);
        const dateZoneFade = Math.min(Math.max(dist / (R * 0.55), 0), 1);
        zoneMul = Math.min(zoneMul, 0.35 + 0.65 * dateZoneFade);
        // Per-particle twinkle — floor 0.25, peak 1.0.
        const twinkle =
          0.625 + 0.375 * Math.sin(now * 0.001 * p.twinkleSpeed + p.phase);
        const rr = p.baseR * sizeMul;
        const gs = p.glowSize * sizeMul;

        ctx.globalAlpha =
          p.baseAlpha * alphaMul * edgeFade * zoneMul * twinkle * introOpacity * 0.30;
        ctx.drawImage(GLOW_SPRITE, drawX - gs / 2, drawY - gs / 2, gs, gs);
        // Main colored point
        ctx.globalAlpha =
          p.baseAlpha * alphaMul * edgeFade * zoneMul * twinkle * introOpacity;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(drawX, drawY, rr, 0, Math.PI * 2);
        ctx.fill();
        // Round 34: bright core — smaller (×0.4), pure white-gold, ×1.0
        // alpha, so every particle has a glowing "kernel" (transparent glow).
        ctx.fillStyle = 'rgba(255, 250, 235, 1)';
        ctx.beginPath();
        ctx.arc(drawX, drawY, rr * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="pointer-events-none fixed inset-0 z-0"
        aria-hidden="true"
      />
    </>
  );
}
