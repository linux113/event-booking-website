/**
 * Environment configuration.
 *
 * Rules for this file:
 * - Never read `process.env` directly anywhere else in the app — import from here
 *   so every variable has one documented home.
 * - Never throw at module scope. Values are resolved lazily so a missing secret
 *   only fails the request/feature that actually needs it, and never breaks
 *   `next build`.
 * - `NEXT_PUBLIC_*` values are inlined into the client bundle at build time.
 *   Anything without that prefix must only ever be read from server code.
 *
 * Variable names must match `.env.example`. Values are created by you in the
 * Supabase and Razorpay dashboards — none of them are ever committed or invented
 * by the code.
 */

/** Throws a descriptive error when a required variable is missing or empty. */
export function requireEnv(name: string, value: string | undefined): string {
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable "${name}". ` +
        `Copy .env.example to .env.local and fill it in (see README.md).`,
    );
  }

  return value;
}

/** Vercel exposes the deployment URL at build time; fall back to it when unset locally. */
function resolveSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();

  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }

  const vercelUrl = process.env.VERCEL_URL?.trim();

  if (vercelUrl) {
    return `https://${vercelUrl}`;
  }

  return "http://localhost:3000";
}

/**
 * Public base URL of the deployment. Safe to use on the client, in metadata,
 * for absolute URLs in share links and (later) for Razorpay callbacks.
 */
export const siteUrl = resolveSiteUrl();

/**
 * Browser-safe Supabase credentials: the project URL and the *anon* key.
 *
 * The anon key is public by design — it ships in the client bundle and Row Level
 * Security policies decide what it can actually read or write. Access control is
 * never done by hiding this key.
 */
export function getSupabasePublicEnv(): { url: string; anonKey: string } {
  return {
    url: requireEnv("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
    anonKey: requireEnv(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ),
  };
}

/**
 * Server-only Supabase service-role key. Bypasses Row Level Security, so it must
 * never reach the browser: only import `src/lib/supabase/admin.ts`, which is
 * guarded by the `server-only` package.
 */
export function getSupabaseServiceRoleKey(): string {
  return requireEnv("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * True when the public Supabase variables are present. Lets pages render an
 * empty state instead of crashing before the project is configured.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim(),
  );
}

/**
 * Razorpay key id (public — it opens Checkout in the browser). The matching
 * secret and webhook secret are server-only and are read where they are used,
 * in `src/lib/payments/`, so they cannot be bundled into a page by accident.
 */
export function getRazorpayKeyId(): string {
  return requireEnv("NEXT_PUBLIC_RAZORPAY_KEY_ID", process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID);
}

export function getRazorpayKeySecret(): string {
  return requireEnv("RAZORPAY_KEY_SECRET", process.env.RAZORPAY_KEY_SECRET);
}

export function getRazorpayWebhookSecret(): string {
  return requireEnv("RAZORPAY_WEBHOOK_SECRET", process.env.RAZORPAY_WEBHOOK_SECRET);
}
