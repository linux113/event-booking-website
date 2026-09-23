import { NextResponse, type NextRequest } from "next/server";

import { isAdminAuthConfigured } from "@/config/env";
import { ADMIN_SESSION_COOKIE, readSessionValue } from "@/lib/auth/session";

/**
 * The request hook for the admin area — Next 16's `proxy.ts`.
 *
 * One job, done before the response starts: **decide whether this request may
 * continue**. A `redirect()` thrown inside a streaming page cannot change the
 * status code; here an unauthorised visitor gets a real 307/401 and no content.
 *
 * Authentication is the signed `gn_admin` cookie (HMAC under AUTH_SECRET).
 * There are no roles: a valid session is the admin.
 */

export const config = {
  matcher: ["/admin/:path*", "/api/staff/:path*", "/api/admin/:path*"],
};

const SIGN_IN_PATH = "/admin/login";
const LOGOUT_PATH = "/api/staff/logout";

function jsonError(status: number, kind: string, message: string): NextResponse {
  return NextResponse.json(
    { ok: false, error: { kind, message } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  if (!isAdminAuthConfigured()) {
    // No admin credentials on this deployment: pages say so themselves; APIs 401.
    return NextResponse.next({ request });
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-admin-path", `${pathname}${request.nextUrl.search}`);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  const cookie = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const signedIn = readSessionValue(cookie);

  // Signing out needs no session: "this browser has no admin session" is already
  // true for a visitor who has none.
  if (isApi && pathname === LOGOUT_PATH) {
    return response;
  }

  if (isApi) {
    if (!signedIn) {
      return jsonError(401, "not-authorized", "Sign in as the administrator to use this endpoint.");
    }

    return response;
  }

  // The sign-in screen is the one admin path a signed-out visitor may load.
  if (pathname === SIGN_IN_PATH) {
    return response;
  }

  if (!signedIn) {
    const signIn = new URL(SIGN_IN_PATH, request.url);
    signIn.searchParams.set("next", pathname);

    return NextResponse.redirect(signIn);
  }

  return response;
}
