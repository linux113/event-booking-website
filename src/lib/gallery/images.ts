/**
 * Turning a phone photograph into the two files the gallery stores.
 *
 * A 6 MB, 4032 × 3024 JPEG straight out of a camera is not what a gallery page
 * should serve: it is slow on the mobile connections most of this site's visitors
 * are on, and it is bigger than the layout ever shows. So every upload is re-encoded
 * on the server, once, into:
 *
 *   * **the full image** — longest edge 2400 px, WebP, quality 82. Big enough to
 *     look right on a laptop at full width, small enough to load quickly.
 *   * **the thumbnail** — 640 px wide, WebP, quality 74. This is what the grid
 *     loads; the full image is only fetched when somebody opens the lightbox.
 *
 * Two details that matter more than the numbers:
 *
 *   * **EXIF orientation is applied, and the EXIF is then dropped.** `.rotate()`
 *     with no argument bakes the camera's rotation into the pixels, and sharp does
 *     not copy metadata unless asked — so a photo taken sideways does not arrive
 *     sideways, and the GPS coordinates in a guest's photograph do not end up on
 *     the public site.
 *   * **The declared content type is not trusted.** A file called `stage.png` is
 *     decoded and its real format read from the bytes; anything that is not an
 *     image is refused before it reaches storage.
 *
 * `sharp` runs in Node — this module is used only from the route handler and the
 * server service, never from a component. It deliberately does not import
 * `server-only`, because the verification harness exercises exactly this pipeline;
 * a client component importing it would fail to bundle `sharp` at all.
 */

import sharp, { type Metadata, type Sharp } from "sharp";

import { GALLERY_LIMITS, GALLERY_UPLOAD_TYPES, formatBytes } from "@/lib/admin/gallery";

/** The formats a browser may upload. */
const ACCEPTED_FORMATS = ["jpeg", "png", "webp", "avif"] as const;

const WEBP = "image/webp" as const;

export interface PreparedFile {
  data: Buffer;
  contentType: typeof WEBP;
  byteSize: number;
  width: number;
  height: number;
}

export interface PreparedGalleryImage {
  full: PreparedFile;
  thumb: PreparedFile;
  /** What the original was, for the log line and the "optimised" note in the UI. */
  original: { bytes: number; format: string; width: number; height: number };
}

export interface ImageRefusal {
  message: string;
  /** The form field to blame, when there is one. */
  field?: string;
}

export type PrepareImageResult = { ok: true; image: PreparedGalleryImage } | { ok: false; error: ImageRefusal };

/** True for the content types the buckets accept. */
export function isAcceptedUploadType(contentType: string): boolean {
  return (GALLERY_UPLOAD_TYPES as readonly string[]).includes(contentType);
}

/** A sentence for a file the pipeline will not take, given what was declared. */
export function describeUploadRefusal(contentType: string, bytes: number): ImageRefusal | null {
  if (!isAcceptedUploadType(contentType)) {
    return {
      message: "That is not an image we can store. Use a JPEG, PNG, WebP or AVIF photo.",
      field: "file",
    };
  }

  if (bytes <= 0) {
    return { message: "That file is empty.", field: "file" };
  }

  if (bytes > GALLERY_LIMITS.uploadBytes) {
    return {
      message: `That photo is ${formatBytes(bytes)} — the limit is ${formatBytes(GALLERY_LIMITS.uploadBytes)}. Resize it and try again.`,
      field: "file",
    };
  }

  return null;
}

/**
 * Resize, re-encode and measure one upload.
 *
 * The returned dimensions are the *stored* full image's, not the original's: they
 * are what the page uses to reserve space before the bytes arrive, so they have to
 * describe the file that will actually be served.
 */
export async function prepareGalleryImage(input: {
  bytes: Buffer | Uint8Array;
  contentType: string;
}): Promise<PrepareImageResult> {
  const buffer = Buffer.isBuffer(input.bytes) ? input.bytes : Buffer.from(input.bytes);
  const declared = describeUploadRefusal(input.contentType, buffer.byteLength);

  if (declared) {
    return { ok: false, error: declared };
  }

  let source: Sharp;
  let metadata: Metadata;

  try {
    source = sharp(buffer, { failOn: "error" });
    metadata = await source.metadata();
  } catch (error) {
    console.error("[gallery] could not read the uploaded image:", error);

    return { ok: false, error: { message: "That file could not be read as an image.", field: "file" } };
  }

  const format = metadata.format ?? "";

  if (!(ACCEPTED_FORMATS as readonly string[]).includes(format)) {
    return {
      ok: false,
      error: {
        message: `That file is a ${format || "unknown format"}, not a photograph we can store.`,
        field: "file",
      },
    };
  }

  if (!metadata.width || !metadata.height) {
    return { ok: false, error: { message: "That image has no readable size.", field: "file" } };
  }

  if (Math.min(metadata.width, metadata.height) < GALLERY_LIMITS.minEdge) {
    return {
      ok: false,
      error: {
        message: `That image is ${metadata.width} × ${metadata.height}. Photos need to be at least ${GALLERY_LIMITS.minEdge} px on the short edge.`,
        field: "file",
      },
    };
  }

  try {
    // `rotate()` with no angle reads the EXIF orientation and applies it; nothing
    // else in the pipeline asks for metadata, so the EXIF does not survive.
    const full = await sharp(buffer, { failOn: "error" })
      .rotate()
      .resize({
        width: GALLERY_LIMITS.fullEdge,
        height: GALLERY_LIMITS.fullEdge,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82, effort: 4 })
      .toBuffer({ resolveWithObject: true });

    const thumb = await sharp(buffer, { failOn: "error" })
      .rotate()
      .resize({ width: GALLERY_LIMITS.thumbEdge, withoutEnlargement: true })
      .webp({ quality: 74, effort: 4 })
      .toBuffer({ resolveWithObject: true });

    return {
      ok: true,
      image: {
        full: {
          data: full.data,
          contentType: WEBP,
          byteSize: full.info.size,
          width: full.info.width,
          height: full.info.height,
        },
        thumb: {
          data: thumb.data,
          contentType: WEBP,
          byteSize: thumb.info.size,
          width: thumb.info.width,
          height: thumb.info.height,
        },
        original: {
          bytes: buffer.byteLength,
          format,
          width: metadata.width,
          height: metadata.height,
        },
      },
    };
  } catch (error) {
    console.error("[gallery] could not process the uploaded image:", error);

    return { ok: false, error: { message: "That photo could not be processed. Try another one.", field: "file" } };
  }
}
