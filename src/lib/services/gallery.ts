import { isDatabaseConfigured } from "@/config/env";
import { DatabaseError, sql } from "@/lib/db/client";
import { publicGalleryUrl } from "@/lib/gallery/paths";
import { toGalleryItem } from "@/lib/services/mappers";
import { fail, failFromPostgrest, ok, type Result } from "@/lib/services/result";
import type { GalleryItem } from "@/types";
import type { GalleryRow } from "@/types/database";

/**
 * Gallery data access.
 *
 * Only `status = 'published'` rows are listed. Public URLs come from Vercel
 * Blob (or an externally hosted `url` on the row).
 */
export async function listPublishedGallery(eventId?: string): Promise<Result<GalleryItem[]>> {
  if (!isDatabaseConfigured()) {
    return fail<GalleryItem[]>(
      "not-configured",
      "The database is not connected yet. Add DATABASE_URL to the environment.",
    );
  }

  try {
    const rows = eventId
      ? await sql<GalleryRow[]>`
          select * from public.gallery
          where status = 'published' and event_id = ${eventId}::uuid
          order by sort_order asc, created_at desc
          limit 24
        `
      : await sql<GalleryRow[]>`
          select * from public.gallery
          where status = 'published'
          order by sort_order asc, created_at desc
          limit 24
        `;

    return ok(rows.map(toGalleryItem).filter((item): item is GalleryItem => item !== null));
  } catch (error) {
    const normalised =
      error instanceof DatabaseError
        ? { message: error.message, code: error.code }
        : { message: String(error) };
    return failFromPostgrest(normalised, "listPublishedGallery");
  }
}

// Re-export for mappers that need the URL builder in scope during tests.
export { publicGalleryUrl };
