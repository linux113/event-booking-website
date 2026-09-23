import "server-only";

import { isSupabaseConfigured } from "@/config/env";
import type { ServiceError } from "@/lib/services/result";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The one door to the admin database.
 *
 * Every admin read — the dashboard, the booking list, the payments and passes screens —
 * goes through this function, so there is a single place that decides what happens when
 * the service-role key is missing, and no read has its own idea about it. The client it
 * returns carries the service-role key, which is why this module imports `server-only`:
 * importing it from a client component is a build error rather than a leaked key.
 *
 * A missing configuration is an *answer*, not a crash: the pages render a "database not
 * connected" state, which is what lets `next build` complete on a deployment that has
 * not been given its environment variables yet.
 */

export const NOT_CONFIGURED: ServiceError = {
  kind: "not-configured",
  message: "The admin area needs the database: add the Supabase variables and try again.",
};

export function getAdminClient(): { ok: true; client: SupabaseClient<Database> } | { ok: false; error: ServiceError } {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: NOT_CONFIGURED };
  }

  try {
    return { ok: true, client: createSupabaseAdminClient() };
  } catch (error) {
    console.error("[admin] admin client unavailable:", error);

    return { ok: false, error: NOT_CONFIGURED };
  }
}
