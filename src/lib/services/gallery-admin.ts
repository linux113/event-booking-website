import "server-only";

import { refusalFromDatabase } from "@/lib/admin/catalogue";
import { titleFromFileName } from "@/lib/admin/gallery";
import { bucketForStatus, galleryObjectKey, isPublicStatus } from "@/lib/gallery/paths";
import { prepareGalleryImage } from "@/lib/gallery/images";
import { getAdminClient } from "@/lib/services/admin-client";
import { fail, failFromPostgrest, ok, type Result } from "@/lib/services/result";
import type { CatalogueResult } from "@/types/catalogue";
import type { AdminGalleryItem, GalleryFormValues, GalleryStatus } from "@/types/gallery";

/**
 * The gallery's data access — the only place that touches both the table and the
 * buckets.
 *
 * Three rules run through every function here.
 *
 * **The row decides where the file lives.** `status = 'published'` means the object
 * belongs in the public bucket; anything else means the private one. A photograph is
 * uploaded into the private bucket and moved when it is published, so a draft is not
 * a hidden row pointing at a public URL — it is a file no browser can fetch.
 *
 * **The database is asked first, storage second.** Publishing flips the row and then
 * moves the object; deleting removes the row and then the files. If storage is slow
 * or fails, the row is still the truth, and the failure is logged rather than
 * pretended away — an orphaned object costs a few kilobytes, a row pointing at a
 * deleted file is a broken picture on the public page.
 *
 * **Nothing is written by a table update.** Every change goes through a
 * `service_role` function that re-validates it and raises PG001–PG011; this module's
 * job is to translate those codes into the field to highlight, and to keep storage in
 * step with what the database decided.
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
    isPublic: isPublicStatus(status),
    url: row.url,
    thumbnailUrl: row.thumbnail_url,
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
      message: "The database is not connected yet, so the gallery cannot be changed. Add the Supabase keys to the environment.",
    },
  };
}

function refused<T>(context: string, error: { message: string; code?: string; details?: string }): WriteOutcome<T> {
  console.error(`[gallery] ${context} refused:`, error.message, error.code ?? "", error.details ?? "");

  return { ok: false, error: refusalFromDatabase(error) };
}

/** Every row of the (or an) event, in the running order the public grid uses. */
export async function listGalleryItems(): Promise<Result<AdminGalleryItem[]>> {
  const client = getAdminClient();

  if (!client.ok) {
    return fail<AdminGalleryItem[]>("not-configured", client.error.message);
  }

  const { data, error } = await client.client.rpc("admin_gallery_items", { p_event_id: null });

  if (error) {
    return failFromPostgrest(error, "listGalleryItems");
  }

  return ok(((data ?? []) as GalleryRow[]).map(toItem));
}

/** The event a new upload belongs to: the published one, or the oldest. */
async function defaultEventId(client: ReturnType<typeof getAdminClient>): Promise<string | null> {
  if (!client.ok) {
    return null;
  }

  const { data, error } = await client.client.rpc("admin_default_event_id");

  if (error) {
    console.error("[gallery] could not read the default event:", error.message);

    return null;
  }

  return typeof data === "string" ? data : null;
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
 * Take one upload: optimise it, store it privately, and record the row.
 *
 * The order is deliberate. The image is optimised before anything is written, so a
 * file that cannot be processed never reaches a bucket. The objects go into the
 * *private* bucket, because a row starts as a draft — publishing is a separate,
 * deliberate act. If the row cannot be written, the objects just uploaded are
 * removed again, so a refused upload does not leave litter behind.
 */
export async function uploadGalleryItem(input: UploadGalleryInput): Promise<WriteOutcome<AdminGalleryItem>> {
  const client = getAdminClient();

  if (!client.ok) {
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
  const eventId = await defaultEventId(client);
  const storagePath = galleryObjectKey(id, "full", eventId);
  const thumbnailPath = galleryObjectKey(id, "thumb", eventId);
  const bucket = bucketForStatus("draft");

  const uploads = await Promise.all([
    client.client.storage.from(bucket).upload(storagePath, image.full.data, {
      contentType: image.full.contentType,
      // A year: the key contains the item's id, so a replaced file gets a new key
      // rather than new bytes behind an old URL.
      cacheControl: "31536000",
      upsert: false,
    }),
    client.client.storage.from(bucket).upload(thumbnailPath, image.thumb.data, {
      contentType: image.thumb.contentType,
      cacheControl: "31536000",
      upsert: false,
    }),
  ]);

  const failed = uploads.find((result) => result.error);

  if (failed?.error) {
    console.error("[gallery] upload to storage failed:", failed.error.message);

    // Clean up whatever half of the pair did land.
    await client.client.storage.from(bucket).remove([storagePath, thumbnailPath]);

    return {
      ok: false,
      error: {
        kind: "server-error",
        message: "The photo could not be stored. Nothing was saved — please try again.",
      },
    };
  }

  const { data, error } = await client.client.rpc("admin_add_gallery_item", {
    p_id: id,
    p_event_id: eventId,
    p_storage_path: storagePath,
    p_thumbnail_path: thumbnailPath,
    p_media_type: "image",
    p_width: image.full.width,
    p_height: image.full.height,
    p_byte_size: image.full.byteSize,
    p_title: input.title?.trim() || titleFromFileName(input.fileName),
    p_description: input.description?.trim() || null,
    p_alt_text: input.altText?.trim() || input.title?.trim() || titleFromFileName(input.fileName),
    p_album: input.album?.trim() || null,
    p_captured_on: null,
    p_sort_order: 0,
    p_status: "draft",
  });

  if (error) {
    // The row is the record of the file. Without it, the objects must not stay.
    await client.client.storage.from(bucket).remove([storagePath, thumbnailPath]);

    return refused("upload", error);
  }

  const [row] = (data ?? []) as { item_id: string; storage_path: string; item_status: string; sort_order: number; updated_at: string }[];

  if (!row?.item_id) {
    await client.client.storage.from(bucket).remove([storagePath, thumbnailPath]);

    return { ok: false, error: { kind: "server-error", message: "The photo was stored but not recorded. Please try again." } };
  }

  // Re-read the row so the caller gets the same shape the list returns, rather than
  // a partial one assembled here.
  const items = await listGalleryItems();
  const item = items.ok ? items.data.find((candidate) => candidate.id === row.item_id) : undefined;

  return saved(
    item ?? {
      id: row.item_id,
      eventId,
      album: input.album?.trim() || null,
      title: input.title?.trim() || titleFromFileName(input.fileName),
      description: input.description?.trim() || null,
      altText: input.altText?.trim() || titleFromFileName(input.fileName),
      mediaType: "image",
      status: "draft",
      storagePath: row.storage_path,
      thumbnailPath,
      width: image.full.width,
      height: image.full.height,
      byteSize: image.full.byteSize,
      capturedOn: null,
      sortOrder: Number(row.sort_order),
      createdAt: row.updated_at,
      updatedAt: row.updated_at,
      isPublic: false,
      url: null,
      thumbnailUrl: null,
    },
  );
}

/** Edit the words, the album and the position — never the file. */
export async function saveGalleryItem(values: GalleryFormValues): Promise<WriteOutcome<AdminGalleryItem>> {
  const client = getAdminClient();

  if (!client.ok) {
    return notConfigured();
  }

  const { error } = await client.client.rpc("admin_update_gallery_item", {
    p_id: values.id ?? "",
    p_title: values.title || null,
    p_description: values.description || null,
    p_alt_text: values.altText,
    p_album: values.album || null,
    p_captured_on: values.capturedOn || null,
    p_sort_order: values.sortOrder,
  });

  if (error) {
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
 * Publish, unpublish or archive one photograph — and move its files to match.
 *
 * The row changes first. If the file move then fails, the row and the bucket
 * disagree and the failure is logged with both keys, because the alternative (moving
 * the file first) would publish an object the row still calls a draft.
 */
export async function setGalleryItemStatus(
  id: string,
  status: GalleryStatus,
): Promise<WriteOutcome<{ id: string; status: GalleryStatus; moved: boolean }>> {
  const client = getAdminClient();

  if (!client.ok) {
    return notConfigured();
  }

  const { data, error } = await client.client.rpc("admin_set_gallery_status", { p_id: id, p_status: status });

  if (error) {
    return refused("status", error);
  }

  const [row] = (data ?? []) as {
    item_id: string;
    item_status: string;
    storage_path: string | null;
    thumbnail_path: string | null;
    was_public: boolean;
    is_public: boolean;
  }[];

  if (!row?.item_id) {
    return { ok: false, error: { kind: "server-error", message: "That photograph could not be found — reload the page." } };
  }

  const keys = [row.storage_path, row.thumbnail_path].filter((key): key is string => Boolean(key));

  if (row.was_public === row.is_public || keys.length === 0) {
    return saved({ id, status: row.item_status as GalleryStatus, moved: false });
  }

  const from = bucketForStatus(row.was_public ? "published" : "draft");
  const to = bucketForStatus(row.is_public ? "published" : "draft");
  const moves = await Promise.all(
    keys.map((key) => client.client.storage.from(from).move(key, key, { destinationBucket: to })),
  );
  const failure = moves.find((result) => result.error);

  if (failure?.error) {
    console.error(
      `[gallery] object move failed (${from} → ${to}, item ${id}):`,
      failure.error.message,
      keys.join(", "),
    );

    return {
      ok: false,
      error: {
        kind: "server-error",
        message: "The photo was updated, but its file could not be moved. Reload and try again.",
      },
    };
  }

  return saved({ id, status: row.item_status as GalleryStatus, moved: true });
}

/** Move one photograph one place up or down the running order. */
export async function moveGalleryItem(
  id: string,
  direction: "up" | "down",
): Promise<WriteOutcome<{ id: string; sortOrder: number; moved: boolean }>> {
  const client = getAdminClient();

  if (!client.ok) {
    return notConfigured();
  }

  const { data, error } = await client.client.rpc("admin_move_gallery_item", { p_id: id, p_direction: direction });

  if (error) {
    return refused("move", error);
  }

  const [row] = (data ?? []) as { item_id: string; sort_order: number; moved: boolean }[];

  if (!row?.item_id) {
    return { ok: false, error: { kind: "server-error", message: "That photograph could not be found — reload the page." } };
  }

  return saved({ id: row.item_id, sortOrder: Number(row.sort_order), moved: row.moved });
}

/**
 * Delete one photograph: the row first, then the files it named.
 *
 * A file that cannot be deleted is reported but not raised: the row is gone, so the
 * public page is already correct, and the orphaned object is a cleaning job rather
 * than a visitor-facing problem.
 */
export async function deleteGalleryItem(id: string): Promise<WriteOutcome<{ id: string; filesDeleted: number }>> {
  const client = getAdminClient();

  if (!client.ok) {
    return notConfigured();
  }

  const { data, error } = await client.client.rpc("admin_delete_gallery_item", { p_id: id });

  if (error) {
    return refused("delete", error);
  }

  const [row] = (data ?? []) as {
    item_id: string;
    storage_path: string | null;
    thumbnail_path: string | null;
    is_public: boolean;
    removed_paths: string[] | null;
  }[];

  if (!row?.item_id) {
    return { ok: false, error: { kind: "server-error", message: "That photograph could not be found — reload the page." } };
  }

  const keys = (row.removed_paths ?? []).filter((key): key is string => Boolean(key));

  if (keys.length === 0) {
    return saved({ id, filesDeleted: 0 });
  }

  const bucket = bucketForStatus(row.is_public ? "published" : "draft");
  const { error: storageError } = await client.client.storage.from(bucket).remove(keys);

  if (storageError) {
    console.error(`[gallery] object delete failed (${bucket}):`, storageError.message, keys.join(", "));

    return saved({ id, filesDeleted: 0 });
  }

  return saved({ id, filesDeleted: keys.length });
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
 * The point of this being a server call rather than a URL is that drafts live in a
 * private bucket: there is no public URL to put in an `<img>`, and handing the
 * browser a signed URL would put a working address for an unpublished photograph
 * into the page source. So the bytes come through the staff session, which is
 * already checked twice (the request hook and the route handler).
 */
export async function readGalleryPreview(
  id: string,
  variant: "thumb" | "full",
): Promise<Result<GalleryPreview>> {
  const client = getAdminClient();

  if (!client.ok) {
    return fail<GalleryPreview>("not-configured", client.error.message);
  }

  const { data, error } = await client.client
    .from("gallery")
    .select("status, storage_path, thumbnail_path")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return failFromPostgrest(error, "readGalleryPreview");
  }

  if (!data) {
    return fail<GalleryPreview>("not-found", "That photograph is no longer in the gallery.");
  }

  const path = variant === "thumb" ? data.thumbnail_path ?? data.storage_path : data.storage_path ?? data.thumbnail_path;

  if (!path) {
    return fail<GalleryPreview>("not-found", "That photograph has no stored file.");
  }

  const bucket = bucketForStatus(data.status);
  const { data: file, error: downloadError } = await client.client.storage.from(bucket).download(path);

  if (downloadError || !file) {
    console.error("[gallery] preview download failed:", downloadError?.message ?? "no file", `${bucket}/${path}`);

    return fail<GalleryPreview>("not-found", "That photograph's file could not be read.");
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  return ok({
    bytes,
    contentType: file.type || "image/webp",
    // Long enough that scrolling the grid does not re-download, short enough that an
    // organiser who replaces a photo sees the new one the same minute.
    maxAge: 60,
  });
}
