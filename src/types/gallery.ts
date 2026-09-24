/**
 * The gallery's view shapes: one photograph as the management screen sees it, the
 * form that edits its words, and what an upload reports back.
 *
 * These are *view* shapes — camelCase, no `snake_case` columns, no storage keys
 * leaking into components — and they are the same shapes the route handler, the
 * server service and the verification harness speak. The database's own shapes live
 * in `src/types/database.ts`, and the public site's lighter `GalleryItem` lives in
 * `src/types/index.ts`.
 */

import type { CatalogueError, CatalogueResult } from "@/types/catalogue";

/** The three states a photograph can be in. There is no fourth. */
export const GALLERY_STATUSES = ["draft", "published", "archived"] as const;

export type GalleryStatus = (typeof GALLERY_STATUSES)[number];

/** True for a status the database will accept. */
export function isGalleryStatus(value: unknown): value is GalleryStatus {
  return typeof value === "string" && (GALLERY_STATUSES as readonly string[]).includes(value);
}

/** One row of the management list. */
export interface AdminGalleryItem {
  id: string;
  eventId: string | null;
  album: string | null;
  title: string | null;
  description: string | null;
  altText: string;
  mediaType: "image" | "video";
  status: GalleryStatus;
  /** Object key of the stored full image, or null for externally hosted media. */
  storagePath: string | null;
  thumbnailPath: string | null;
  width: number | null;
  height: number | null;
  byteSize: number | null;
  capturedOn: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  /** True when the public site is allowed to list this row's media. */
  isPublic: boolean;
  /** Set when the media lives somewhere else (a video on a CDN). */
  url: string | null;
  thumbnailUrl: string | null;
}

/**
 * What the edit form sends.
 *
 * Every value is a string or a number exactly as a form control holds it: the
 * browser validates with this, the route handler runs the same parse on what it
 * received, and the database has the last word either way.
 */
export interface GalleryFormValues {
  /** Null when the form is editing an existing photograph. */
  id: string | null;
  title: string;
  description: string;
  altText: string;
  album: string;
  /** `YYYY-MM-DD`, or empty for "not recorded". */
  capturedOn: string;
  sortOrder: number;
}

export type GalleryFormErrors = Partial<Record<keyof GalleryFormValues, string>>;

/** What an upload produced, and what it refused. */
export interface GalleryUploadOutcome {
  uploaded: AdminGalleryItem[];
  /** One sentence per file that could not be taken, in the order they were chosen. */
  refused: {
    fileName: string;
    message: string;
    /** Error class lets a wholly refused batch keep the right HTTP status. */
    kind?: CatalogueError["kind"];
  }[];
}

/** `POST /api/admin/gallery` with a JSON body speaks these three actions. */
export type GalleryAction =
  | { action: "save"; item: unknown }
  | { action: "status"; id: string; status: GalleryStatus }
  | { action: "move"; id: string; direction: "up" | "down" }
  | { action: "delete"; id: string };

/** The endpoints answer the same contract the pass and date forms do. */
export type GalleryResult<T> = CatalogueResult<T>;
export type GalleryError = CatalogueError;
