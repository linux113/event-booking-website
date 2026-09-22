/**
 * A very small Supabase Auth (GoTrue) double, for the test harness.
 *
 * WHY THIS EXISTS
 *   The staff scanner is protected by real Supabase Auth: `signInWithPassword`
 *   exchanges an email and password for a session, and every later request proves
 *   who it is with that session's access token. Without a Supabase project there is
 *   no `/auth/v1` to talk to, so the *client* code path — supabase-js building the
 *   request, `@supabase/ssr` storing the session in cookies, the server reading it
 *   back — would never be exercised at all.
 *
 *   This stub implements the four endpoints that path uses and nothing else:
 *
 *     POST /auth/v1/token?grant_type=password        email + password → session
 *     POST /auth/v1/token?grant_type=refresh_token   refresh token → session
 *     GET  /auth/v1/user                             access token → user
 *     POST /auth/v1/logout                           revokes the session
 *
 * WHAT THIS IS NOT
 *   It is not GoTrue, and it is not a security control. It never checks a password
 *   hash, it signs nothing, and the "JWT" it mints is a base64 payload with a
 *   placeholder signature. It exists so the harness can hold a realistic session,
 *   and it is never shipped: only `scripts/` import it.
 *
 *   Accounts are supplied by the caller (see `verify-web.mjs`), which is also what
 *   makes the interesting case testable — a perfectly valid Auth user who is *not*
 *   on the `admin_users` allow-list must still be refused by the app.
 */

const ACCESS_TOKEN_SECONDS = 3600;
const REFRESH_TOKEN_SECONDS = 30 * 24 * 3600;

/** A JWT-shaped token: header.payload.signature, with real claims and no signing. */
function token(claims) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(claims)}.auth-stub-signature`;
}

function decode(token) {
  const [, payload] = String(token ?? "").split(".");

  if (!payload) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function bearerToken(headers) {
  const raw = headers.authorization ?? headers.Authorization ?? "";

  return decode(String(raw).replace(/^Bearer\s+/i, ""));
}

/**
 * @param {object} options
 * @param {Array<{ id: string, email: string, password: string, userMetadata?: object }>} options.accounts
 *   The users this stub knows about. `id` must be the uuid the database sees as
 *   `admin_users.user_id`.
 */
export function createAuthStub({ accounts = [], log = false } = {}) {
  const byEmail = new Map(accounts.map((account) => [account.email.toLowerCase(), account]));
  const byId = new Map(accounts.map((account) => [account.id, account]));

  /**
   * Sessions that have been signed out of.
   *
   * GoTrue revokes a session's refresh token on logout, so the access token stops
   * being accepted. That is the security property a shared device depends on — a
   * cookie copied off a gate phone must die when the shift ends — so the stub models
   * it rather than pretending every token lives until it expires.
   */
  const revokedSessions = new Set();

  const now = () => Math.floor(Date.now() / 1000);
  const iso = () => new Date().toISOString();

  function userFor(account) {
    return {
      id: account.id,
      aud: "authenticated",
      role: "authenticated",
      email: account.email,
      email_confirmed_at: iso(),
      phone: "",
      confirmed_at: iso(),
      last_sign_in_at: iso(),
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: account.userMetadata ?? {},
      identities: [],
      created_at: iso(),
      updated_at: iso(),
      is_anonymous: false,
    };
  }

  /**
   * A session id, fresh for every sign-in.
   *
   * GoTrue issues a new session on every sign-in, and that is what makes revoking one
   * harmless to the others: signing a gate phone out must not end the shift manager's
   * session, and signing in again must produce a session that works. A per-user id
   * would model neither — the second sign-in would inherit the first one's death.
   */
  let sessionCounter = 0;

  function sessionFor(account) {
    sessionCounter += 1;
    const sessionId = `stub-session-${account.id}-${sessionCounter}`;

    return {
      access_token: token({
        sub: account.id,
        email: account.email,
        role: "authenticated",
        aud: "authenticated",
        type: "access",
        session_id: sessionId,
        iat: now(),
        exp: now() + ACCESS_TOKEN_SECONDS,
      }),
      token_type: "bearer",
      expires_in: ACCESS_TOKEN_SECONDS,
      expires_at: now() + ACCESS_TOKEN_SECONDS,
      refresh_token: token({
        sub: account.id,
        type: "refresh",
        session_id: sessionId,
        iat: now(),
        exp: now() + REFRESH_TOKEN_SECONDS,
      }),
      user: userFor(account),
    };
  }

  const unauthorized = () => ({
    status: 401,
    body: { code: "bad_jwt", message: "invalid JWT: unable to parse or verify signature" },
  });

  return {
    /** The accounts this stub will accept, for the harness to echo in its output. */
    accounts,
    /** Sessions ended by a sign-out — used by the harness to assert a cookie died. */
    revokedSessions,

    /**
     * @returns {Promise<{ status: number, body: unknown }>}
     *   The shim writes `body` as JSON (and writes no body at all for 204).
     */
    async handle({ method, pathname, searchParams, headers, body }) {
      if (log) {
        console.log(`  → auth-stub: ${method} ${pathname}${searchParams?.toString() ? `?${searchParams}` : ""}`);
      }

      if (pathname === "/auth/v1/token" && method === "POST") {
        const grantType = searchParams?.get("grant_type") ?? "password";

        if (grantType === "password") {
          const email = String(body?.email ?? "").toLowerCase();
          const account = byEmail.get(email);

          if (!account || account.password !== body?.password) {
            // GoTrue answers 400 with this exact shape for a wrong pair.
            return { status: 400, body: { code: "invalid_credentials", message: "Invalid login credentials" } };
          }

          return { status: 200, body: sessionFor(account) };
        }

        if (grantType === "refresh_token") {
          const claims = decode(body?.refresh_token);
          const account = claims?.sub ? byId.get(claims.sub) : null;

          if (!account || revokedSessions.has(claims.session_id)) {
            return unauthorized();
          }

          return { status: 200, body: sessionFor(account) };
        }

        return { status: 400, body: { code: "unsupported_grant_type", message: `grant_type ${grantType}` } };
      }

      if (pathname === "/auth/v1/user" && method === "GET") {
        const claims = bearerToken(headers);
        const account = claims?.sub ? byId.get(claims.sub) : null;

        if (
          !account ||
          (claims.exp ?? 0) < now() ||
          claims.type !== "access" ||
          revokedSessions.has(claims.session_id)
        ) {
          return unauthorized();
        }

        return { status: 200, body: userFor(account) };
      }

      if (pathname === "/auth/v1/logout" && method === "POST") {
        const claims = bearerToken(headers);

        if (claims?.session_id) {
          revokedSessions.add(claims.session_id);
        }

        return { status: 204, body: null };
      }

      if (pathname === "/auth/v1/settings" && method === "GET") {
        return { status: 200, body: { external: { email: true }, disable_signup: true } };
      }

      return { status: 404, body: { code: "not_found", message: `auth stub has no route for ${method} ${pathname}` } };
    },
  };
}
