import { useRef, useCallback } from 'react';
import * as THREE from 'three';
import type { ParticleData } from '../types';
import { VERTEX_SHADER, FRAGMENT_SHADER } from '../shaders/particleShaders';
import { CONFIG } from '../utils/constants';
import { getAudioEnv } from '../utils/audioMeter';

/**
 * Return type of the useParticleSystem hook.
 */
interface ParticleSystemHandle {
  /** Initialize the particle system into the given container. */
  init: (container: HTMLElement, data: ParticleData) => void;
  /** Start the animation loop. */
  startAnimation: () => void;
  /** Stop the animation loop. */
  stopAnimation: () => void;
  /** Update mouse NDC position from screen coordinates (for repulsion). */
  updateMouse3D: (clientX: number, clientY: number) => void;
  /** Set whether mouse repulsion is active. */
  setMouseActive: (active: boolean) => void;
  /** Convenience: update hover position and activate repulsion. */
  updateHover: (clientX: number, clientY: number) => void;
  /** Zoom camera by delta. Positive = zoom in, negative = zoom out. */
  zoom: (delta: number) => void;
  /** Trigger a click ripple at the given screen coordinates. */
  triggerRipple: (clientX: number, clientY: number) => void;
  /** Start pointer drag (for rotating the cloud). */
  startDrag: (clientX: number, clientY: number) => void;
  /** Update pointer drag delta. */
  updateDrag: (clientX: number, clientY: number) => void;
  /** End pointer drag (cloud will inertia-decay then auto-return). */
  endDrag: () => void;
  /** Clean up all Three.js resources. */
  dispose: () => void;
  /** Whether the system is currently initialized. */
  isInitialized: () => boolean;
}

/**
 * useParticleSystem — manages the full Three.js lifecycle for particle rendering.
 *
 * Features:
 * - Assemble animation: random → target over ASSEMBLE_DURATION
 * - Sine-wave breathing (in shader)
 * - Soft mouse repulsion: raycaster → uMouse, smoothstep falloff, clamped displacement
 * - Inertia drag: velocity accumulation + friction decay (Round 4)
 * - Delayed auto-return: 4 s after last interaction, lerp toward front (Round 4)
 * - Tilt clamp: rotation clamped to ±MAX_TILT (Round 4)
 * - Scroll zoom: camera Z lerp
 * - Multiple click ripples: ring buffer of RIPPLE_MAX_COUNT independent ripples
 * - Live CONFIG sync: uniforms updated from CONFIG every frame (Round 4)
 */
export function useParticleSystem(): ParticleSystemHandle {
  // Three.js objects
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const groupRef = useRef<THREE.Group | null>(null);
  const pointsRef = useRef<THREE.Points | null>(null);
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);
  const geometryRef = useRef<THREE.BufferGeometry | null>(null);
  const animationIdRef = useRef<number | null>(null);
  const clockRef = useRef<THREE.Clock | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);

  // Mouse NDC for screen-space hover influence.
  // Initialized far outside the screen (NDC is -1..1) so that before the
  // mouse ever moves, distance to any particle is huge and force = 0.
  // This kills the "effect flies in from the corner" bug.
  const mouseNDCRef = useRef<THREE.Vector2>(new THREE.Vector2(9999, 9999));
  const mouseActiveRef = useRef<boolean>(false);
  const mouseActivePrevRef = useRef<boolean>(false);

  // Raycaster for click ripples (still need world-space ripple centers)
  const raycasterRef = useRef<THREE.Raycaster | null>(null);
  const intersectPlaneRef = useRef<THREE.Plane>(
    new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
  );

  // Assemble animation state
  const assembleStartRef = useRef<number>(0);
  const assembleActiveRef = useRef<boolean>(false);

  // Camera zoom target
  const cameraZTargetRef = useRef<number>(CONFIG.CAMERA_DEFAULT_Z);

  // Drag rotation state — with inertia (Round 4)
  const draggingRef = useRef<boolean>(false);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const targetRotXRef = useRef<number>(0);
  const targetRotYRef = useRef<number>(0);
  const currentRotXRef = useRef<number>(0);
  const currentRotYRef = useRef<number>(0);
  // Inertia velocity (accumulated during drag, decays with friction after release)
  const velocityXRef = useRef<number>(0);
  const velocityYRef = useRef<number>(0);
  // Last interaction time (used for delayed auto-return)
  const lastInteractTimeRef = useRef<number>(0);

  // Ripple ring buffer
  const rippleIndexRef = useRef<number>(0);
  const ripplesRef = useRef<THREE.Vector4[]>(
    Array.from({ length: CONFIG.RIPPLE_MAX_COUNT }, () => new THREE.Vector4(0, 0, -999, 0)),
  );

  const initializedRef = useRef<boolean>(false);

  /**
   * Convert screen coordinates to Normalized Device Coordinates (-1..1)
   * relative to the canvas container.
   */
  const screenToNDC = useCallback((clientX: number, clientY: number): void => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    mouseNDCRef.current.x = (x / rect.width) * 2 - 1;
    mouseNDCRef.current.y = -((y / rect.height) * 2 - 1);
  }, []);

  /**
   * Convert screen coordinates to world-space position via raycaster
   * intersecting the z=0 invisible plane (used for click ripples).
   */
  const screenToWorld = useCallback(
    (clientX: number, clientY: number): THREE.Vector3 | null => {
      const container = containerRef.current;
      const camera = cameraRef.current;
      const raycaster = raycasterRef.current;
      if (!container || !camera || !raycaster) return null;

      const rect = container.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;

      const ndcX = (x / rect.width) * 2 - 1;
      const ndcY = -((y / rect.height) * 2 - 1);

      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
      const intersection = new THREE.Vector3();
      raycaster.ray.intersectPlane(intersectPlaneRef.current, intersection);
      return intersection;
    },
    [],
  );

  /**
   * Initialize the particle system.
   */
  const init = useCallback((container: HTMLElement, data: ParticleData) => {
    if (initializedRef.current) {
      // Dispose previous instance before re-initializing
      if (animationIdRef.current !== null) {
        cancelAnimationFrame(animationIdRef.current);
        animationIdRef.current = null;
      }
      if (geometryRef.current) {
        geometryRef.current.dispose();
        geometryRef.current = null;
      }
      if (materialRef.current) {
        materialRef.current.dispose();
        materialRef.current = null;
      }
      if (pointsRef.current && groupRef.current) {
        groupRef.current.remove(pointsRef.current);
        pointsRef.current = null;
      }
      if (groupRef.current && sceneRef.current) {
        sceneRef.current.remove(groupRef.current);
        groupRef.current = null;
      }
      if (rendererRef.current) {
        rendererRef.current.dispose();
        if (rendererRef.current.domElement.parentNode) {
          rendererRef.current.domElement.parentNode.removeChild(
            rendererRef.current.domElement,
          );
        }
        rendererRef.current = null;
      }
      if (sceneRef.current) {
        sceneRef.current.clear();
        sceneRef.current = null;
      }
    }

    containerRef.current = container;

    // --- Scene ---
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // --- Camera ---
    const camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / container.clientHeight,
      0.1,
      100,
    );
    camera.position.set(0, 0, CONFIG.CAMERA_DEFAULT_Z);
    cameraZTargetRef.current = CONFIG.CAMERA_DEFAULT_Z;
    cameraRef.current = camera;

    // --- Renderer ---
    const pixelRatio = Math.min(window.devicePixelRatio, 2);
    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(pixelRatio);
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // --- Raycaster ---
    raycasterRef.current = new THREE.Raycaster();

    // --- Group (for drag rotation) ---
    const group = new THREE.Group();
    // Pivot must be exactly the origin: rotation is applied to the group,
    // so the group (and everything inside) must sit at (0,0,0) for the
    // cloud to spin around the image's own geometric center, not a corner.
    group.position.set(0, 0, 0);
    scene.add(group);
    groupRef.current = group;

    // --- BufferGeometry ---
    const geometry = new THREE.BufferGeometry();

    geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geometry.setAttribute(
      'aOriginalPosition',
      new THREE.BufferAttribute(data.originalPositions, 3),
    );
    geometry.setAttribute(
      'aRandomPosition',
      new THREE.BufferAttribute(data.randomPositions, 3),
    );
    geometry.setAttribute('aScale', new THREE.BufferAttribute(data.sizes, 1));
    geometry.setAttribute(
      'aRandomSeed',
      new THREE.BufferAttribute(data.randomSeeds, 1),
    );
    geometry.setAttribute('aEdge', new THREE.BufferAttribute(data.edges, 1));
    geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));

    // Ensure the geometry's pivot is exactly the origin. The image processor
    // already centers the cloud on all three axes; computeBoundingBox + center
    // is a defensive extra step (and the console log below lets us verify).
    geometry.computeBoundingBox();
    geometry.center();
    geometry.computeBoundingBox();
    const bbCenter = geometry.boundingBox?.getCenter(new THREE.Vector3());
    // eslint-disable-next-line no-console
    console.log('[ParticleDiary] geometry boundingBox center =', bbCenter?.toArray());

    geometryRef.current = geometry;

    // R65: precompute the cloud radius so the voice "light-touch" dispersion
    // can normalize each particle's distance-from-center into r_norm ∈ [0,1]
    // (center stays put, edge drifts most). originalPositions are already
    // centered at the origin by the image processor.
    let maxR = 1e-4;
    const op = data.originalPositions;
    for (let i = 0; i < op.length; i += 3) {
      const r = Math.hypot(op[i], op[i + 1]);
      if (r > maxR) maxR = r;
    }

    // --- ShaderMaterial ---
    const rippleArray = Array.from(
      { length: CONFIG.RIPPLE_MAX_COUNT },
      () => new THREE.Vector4(0, 0, -999, 0),
    );
    ripplesRef.current = rippleArray;
    rippleIndexRef.current = 0;

    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        uTime: { value: 0 },
        uAssembleProgress: { value: 0 },
        uDepthThickness: { value: CONFIG.DEPTH_THICKNESS },

        uMouseNDC: { value: new THREE.Vector2(9999, 9999) },
        uMouseWorld: { value: new THREE.Vector2(9999, 9999) },
        uMouseActive: { value: 0 },
        uMouseRadius: { value: CONFIG.MOUSE_RADIUS },
        uMouseStrength: { value: CONFIG.MOUSE_STRENGTH },
        uMouseDisplacementMax: { value: CONFIG.MOUSE_DISPLACEMENT_MAX },
        uScatterStrength: { value: CONFIG.SCATTER_STRENGTH },
        // Round 16: aspect-corrected mouse influence + zoom-aware scaling
        uAspect: { value: 1 },
        uCameraZ: { value: CONFIG.CAMERA_DEFAULT_Z },
        uCameraMinZ: { value: CONFIG.CAMERA_MIN_Z },
        uCameraDefaultZ: { value: CONFIG.CAMERA_DEFAULT_Z },

        uRipples: { value: rippleArray },
        uRippleSpeed: { value: CONFIG.RIPPLE_SPEED },
        uRippleWidth: { value: CONFIG.RIPPLE_WIDTH },
        uRippleDuration: { value: CONFIG.RIPPLE_DURATION },
        uRippleStrength: { value: CONFIG.RIPPLE_STRENGTH },

        uFloatAmplitude: { value: CONFIG.PARTICLE_FLOAT_AMPLITUDE },
        uSize: { value: CONFIG.PARTICLE_BASE_SIZE },
        uPixelRatio: { value: pixelRatio },
        uSizeAttenuation: { value: CONFIG.PARTICLE_SIZE_ATTENUATION },
        uBrightness: { value: CONFIG.PARTICLE_BRIGHTNESS },
        uOpacity: { value: CONFIG.PARTICLE_OPACITY },

        // Round 4 new uniforms
        uPointSize: { value: CONFIG.POINT_SIZE },
        uDepth: { value: CONFIG.U_DEPTH },
        uSpreadStart: { value: CONFIG.SPREAD_START },
        uSpreadStrength: { value: CONFIG.SPREAD_STRENGTH },
        uVignetteStart: { value: CONFIG.VIGNETTE_START },
        uBrightnessEnhance: { value: CONFIG.BRIGHTNESS_ENHANCE },
        // Round 14 new uniforms
        uEdgeScatter: { value: CONFIG.EDGE_SCATTER },
        uZoomDefaultZ: { value: CONFIG.CAMERA_DEFAULT_Z },

        // R65: voice "light-touch" dispersion — additive, engine core untouched.
        // uVoiceEnv is fed every frame from the shared audio envelope
        // (audioMeter.getAudioEnv) so the waveform and particles stay synced.
        uVoiceEnv: { value: 0 },
        uVoiceDisp: { value: 0.05 }, // edge radial drift as fraction of radius (~10-14px at default zoom)
        uVoiceJitter: { value: 0.012 }, // tangential jitter as fraction of radius (~±3px)
        uVoiceMaxR: { value: maxR },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NormalBlending,
      vertexColors: true,
    });
    materialRef.current = material;

    // --- Points ---
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.position.set(0, 0, 0); // keep pivot at origin — rotation centers on the image
    group.add(points);
    pointsRef.current = points;

    // --- Clock ---
    clockRef.current = new THREE.Clock();

    // --- Reset state ---
    assembleStartRef.current = 0;
    assembleActiveRef.current = true;
    targetRotXRef.current = 0;
    targetRotYRef.current = 0;
    currentRotXRef.current = 0;
    currentRotYRef.current = 0;
    draggingRef.current = false;
    lastPointerRef.current = null;
    velocityXRef.current = 0;
    velocityYRef.current = 0;
    lastInteractTimeRef.current = 0;
    mouseActiveRef.current = false;
    mouseActivePrevRef.current = false;
    mouseNDCRef.current.set(9999, 9999);

    initializedRef.current = true;
  }, []);

  /**
   * Animation loop.
   */
  const animate = useCallback(() => {
    animationIdRef.current = requestAnimationFrame(animate);

    const clock = clockRef.current;
    const material = materialRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const renderer = rendererRef.current;
    const raycaster = raycasterRef.current;
    const group = groupRef.current;

    if (!clock || !material || !scene || !camera || !renderer || !group) return;

    const elapsed = clock.getElapsedTime();
    material.uniforms.uTime.value = elapsed;

    // --- Live CONFIG sync (Round 4) ---
    // Update uniforms from CONFIG every frame so the AtmospherePanel
    // can tweak parameters in real time.
    const u = material.uniforms;
    u.uDepthThickness.value = CONFIG.DEPTH_THICKNESS;
    u.uBrightness.value = CONFIG.PARTICLE_BRIGHTNESS;
    u.uOpacity.value = CONFIG.PARTICLE_OPACITY;
    u.uFloatAmplitude.value = CONFIG.PARTICLE_FLOAT_AMPLITUDE;
    u.uMouseRadius.value = CONFIG.MOUSE_RADIUS;
    u.uMouseStrength.value = CONFIG.MOUSE_STRENGTH;
    u.uMouseDisplacementMax.value = CONFIG.MOUSE_DISPLACEMENT_MAX;
    u.uScatterStrength.value = CONFIG.SCATTER_STRENGTH;
    u.uRippleSpeed.value = CONFIG.RIPPLE_SPEED;
    u.uRippleWidth.value = CONFIG.RIPPLE_WIDTH;
    u.uRippleDuration.value = CONFIG.RIPPLE_DURATION;
    u.uRippleStrength.value = CONFIG.RIPPLE_STRENGTH;
    // Round 4 new uniforms
    u.uPointSize.value = CONFIG.POINT_SIZE;
    u.uDepth.value = CONFIG.U_DEPTH;
    u.uSpreadStart.value = CONFIG.SPREAD_START;
    u.uSpreadStrength.value = CONFIG.SPREAD_STRENGTH;
    u.uVignetteStart.value = CONFIG.VIGNETTE_START;
    u.uBrightnessEnhance.value = CONFIG.BRIGHTNESS_ENHANCE;
    u.uEdgeScatter.value = CONFIG.EDGE_SCATTER;
    u.uZoomDefaultZ.value = CONFIG.CAMERA_DEFAULT_Z;

    // R65: voice "light-touch" dispersion envelope. Read straight from the
    // shared audio-meter scalar (a module-level ref, never React state) and
    // write the GPU uniform directly — zero re-render latency, so the
    // particles respond to the voice on the very next rendered frame.
    u.uVoiceEnv.value = getAudioEnv();
    // Legacy size uniforms (kept for backward compat / fallback)
    u.uSize.value = CONFIG.PARTICLE_BASE_SIZE;
    u.uSizeAttenuation.value = CONFIG.PARTICLE_SIZE_ATTENUATION;

    // --- Assemble Animation ---
    if (assembleActiveRef.current) {
      if (assembleStartRef.current === 0) {
        assembleStartRef.current = elapsed;
      }
      const progress =
        (elapsed - assembleStartRef.current) / CONFIG.ASSEMBLE_DURATION;
      if (progress >= 1.0) {
        material.uniforms.uAssembleProgress.value = 1.0;
        assembleActiveRef.current = false;
      } else {
        material.uniforms.uAssembleProgress.value = progress;
      }
    }

    // --- Screen-space Mouse NDC + world-space push direction ---
    // Before the mouse ever moves: uMouseActive = 0, both mouse uniforms stay
    // far outside the screen (9999) so no particle is ever affected → no
    // corner fly-in. On the FIRST activation we snap directly to the cursor
    // (no lerp fly-in); afterwards we lerp smoothly as the cursor glides.
    const uMouseNDC = material.uniforms.uMouseNDC.value as THREE.Vector2;
    const uMouseWorld = material.uniforms.uMouseWorld.value as THREE.Vector2;
    const isActive = mouseActiveRef.current;
    if (isActive && !mouseActivePrevRef.current) {
      // First frame the mouse becomes active — snap, never lerp from 9999.
      uMouseNDC.copy(mouseNDCRef.current);
    } else if (isActive) {
      uMouseNDC.x += (mouseNDCRef.current.x - uMouseNDC.x) * 0.12;
      uMouseNDC.y += (mouseNDCRef.current.y - uMouseNDC.y) * 0.12;
    } else {
      uMouseNDC.set(9999, 9999);
    }
    mouseActivePrevRef.current = isActive;
    material.uniforms.uMouseActive.value = isActive ? 1.0 : 0.0;

    // World-space mouse position on the z=0 plane (used for push DIRECTION).
    // Re-projected from the current (smoothed) NDC so the shader can compute
    // the push vector in the same space as the particle positions — this
    // keeps the push aligned with the cursor even at screen edges.
    if (isActive && raycaster) {
      raycaster.setFromCamera(mouseNDCRef.current, camera);
      const intersection = new THREE.Vector3();
      raycaster.ray.intersectPlane(intersectPlaneRef.current, intersection);
      if (intersection) {
        uMouseWorld.set(intersection.x, intersection.y);
      }
    } else {
      uMouseWorld.set(9999, 9999);
    }

    // --- Inertia Drag + Delayed Auto-Return (Round 4) ---
    if (!draggingRef.current) {
      // Apply inertia velocity with friction decay
      const vx = velocityXRef.current;
      const vy = velocityYRef.current;
      if (Math.abs(vx) > 0.0001 || Math.abs(vy) > 0.0001) {
        targetRotYRef.current += vx;
        targetRotXRef.current += vy;
        velocityXRef.current = vx * CONFIG.FRICTION;
        velocityYRef.current = vy * CONFIG.FRICTION;
      } else {
        velocityXRef.current = 0;
        velocityYRef.current = 0;
      }

      // Delayed auto-return: only after RETURN_DELAY seconds of inactivity.
      // Snap to nearest 2π multiple for shortest return path (infinite rotation).
      const timeSinceLastInteract = elapsed - lastInteractTimeRef.current;
      if (CONFIG.AUTO_RETURN && timeSinceLastInteract > CONFIG.RETURN_DELAY) {
        const TWO_PI = Math.PI * 2;
        const nearestX = Math.round(targetRotXRef.current / TWO_PI) * TWO_PI;
        const nearestY = Math.round(targetRotYRef.current / TWO_PI) * TWO_PI;
        targetRotXRef.current += (nearestX - targetRotXRef.current) * CONFIG.RETURN_SPEED;
        targetRotYRef.current += (nearestY - targetRotYRef.current) * CONFIG.RETURN_SPEED;

        // Also restore camera zoom to default if enabled
        if (CONFIG.RETURN_RESTORE_ZOOM) {
          cameraZTargetRef.current +=
            (CONFIG.CAMERA_DEFAULT_Z - cameraZTargetRef.current) * CONFIG.RETURN_SPEED;
        }
      }
    }

    // No tilt clamp — allow infinite rotation (like spinning a top)

    // Smooth current rotation toward target
    currentRotXRef.current += (targetRotXRef.current - currentRotXRef.current) * 0.08;
    currentRotYRef.current += (targetRotYRef.current - currentRotYRef.current) * 0.08;

    group.rotation.x = currentRotXRef.current;
    group.rotation.y = currentRotYRef.current;

    // --- Camera Zoom (smooth lerp) ---
    camera.position.z +=
      (cameraZTargetRef.current - camera.position.z) * CONFIG.CAMERA_ZOOM_LERP;

    // Static camera, always looks at origin
    camera.lookAt(0, 0, 0);

    // --- Sync aspect + camera Z to shader every frame (Round 16) ---
    // Aspect is derived from the camera's projection matrix (so it tracks
    // viewport resizes for free). Camera Z drives the zoom-fade + radius
    // scaling that keeps the push region footprint constant in pixels.
    material.uniforms.uAspect.value = camera.aspect;
    material.uniforms.uCameraZ.value = camera.position.z;
    material.uniforms.uCameraMinZ.value = CONFIG.CAMERA_MIN_Z;
    material.uniforms.uCameraDefaultZ.value = CONFIG.CAMERA_DEFAULT_Z;

    // Render
    renderer.render(scene, camera);
  }, []);

  /**
   * Start the animation loop.
   */
  const startAnimation = useCallback(() => {
    if (animationIdRef.current !== null) return;
    if (clockRef.current) clockRef.current.start();
    animate();
  }, [animate]);

  /**
   * Stop the animation loop.
   */
  const stopAnimation = useCallback(() => {
    if (animationIdRef.current !== null) {
      cancelAnimationFrame(animationIdRef.current);
      animationIdRef.current = null;
    }
  }, []);

  /**
   * Update mouse NDC position from screen coordinates.
   */
  const updateMouse3D = useCallback((clientX: number, clientY: number) => {
    screenToNDC(clientX, clientY);
  }, [screenToNDC]);

  /**
   * Set whether mouse repulsion is active.
   */
  const setMouseActive = useCallback((active: boolean) => {
    mouseActiveRef.current = active;
  }, []);

  /**
   * Convenience: update hover position and activate repulsion in one call.
   * (Round 4)
   */
  const updateHover = useCallback(
    (clientX: number, clientY: number) => {
      updateMouse3D(clientX, clientY);
      mouseActiveRef.current = true;
    },
    [updateMouse3D],
  );

  /**
   * Zoom camera by delta. Positive = zoom in (decrease Z), negative = zoom out.
   */
  const zoom = useCallback((delta: number) => {
    const current = cameraZTargetRef.current;
    const next = THREE.MathUtils.clamp(current - delta, CONFIG.CAMERA_MIN_Z, CONFIG.CAMERA_MAX_Z);
    cameraZTargetRef.current = next;
    // Record interaction time so auto-return delay restarts
    const clock = clockRef.current;
    if (clock) {
      lastInteractTimeRef.current = clock.getElapsedTime();
    }
  }, []);

  /**
   * Trigger a click ripple at the given screen coordinates.
   * Uses a ring buffer so multiple ripples can coexist.
   */
  const triggerRipple = useCallback(
    (clientX: number, clientY: number) => {
      const clock = clockRef.current;
      if (!clock) return;

      const worldPos = screenToWorld(clientX, clientY);
      if (!worldPos) return;

      // Round 26 (bug①): the particle cloud is ROTATED / TILTED by drag
      // (group.rotation), yet the vertex shader compares every particle's
      // LOCAL `pos` against the ripple center. `screenToWorld` returns a
      // WORLD-space point on the z=0 plane, so feeding it directly makes the
      // ripple land at the wrong place once the image is turned. We therefore
      // map the world click back into the cloud's LOCAL frame using the
      // inverse of the group's world matrix — the exact 3D analogue of
      // DOMMatrix.inverse() + transformPoint for a 2D <img>. The ripple is
      // then stored in the same local space the shader uses, so it appears
      // precisely under the pointer at ANY rotation / tilt.
      let rippleX = worldPos.x;
      let rippleY = worldPos.y;
      const group = groupRef.current;
      if (group) {
        group.updateMatrixWorld(true);
        // Object3D has no matrixWorldInverse (only Camera does), so build the
        // inverse of the group's world matrix explicitly.
        const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
        const local = worldPos.clone().applyMatrix4(inv);
        rippleX = local.x;
        rippleY = local.y;
      }

      const idx = rippleIndexRef.current;
      ripplesRef.current[idx].set(rippleX, rippleY, clock.getElapsedTime(), 1);
      rippleIndexRef.current = (idx + 1) % CONFIG.RIPPLE_MAX_COUNT;

      // Update uniform reference (in case React re-created the array)
      const material = materialRef.current;
      if (material) {
        material.uniforms.uRipples.value = ripplesRef.current;
      }
    },
    [screenToWorld],
  );

  /**
   * Start pointer drag.
   * (Round 4: also resets inertia velocity and records interaction time)
   */
  const startDrag = useCallback((clientX: number, clientY: number) => {
    draggingRef.current = true;
    lastPointerRef.current = { x: clientX, y: clientY };
    velocityXRef.current = 0;
    velocityYRef.current = 0;
    const clock = clockRef.current;
    if (clock) {
      lastInteractTimeRef.current = clock.getElapsedTime();
    }
  }, []);

  /**
   * Update pointer drag: accumulate delta into target rotation and
   * store velocity for inertia after release (Round 4).
   */
  const updateDrag = useCallback((clientX: number, clientY: number) => {
    if (!draggingRef.current || !lastPointerRef.current) return;

    const dx = clientX - lastPointerRef.current.x;
    const dy = clientY - lastPointerRef.current.y;

    // Horizontal drag → rotate around Y axis
    const rotDeltaY = dx * CONFIG.DRAG_SENSITIVITY;
    // Vertical drag → rotate around X axis
    const rotDeltaX = dy * CONFIG.DRAG_SENSITIVITY;

    targetRotYRef.current += rotDeltaY;
    targetRotXRef.current += rotDeltaX;

    // Store velocity for inertia (will be applied after release)
    velocityXRef.current = rotDeltaY;
    velocityYRef.current = rotDeltaX;

    lastPointerRef.current = { x: clientX, y: clientY };
  }, []);

  /**
   * End pointer drag: record interaction time for delayed auto-return.
   * Inertia velocity continues to decay in the animation loop (Round 4).
   */
  const endDrag = useCallback(() => {
    draggingRef.current = false;
    lastPointerRef.current = null;
    const clock = clockRef.current;
    if (clock) {
      lastInteractTimeRef.current = clock.getElapsedTime();
    }
  }, []);

  /**
   * Dispose all Three.js resources.
   */
  const dispose = useCallback(() => {
    if (animationIdRef.current !== null) {
      cancelAnimationFrame(animationIdRef.current);
      animationIdRef.current = null;
    }

    if (geometryRef.current) {
      geometryRef.current.dispose();
      geometryRef.current = null;
    }

    if (materialRef.current) {
      materialRef.current.dispose();
      materialRef.current = null;
    }

    if (pointsRef.current && groupRef.current) {
      groupRef.current.remove(pointsRef.current);
      pointsRef.current = null;
    }

    if (groupRef.current && sceneRef.current) {
      sceneRef.current.remove(groupRef.current);
      groupRef.current = null;
    }

    if (rendererRef.current) {
      rendererRef.current.dispose();
      if (rendererRef.current.domElement.parentNode) {
        rendererRef.current.domElement.parentNode.removeChild(
          rendererRef.current.domElement,
        );
      }
      rendererRef.current = null;
    }

    if (sceneRef.current) {
      sceneRef.current.clear();
      sceneRef.current = null;
    }

    cameraRef.current = null;
    clockRef.current = null;
    raycasterRef.current = null;
    assembleActiveRef.current = false;
    initializedRef.current = false;
  }, []);

  /**
   * Whether the system is currently initialized.
   */
  const isInitialized = useCallback(() => initializedRef.current, []);

  return {
    init,
    startAnimation,
    stopAnimation,
    updateMouse3D,
    setMouseActive,
    updateHover,
    zoom,
    triggerRipple,
    startDrag,
    updateDrag,
    endDrag,
    dispose,
    isInitialized,
  };
}
