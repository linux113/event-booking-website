import sharp, { type Metadata } from "sharp";

import {
  HERO_IMAGE_CONTENT_TYPE,
  HERO_IMAGE_MAX_EDGE,
  HERO_IMAGE_MAX_STORED_BYTES,
  HERO_IMAGE_MAX_UPLOAD_BYTES,
  HERO_IMAGE_MIN_EDGE,
  isAcceptedHeroImageType,
} from "@/lib/admin/hero-image";

const ACCEPTED_FORMATS = ["jpeg", "png", "webp", "heif"] as const;
const MAX_INPUT_PIXELS = 40_000_000;
const ENCODE_ATTEMPTS = [
  { edge: HERO_IMAGE_MAX_EDGE, quality: 84 },
  { edge: 2000, quality: 78 },
  { edge: 1600, quality: 72 },
] as const;

export interface PreparedHeroImage {
  data: Buffer;
  contentType: typeof HERO_IMAGE_CONTENT_TYPE;
  byteSize: number;
  width: number;
  height: number;
  original: { format: string; width: number; height: number; byteSize: number };
}

export type PrepareHeroImageResult =
  | { ok: true; image: PreparedHeroImage }
  | { ok: false; error: { message: string; field: "file" } };

function refusal(message: string): PrepareHeroImageResult {
  return { ok: false, error: { message, field: "file" } };
}

/** Validate, orient, resize and re-encode a single uploaded hero as WebP. */
export async function prepareHeroImage(input: {
  bytes: Buffer | Uint8Array;
  contentType: string;
}): Promise<PrepareHeroImageResult> {
  const bytes = Buffer.isBuffer(input.bytes) ? input.bytes : Buffer.from(input.bytes);

  if (!isAcceptedHeroImageType(input.contentType)) {
    return refusal("Choose a JPEG, PNG, WebP or AVIF image.");
  }
  if (bytes.byteLength === 0) {
    return refusal("That image file is empty.");
  }
  if (bytes.byteLength > HERO_IMAGE_MAX_UPLOAD_BYTES) {
    return refusal("That upload is too large to process. Choose a smaller image or let the browser resize it first.");
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(bytes, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch {
    return refusal("That file could not be read as an image. Choose a JPEG, PNG, WebP or AVIF photo.");
  }

  const format = metadata.format ?? "";
  if (!(ACCEPTED_FORMATS as readonly string[]).includes(format)) {
    return refusal("That file is not a supported photo. Choose a JPEG, PNG, WebP or AVIF image.");
  }
  if (!metadata.width || !metadata.height) {
    return refusal("That image has no readable dimensions.");
  }
  if (metadata.width * metadata.height > MAX_INPUT_PIXELS) {
    return refusal("That image has too many pixels to process. Resize it and try again.");
  }
  if (Math.min(metadata.width, metadata.height) < HERO_IMAGE_MIN_EDGE) {
    return refusal(`Choose an image with at least ${HERO_IMAGE_MIN_EDGE} pixels on its shortest side.`);
  }
  if ((metadata.pages ?? 1) > 1) {
    return refusal("Animated images are not supported. Choose a still photo instead.");
  }

  for (const attempt of ENCODE_ATTEMPTS) {
    try {
      const encoded = await sharp(bytes, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS })
        .rotate()
        .resize({
          width: attempt.edge,
          height: attempt.edge,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: attempt.quality, effort: 4, smartSubsample: true })
        .toBuffer({ resolveWithObject: true });

      if (encoded.data.byteLength <= HERO_IMAGE_MAX_STORED_BYTES) {
        return {
          ok: true,
          image: {
            data: encoded.data,
            contentType: HERO_IMAGE_CONTENT_TYPE,
            byteSize: encoded.data.byteLength,
            width: encoded.info.width,
            height: encoded.info.height,
            original: {
              format,
              width: metadata.width,
              height: metadata.height,
              byteSize: bytes.byteLength,
            },
          },
        };
      }
    } catch {
      return refusal("That image could not be optimized. Try another photo.");
    }
  }

  return refusal("That image is still too large after optimization. Choose a simpler or smaller photo.");
}
