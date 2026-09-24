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
 * Neon, Razorpay and Vercel dashboards — none of them are ever committed or
 * invented by the code.
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
 * for absolute URLs in share links and for Razorpay callbacks.
 */
export const siteUrl = resolveSiteUrl();

/**
 * True when a database connection string is present.
 *
 * This is the app's single "is the data store connected?" gate. Pages and APIs
 * branch on it and render an honest not-configured state instead of crashing —
 * which is also what lets `next build` complete before env vars are set.
 */
export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

/**
 * True when the single-admin credentials are present (email + password hash +
 * AUTH_SECRET). Sign-in is refused (not crashed) when they are not.
 */
export function isAdminAuthConfigured(): boolean {
  return Boolean(
    adminEmail() &&
      (process.env.ADMIN_PASSWORD?.trim() || process.env.ADMIN_PASSWORD_HASH?.trim()) &&
      process.env.AUTH_SECRET?.trim(),
  );
}

/**
 * Admin sign-in email. Preferred name is `ADMIN_EMAIL`; `ADMIN_USERNAME` is
 * accepted as a fallback so older env setups keep working.
 */
export function adminEmail(): string | undefined {
  return process.env.ADMIN_EMAIL?.trim() || process.env.ADMIN_USERNAME?.trim() || undefined;
}

/** Razorpay key id (public — it opens Checkout in the browser). */
export function getRazorpayKeyId(): string {
  return requireEnv("NEXT_PUBLIC_RAZORPAY_KEY_ID", process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID);
}

export function getRazorpayKeySecret(): string {
  return requireEnv("RAZORPAY_KEY_SECRET", process.env.RAZORPAY_KEY_SECRET);
}

export function getRazorpayWebhookSecret(): string {
  return requireEnv("RAZORPAY_WEBHOOK_SECRET", process.env.RAZORPAY_WEBHOOK_SECRET);
}

/**
 * Base URL of the Razorpay API.
 *
 * Not part of `.env.example`: production always uses Razorpay's official API.
 */
export function getRazorpayApiBaseUrl(): string {
  const configured = process.env.RAZORPAY_API_BASE_URL?.trim();

  return (configured || "https://api.razorpay.com").replace(/\/+$/, "");
}

/** True when a key id and key secret are both present, i.e. checkout can open. */
export function isRazorpayConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID?.trim() && process.env.RAZORPAY_KEY_SECRET?.trim(),
  );
}

/** Live payments stay disabled until they are switched on deliberately. */
export function isLiveRazorpayAllowed(): boolean {
  return process.env.RAZORPAY_ALLOW_LIVE?.trim().toLowerCase() === "true";
}

/** Which mode the public key id belongs to, from its prefix. */
export function getPublicPaymentMode(): "test" | "live" | null {
  const keyId = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID?.trim().toLowerCase() ?? "";

  if (keyId.startsWith("rzp_test_")) {
    return "test";
  }

  if (keyId.startsWith("rzp_live_")) {
    return "live";
  }

  return null;
}

/** True when a Vercel Blob token is present (gallery upload/storage). */
export function isBlobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}
