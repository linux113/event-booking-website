/**
 * Gallery object keys and public URLs.
 *
 * Objects live in a single Vercel Blob store (no separate draft/publish
 * buckets). Keys are namespaced under `gallery/` and embed the item id.
 *
 * `publicGalleryUrl` must only be used for rows with `status = 'published'` —
 * drafts are never linked from public HTML; previews stream through the admin
 * route.
 */

/** Namespace all gallery objects share in the Blob store. */
export const GALLERY_PREFIX = "gallery/" as const;

/**
 * Build the storage key for one gallery item's file.
 *
 *   full:  gallery/<itemId>/full.webp
 *   thumb: gallery/<itemId>/thumb.webp
 */
export function galleryObjectKey(
  itemId: string,
  variant: "full" | "thumb",
  _eventId?: string | null,
): string {
  const name = variant === "thumb" ? "thumb.webp" : "full.webp";
  return `${GALLERY_PREFIX}${itemId}/${name}`;
}

/** Public URL for an object key (from its Blob `url` or the row's `url` column). */
export function publicGalleryUrl(storagePath: string): string | null {
  if (!storagePath) return null;
  // Absolute URLs (Blob store / row.url) pass through.
  if (/^https?:\/\//i.test(storagePath)) return storagePath;
  // Relative keys without a stored URL are not publicly resolvable here.
  return null;
}

/**
 * For maps that only expose the published subset (kept for call-site clarity).
 */
export function isPublicStatus(status: string): boolean {
  return status === "published";
}
