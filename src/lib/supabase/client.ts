import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabasePublicEnv } from "@/config/env";
import type { Database } from "@/types/database";

/**
 * Supabase client for browser code (client components, hooks).
 *
 * Uses the **anon key only**, so every query is subject to Row Level Security —
 * a browser session can read published events but can never insert a booking or
 * read someone else's pass. The service-role key is intentionally not reachable
 * from here (it lives in `./admin.ts`, which is server-only).
 *
 * Memoised so hot reloads and multiple components share one client.
 *
 * Note: this client cannot see the staff session. Session cookies are HttpOnly
 * (`./cookies.ts`), and signing in happens through the server action in
 * `src/app/admin/actions.ts` — which is why nothing in the app imports this module
 * today. Use it for public data (RLS still applies), not for anything that needs the
 * signed-in user.
 */
let browserClient: SupabaseClient<Database> | undefined;

export function createSupabaseBrowserClient(): SupabaseClient<Database> {
  if (!browserClient) {
    const { url, anonKey } = getSupabasePublicEnv();

    browserClient = createBrowserClient<Database>(url, anonKey);
  }

  return browserClient;
}
