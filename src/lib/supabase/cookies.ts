/**
 * The options every Supabase session cookie is written with.
 *
 * The library's default is `httpOnly: false`, which is the right default for an app
 * whose browser client reads the session out of `document.cookie`. This app never
 * does: sign-in, the silent refresh (`src/proxy.ts`) and sign-out all happen on the
 * server, and no client component imports `@/lib/supabase/client`. So the session is
 * set HttpOnly — a script running on the page cannot read the token, which is the
 * difference between an XSS being a bad afternoon and an XSS handing over a
 * 400-day refresh token.
 *
 * `sameSite: "lax"` stays as the library sets it. Together with every mutation being
 * a POST that the server re-authorises, it is what stops a cross-site form post from
 * carrying a session.
 *
 * Both server clients must use this object: `createServerClient` merges it over its
 * defaults (`{ ...DEFAULT_COOKIE_OPTIONS, ...cookieOptions }`), so a JWT rotated by
 * one and read by the other stays consistent — including its attributes.
 */
export const SESSION_COOKIE_OPTIONS = {
  path: "/",
  sameSite: "lax",
  httpOnly: true,
} as const;
