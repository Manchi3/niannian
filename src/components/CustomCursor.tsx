import { useEffect, useRef, useState } from 'react';
import { CONFIG } from '../utils/constants';

/**
 * CustomCursor — replaces the system cursor with a white ring + dot.
 *
 * - 28px outer ring (white outline, follows with slight lerp trailing)
 * - 4px inner dot (white fill, tracks 1:1)
 * - Dragging: ring grows to 36px + opacity drops to 0.6
 * - Leaves canvas: hides, system cursor restored
 *
 * Toggled by CONFIG.CUSTOM_CURSOR.
 */
export default function CustomCursor(): React.ReactElement | null {
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [dragging, setDragging] = useState(false);

  // Mouse position refs
  const mouseXRef = useRef(0);
  const mouseYRef = useRef(0);
  const ringXRef = useRef(0);
  const ringYRef = useRef(0);

  useEffect(() => {
    if (!CONFIG.CUSTOM_CURSOR) {
      setVisible(false);
      return;
    }

    setVisible(true);

    const handleMouseMove = (e: MouseEvent): void => {
      mouseXRef.current = e.clientX;
      mouseYRef.current = e.clientY;
      if (dotRef.current) {
        dotRef.current.style.transform = `translate3d(${e.clientX - 2}px, ${e.clientY - 2}px, 0)`;
      }
    };

    const handleMouseDown = (): void => setDragging(true);
    const handleMouseUp = (): void => setDragging(false);
    const handleMouseEnter = (): void => setVisible(true);
    const handleMouseLeave = (): void => {
      setVisible(false);
      setDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('mouseenter', handleMouseEnter);
    document.addEventListener('mouseleave', handleMouseLeave);

    // Ring trailing animation loop
    let rafId: number | null = null;
    const animateRing = (): void => {
      rafId = requestAnimationFrame(animateRing);
      ringXRef.current += (mouseXRef.current - ringXRef.current) * 0.18;
      ringYRef.current += (mouseYRef.current - ringYRef.current) * 0.18;
      if (ringRef.current) {
        const half = dragging ? 18 : 14; // half of 36 or 28
        ringRef.current.style.transform = `translate3d(${ringXRef.current - half}px, ${ringYRef.current - half}px, 0)`;
      }
    };
    animateRing();

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mouseenter', handleMouseEnter);
      document.removeEventListener('mouseleave', handleMouseLeave);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [dragging]);

  if (!visible || !CONFIG.CUSTOM_CURSOR) return null;

  const ringSize = dragging ? 36 : 28;
  const ringOpacity = dragging ? 0.6 : 0.8;

  return (
    <>
      {/* Outer ring */}
      <div
        ref={ringRef}
        className="pointer-events-none fixed left-0 top-0 z-[9999]"
        style={{
          width: `${ringSize}px`,
          height: `${ringSize}px`,
          borderRadius: '50%',
          border: '1.5px solid rgba(255, 255, 255, 0.8)',
          background: 'transparent',
          opacity: ringOpacity,
          willChange: 'transform, width, height, opacity',
          transition: 'width 0.15s ease, height 0.15s ease, opacity 0.15s ease',
          mixBlendMode: 'screen',
        }}
        aria-hidden="true"
      />
      {/* Inner dot */}
      <div
        ref={dotRef}
        className="pointer-events-none fixed left-0 top-0 z-[9999]"
        style={{
          width: '4px',
          height: '4px',
          borderRadius: '50%',
          background: 'rgba(255, 255, 255, 1)',
          willChange: 'transform',
          mixBlendMode: 'screen',
        }}
        aria-hidden="true"
      />
    </>
  );
}
