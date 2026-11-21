// lib/listing-photo.ts
// Prepares a listing photo in the browser before upload: turns it upright,
// shrinks it to at most 2048px on the long edge, and re-saves it as a JPEG.
//
// Re-saving matters for privacy as much as size: phone camera photos carry
// EXIF metadata, often including the GPS spot where they were taken (usually
// the seller's home). Drawing to a canvas keeps only the pixels, so none of
// that reaches the public listing-photos bucket.

const MAX_EDGE = 2048
const QUALITY = 0.85
/** Bigger than this is very unlikely to be a photo we can handle. */
export const MAX_SOURCE_BYTES = 40 * 1024 * 1024

export class UnsupportedPhotoError extends Error {}

export async function prepareListingPhoto(file: File): Promise<File> {
  if (file.size > MAX_SOURCE_BYTES) throw new UnsupportedPhotoError('too large')

  let bitmap: ImageBitmap
  try {
    // 'from-image' applies the camera's rotation flag, so photos aren't sideways.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    // e.g. HEIC on a browser that can't read it.
    throw new UnsupportedPhotoError('unreadable')
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    throw new UnsupportedPhotoError('no canvas')
  }
  // JPEG has no transparency: put see-through PNGs on white, not black.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY))
  if (!blob) throw new UnsupportedPhotoError('encode failed')
  const base = file.name.replace(/\.[^.]+$/, '') || 'photo'
  return new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: Date.now() })
}
