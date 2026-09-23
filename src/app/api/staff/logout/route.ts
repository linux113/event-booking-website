import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * POST /api/staff/logout — end the staff session.
 *
 * A route handler rather than a server action, because signing out is the one thing
 * that must work even when the page it is called from is in a strange state: it
 * clears the Supabase session cookies server-side, then sends the browser to the
 * sign-in screen with a 303 so the redirect is followed as a GET.
 *
 * POST only, and it redirects rather than returning JSON, because the caller is a
 * plain HTML form (`SignOutButton`) — which means it also works with JavaScript
 * disabled, and there is no client-side session left behind in memory.
 *
 * Signing out when already signed out is a success, not an error: the goal is "this
 * browser has no staff session", and that is true either way.
 */

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

/** A same-site path only, so a crafted form cannot bounce somebody off-site. */
function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/admin/login";
  }

  return value;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const destination = safeNext(request.nextUrl.searchParams.get("next"));

  try {
    const supabase = await createSupabaseServerClient();

    // `scope: "global"` revokes the refresh token as well, so the session cannot be
    // resumed from a copy of the cookie. This is what a shared gate phone needs.
    const { error } = await supabase.auth.signOut({ scope: "global" });

    if (error) {
      // Not fatal: the cookies are cleared below either way, and the local session
      // is what this browser trusts.
      console.error("[auth] sign-out call failed:", error.message);
    }
  } catch (error) {
    console.error("[auth] sign-out unavailable:", error);
  }

  const response = NextResponse.redirect(new URL(destination, request.url), 303);

  // Belt and braces: drop every Supabase auth cookie on the response as well, in
  // case the cookie adapter above could not write through (a cached or read-only
  // cookie store), so a shared device cannot keep the session alive.
  for (const cookie of request.cookies.getAll()) {
    if (cookie.name.startsWith("sb-") && cookie.name.includes("auth-token")) {
      response.cookies.set(cookie.name, "", { path: "/", expires: new Date(0) });
    }
  }

  response.headers.set("cache-control", "private, no-store");

  return response;
}
