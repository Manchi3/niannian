import { useRef, useEffect } from 'react';
import { useParticleSystem } from '../hooks/useParticleSystem';
import { CONFIG } from '../utils/constants';
import type { ParticleData } from '../types';

/**
 * Props for the ParticleCanvas component.
 */
interface ParticleCanvasProps {
  /** Particle data to render. When this changes, the system re-initializes. */
  particleData: ParticleData | null;
  /** Whether the particle system should be actively animating. */
  active?: boolean;
}

/**
 * Selector used to skip particle interactions when the pointer target is a
 * real UI element (button / input / textarea / link / role=button / [data-ui]).
 * Prevents clicks on the UI from also triggering particle effects (Round 21).
 */
const UI_ELEMENT_SELECTOR =
  'button, input, textarea, a, [role="button"], [data-ui]';

/**
 * ParticleCanvas — full-screen Three.js particle rendering layer.
 *
 * Renders particles as a fixed background layer (z-index: 0).
 *
 * Round 21 — Event binding rework (fixes "no scatter over bubble area"):
 *   - pointermove / pointerdown / pointerup are bound to **window** instead
 *     of the canvas container, so particles receive coordinates no matter
 *     which DOM layer the pointer is over (bubble overlays no longer block
 *     the events).
 *   - A `suppressPointerRef` flag is set when a pointerdown hits a real UI
 *     element (see UI_ELEMENT_SELECTOR) — that press neither starts a drag
 *     nor fires a ripple, so UI clicks are never hijacked by particles.
 *   - pointermove over UI elements is skipped too (no scatter while typing
 *     in the input box, etc.).
 *   - Wheel (camera zoom) stays on the container; the chat panel installs a
 *     capture-phase wheel handler that takes over when the cursor is over
 *     the bubble history (Round 21 bubble scroll compensation).
 */
export default function ParticleCanvas({
  particleData,
  active = true,
}: ParticleCanvasProps): React.ReactElement | null {
  const containerRef = useRef<HTMLDivElement>(null);
  const particleSystem = useParticleSystem();
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  /** True while a pointerdown landed on a UI element — suppress drag/ripple. */
  const suppressPointerRef = useRef(false);
  /**
   * Round 54: init guard. Keeps the (heavy) Three.js init + the one-shot
   * formation animation from running twice for the SAME particleData — this
   * also neutralizes React 18 dev StrictMode's duplicate mount-time effect
   * invocation, so the picture forms exactly once (no double-play). The
   * cleanup still disposes every resource on real unmount.
   */
  const initGuardRef = useRef<ParticleData | null>(null);

  // Determine cursor style based on CONFIG
  const cursorStyle = CONFIG.CUSTOM_CURSOR ? 'none' : 'grab';
  const cursorGrabbing = CONFIG.CUSTOM_CURSOR ? 'none' : 'grabbing';

  // Initialize / re-initialize when particle data changes
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !particleData) return;
    // Skip if this exact data instance is already live (StrictMode guard /
    // re-render guard — prevents the formation from replaying).
    if (initGuardRef.current === particleData && particleSystem.isInitialized()) {
      return;
    }
    initGuardRef.current = particleData;

    particleSystem.init(container, particleData);
    particleSystem.startAnimation();

    const handleResize = (): void => {
      const canvas = container.querySelector('canvas');
      if (canvas) {
        canvas.style.width = '100%';
        canvas.style.height = '100%';
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      particleSystem.stopAnimation();
      particleSystem.dispose();
      initGuardRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [particleData]);

  // Start/stop animation based on `active` prop
  useEffect(() => {
    if (active && particleSystem.isInitialized()) {
      particleSystem.startAnimation();
    } else {
      particleSystem.stopAnimation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Round 21 — Window-level pointer interactions with UI-suppression.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    /** True when the event target is a real UI element (button, input…). */
    const isUI = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return false;
      return target.closest(UI_ELEMENT_SELECTOR) !== null;
    };

    const handlePointerMove = (e: PointerEvent): void => {
      // Don't scatter while the pointer is over a real UI control
      if (isUI(e.target)) return;

      if (dragStartRef.current) {
        // Dragging → rotate cloud, AND keep the mouse uniform in sync so the
        // hover push-aside effect still works during drag. (Round 16 fix:
        // previously drag completely disabled hover repulsion.)
        particleSystem.updateHover(e.clientX, e.clientY);
        particleSystem.updateDrag(e.clientX, e.clientY);
      } else {
        // Hover → repulsion field (combined position + activate)
        particleSystem.updateHover(e.clientX, e.clientY);
      }
    };

    const handlePointerDown = (e: PointerEvent): void => {
      if (isUI(e.target)) {
        // Clicking a UI control must NOT start a particle drag or ripple.
        suppressPointerRef.current = true;
        dragStartRef.current = null;
        return;
      }
      suppressPointerRef.current = false;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      container.style.cursor = cursorGrabbing;
      particleSystem.startDrag(e.clientX, e.clientY);
      // Do NOT set mouseActive=false here — we want hover push-aside to keep
      // running while the user is dragging. (Round 16 fix.)
    };

    const handlePointerUp = (e: PointerEvent): void => {
      const suppressed = suppressPointerRef.current;
      const start = dragStartRef.current;
      const wasDragging = start !== null;

      particleSystem.endDrag();
      dragStartRef.current = null;
      suppressPointerRef.current = false;
      container.style.cursor = cursorStyle;

      // Round 21: never fire particle ripple for clicks that began on a UI
      // element (Tab / input / condense / mode button…).
      if (suppressed) return;

      if (wasDragging && start) {
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < 5) {
          particleSystem.triggerRipple(e.clientX, e.clientY);
        }
      } else if (!wasDragging) {
        // Plain click without prior drag
        particleSystem.triggerRipple(e.clientX, e.clientY);
      }
    };

    const handlePointerLeave = (): void => {
      particleSystem.endDrag();
      dragStartRef.current = null;
      particleSystem.setMouseActive(false);
      container.style.cursor = cursorStyle;
    };

    const handleWheel = (e: WheelEvent): void => {
      // deltaY < 0 (scroll up) = zoom in (closer)
      // deltaY > 0 (scroll down) = zoom out (farther)
      const delta = -e.deltaY * 0.002;
      particleSystem.zoom(delta);
    };

    container.style.cursor = cursorStyle;

    // Round 21: pointer events go to WINDOW so overlaying DOM (chat bubbles,
    // panels) never blocks them. Wheel stays on the container (the chat
    // panel's capture-phase wheel handler takes precedence over bubbles).
    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointerup', handlePointerUp);
    container.addEventListener('pointerleave', handlePointerLeave);
    container.addEventListener('wheel', handleWheel, { passive: true });

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointerup', handlePointerUp);
      container.removeEventListener('pointerleave', handlePointerLeave);
      container.removeEventListener('wheel', handleWheel);
    };
  }, [particleSystem, cursorStyle, cursorGrabbing]);

  if (!particleData) return null;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-0"
      aria-hidden="true"
      style={{ pointerEvents: 'auto', cursor: cursorStyle }}
    />
  );
}
