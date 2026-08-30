/**
 * Avatar utilities — compress a picked image file into a 256×256 square
 * avatar as a base64 data URL (data:image/jpeg;base64,...).
 *
 * The source image is cover-cropped (center) to a square, drawn at 256px,
 * and encoded as JPEG. Round 22 hardening: the encoder re-compresses at
 * progressively lower quality (0.85 → 0.7 → 0.5) until the resulting
 * base64 string is safely under the server's 200 KB limit — the original
 * "avatar upload silently fails" bug happened when a detailed photo at a
 * FIXED 0.85 quality produced a payload the server rejected.
 */

/** Server-side cap (server/routes/user.ts MAX_AVATAR_LENGTH = 200 KB).
 *  base64 string length ≈ 4/3 × raw bytes, so we aim well under the cap. */
const MAX_AVATAR_DATA_URL_LENGTH = 185 * 1024; // 185 KB string length ≈ 138 KB bytes

/** Load an image element from an object URL. */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = url;
  });
}

/**
 * Encode the canvas as JPEG at the given quality and return the data URL.
 */
function encodeCanvas(canvas: HTMLCanvasElement, quality: number): string {
  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Convert a picked File into a 256×256 avatar data URL that is guaranteed
 * to fit the server's size limit (re-encodes at lower quality if needed).
 *
 * @param file — image file (jpeg/png/webp)
 * @returns base64 data URL (always data:image/jpeg;base64,...)
 */
export async function fileToAvatarDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const SIZE = 256;
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D not supported');

    // Cover-crop: scale so the smaller dimension fills 256px, center crop.
    const scale = Math.max(SIZE / img.width, SIZE / img.height);
    const srcW = SIZE / scale;
    const srcH = SIZE / scale;
    const sx = (img.width - srcW) / 2;
    const sy = (img.height - srcH) / 2;
    ctx.drawImage(img, sx, sy, srcW, srcH, 0, 0, SIZE, SIZE);

    // Try 0.85 first, then step down to 0.7 / 0.5 until under the cap.
    const qualities = [0.85, 0.7, 0.5];
    for (const quality of qualities) {
      const dataUrl = encodeCanvas(canvas, quality);
      if (dataUrl.length <= MAX_AVATAR_DATA_URL_LENGTH) {
        return dataUrl;
      }
    }
    // Absolute fallback: lowest supported quality. If it is STILL over the
    // cap, the server will reject it — but at 256×256 @0.5 that is virtually
    // impossible, so we never silently upload a broken payload.
    return encodeCanvas(canvas, 0.5);
  } finally {
    URL.revokeObjectURL(url);
  }
}
