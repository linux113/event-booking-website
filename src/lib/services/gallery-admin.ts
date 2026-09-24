import "server-only";

import { refusalFromDatabase } from "@/lib/admin/catalogue";
import { titleFromFileName } from "@/lib/admin/gallery";
import { prepareGalleryImage } from "@/lib/gallery/images";
import { publicGalleryUrl } from "@/lib/gallery/paths";
import { isDatabaseConfigured } from "@/config/env";
import { DatabaseError, rpc, sql } from "@/lib/db/client";
import { fail, ok, type Result } from "@/lib/services/result";
import type { CatalogueResult } from "@/types/catalogue";
import type { AdminGalleryItem, GalleryFormValues, GalleryStatus } from "@/types/gallery";

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
    url: isPublic ? row.url ?? publicGalleryUrl(row.item_id, "full") : null,
    thumbnailUrl: isPublic
      ? row.thumbnail_url ?? publicGalleryUrl(row.item_id, "thumb")
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
        g.thumbnail_url,
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
 * Take one upload: optimise it and store bytes directly in database bytea columns.
 */
export async function uploadGalleryItem(input: UploadGalleryInput): Promise<WriteOutcome<AdminGalleryItem>> {
  if (!isDatabaseConfigured()) {
    return notConfigured();
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

  try {
    await sql`
      insert into public.gallery (
        id, event_id, media_type, image_data, thumbnail_data,
        width, height, byte_size, title, description, alt_text, album,
        captured_on, sort_order, status
      ) values (
        ${id}::uuid,
        ${eventId}::uuid,
        'image',
        ${image.full.data},
        ${image.thumb.data},
        ${image.full.width},
        ${image.full.height},
        ${image.full.byteSize},
        ${input.title?.trim() || titleFromFileName(input.fileName)},
        ${input.description?.trim() || null},
        ${input.altText?.trim() || input.title?.trim() || titleFromFileName(input.fileName)},
        ${input.album?.trim() || null},
        null::date,
        (
          select coalesce(max(g.sort_order) + 1, 0)
          from public.gallery g
          where g.event_id is not distinct from ${eventId}::uuid
        ),
        'draft'
      )
      returning id
    `;
  } catch (error) {
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
 */
export async function setGalleryItemStatus(
  id: string,
  status: GalleryStatus,
): Promise<WriteOutcome<{ id: string; status: GalleryStatus; moved: boolean }>> {
  if (!isDatabaseConfigured()) {
    return notConfigured();
  }

  try {
    const rows = await sql<{ id: string; status: string }[]>`
      update public.gallery set status = ${status}, updated_at = now()
      where id = ${id}::uuid
      returning id, status
    `;
    const row = rows[0];

    if (!row) {
      return {
        ok: false,
        error: { kind: "server-error", message: "That photograph could not be found — reload the page." },
      };
    }

    return saved({ id: row.id, status: row.status as GalleryStatus, moved: true });
  } catch (error) {
    return refused("status", error);
  }
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
 * Delete one photograph from the database.
 */
export async function deleteGalleryItem(
  id: string,
): Promise<WriteOutcome<{ id: string; filesDeleted: number; filesToDelete: number }>> {
  if (!isDatabaseConfigured()) {
    return notConfigured();
  }

  try {
    const rows = await sql<{ id: string }[]>`
      delete from public.gallery
      where id = ${id}::uuid
      returning id
    `;
    const row = rows[0];

    if (!row?.id) {
      return { ok: false, error: { kind: "server-error", message: "That photograph could not be found — reload the page." } };
    }

    return saved({ id, filesDeleted: 1, filesToDelete: 1 });
  } catch (error) {
    return refused("delete", error);
  }
}

export interface GalleryPreview {
  bytes: Buffer;
  contentType: string;
  maxAge: number;
}

/**
 * Read image bytes directly from Postgres bytea.
 */
async function readGalleryImageBytes(
  id: string,
  variant: "thumb" | "full",
  publishedOnly: boolean,
): Promise<Result<GalleryPreview>> {
  if (!isDatabaseConfigured()) {
    return fail("not-configured", "The gallery needs the database: add DATABASE_URL.");
  }

  try {
    const rows = publishedOnly
      ? variant === "thumb"
        ? await sql<{ image_base64: string | null }[]>`
            select
              encode(thumbnail_data, 'base64') as image_base64
            from public.gallery
            where id = ${id}::uuid and status = 'published'
            limit 1
          `
        : await sql<{ image_base64: string | null }[]>`
            select
              encode(image_data, 'base64') as image_base64
            from public.gallery
            where id = ${id}::uuid and status = 'published'
            limit 1
          `
      : variant === "thumb"
        ? await sql<{ image_base64: string | null }[]>`
            select
              encode(thumbnail_data, 'base64') as image_base64
            from public.gallery
            where id = ${id}::uuid
            limit 1
          `
        : await sql<{ image_base64: string | null }[]>`
            select
              encode(image_data, 'base64') as image_base64
            from public.gallery
            where id = ${id}::uuid
            limit 1
          `;

    const row = rows[0];
    if (!row?.image_base64) {
      return fail("not-found", "That photograph has no stored image data.");
    }

    return ok({
      bytes: Buffer.from(row.image_base64, "base64"),
      contentType: "image/webp",
      maxAge: 60,
    });
  } catch (error) {
    const dbError = toDbError(error);
    console.error("[gallery] read image bytes failed:", dbError.message, dbError.code ?? "");
    return fail("query-failed", "We could not load that photograph right now.");
  }
}

/**
 * Read one image for admin preview (including drafts).
 */
export function readGalleryPreview(
  id: string,
  variant: "thumb" | "full",
): Promise<Result<GalleryPreview>> {
  return readGalleryImageBytes(id, variant, false);
}

/**
 * Read one image for public serving (published rows only).
 */
export function readPublishedGalleryImage(
  id: string,
  variant: "thumb" | "full",
): Promise<Result<GalleryPreview>> {
  return readGalleryImageBytes(id, variant, true);
}
