import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getSupabasePublicEnv, getSupabaseServiceRoleKey } from "@/config/env";
import type { Database } from "@/types/database";

/**
 * Service-role Supabase client — **bypasses Row Level Security**.
 *
 * `import "server-only"` makes the build fail if this module is ever pulled into
 * a client component, and the key is read from a non-`NEXT_PUBLIC_` variable so
 * it can never be inlined into the browser bundle. Treat every call as
 * privileged and validate input before using it.
 *
 * Legitimate uses:
 *   - creating a booking + its pass after the payment signature is verified
 *   - Razorpay webhook handlers
 *   - scheduled maintenance jobs
 *
 * Never: reading data for a page render, or anything triggered directly by
 * unvalidated client input. Use `./server.ts` (user session) or `./client.ts`
 * for that.
 */
export function createSupabaseAdminClient(): SupabaseClient<Database> {
  const { url } = getSupabasePublicEnv();

  return createClient<Database>(url, getSupabaseServiceRoleKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
