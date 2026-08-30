import type { ParticleData } from '../types';
import { CONFIG } from '../utils/constants';

/**
 * Image Processor — converts an image into structured particle data.
 *
 * Pipeline:
 * 1. Draw image to an offscreen canvas
 * 2. Read pixel data via getImageData
 * 3. Sample pixels at gap=1-2 to reach ~PARTICLE_COUNT
 * 4. Filter transparent/very-dark pixels (alpha < threshold, brightness < threshold)
 * 5. Z-depth from brightness (2.5D relief) + random jitter
 * 6. Build Float32Arrays for positions, colors, sizes, originalPositions, randomSeeds
 */

/** Alpha threshold below which a pixel is considered transparent. */
const ALPHA_THRESHOLD = 10;

/** Brightness threshold below which a pixel is treated as background noise.
 *  Kept very low to preserve image details. */
const BRIGHTNESS_THRESHOLD = 0.03;

/** Maximum canvas dimension before downsampling (to limit memory).
 *  Larger = more particles / finer detail. */
const MAX_CANVAS_DIMENSION = 1200;

/** Random Z jitter amplitude (±this value). */
const Z_JITTER = 0.15;

/**
 * GLSL-style smoothstep helper.
 * Returns 0 when x <= edge0, 1 when x >= edge1, smooth Hermite interpolation in between.
 */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Calculate the sampling step to approximately reach the target particle count.
 * Gap is clamped to [1, 2] — gap=1 samples every pixel, gap=2 samples every other.
 */
function calculateStep(width: number, height: number, target: number): number {
  const totalPixels = width * height;
  const step = Math.sqrt(totalPixels / target);
  return Math.max(1, Math.min(2, Math.round(step)));
}

/**
 * Downscale image dimensions if they exceed the maximum canvas dimension,
 * preserving aspect ratio.
 */
function fitToCanvas(
  width: number,
  height: number,
  maxDim: number,
): { width: number; height: number } {
  if (width <= maxDim && height <= maxDim) {
    return { width, height };
  }
  const ratio = Math.min(maxDim / width, maxDim / height);
  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
  };
}

/**
 * Process an HTMLImageElement into ParticleData.
 *
 * @param image — The loaded HTMLImageElement to convert
 * @returns ParticleData containing positions, colors, sizes, etc.
 */
export function processImage(image: HTMLImageElement): ParticleData {
  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;

  // Fit to canvas size limits
  const { width, height } = fitToCanvas(naturalWidth, naturalHeight, MAX_CANVAS_DIMENSION);

  // Create offscreen canvas
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (!ctx) {
    throw new Error('Failed to get 2D canvas context');
  }

  // Draw image onto canvas
  ctx.drawImage(image, 0, 0, width, height);

  // Read pixel data
  const imageData = ctx.getImageData(0, 0, width, height);
  const pixels = imageData.data;

  // Calculate sampling step
  const step = calculateStep(width, height, CONFIG.PARTICLE_COUNT);

  // Collect sampled particles
  const positions: number[] = [];
  const colors: number[] = [];
  const sizes: number[] = [];
  const originalPositions: number[] = [];
  const randomPositions: number[] = [];
  const randomSeeds: number[] = [];
  const edges: number[] = [];

  // Center the point cloud around origin (0, 0, 0)
  const centerX = width / 2;
  const centerY = height / 2;

  // Scale factor: normalize coordinates to roughly [-1, 1] range
  const maxDim = Math.max(width, height);
  const scaleFactor = 2 / maxDim;

  // Aspect ratios for elliptical edge fade (follows original image aspect)
  const aspectX = width / maxDim;
  const aspectY = height / maxDim;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const idx = (y * width + x) * 4;
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];
      const a = pixels[idx + 3];

      // Skip transparent pixels
      if (a < ALPHA_THRESHOLD) continue;

      // Calculate perceived brightness (luminance)
      const brightness = (r * 0.299 + g * 0.587 + b * 0.114) / 255;

      // Skip very dark pixels to keep background clean
      if (brightness < BRIGHTNESS_THRESHOLD) continue;

      // Normalized coordinates centered at origin
      const nx = (x - centerX) * scaleFactor;
      const ny = -(y - centerY) * scaleFactor; // Flip Y (canvas Y goes down, 3D Y goes up)

      // Z-depth from brightness: SYMMETRIC around 0 so the rotation pivot is
      // exactly the image center. Bright pixels pop forward (+Z), dark pixels
      // recede backward (-Z), plus symmetric random jitter for organic 2.5D
      // relief. (Round 15: previously this was all-positive, which shifted the
      // visual rotation center forward and made the cloud swing eccentrically.)
      const nz =
        (brightness - 0.5) * CONFIG.DEPTH_STRENGTH * 2 +
        (Math.random() - 0.5) * Z_JITTER * 2;

      positions.push(nx, ny, nz);
      originalPositions.push(nx, ny, nz);

      // Random start position for assemble animation
      // Distribute in a sphere of radius ~3 around the origin
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const radius = 2.0 + Math.random() * 2.0;
      randomPositions.push(
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.sin(phi) * Math.sin(theta),
        radius * Math.cos(phi),
      );

      // Sample exact color from the image (normalized to 0-1)
      colors.push(r / 255, g / 255, b / 255);

      // Per-particle scale: 0.8–1.2 based on brightness.
      // Brighter pixels are slightly larger (more visible), darker ones smaller.
      const scale = 0.8 + brightness * 0.4;
      sizes.push(scale);

      // Elliptical edge fade: particles near the image border become transparent.
      // rx/ry are normalized by the image aspect so the ellipse matches the photo ratio.
      const rx = nx / aspectX;
      const ry = ny / aspectY;
      const edgeRadius = Math.sqrt(rx * rx + ry * ry);
      const edge = smoothstep(0.7, 1.0, edgeRadius);
      edges.push(edge);

      // Random seed for float animation phase
      randomSeeds.push(Math.random());
    }
  }

  const count = positions.length / 3;

  // Defensive centering (Round 15): shift every sampled position so the
  // geometric center is exactly (0,0,0) on ALL THREE axes. This guarantees
  // the rotation pivot is the true image center regardless of any small
  // asymmetry left over from brightness-based Z (or sampling gaps).
  if (count > 0) {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let i = 0; i < count; i++) {
      cx += positions[i * 3];
      cy += positions[i * 3 + 1];
      cz += positions[i * 3 + 2];
    }
    cx /= count;
    cy /= count;
    cz /= count;
    for (let i = 0; i < count; i++) {
      positions[i * 3] -= cx;
      positions[i * 3 + 1] -= cy;
      positions[i * 3 + 2] -= cz;
      originalPositions[i * 3] -= cx;
      originalPositions[i * 3 + 1] -= cy;
      originalPositions[i * 3 + 2] -= cz;
    }
  }

  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    sizes: new Float32Array(sizes),
    originalPositions: new Float32Array(originalPositions),
    randomPositions: new Float32Array(randomPositions),
    randomSeeds: new Float32Array(randomSeeds),
    edges: new Float32Array(edges),
    count,
  };
}

/**
 * Create a thumbnail Blob from an image Blob.
 *
 * @param blob — The original image Blob
 * @param maxSize — Maximum dimension of the thumbnail (default 100)
 * @returns A Promise resolving to a JPEG thumbnail Blob
 */
export async function createThumbnail(blob: Blob, maxSize = 100): Promise<Blob> {
  const url = URL.createObjectURL(blob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Failed to load image for thumbnail'));
      image.src = url;
    });

    const naturalWidth = img.naturalWidth || img.width;
    const naturalHeight = img.naturalHeight || img.height;

    // Calculate thumbnail dimensions (square crop)
    const sourceSize = Math.min(naturalWidth, naturalHeight);
    const sourceX = (naturalWidth - sourceSize) / 2;
    const sourceY = (naturalHeight - sourceSize) / 2;

    const canvas = document.createElement('canvas');
    canvas.width = maxSize;
    canvas.height = maxSize;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      throw new Error('Failed to get 2D canvas context for thumbnail');
    }

    // Draw center-cropped square
    ctx.drawImage(img, sourceX, sourceY, sourceSize, sourceSize, 0, 0, maxSize, maxSize);

    // Convert to Blob
    const thumbnailBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blobResult) => {
          if (blobResult) resolve(blobResult);
          else reject(new Error('Failed to create thumbnail blob'));
        },
        'image/jpeg',
        0.85,
      );
    });

    return thumbnailBlob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Process a Blob into ParticleData.
 * Convenience wrapper that loads the image first, then calls processImage.
 *
 * @param blob — The image Blob to process
 * @returns A Promise resolving to ParticleData
 */
export async function processImageBlob(blob: Blob): Promise<ParticleData> {
  const url = URL.createObjectURL(blob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Failed to load image from blob'));
      image.src = url;
    });

    return processImage(img);
  } finally {
    URL.revokeObjectURL(url);
  }
}
