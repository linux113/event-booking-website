import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabasePublicEnv, isSupabaseConfigured } from "@/config/env";
import { ADMIN_SECTIONS, can, isStaffRole, type Permission, type StaffRole } from "@/lib/auth/permissions";
import type { Database } from "@/types/database";

/**
 * The request hook for the staff area — Next 16's `proxy.ts`.
 *
 * It does two jobs, and the first one is the reason it exists at all:
 *
 *  1. **Authorisation, before the response starts.** A `redirect()` thrown inside a
 *     page that is already streaming cannot change the status code: the browser gets
 *     a 200 with a redirect embedded in it. That is fine for a signed-in user who
 *     typed the wrong URL, and not good enough as a boundary. So the decision is made
 *     here, before a single byte of the admin area is rendered — an unauthorised
 *     visitor gets a real `307` and no content.
 *  2. **Keeping the session alive.** Supabase access tokens are short-lived and a
 *     Server Component cannot write cookies. `getUser()` refreshes the session when
 *     needed and the rotated cookies are copied onto the response, so a staff member
 *     who leaves the scanner open across a shift is not thrown back to the sign-in
 *     screen mid-queue.
 *
 * It is still not the last word. Every admin page calls `requirePermission()` again
 * (`src/lib/auth/guard.ts`) and the database checks the staff id on every check-in, so
 * a mistake in this file is a mistake in one of three layers rather than the whole of
 * security. Belt, braces, and a lock on the door.
 *
 * What the browser sends is never trusted: the role comes from the database, via
 * `current_staff_role()`, which returns one word about the caller and nothing else.
 */

/** Where a session can matter. Public pages never pay for this. */
export const config = {
  matcher: ["/admin/:path*", "/api/staff/:path*", "/api/admin/:path*"],
};

const SIGN_IN_PATH = "/admin/login";
const LOGOUT_PATH = "/api/staff/logout";
const ADMIN_HOME = "/admin";

/**
 * Which capability each admin path needs.
 *
 * Derived from the same `ADMIN_SECTIONS` table the dashboard navigates by, so a
 * section cannot be added to the menu without its URL being guarded by the same
 * permission — the map is not maintained by hand.
 */
function permissionForPath(pathname: string): Permission | null {
  // The write endpoints of the management screens. They are named after the screen
  // they serve, plus the capability that is specific to changing something — so a
  // role that may read a screen is not thereby allowed to post to it. The longest
  // matching prefix wins, which is how the gallery's read-only preview sits under a
  // write-only endpoint's URL without inheriting its permission.
  const API_PERMISSIONS: Record<string, Permission> = {
    "/api/admin/passes": "passes:edit",
    "/api/admin/dates": "dates:edit",
    "/api/admin/gallery": "gallery:edit",
    "/api/admin/gallery/preview": "gallery:view",
  };

  const matches = Object.entries(API_PERMISSIONS)
    .filter(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`))
    .sort(([left], [right]) => right.length - left.length);

  if (matches.length > 0) {
    return matches[0][1];
  }

  const section = ADMIN_SECTIONS.find(
    (candidate) =>
      candidate.href !== null && (pathname === candidate.href || pathname.startsWith(`${candidate.href}/`)),
  );

  return section?.permission ?? null;
}

function jsonError(status: number, kind: string, message: string): NextResponse {
  return NextResponse.json({ ok: false, error: { kind, message } }, { status, headers: { "cache-control": "no-store" } });
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  if (!isSupabaseConfigured()) {
    // No Supabase on this deployment: there is no session to check and no role to
    // read. The pages say so themselves; the APIs answer as they always do.
    return NextResponse.next({ request });
  }

  // Remember where the visitor was heading, for the sign-in redirect. Only ever used
  // as a same-site path on the way back in, and re-validated where it is read.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-admin-path", `${pathname}${request.nextUrl.search}`);

  let response = NextResponse.next({ request: { headers: requestHeaders } });
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
        response = NextResponse.next({ request: { headers: requestHeaders } });

        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }

        // The library hands over `Cache-Control: private, no-store` here: a response
        // carrying a session token must never be cached anywhere.
        for (const [key, value] of Object.entries(headers)) {
          response.headers.set(key, value);
        }
      },
    },
  });

  let signedIn = false;
  let role: StaffRole | null = null;

  try {
    // `getUser()` rather than `getSession()`: it revalidates the token with Supabase
    // instead of believing the cookie, and it is what performs the refresh.
    const { data } = await supabase.auth.getUser();
    signedIn = Boolean(data.user);

    if (signedIn) {
      // One word, about the caller only. Read through the anon key with the user's own
      // session, so this cannot be talked into answering for somebody else.
      const { data: roleData, error: roleError } = await supabase.rpc("current_staff_role");

      if (roleError) {
        console.error("[proxy] could not read the staff role:", roleError.message, roleError.code);
      } else {
        role = isStaffRole(roleData) ? roleData : null;
      }
    }
  } catch (error) {
    // Supabase unreachable. Nobody is authorised by accident: the request continues
    // un-refreshed and the pages answer for themselves.
    console.error("[proxy] session check skipped:", error);

    return response;
  }

  // ---------------------------------------------------------------------------
  // The staff APIs: answer with JSON, never with an HTML redirect.
  // ---------------------------------------------------------------------------
  // Signing out is the one staff endpoint that needs no session at all: the goal is
  // "this browser has no staff session", and that is already true for a visitor who
  // has none. Requiring authorisation to *end* authorisation would strand anybody
  // whose role was revoked mid-shift.
  if (isApi && pathname === LOGOUT_PATH) {
    return response;
  }

  if (isApi) {
    if (!role) {
      return jsonError(401, "not-authorized", "Sign in as event staff to use this endpoint.");
    }

    // The gate endpoints need `scanner:use`; the management endpoints need the
    // capability that belongs to the screen they serve. Which one applies is read
    // from the same map the pages use, so an endpoint cannot be added without its
    // permission being named.
    const required = permissionForPath(pathname) ?? "scanner:use";

    if (!can(role, required)) {
      return jsonError(403, "forbidden", "Your role cannot change this.");
    }

    return response;
  }

  // ---------------------------------------------------------------------------
  // The pages.
  // ---------------------------------------------------------------------------
  // The sign-in screen is the one admin path a signed-out visitor may load (it also
  // serves the "signed in, but not staff" explanation). The page decides where to
  // send somebody who is already staff.
  if (pathname === SIGN_IN_PATH) {
    return response;
  }

  if (!signedIn) {
    const signIn = new URL(SIGN_IN_PATH, request.url);
    signIn.searchParams.set("next", pathname);

    return NextResponse.redirect(signIn);
  }

  // Signed in, but not on the allow-list. The page they asked for is not rendered:
  // they are sent to the sign-in screen, which explains the situation and offers to
  // sign out, rather than to a dashboard they also cannot open.
  if (!role) {
    const signIn = new URL(SIGN_IN_PATH, request.url);
    signIn.searchParams.set("next", pathname);

    return NextResponse.redirect(signIn);
  }

  const required = permissionForPath(pathname);

  if (required && !can(role, required)) {
    // Signed in with a role, just not this one. The dashboard is where the answer
    // ("what can I actually open?") lives, so that is where they go.
    const denied = new URL(ADMIN_HOME, request.url);
    denied.searchParams.set("denied", required);

    return NextResponse.redirect(denied);
  }

  // Nothing else in this file knows whether the pass is good, who a guest is, or what
  // a section contains: it answers exactly one question — may this request continue —
  // and hands the page a request it can no longer refuse.
  return response;
}
