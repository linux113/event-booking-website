import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabasePublicEnv, isSupabaseConfigured } from "@/config/env";
import type { Database } from "@/types/database";

/**
 * Session refresh for the staff area (Next.js request hook — `proxy.ts`).
 *
 * Supabase access tokens are short-lived. A staff member who leaves the scanner
 * open across a shift must not be thrown back to the sign-in screen, and a check-in
 * must never be refused because a token expired ninety seconds ago. Both are the
 * same problem: somebody has to exchange the refresh-token cookie for a new access
 * token, and a Server Component is not allowed to write cookies.
 *
 * So this runs *before* every staff route, calls `getUser()` — which refreshes the
 * session when needed — and copies any rotated cookies onto the response.
 *
 * It also short-circuits the obvious case: a visitor with no session is sent to the
 * sign-in screen instead of rendering a staff page and bouncing afterwards. That
 * redirect is a courtesy for the user, **not** the access control: the pages and
 * route handlers check the session again, and the database checks the staff id on
 * every check-in. Anything decided only out here would be decoration.
 */

/** Where a session can matter. Public pages never pay for this. */
export const config = {
  matcher: ["/admin/:path*", "/api/staff/:path*"],
};

const SIGN_IN_PATH = "/admin/login";

export async function proxy(request: NextRequest): Promise<NextResponse> {
  if (!isSupabaseConfigured()) {
    // No Supabase on this deployment: there is no session to refresh, and the
    // staff routes report that themselves.
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const { url, anonKey } = getSupabasePublicEnv();

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }

        // Rebuild the response so the request that reaches the page carries the
        // refreshed cookies as well as the browser.
        response = NextResponse.next({ request });

        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }

        // The library hands over `Cache-Control: private, no-store` here: a
        // response carrying a session token must never be cached anywhere.
        for (const [key, value] of Object.entries(headers)) {
          response.headers.set(key, value);
        }
      },
    },
  });

  let email: string | null = null;

  try {
    const { data } = await supabase.auth.getUser();
    email = data.user?.email ?? null;
  } catch (error) {
    // Supabase unreachable: let the request through un-refreshed. Pages ask for a
    // sign-in rather than the whole staff area going down.
    console.error("[proxy] session refresh skipped:", error);
    return response;
  }

  const { pathname } = request.nextUrl;

  // API routes answer with JSON (401), never with an HTML redirect.
  if (pathname.startsWith("/api/")) {
    return response;
  }

  if (!email && pathname !== SIGN_IN_PATH) {
    const signIn = new URL(SIGN_IN_PATH, request.url);
    // Where to come back to once they are signed in — a path, never a full URL, so
    // a crafted link cannot bounce somebody to another site.
    signIn.searchParams.set("next", pathname);

    return NextResponse.redirect(signIn);
  }

  // Note what is *not* here: signing in is not the same as being staff. Someone
  // with a Supabase account who is not on the `admin_users` allow-list is bounced
  // by the pages themselves, which can ask the database — this hook cannot.
  return response;
}
