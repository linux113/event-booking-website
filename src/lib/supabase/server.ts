import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { getSupabasePublicEnv } from "@/config/env";
import { SESSION_COOKIE_OPTIONS } from "@/lib/supabase/cookies";
import type { Database } from "@/types/database";

/**
 * Supabase client for server code (server components, server actions, route
 * handlers) that acts **as the signed-in user**.
 *
 * Still the anon key: RLS applies, and the user's session cookie decides what
 * they may see. Use `./admin.ts` only when a genuine RLS bypass is required
 * (creating bookings, verifying Razorpay payments).
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient<Database>> {
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabasePublicEnv();

  return createServerClient<Database>(url, anonKey, {
    // HttpOnly, same-site session cookies — see ./cookies.ts.
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. Session refreshes still happen
          // in middleware/proxy, so this is safe to ignore here.
        }
      },
    },
  });
}
