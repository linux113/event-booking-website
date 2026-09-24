import "server-only";

import { isDatabaseConfigured } from "@/config/env";
import {
  adminHeroImagePreviewUrl,
  HERO_IMAGE_MAX_STORED_BYTES,
} from "@/lib/admin/hero-image";
import { DatabaseError, sql } from "@/lib/db/client";
import { fail, ok, type Result } from "@/lib/services/result";
import type { CatalogueResult } from "@/types/catalogue";
import type { HeroImageSettingsState } from "@/types/event-settings";

export interface StoredHeroImage {
  bytes: Buffer;
  version: string;
}

interface HeroImageMetaRow {
  id: string;
  version: string;
  byte_size: number | null;
}

function notConfigured<T>(): CatalogueResult<T> {
  return {
    ok: false,
    error: {
      kind: "not-configured",
      message: "Homepage hero uploads need the Neon database connection to be configured.",
    },
  };
}

function writeFailure<T>(context: string, error: unknown): CatalogueResult<T> {
  const dbError = error instanceof DatabaseError ? error : new DatabaseError(String(error));
  console.error(`[hero image] ${context} failed:`, dbError.message, dbError.code ?? "");

  if (dbError.code === "23514") {
    return {
      ok: false,
      error: {
        kind: "invalid-input",
        message: `That image exceeds the database's ${Math.round(HERO_IMAGE_MAX_STORED_BYTES / (1024 * 1024))} MiB WebP limit. Choose a smaller image.`,
        field: "file",
      },
    };
  }

  return {
    ok: false,
    error: { kind: "server-error", message: "The homepage hero image could not be saved right now." },
  };
}

function settingsState(row: HeroImageMetaRow, hasImage: boolean): HeroImageSettingsState {
  return {
    hasImage,
    byteSize: row.byte_size === null ? null : Number(row.byte_size),
    version: row.version,
    previewUrl: hasImage ? adminHeroImagePreviewUrl(row.id, row.version) : null,
  };
}

/** Replace the selected event's homepage hero with already-optimized WebP bytes. */
export async function saveHeroImage(bytes: Buffer): Promise<CatalogueResult<HeroImageSettingsState>> {
  if (!isDatabaseConfigured()) return notConfigured();

  try {
    const rows = await sql<HeroImageMetaRow[]>`
      update public.events
      set
        hero_image_data = ${bytes},
        hero_image_url = null,
        hero_image_version = hero_image_version + 1,
        updated_at = now()
      where id = (
        select id from public.events
        order by (status = 'published') desc, created_at asc
        limit 1
      )
      returning
        id,
        hero_image_version::text as version,
        octet_length(hero_image_data)::int as byte_size
    `;

    if (!rows[0]) {
      return {
        ok: false,
        error: { kind: "server-error", message: "There is no event row available to update." },
      };
    }

    return { ok: true, data: settingsState(rows[0], true) };
  } catch (error) {
    return writeFailure("save", error);
  }
}

/** Remove the custom artwork; the homepage then renders its built-in diya design. */
export async function removeHeroImage(): Promise<CatalogueResult<HeroImageSettingsState>> {
  if (!isDatabaseConfigured()) return notConfigured();

  try {
    const rows = await sql<HeroImageMetaRow[]>`
      update public.events
      set
        hero_image_data = null,
        hero_image_url = null,
        hero_image_version = hero_image_version + 1,
        updated_at = now()
      where id = (
        select id from public.events
        order by (status = 'published') desc, created_at asc
        limit 1
      )
      returning
        id,
        hero_image_version::text as version,
        null::int as byte_size
    `;

    if (!rows[0]) {
      return {
        ok: false,
        error: { kind: "server-error", message: "There is no event row available to update." },
      };
    }

    return { ok: true, data: settingsState(rows[0], false) };
  } catch (error) {
    return writeFailure("remove", error);
  }
}

async function readHeroImage(eventId: string, publishedOnly: boolean): Promise<Result<StoredHeroImage>> {
  if (!isDatabaseConfigured()) {
    return fail("not-configured", "The homepage hero image is not available until the database is configured.");
  }

  try {
    const rows = publishedOnly
      ? await sql<{ image_base64: string | null; version: string }[]>`
          select
            encode(hero_image_data, 'base64') as image_base64,
            hero_image_version::text as version
          from public.events
          where id = ${eventId}::uuid and status = 'published'
          limit 1
        `
      : await sql<{ image_base64: string | null; version: string }[]>`
          select
            encode(hero_image_data, 'base64') as image_base64,
            hero_image_version::text as version
          from public.events
          where id = ${eventId}::uuid
          limit 1
        `;

    const row = rows[0];
    if (!row?.image_base64) {
      return fail("not-found", "This event does not have a saved hero image.");
    }

    return ok({ bytes: Buffer.from(row.image_base64, "base64"), version: row.version });
  } catch (error) {
    const dbError = error instanceof DatabaseError ? error : new DatabaseError(String(error));
    console.error("[hero image] read failed:", dbError.message, dbError.code ?? "");
    return fail("query-failed", "The homepage hero image could not be loaded right now.");
  }
}

/** Public images are only served for published events. */
export function readPublishedHeroImage(eventId: string): Promise<Result<StoredHeroImage>> {
  return readHeroImage(eventId, true);
}

/** Admin preview can also read the selected event while it is still a draft. */
export function readAdminHeroImage(eventId: string): Promise<Result<StoredHeroImage>> {
  return readHeroImage(eventId, false);
}
