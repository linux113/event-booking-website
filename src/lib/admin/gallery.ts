/**
 * The gallery screen's vocabulary, as a pure module.
 *
 * Same shape as `src/lib/admin/catalogue.ts`: no database, no React, no filesystem,
 * so the form, the route handler and the verification harness all read the same
 * rules. What lives here:
 *
 *   1. **Limits, stated once** — shared form/server rules for metadata and image size,
 *      so the browser and API report the same constraints.
 *   2. **Parsing a submitted form** into typed values, with a message per field.
 *   3. **The words** the screen uses: what "draft" means, what a file size looks
 *      like, what the upload will accept.
 *
 * Nothing here decides whether a photograph may be published: that is the database's
 * answer (`gallery_check_metadata` and the status function), and it comes back as a
 * code the refusal table translates.
 */

import type { GalleryFormErrors, GalleryFormValues, GalleryStatus } from "@/types/gallery";

// -----------------------------------------------------------------------------
// Limits
// -----------------------------------------------------------------------------

export const GALLERY_STORAGE_SETUP_MESSAGE =
  "Gallery storage is not configured. In Vercel, open Project → Storage → create a Blob store and connect it to this project, enable Production (and Preview if used), confirm BLOB_READ_WRITE_TOKEN is available in that environment, then redeploy.";

export const GALLERY_LIMITS = {
  /** Longest title the column holds. */
  titleMax: 120,
  descriptionMax: 400,
  altTextMax: 200,
  albumMax: 60,
  sortOrderMax: 9999,
  /** Bytes: the server-side per-file ceiling, before image processing. */
  uploadBytes: 8 * 1024 * 1024,
  /** Smaller than this is a screenshot or a logo, not a photograph of the night. */
  minEdge: 400,
  /** The longest edge the stored full image is resized to. */
  fullEdge: 2400,
  /** The width of the grid thumbnail. */
  thumbEdge: 640,
} as const;

/** Image types allowed by the file picker and accepted by the server image processor. */
export const GALLERY_UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;

/** A file input's `accept` attribute, built from the list above. */
export const GALLERY_UPLOAD_ACCEPT = GALLERY_UPLOAD_TYPES.join(",");

// -----------------------------------------------------------------------------
// The form
// -----------------------------------------------------------------------------

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? Math.trunc(parsed) : Number.NaN;
  }

  return Number.NaN;
}

/** `YYYY-MM-DD` and nothing that only looks like it. */
function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00Z`);

  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Read the edit form.
 *
 * Alternative text is required, and the message says why rather than "required":
 * it is the only thing a screen reader has to describe the photograph, and a
 * gallery that fails that is not an accessible gallery. The database enforces the
 * same rule (PG001) — this exists so the person sees it before a round trip.
 */
export function parseGalleryForm(
  input: unknown,
): { values: GalleryFormValues; errors: GalleryFormErrors } {
  const source = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;

  const values: GalleryFormValues = {
    id: asString(source.id) || null,
    title: asString(source.title),
    description: asString(source.description),
    altText: asString(source.altText),
    album: asString(source.album),
    capturedOn: asString(source.capturedOn),
    sortOrder: asNumber(source.sortOrder),
  };

  const errors: GalleryFormErrors = {};

  if (values.title.length > GALLERY_LIMITS.titleMax) {
    errors.title = `Keep the title under ${GALLERY_LIMITS.titleMax} characters.`;
  }

  if (values.description.length > GALLERY_LIMITS.descriptionMax) {
    errors.description = `Keep the description under ${GALLERY_LIMITS.descriptionMax} characters.`;
  }

  if (values.altText.length === 0) {
    errors.altText = "Describe the photo for somebody who cannot see it — this is read aloud by screen readers.";
  } else if (values.altText.length > GALLERY_LIMITS.altTextMax) {
    errors.altText = `Keep the description under ${GALLERY_LIMITS.altTextMax} characters.`;
  }

  if (values.album.length > GALLERY_LIMITS.albumMax) {
    errors.album = `Keep the album name under ${GALLERY_LIMITS.albumMax} characters.`;
  }

  if (values.capturedOn !== "" && !isIsoDate(values.capturedOn)) {
    errors.capturedOn = "Pick the date the photo was taken, or leave it empty.";
  }

  if (!Number.isInteger(values.sortOrder) || values.sortOrder < 0 || values.sortOrder > GALLERY_LIMITS.sortOrderMax) {
    errors.sortOrder = `Order is a whole number from 0 to ${GALLERY_LIMITS.sortOrderMax}.`;
  }

  return { values, errors };
}

/** True when the form is clean. Kept here so both callers spell it the same way. */
export function isCleanGalleryForm(errors: GalleryFormErrors): boolean {
  return Object.keys(errors).length === 0;
}

/** The first field with a problem, for a single-line answer to a whole form. */
export function firstGalleryError(errors: GalleryFormErrors): { field: keyof GalleryFormErrors; message: string } | null {
  const [field] = Object.keys(errors) as (keyof GalleryFormErrors)[];

  return field ? { field, message: errors[field] as string } : null;
}

/**
 * A title from a file name, so an upload is never an untitled row.
 *
 * "night-2-stage_1804.JPG" becomes "Night 2 stage 1804" — the photographer's own
 * words, tidied, not invented. The database needs a title for the caption; the
 * organiser can rewrite it, and the alternative text still has to be written by a
 * person because a file name cannot describe a photograph.
 */
export function titleFromFileName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[A-Za-z0-9]+$/, "");

  const words = withoutExtension
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (words.length === 0) {
    return "";
  }

  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`.slice(0, GALLERY_LIMITS.titleMax);
}

// -----------------------------------------------------------------------------
// The words on the screen
// -----------------------------------------------------------------------------

/** One word for a status, in the sense the organiser means it. */
export function galleryStatusLabel(status: GalleryStatus): string {
  switch (status) {
    case "published":
      return "Live on the site";
    case "archived":
      return "Archived";
    default:
      return "Draft — not visible";
  }
}

/** What the status means for the public page, in a sentence. */
export function galleryStatusHint(status: GalleryStatus): string {
  switch (status) {
    case "published":
      return "Anyone visiting the gallery can see this photo.";
    case "archived":
      return "Hidden, and kept out of the running order. Nothing is deleted.";
    default:
      return "Only staff can see this photo. Publish it to put it on the site.";
  }
}

/** A file size a person can read. */
export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes <= 0) {
    return "";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The dimensions shown under a thumbnail, e.g. "2400 × 1600". */
export function formatDimensions(width: number | null, height: number | null): string {
  return width && height ? `${width} × ${height}` : "";
}

/**
 * Where a newly uploaded photo should sit in the running order.
 *
 * The end of the list, so a batch upload arrives in the order it was chosen and an
 * organiser can then move things about — rather than every upload fighting over 0.
 */
export function nextSortOrder(existing: readonly { sortOrder: number }[]): number {
  return existing.reduce((highest, item) => Math.max(highest, item.sortOrder), -1) + 1;
}

/** Counts for the panel's summary line. */
export function gallerySummary(items: readonly { status: GalleryStatus; byteSize: number | null }[]): {
  total: number;
  published: number;
  drafts: number;
  archived: number;
  bytes: number;
} {
  return {
    total: items.length,
    published: items.filter((item) => item.status === "published").length,
    drafts: items.filter((item) => item.status === "draft").length,
    archived: items.filter((item) => item.status === "archived").length,
    bytes: items.reduce((total, item) => total + (item.byteSize ?? 0), 0),
  };
}
