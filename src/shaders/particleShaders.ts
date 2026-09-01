/**
 * GLSL Shader source code for the particle system.
 *
 * True 3D point cloud with:
 * - Assemble animation (random → target)
 * - Sine-wave breathing
 * - Soft mouse repulsion (gentle finger-on-water feel, no black holes)
 * - Multiple simultaneous click ripples (ring buffer of 5)
 * - Elliptical edge fade that follows the original image aspect ratio
 * - Vignette fade + brightness enhance (Round 4)
 * - Edge spread (Round 4)
 * - Perspective point-size with uDepth (Round 4)
 */

// ---------------------------------------------------------------------------
// Vertex Shader
// ---------------------------------------------------------------------------

export const VERTEX_SHADER = /* glsl */ `
  // Per-vertex attributes
  attribute vec3 aOriginalPosition;    // Target position (with brightness depth Z)
  attribute vec3 aRandomPosition;      // Random start (assemble animation)
  attribute float aScale;              // Per-particle scale (0.8–1.2)
  attribute float aRandomSeed;         // Random seed for phase offset
  attribute float aEdge;               // Edge fade factor (0 = center, 1 = border)

  // Uniforms — animation
  uniform float uTime;
  uniform float uAssembleProgress;     // 0→1, assemble animation
  uniform float uDepthThickness;       // 0–1 Z-axis thickness scale (thin film)

  // Uniforms — mouse influence (screen-space)
  uniform vec2  uMouseNDC;             // Mouse position in NDC (-1..1), screen-space
  uniform vec2  uMouseWorld;           // Mouse position in world XY (z=0 plane) — push direction
  uniform float uMouseActive;          // 0 = mouse never touched, 1 = active (kills fly-in)
  uniform float uMouseRadius;          // Influence radius (in NDC units, at default zoom)
  uniform float uMouseStrength;        // Push force strength
  uniform float uMouseDisplacementMax; // Max push distance (prevents black holes)
  uniform float uScatterStrength;      // Master scatter multiplier (0–3, panel "散开程度")
  uniform float uAspect;              // canvas width/height — keeps push circle a true pixel circle
  uniform float uCameraZ;             // current camera Z (for zoom-fade + radius scaling)
  uniform float uCameraMinZ;          // CAMERA_MIN_Z reference
  uniform float uCameraDefaultZ;      // CAMERA_DEFAULT_Z reference (1x zoom)

  // Uniforms — click ripples (ring buffer, max 5)
  uniform vec4  uRipples[5];           // xy = center, z = startTime, w = active
  uniform float uRippleSpeed;
  uniform float uRippleWidth;
  uniform float uRippleDuration;
  uniform float uRippleStrength;

  // Uniforms — rendering
  uniform float uFloatAmplitude;       // Breathing amplitude
  uniform float uSize;                 // Legacy base particle size
  uniform float uPixelRatio;           // Device pixel ratio
  uniform float uSizeAttenuation;      // Legacy perspective size factor

  // Uniforms — Round 4 new parameters
  uniform float uPointSize;            // Direct point-size base
  uniform float uDepth;                // Perspective depth factor
  uniform float uSpreadStart;          // Edge distance where spreading begins
  uniform float uSpreadStrength;       // Outward spread magnitude
  uniform float uEdgeScatter;          // Edge halo scatter amplitude (world units)
  uniform float uZoomDefaultZ;         // Camera Z at "1x" zoom (point-size reference)

  // Uniforms — voice "light-touch" dispersion (R65, additive — core untouched)
  uniform float uVoiceEnv;     // shared envelope 0..1 (from audioMeter module)
  uniform float uVoiceDisp;    // edge radial dispersion, fraction of cloud radius
  uniform float uVoiceJitter;  // tangential jitter amplitude, fraction of cloud radius
  uniform float uVoiceMaxR;    // precomputed cloud radius (world units)

  // Varyings
  varying vec3  vColor;
  varying float vAlpha;
  varying float vEdge;                 // 0–1, edge fade
  varying float vScatter;              // 0–1, edge scatter amount (for alpha fade)

  void main() {
    vColor = color;
    vEdge = aEdge;
    vScatter = 0.0;

    // === 1. Assemble Animation (random → target) ===
    float delay = aRandomSeed * 0.3;
    float delayedT = clamp((uAssembleProgress - delay) / (1.0 - delay), 0.0, 1.0);
    delayedT = smoothstep(0.0, 1.0, delayedT);
    // Crush the Z axis toward a thin film: the target depth (brightness relief
    // + jitter, roughly ±0.2 world units) is scaled by uDepthThickness so the
    // cloud becomes a thin 3D sheet instead of a thick block. Assemble still
    // flies from the random sphere to the crushed target naturally.
    vec3 target = aOriginalPosition;
    target.z *= uDepthThickness;
    vec3 pos = mix(aRandomPosition, target, delayedT);

    // === 2. Breathing (sine-wave, position-based) ===
    pos.x += sin(uTime * 0.6 + pos.y * 4.0) * uFloatAmplitude;
    pos.y += cos(uTime * 0.5 + pos.x * 4.0) * uFloatAmplitude;

    // === 3. Screen-Space Mouse Push-aside (soft ring, no holes, scales with zoom) ===
    // DISTANCE is measured in screen space with aspect correction so the
    // push region is a TRUE CIRCLE in pixels, not an NDC square (which on
    // 16:9 screens would appear horizontally stretched).
    vec4 projected = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    vec2 screenPos = projected.xy / projected.w;
    vec2 sp = screenPos * vec2(uAspect, 1.0);
    vec2 mp = uMouseNDC * vec2(uAspect, 1.0);
    float d = distance(sp, mp);

    // RADIUS scales with zoom so the on-screen push footprint stays roughly
    // the same pixel size regardless of camera distance — otherwise the
    // push region would balloon into a giant hole at max zoom-in.
    float effectiveRadius = uMouseRadius * (uCameraDefaultZ / max(uCameraZ, 0.1));
    float distNorm = clamp(d / effectiveRadius, 0.0, 1.0);

    // MID-RADIUS PEAK profile (Round 16): force=0 at center AND at edge, peak
    // around distNorm ≈ 0.4. This is what eliminates the "black hole" — the
    // particles directly under the cursor barely move, while a soft ring of
    // particles around them gets gently pushed aside. No void at center.
    float force = distNorm * pow(1.0 - distNorm, 1.5);
    force *= uMouseActive;

    // ZOOM FADE: strength tapers off as the camera zooms in. At max zoom-in
    // (uCameraZ = CAMERA_MIN_Z) only ~15% strength remains, leaving just a
    // gentle ripple instead of a visible hole. At default zoom, full strength.
    float zoomFade = smoothstep(uCameraMinZ, uCameraDefaultZ, uCameraZ);
    float strengthScale = mix(0.15, 1.0, zoomFade);

    // DIRECTION is in WORLD space so the push aligns perfectly with the
    // cursor even near screen edges (avoids the off-center drift).
    vec3 dir = normalize(pos - vec3(uMouseWorld, pos.z) + vec3(0.001));
    // Final displacement = ring force × base strength × zoom fade × master
    // scatter multiplier (panel "散开程度"). The master multiplier only
    // raises the overall peak — force stays 0 at center & edge, so the
    // "no black hole" constraint is preserved at any strength.
    vec3 displacement = dir * force * uMouseStrength * strengthScale * uScatterStrength;
    // Clamp displacement so particles never get pushed too far
    float displacementLen = length(displacement);
    if (displacementLen > uMouseDisplacementMax) {
      displacement = (displacement / displacementLen) * uMouseDisplacementMax;
    }
    pos += displacement;

    // === 4. Multiple Click Ripples (ring buffer, independent) ===
    vec3 rippleDisplacement = vec3(0.0);
    for (int i = 0; i < 5; i++) {
      vec4 ripple = uRipples[i];
      // ripple.w < 0.5 means inactive
      if (ripple.w < 0.5) continue;

      float age = uTime - ripple.z;
      if (age < 0.0 || age > uRippleDuration) continue;

      float rippleDist = distance(pos.xy, ripple.xy);
      float ringRadius = age * uRippleSpeed;
      float ringDist = abs(rippleDist - ringRadius);

      if (ringDist < uRippleWidth) {
        float ringForce = 1.0 - (ringDist / uRippleWidth);
        ringForce *= ringForce;
        float timeFade = 1.0 - (age / uRippleDuration);
        ringForce *= timeFade;
        vec3 ringDir = normalize(pos - vec3(ripple.xy, pos.z) + vec3(0.001));
        rippleDisplacement += ringDir * ringForce * uRippleStrength;
      }
    }
    pos += rippleDisplacement;

    // === 5. Edge Scatter (Round 14) ===
    // Two components build a wide, soft halo around the image:
    // a) Radial spread (panel "扩散强度") — small outward push near border.
    // b) RANDOM-direction scatter (panel "边缘散射") — each edge particle is
    //    nudged in its own direction (seeded by aRandomSeed) with amplitude
    //    growing from the center outward, so the halo looks like natural mist
    //    instead of a uniform ring. Distant scattered particles fade out in
    //    the fragment shader via vScatter.
    float spreadFactor = smoothstep(uSpreadStart, 1.0, aEdge);
    vec3 radialDir = normalize(pos + vec3(0.001, 0.001, 0.0));
    pos += radialDir * spreadFactor * (uSpreadStrength * 0.0001);

    float distFromCenter = length(pos.xy);
    float scatterFactor = smoothstep(0.35, 1.0, distFromCenter);
    float angle = aRandomSeed * 6.2831853;
    vec2 scatterDir2 = vec2(cos(angle), sin(angle));
    pos.x += scatterDir2.x * scatterFactor * uEdgeScatter;
    pos.y += scatterDir2.y * scatterFactor * uEdgeScatter;
    vScatter = scatterFactor;

    // === 6. Voice "light-touch" dispersion (R65, additive — core untouched) ===
    // Replaces the old whole-image CSS scale. Per-particle radial + tangential
    // offset driven by ONE shared envelope (uVoiceEnv). w = r_norm² weights it
    // so the CENTER stays put (w≈0) while the OUTER particles drift outward a
    // few pixels — "外围粒子微微散开、中心几乎不动". Never scales the cloud.
    //
    // R66 hardening: the ENTIRE cloud shares this ONE ShaderMaterial, so a single
    // compile failure here blanks ALL particles. To stay compatible with strict
    // GLSL ES 1.00 compilers (Windows ANGLE / Direct3D) we avoid the ternary
    // operator returning a vec2 and the "1e-4" exponent literal (both rejected by
    // some drivers), and we clamp the envelope so a stray NaN can never fan out
    // to every vertex.
    float rNorm = length(aOriginalPosition.xy) / max(uVoiceMaxR, 0.0001);
    float w = rNorm * rNorm;                  // center ~0, edge ~1
    // Safe radial direction: divide by length, then ZERO it at the exact center
    // so we never normalize() a near-zero vector (NaN on strict compilers).
    float pLen = length(aOriginalPosition.xy);
    // NOTE: named voiceRadial / voiceTangent (NOT radialDir) on purpose —
    // the spread section above (line ~177) already declares vec3 radialDir
    // in the same main() scope, and re-declaring it here is a GLSL
    // "redefinition" COMPILE ERROR that kills the whole ShaderMaterial
    // (all particles vanish). This collision existed since R65 and was the
    // real cause of the "particle portrait disappears" regression.
    vec2 voiceRadial = aOriginalPosition.xy / max(pLen, 0.0001);
    voiceRadial *= step(0.0001, pLen);        // center particle → no offset
    vec2 voiceTangent = vec2(-voiceRadial.y, voiceRadial.x);
    float factor = 0.6 + aRandomSeed * 0.6;   // 0.6..1.2 per-particle randomness
    float voiceEnv = clamp(uVoiceEnv, 0.0, 1.0); // never NaN/overshoot
    float jitter = sin(aRandomSeed * 6.2831853 + uTime * 1.5) * uVoiceJitter;
    pos.xy += voiceRadial * (w * voiceEnv * uVoiceDisp * uVoiceMaxR * factor);
    pos.xy += voiceTangent * (w * voiceEnv * jitter * uVoiceMaxR);

    // === Transform ===
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);

    // === gl_PointSize ===
    // New Round-4 formula using uPointSize + uDepth for perspective:
    //   perspectiveFactor = uDepth / (uDepth + |z|)
    // Round 14: multiply by a zoom compensation factor so particles get
    // visibly larger as the camera zooms in (grains become visible) and
    // don't shrink to nothing when zoomed far out (kept at 1x minimum).
    float perspectiveFactor = uDepth / (uDepth + max(0.0, -mv.z));
    float distToCam = max(0.1, -mv.z);
    float zoomComp = clamp(uZoomDefaultZ / distToCam, 1.0, 15.0);
    gl_PointSize = uPointSize * aScale * uPixelRatio * perspectiveFactor * zoomComp;

    // Legacy fallback: if uPointSize is 0, use the old formula
    if (uPointSize < 0.001) {
      gl_PointSize = uSize * aScale * uPixelRatio * (uSizeAttenuation / max(0.1, -mv.z));
    }

    gl_PointSize = max(gl_PointSize, 1.0);

    gl_Position = projectionMatrix * mv;

    // Depth-based alpha (closer = more opaque)
    vAlpha = clamp(1.0 - (-mv.z - 1.0) / 10.0, 0.4, 1.0);
  }
`;

// ---------------------------------------------------------------------------
// Fragment Shader
// ---------------------------------------------------------------------------

export const FRAGMENT_SHADER = /* glsl */ `
  varying vec3  vColor;
  varying float vAlpha;
  varying float vEdge;
  varying float vScatter;

  uniform float uBrightness;
  uniform float uOpacity;

  // Round 4 new parameters
  uniform float uVignetteStart;       // Edge distance where vignette begins
  uniform float uBrightnessEnhance;   // Global brightness multiplier

  void main() {
    // Round particle: distance from center of point sprite
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord);

    // Soft circular falloff
    float alpha = smoothstep(0.5, 0.3, dist);
    if (alpha < 0.01) discard;

    // Color: 100% from the sampled texture color — NO mouse glow, NO whitening.
    vec3 color = vColor * uBrightness * uBrightnessEnhance;
    color = clamp(color, 0.0, 1.0);

    // Elliptical edge fade: particles at the image border become transparent
    alpha *= (1.0 - vEdge);

    // Vignette fade (Round 4): particles beyond uVignetteStart get extra fade
    float vignetteFade = 1.0 - smoothstep(uVignetteStart, 1.0, vEdge);
    alpha *= vignetteFade;

    // Edge-scatter fade (Round 14): scattered halo particles fade out the
    // farther they are from the center, blending naturally into the black
    // background — no hard edge on the halo.
    alpha *= (1.0 - vScatter * 0.75);

    gl_FragColor = vec4(color, alpha * vAlpha * uOpacity);
  }
`;
