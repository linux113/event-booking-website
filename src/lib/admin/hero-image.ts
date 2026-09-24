/**
 * Shared limits and URL helpers for the one homepage hero image.
 *
 * This module is safe in the browser: image decoding and database writes live in
 * separate server-only modules, and hero artwork never touches gallery storage.
 */
export const HERO_IMAGE_ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;
export const HERO_IMAGE_UPLOAD_ACCEPT = HERO_IMAGE_ALLOWED_TYPES.join(",");

/** Vercel Functions cap request bodies at roughly 4.5 MiB; leave room for multipart fields. */
export const HERO_IMAGE_MAX_REQUEST_BYTES = 4 * 1024 * 1024;
/** The uploaded part stays below the request ceiling, including multipart boundaries. */
export const HERO_IMAGE_MAX_UPLOAD_BYTES = Math.floor(3.5 * 1024 * 1024);
/** Large phone photos are resized in the browser before they reach the function. */
export const HERO_IMAGE_MAX_SOURCE_BYTES = 24 * 1024 * 1024;
/** Hard database guard: one optimized WebP per event, at most 2 MiB. */
export const HERO_IMAGE_MAX_STORED_BYTES = 2 * 1024 * 1024;
export const HERO_IMAGE_MAX_EDGE = 2400;
export const HERO_IMAGE_MIN_EDGE = 320;
export const HERO_IMAGE_CONTENT_TYPE = "image/webp" as const;

export function isAcceptedHeroImageType(contentType: string): boolean {
  return (HERO_IMAGE_ALLOWED_TYPES as readonly string[]).includes(contentType.toLowerCase());
}

/** Public image route; version is part of the URL so replacements bypass stale caches. */
export function publicHeroImageUrl(eventId: string, version: string | number | null | undefined): string {
  const token = encodeURIComponent(String(version ?? "0"));
  return `/api/hero-image/${encodeURIComponent(eventId)}?v=${token}`;
}

/** Authenticated preview route used only inside Event settings. */
export function adminHeroImagePreviewUrl(eventId: string, version: string | number | null | undefined): string {
  const params = new URLSearchParams({ id: eventId, v: String(version ?? "0") });
  return `/api/admin/hero-image/preview?${params.toString()}`;
}

export function formatHeroImageBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
