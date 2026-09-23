import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getSupabasePublicEnv, isSupabaseConfigured } from "@/config/env";
import type { Database } from "@/types/database";

/**
 * Read-only Supabase client for public content.
 *
 * Uses the **anon key only** and never touches cookies or sessions, so every
 * statement runs through the Row Level Security policies: an anonymous visitor
 * can read published events, their nights, active pass categories and published
 * gallery rows — and nothing else. The service-role key is not reachable from
 * here (it lives in `./admin.ts`, which is guarded by `server-only`).
 *
 * Memoised because a page render calls several services in parallel.
 */
let publicClient: SupabaseClient<Database> | undefined;

export function isDatabaseConfigured(): boolean {
  return isSupabaseConfigured();
}

export function getPublicClient(): SupabaseClient<Database> {
  if (!publicClient) {
    const { url, anonKey } = getSupabasePublicEnv();

    publicClient = createClient<Database>(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }

  return publicClient;
}
