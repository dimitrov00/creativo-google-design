/** A picture as it goes up: the long edge capped, JPEG, the camera's own orientation applied. */
export interface SizedImage {
  readonly image: Blob;
  readonly width: number | null;
  readonly height: number | null;
}

const LONG_EDGE = 1600;
const JPEG_QUALITY = 0.85;

/**
 * A phone's photo is 12 megapixels and four megabytes; the shop's record of
 * a haircut is not. The long edge is capped and the image re-encoded as
 * JPEG before it goes up, with the EXIF orientation baked in so the
 * picture stands the way the camera saw it. Where the browser cannot draw
 * it — no `createImageBitmap`, no canvas, an unreadable file — the
 * original goes up as it is, its size checked at the port.
 */
export async function downscaleImage(
  file: Blob,
  longEdge = LONG_EDGE,
): Promise<SizedImage> {
  if (typeof createImageBitmap !== 'function') {
    return { image: file, width: null, height: null };
  }
  try {
    const bitmap = await createImageBitmap(file, {
      imageOrientation: 'from-image',
    });
    const scale = Math.min(1, longEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    if (scale === 1 && file.type === 'image/jpeg') {
      bitmap.close();
      return { image: file, width, height };
    }
    const image = await draw(bitmap, width, height);
    bitmap.close();
    return { image: image ?? file, width, height };
  } catch {
    return { image: file, width: null, height: null };
  }
}

async function draw(
  bitmap: ImageBitmap,
  width: number,
  height: number,
): Promise<Blob | null> {
  if (typeof OffscreenCanvas === 'function') {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (context === null) return null;
    context.drawImage(bitmap, 0, 0, width, height);
    return canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
  }
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) return null;
  context.drawImage(bitmap, 0, 0, width, height);
  return new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
  );
}
