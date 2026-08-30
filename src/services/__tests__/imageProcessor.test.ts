/**
 * ImageProcessor Tests — Particle Generation Logic
 *
 * Tests the image-to-particle conversion pipeline:
 * - calculateStep (sampling step calculation)
 * - fitToCanvas (dimension downscaling)
 * - processImage (full pipeline with mocked canvas)
 *
 * Since these functions use browser Canvas API, we mock the canvas
 * context with a controlled pixel array.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock canvas context — returns controlled pixel data
// ---------------------------------------------------------------------------
function createMockCanvasContext(width: number, height: number) {
  const pixels = new Uint8ClampedArray(width * height * 4);

  // Fill with a simple pattern: red for left half, blue for right half
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (x < width / 2) {
        pixels[idx] = 255; // R
        pixels[idx + 1] = 0; // G
        pixels[idx + 2] = 0; // B
      } else {
        pixels[idx] = 0; // R
        pixels[idx + 1] = 0; // G
        pixels[idx + 2] = 255; // B
      }
      pixels[idx + 3] = 255; // A (fully opaque)
    }
  }

  const ctx = {
    drawImage: vi.fn(),
    getImageData: vi.fn().mockReturnValue({
      data: pixels,
      width,
      height,
    }),
  };

  return ctx;
}

// Mock document.createElement to return a mock canvas
beforeEach(() => {
  const mockCreateElement = vi.fn().mockImplementation((tag: string) => {
    if (tag === 'canvas') {
      return {
        width: 0,
        height: 0,
        getContext: vi.fn().mockImplementation((type: string) => {
          if (type === '2d') {
            // Dimensions will be set dynamically
            return createMockCanvasContext(100, 100);
          }
          return null;
        }),
        toBlob: vi.fn((callback: (blob: Blob | null) => void) => {
          callback(new Blob(['mock'], { type: 'image/jpeg' }));
        }),
      };
    }
    return {};
  });

  vi.stubGlobal('document', {
    ...globalThis.document,
    createElement: mockCreateElement,
  });
});

// We need to import after mocking
import { processImage } from '../imageProcessor';
import { CONFIG } from '../../utils/constants';

describe('imageProcessor — processImage', () => {
  it('should return a ParticleData object with correct structure', () => {
    const mockImage = {
      naturalWidth: 100,
      naturalHeight: 100,
      width: 100,
      height: 100,
    } as HTMLImageElement;

    const result = processImage(mockImage);

    expect(result).toBeDefined();
    expect(result.positions).toBeInstanceOf(Float32Array);
    expect(result.colors).toBeInstanceOf(Float32Array);
    expect(result.sizes).toBeInstanceOf(Float32Array);
    expect(result.originalPositions).toBeInstanceOf(Float32Array);
    expect(result.randomSeeds).toBeInstanceOf(Float32Array);
    expect(result.edges).toBeInstanceOf(Float32Array);
    expect(typeof result.count).toBe('number');
  });

  it('should have consistent array lengths (positions = 3 * count)', () => {
    const mockImage = {
      naturalWidth: 100,
      naturalHeight: 100,
      width: 100,
      height: 100,
    } as HTMLImageElement;

    const result = processImage(mockImage);

    expect(result.positions.length).toBe(result.count * 3);
    expect(result.colors.length).toBe(result.count * 3);
    expect(result.sizes.length).toBe(result.count);
    expect(result.originalPositions.length).toBe(result.count * 3);
    expect(result.randomSeeds.length).toBe(result.count);
    expect(result.edges.length).toBe(result.count);
  });

  it('should have originalPositions matching positions initially', () => {
    const mockImage = {
      naturalWidth: 100,
      naturalHeight: 100,
      width: 100,
      height: 100,
    } as HTMLImageElement;

    const result = processImage(mockImage);

    for (let i = 0; i < result.positions.length; i++) {
      expect(result.positions[i]).toBeCloseTo(result.originalPositions[i], 5);
    }
  });

  it('should normalize color values to 0-1 range', () => {
    const mockImage = {
      naturalWidth: 100,
      naturalHeight: 100,
      width: 100,
      height: 100,
    } as HTMLImageElement;

    const result = processImage(mockImage);

    for (let i = 0; i < result.colors.length; i++) {
      expect(result.colors[i]).toBeGreaterThanOrEqual(0);
      expect(result.colors[i]).toBeLessThanOrEqual(1);
    }
  });

  it('should produce particle sizes in expected range', () => {
    const mockImage = {
      naturalWidth: 100,
      naturalHeight: 100,
      width: 100,
      height: 100,
    } as HTMLImageElement;

    const result = processImage(mockImage);

    for (let i = 0; i < result.sizes.length; i++) {
      // sizes are per-particle scale multipliers (0.8–1.2)
      expect(result.sizes[i]).toBeGreaterThanOrEqual(0.8);
      expect(result.sizes[i]).toBeLessThanOrEqual(1.2);
    }
  });

  it('should have randomSeeds in 0-1 range', () => {
    const mockImage = {
      naturalWidth: 100,
      naturalHeight: 100,
      width: 100,
      height: 100,
    } as HTMLImageElement;

    const result = processImage(mockImage);

    for (let i = 0; i < result.randomSeeds.length; i++) {
      expect(result.randomSeeds[i]).toBeGreaterThanOrEqual(0);
      expect(result.randomSeeds[i]).toBeLessThanOrEqual(1);
    }
  });

  it('should center positions around origin (0,0,0)', () => {
    const mockImage = {
      naturalWidth: 100,
      naturalHeight: 100,
      width: 100,
      height: 100,
    } as HTMLImageElement;

    const result = processImage(mockImage);

    // Positions should be in roughly [-1, 1] range (normalized)
    for (let i = 0; i < result.positions.length; i++) {
      expect(result.positions[i]).toBeGreaterThanOrEqual(-1.5);
      expect(result.positions[i]).toBeLessThanOrEqual(1.5);
    }
  });

  it('should have Z depth based on brightness + jitter (2.5D relief)', () => {
    const mockImage = {
      naturalWidth: 100,
      naturalHeight: 100,
      width: 100,
      height: 100,
    } as HTMLImageElement;

    const result = processImage(mockImage);

    // Z = (brightness - 0.5) * DEPTH_STRENGTH * 2 + jitter(±0.15)
    // Symmetric around 0 (Round 15): brightness∈[0,1], DEPTH_STRENGTH=0.3
    // → range is approximately [-0.45, 0.45]
    for (let i = 2; i < result.positions.length; i += 3) {
      expect(result.positions[i]).toBeGreaterThanOrEqual(-0.5);
      expect(result.positions[i]).toBeLessThanOrEqual(0.5);
    }
  });

  it('should produce approximately PARTICLE_COUNT particles for large images', () => {
    // With a 800x600 image and PARTICLE_COUNT=200000, step is clamped to 1-2
    const mockImage = {
      naturalWidth: 800,
      naturalHeight: 600,
      width: 800,
      height: 600,
    } as HTMLImageElement;

    const result = processImage(mockImage);

    // Should be in the right ballpark (within 50% of target)
    expect(result.count).toBeGreaterThan(CONFIG.PARTICLE_COUNT * 0.5);
    expect(result.count).toBeLessThan(CONFIG.PARTICLE_COUNT * 2);
  });

  it('should have edge fade values in [0, 1] range', () => {
    const mockImage = {
      naturalWidth: 100,
      naturalHeight: 100,
      width: 100,
      height: 100,
    } as HTMLImageElement;

    const result = processImage(mockImage);

    for (let i = 0; i < result.edges.length; i++) {
      expect(result.edges[i]).toBeGreaterThanOrEqual(0);
      expect(result.edges[i]).toBeLessThanOrEqual(1);
    }
  });

  it('should handle small images without crashing', () => {
    const mockImage = {
      naturalWidth: 10,
      naturalHeight: 10,
      width: 10,
      height: 10,
    } as HTMLImageElement;

    const result = processImage(mockImage);

    expect(result.count).toBeGreaterThan(0);
    expect(result.positions.length).toBe(result.count * 3);
  });
});
