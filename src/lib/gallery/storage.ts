import "server-only";

import { put, del, list as blobList, head, type PutBlobResult } from "@vercel/blob";

import { isBlobConfigured } from "@/config/env";

/**
 * Object storage for gallery images — Vercel Blob.
 *
 * The schema stores the Blob **key** in `gallery.storage_path`; binaries never
 * belong in Neon. Public URLs come from the Blob store (`url` on put) and are
 * only exposed for published rows (see `gallery-admin.ts` / mappers).
 *
 * BLOB_READ_WRITE_TOKEN is server-only (Vercel injects it for Blob stores).
 */

export interface StoredObject {
  url: string;
  pathname: string;
}

export function isStorageConfigured(): boolean {
  return isBlobConfigured();
}

export async function putObject(
  key: string,
  data: Buffer | string,
  options: { contentType: string; addRandomSuffix?: boolean } = { contentType: "application/octet-stream" },
): Promise<StoredObject> {
  const result: PutBlobResult = await put(key, data, {
    access: "public",
    contentType: options.contentType,
    cacheControlMaxAge: 31536000,
  });

  return { url: result.url, pathname: result.pathname };
}

export async function deleteObject(key: string): Promise<void> {
  await del(key);
}

export async function downloadObject(key: string): Promise<{ bytes: Buffer; contentType: string }> {
  const info = await head(key);
  if (!info) {
    throw new Error(`Blob not found: ${key}`);
  }

  const response = await fetch(info.url);
  if (!response.ok) {
    throw new Error(`Blob download failed (${response.status}): ${key}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") ?? info.contentType ?? "application/octet-stream";

  return { bytes, contentType };
}

export async function objectExists(key: string): Promise<boolean> {
  try {
    const info = await head(key);
    return Boolean(info);
  } catch {
    return false;
  }
}

/** List keys under a prefix (admin hygiene / tests). */
export async function listObjects(prefix: string): Promise<{ pathname: string; url: string }[]> {
  const { blobs } = await blobList({ prefix });
  return blobs.map((blob) => ({ pathname: blob.pathname, url: blob.url }));
}
