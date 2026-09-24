/**
 * Gallery media paths and public URLs.
 *
 * Gallery images are stored in Postgres bytea (or external URLs).
 *
 * `publicGalleryUrl` must only be used for rows with `status = 'published'` —
 * drafts are never linked from public HTML; previews stream through the admin
 * preview route.
 */

/** Namespace all gallery objects share. Kept for backwards compatibility. */
export const GALLERY_PREFIX = "gallery/" as const;

/**
 * Build the storage key / identifier for one gallery item's file.
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

/** Public URL for a gallery item or storage path. */
export function publicGalleryUrl(storagePathOrId: string, variant: "full" | "thumb" = "full"): string | null {
  if (!storagePathOrId) return null;
  // Absolute URLs pass through.
  if (/^https?:\/\//i.test(storagePathOrId)) return storagePathOrId;

  // If it's a UUID or starts with gallery/<uuid>
  const match = storagePathOrId.match(/(?:^gallery\/)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (match) {
    const id = match[1];
    return `/api/gallery-image/${id}?variant=${variant}`;
  }

  return null;
}

/**
 * For maps that only expose the published subset (kept for call-site clarity).
 */
export function isPublicStatus(status: string): boolean {
  return status === "published";
}
