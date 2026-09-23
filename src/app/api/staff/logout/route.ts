import { NextResponse, type NextRequest } from "next/server";

import { ADMIN_SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";

/**
 * POST /api/staff/logout — end the admin session.
 *
 * Clears the `gn_admin` cookie (and any leftover legacy auth cookies from
 * older deployments), then sends the browser to the sign-in screen with a 303
 * so the redirect is followed as a GET.
 *
 * POST only, plain HTML form friendly — works with JavaScript disabled.
 * Signing out when already signed out is a success, not an error.
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

  const response = NextResponse.redirect(new URL(destination, request.url), 303);

  const { maxAge: _maxAge, ...clear } = sessionCookieOptions();
  response.cookies.set(ADMIN_SESSION_COOKIE, "", { ...clear, maxAge: 0, expires: new Date(0) });

  // Belt and braces: drop any leftover legacy auth cookies from prior deploys.
  for (const cookie of request.cookies.getAll()) {
    if (cookie.name.startsWith("sb-") && cookie.name.includes("auth-token")) {
      response.cookies.set(cookie.name, "", { path: "/", expires: new Date(0) });
    }
  }

  response.headers.set("cache-control", "private, no-store");

  return response;
}
