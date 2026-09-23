import { toGalleryItem } from "@/lib/services/mappers";
import { fail, failFromPostgrest, ok, type Result } from "@/lib/services/result";
import { getPublicClient, isDatabaseConfigured } from "@/lib/supabase/public";
import type { GalleryItem } from "@/types";

/**
 * Gallery data access.
 *
 * Only `status = 'published'` rows are readable by the anon role, so the query
 * does not need a status filter — but it still has one so the intent is obvious
 * and the query stays correct if the policy ever changes.
 */
export async function listPublishedGallery(eventId?: string): Promise<Result<GalleryItem[]>> {
  if (!isDatabaseConfigured()) {
    return fail<GalleryItem[]>(
      "not-configured",
      "The database is not connected yet. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to the environment.",
    );
  }

  let query = getPublicClient()
    .from("gallery")
    .select("*")
    .eq("status", "published")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(24);

  if (eventId) {
    query = query.eq("event_id", eventId);
  }

  const { data, error } = await query;

  if (error) {
    return failFromPostgrest(error, "listPublishedGallery");
  }

  // Rows without a publicly reachable URL are dropped rather than rendered broken.
  return ok(data.map(toGalleryItem).filter((item): item is GalleryItem => item !== null));
}
