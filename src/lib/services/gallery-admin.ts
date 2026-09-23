import "server-only";

import { refusalFromDatabase } from "@/lib/admin/catalogue";
import { titleFromFileName } from "@/lib/admin/gallery";
import { prepareGalleryImage } from "@/lib/gallery/images";
import { publicGalleryUrl } from "@/lib/gallery/paths";
import {
  deleteObject,
  downloadObject,
  isStorageConfigured,
  putObject,
  type StoredObject,
} from "@/lib/gallery/storage";
import { isDatabaseConfigured } from "@/config/env";
import { DatabaseError, rpc, sql } from "@/lib/db/client";
import { fail, ok, type Result } from "@/lib/services/result";
import type { CatalogueResult } from "@/types/catalogue";
import type { AdminGalleryItem, GalleryFormValues, GalleryStatus } from "@/types/gallery";

/**
 * The gallery's data access — the only place that touches both the table and
 * object storage (Vercel Blob).
 *
 * **The row decides whether a file is public.** Blobs live under unguessable
 * keys; only `status = 'published'` rows expose a URL through the public
 * gallery and mappers. Draft previews stream through the admin preview route.
 *
 * **The database is asked first, storage second.** Publishing flips the row;
 * deleting removes the row then the files. A failed delete is logged — an
 * orphaned object beats a row pointing at a deleted file.
 */

type WriteOutcome<T> = CatalogueResult<T>;

interface GalleryRow {
  item_id: string;
  event_id: string | null;
  album: string | null;
  title: string | null;
  description: string | null;
  alt_text: string;
  media_type: string;
  storage_path: string | null;
  thumbnail_path: string | null;
  url: string | null;
  thumbnail_url: string | null;
  width: number | null;
  height: number | null;
  byte_size: number | null;
  captured_on: string | null;
  item_status: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  total_count: number;
}

function toItem(row: GalleryRow): AdminGalleryItem {
  const status = (row.item_status ?? "draft") as GalleryStatus;
  const isPublic = status === "published";

  return {
    id: row.item_id,
    eventId: row.event_id,
    album: row.album,
    title: row.title,
    description: row.description,
    altText: row.alt_text,
    mediaType: row.media_type === "video" ? "video" : "image",
    status,
    storagePath: row.storage_path,
    thumbnailPath: row.thumbnail_path,
    width: row.width === null ? null : Number(row.width),
    height: row.height === null ? null : Number(row.height),
    byteSize: row.byte_size === null ? null : Number(row.byte_size),
    capturedOn: row.captured_on,
    sortOrder: Number(row.sort_order),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isPublic,
    url: isPublic ? row.url ?? (row.storage_path ? publicGalleryUrl(row.storage_path) : null) : null,
    thumbnailUrl: isPublic
      ? row.thumbnail_url ??
        (row.thumbnail_path ? publicGalleryUrl(row.thumbnail_path) : row.storage_path ? publicGalleryUrl(row.storage_path) : null)
      : null,
  };
}

function saved<T>(data: T): WriteOutcome<T> {
  return { ok: true, data };
}

function notConfigured<T>(): WriteOutcome<T> {
  return {
    ok: false,
    error: {
      kind: "not-configured",
      message: "The database is not connected yet, so the gallery cannot be changed. Add DATABASE_URL.",
    },
  };
}

function refused<T>(context: string, error: unknown): WriteOutcome<T> {
  const normalised =
    error instanceof DatabaseError
      ? { message: error.message, code: error.code, details: error.details }
      : { message: String(error) };
  console.error(`[gallery] ${context} refused:`, normalised.message, normalised.code ?? "");
  return { ok: false, error: refusalFromDatabase(normalised) };
}

function toDbError(error: unknown): DatabaseError {
  return error instanceof DatabaseError ? error : new DatabaseError(String(error));
}

/** Every row of the event, in the running order the public grid uses. */
export async function listGalleryItems(): Promise<Result<AdminGalleryItem[]>> {
  if (!isDatabaseConfigured()) {
    return fail("not-configured", "The gallery needs the database: add DATABASE_URL.");
  }

  try {
    const rows = await sql<GalleryRow[]>`
      select
        g.id as item_id,
        g.event_id,
        g.album,
        g.title,
        g.description,
        g.alt_text,
        g.media_type,
        g.storage_path,
        g.thumbnail_path,
        g.url,
        null::text as thumbnail_url,
        g.width,
        g.height,
        g.byte_size,
        g.captured_on,
        g.status as item_status,
        g.sort_order,
        g.created_at,
        g.updated_at,
        count(*) over()::int as total_count
      from public.gallery g
      order by g.sort_order asc, g.created_at desc
      limit 500
    `;
    return ok(rows.map(toItem));
  } catch (error) {
    const dbError = toDbError(error);
    console.error("[gallery] list failed:", dbError.message, dbError.code ?? "");
    return fail("query-failed", "We could not load the gallery right now.");
  }
}

/** The event a new upload belongs to: the published one, or the oldest. */
async function defaultEventId(): Promise<string | null> {
  if (!isDatabaseConfigured()) return null;
  try {
    const rows = await sql<{ id: string | null }[]>`select public.admin_default_event_id() as id`;
    return rows[0]?.id ?? null;
  } catch (error) {
    console.error("[gallery] could not read the default event:", error);
    return null;
  }
}

export interface UploadGalleryInput {
  bytes: Buffer;
  contentType: string;
  fileName: string;
  title?: string;
  description?: string;
  altText?: string;
  album?: string;
}

/**
 * Take one upload: optimise it, store it, and record the row.
 *
 * Order: optimise → upload both variants → insert the draft row → re-read.
 * If the insert fails, the objects are removed so a refused upload leaves no litter.
 */
export async function uploadGalleryItem(input: UploadGalleryInput): Promise<WriteOutcome<AdminGalleryItem>> {
  if (!isDatabaseConfigured()) {
    return notConfigured();
  }

  if (!isStorageConfigured()) {
    return {
      ok: false,
      error: {
        kind: "not-configured",
        message: "Gallery storage is not configured. Add BLOB_READ_WRITE_TOKEN (Vercel Blob).",
      },
    };
  }

  const prepared = await prepareGalleryImage({ bytes: input.bytes, contentType: input.contentType });

  if (!prepared.ok) {
    return {
      ok: false,
      error: { kind: "invalid-input", message: prepared.error.message, field: prepared.error.field },
    };
  }

  const image = prepared.image;
  const id = crypto.randomUUID();
  const eventId = await defaultEventId();
  // Key prefix embeds the item id — keys are not guessable and are stable for this item.
  const storagePath = `gallery/${id}/full.webp`;
  const thumbnailPath = `gallery/${id}/thumb.webp`;

  let fullUpload: StoredObject;
  let thumbUpload: StoredObject;

  try {
    [fullUpload, thumbUpload] = await Promise.all([
      putObject(storagePath, image.full.data, { contentType: image.full.contentType }),
      putObject(thumbnailPath, image.thumb.data, { contentType: image.thumb.contentType }),
    ]);
  } catch (error) {
    console.error("[gallery] upload to storage failed:", error);
    return {
      ok: false,
      error: {
        kind: "server-error",
        message: "The photo could not be stored. Nothing was saved — please try again.",
      },
    };
  }

  try {
    await sql`
      insert into public.gallery (
        id, event_id, media_type, storage_path, thumbnail_path, url,
        width, height, byte_size, title, description, alt_text, album,
        captured_on, sort_order, status
      ) values (
        ${id}::uuid,
        ${eventId}::uuid,
        'image',
        ${storagePath},
        ${thumbnailPath},
        ${fullUpload.url},
        ${image.full.width},
        ${image.full.height},
        ${image.full.byteSize},
        ${input.title?.trim() || titleFromFileName(input.fileName)},
        ${input.description?.trim() || null},
        ${input.altText?.trim() || input.title?.trim() || titleFromFileName(input.fileName)},
        ${input.album?.trim() || null},
        null::date,
        0,
        'draft'
      )
      returning id
    `;
  } catch (error) {
    await Promise.allSettled([deleteObject(storagePath), deleteObject(thumbnailPath)]);
    return refused("upload", error);
  }

  const items = await listGalleryItems();
  const item = items.ok ? items.data.find((candidate) => candidate.id === id) : undefined;

  if (!item) {
    return { ok: false, error: { kind: "server-error", message: "The photo was stored but not recorded. Please try again." } };
  }

  return saved(item);
}

/** Edit the words, the album and the position — never the file. */
export async function saveGalleryItem(values: GalleryFormValues): Promise<WriteOutcome<AdminGalleryItem>> {
  if (!isDatabaseConfigured()) {
    return notConfigured();
  }

  try {
    await sql`
      update public.gallery set
        title = ${values.title || null},
        description = ${values.description || null},
        alt_text = ${values.altText},
        album = ${values.album || null},
        captured_on = ${values.capturedOn || null}::date,
        sort_order = ${values.sortOrder},
        updated_at = now()
      where id = ${values.id ?? ""}::uuid
    `;
  } catch (error) {
    return refused("save", error);
  }

  const items = await listGalleryItems();
  const item = items.ok ? items.data.find((candidate) => candidate.id === values.id) : undefined;

  if (!item) {
    return { ok: false, error: { kind: "server-error", message: "The change was saved but could not be read back." } };
  }

  return saved(item);
}

/**
 * Publish, unpublish or archive one photograph.
 *
 * Blobs do not move between buckets (single store); only the row status flips.
 * The public gallery only lists published rows, so a draft disappears from the
 * site as soon as the status changes.
 */
export async function setGalleryItemStatus(
  id: string,
  status: GalleryStatus,
): Promise<WriteOutcome<{ id: string; status: GalleryStatus; moved: boolean }>> {
  if (!isDatabaseConfigured()) {
    return notConfigured();
  }

  try {
    await sql`
      update public.gallery set status = ${status}, updated_at = now()
      where id = ${id}::uuid
      returning id
    `;
  } catch (error) {
    return refused("status", error);
  }

  return saved({ id, status, moved: true });
}

/** Move one photograph one place up or down the running order. */
export async function moveGalleryItem(
  id: string,
  direction: "up" | "down",
): Promise<WriteOutcome<{ id: string; sortOrder: number; moved: boolean }>> {
  if (!isDatabaseConfigured()) {
    return notConfigured();
  }

  try {
    const rows = await rpc<{ item_id: string; sort_order: number; moved: boolean }>(
      "admin_move_gallery_item",
      { p_id: id, p_direction: direction },
    );
    const row = rows[0];

    if (!row?.item_id) {
      return { ok: false, error: { kind: "server-error", message: "That photograph could not be found — reload the page." } };
    }

    return saved({ id: row.item_id, sortOrder: Number(row.sort_order), moved: row.moved });
  } catch (error) {
    return refused("move", error);
  }
}

/**
 * Delete one photograph: the row first, then the files it named.
 * A file that cannot be deleted is logged; the row is already gone.
 */
export async function deleteGalleryItem(id: string): Promise<WriteOutcome<{ id: string; filesDeleted: number }>> {
  if (!isDatabaseConfigured()) {
    return notConfigured();
  }

  type DeleteRow = {
    item_id: string;
    storage_path: string | null;
    thumbnail_path: string | null;
    is_public: boolean;
    removed_paths: string[] | null;
  };

  let row: DeleteRow | undefined;

  try {
    const rows = await sql<DeleteRow[]>`
      with deleted as (
        delete from public.gallery
        where id = ${id}::uuid
        returning id, storage_path, thumbnail_path, status
      )
      select
        id as item_id,
        storage_path,
        thumbnail_path,
        (status = 'published') as is_public,
        array_remove(array[storage_path, thumbnail_path], null) as removed_paths
      from deleted
    `;
    row = rows[0];
  } catch (error) {
    return refused("delete", error);
  }

  if (!row?.item_id) {
    return { ok: false, error: { kind: "server-error", message: "That photograph could not be found — reload the page." } };
  }

  const keys = (row.removed_paths ?? []).filter((key): key is string => Boolean(key));
  if (keys.length === 0) {
    return saved({ id, filesDeleted: 0 });
  }

  if (!isStorageConfigured()) {
    return saved({ id, filesDeleted: 0 });
  }

  try {
    await Promise.all(keys.map((key) => deleteObject(key)));
    return saved({ id, filesDeleted: keys.length });
  } catch (error) {
    console.error(`[gallery] object delete failed:`, error, keys.join(", "));
    return saved({ id, filesDeleted: 0 });
  }
}

export interface GalleryPreview {
  bytes: Buffer;
  contentType: string;
  /** Seconds a browser may cache this. Short: the file can be replaced or deleted. */
  maxAge: number;
}

/**
 * Read one object so the management screen can show it.
 *
 * Drafts have no public URL in the page; bytes stream through this admin-only
 * route after the session check.
 */
export async function readGalleryPreview(
  id: string,
  variant: "thumb" | "full",
): Promise<Result<GalleryPreview>> {
  if (!isDatabaseConfigured()) {
    return fail("not-configured", "The gallery needs the database: add DATABASE_URL.");
  }

  let status: string;
  let storagePath: string | null;
  let thumbPath: string | null;

  try {
    const rows = await sql<{ status: string; storage_path: string | null; thumbnail_path: string | null }[]>`
      select status, storage_path, thumbnail_path from public.gallery where id = ${id}::uuid
    `;
    const data = rows[0];
    if (!data) {
      return fail("not-found", "That photograph is no longer in the gallery.");
    }
    status = data.status;
    storagePath = data.storage_path;
    thumbPath = data.thumbnail_path;
  } catch (error) {
    const dbError = toDbError(error);
    console.error("[gallery] preview row failed:", dbError.message);
    return fail("query-failed", "We could not load that photograph right now.");
  }

  const path = variant === "thumb" ? thumbPath ?? storagePath : storagePath ?? thumbPath;

  if (!path) {
    return fail("not-found", "That photograph has no stored file.");
  }

  if (!isStorageConfigured()) {
    return fail("not-configured", "Gallery storage is not configured yet.");
  }

  try {
    const file = await downloadObject(path);
    return ok({
      bytes: file.bytes,
      contentType: file.contentType || "image/webp",
      maxAge: 60,
    });
  } catch (error) {
    console.error(`[gallery] preview download failed:`, error, path);
    return fail("not-found", "That photograph's file could not be read.");
  }
}
