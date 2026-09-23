import { getSupabasePublicEnv, isSupabaseConfigured } from "@/config/env";

/**
 * Where a gallery file lives, as pure functions.
 *
 * One rule decides everything here: **the bucket is chosen by the row's status, and
 * the object key never changes.** A photograph is uploaded into the private inbox
 * while it is a draft and moved into the public bucket when it is published — same
 * key, different bucket. That is what lets a caption be edited, a photo be
 * unpublished and republished, and a delete clean up after itself without any of
 * them needing to remember a URL: the key is derived from the row, so it cannot
 * drift from the file it points at.
 *
 * Everything in this module is a string operation, so the service, the route
 * handler, the mapper and the verification harness can all agree about a path
 * without touching storage.
 */

/** Public bucket: what the website reads, and the only place a published file sits. */
export const GALLERY_BUCKET = "gallery";

/** Private bucket: where an upload waits until somebody publishes it. */
export const GALLERY_INBOX_BUCKET = "gallery-inbox";

export type GalleryStatus = "draft" | "published" | "archived";
export type GalleryFileVariant = "full" | "thumb";

/** Both buckets accept the same types, because a file moves between them. */
export const GALLERY_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;

/** Bytes. Matches `file_size_limit` on both buckets. */
export const GALLERY_MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** The longest edge of the stored full image. */
export const GALLERY_FULL_EDGE = 2400;

/** The width of the grid thumbnail — what the gallery page actually loads first. */
export const GALLERY_THUMB_EDGE = 640;

/** Smaller than this is a logo or a screenshot, not a photograph of the night. */
export const GALLERY_MIN_EDGE = 400;

/** Publishing is the only status whose file belongs in the public bucket. */
export function isPublicStatus(status: GalleryStatus | string): boolean {
  return status === "published";
}

/** The bucket a file of this status belongs in. */
export function bucketForStatus(status: GalleryStatus | string): string {
  return isPublicStatus(status) ? GALLERY_BUCKET : GALLERY_INBOX_BUCKET;
}

/**
 * The object key for one item: `<event or "festival">/<item id>/<variant>.webp`.
 *
 * The item id is the row's primary key and is decided *before* the upload — the
 * app generates it, uploads to the key it implies, and inserts the row with that
 * id. A retried upload therefore lands on the same key, and a second row for the
 * same file is impossible (the id is a primary key).
 */
export function galleryObjectKey(
  itemId: string,
  variant: GalleryFileVariant,
  eventId: string | null = null,
): string {
  return `${eventId ?? "festival"}/${itemId}/${variant}.webp`;
}

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$/;

/**
 * Is this a relative object key we are willing to hand to storage?
 *
 * The same rule the database enforces (`PG005`), repeated here because the app
 * builds keys as well as storing them, and a key is also what a delete is aimed
 * with: an absolute URL, a leading slash or a `..` is not a key.
 */
export function isSafeGalleryKey(value: unknown): value is string {
  if (typeof value !== "string" || !SAFE_KEY.test(value)) {
    return false;
  }

  return !value.includes("..") && !value.endsWith("/");
}

/**
 * The URL a published object is served from.
 *
 * Built here rather than read from the row, because the row stores the key and
 * the bucket is a function of its status: a URL column would be one more thing to
 * keep in step with the file. Returns `null` when the deployment has no Supabase
 * URL to point at (the page then renders nothing rather than a broken image).
 */
export function publicGalleryUrl(
  path: string | null | undefined,
  bucket: string = GALLERY_BUCKET,
): string | null {
  if (!path || !isSupabaseConfigured()) {
    return null;
  }

  const { url } = getSupabasePublicEnv();

  return `${url.replace(/\/+$/, "")}/storage/v1/object/public/${bucket}/${path}`;
}
