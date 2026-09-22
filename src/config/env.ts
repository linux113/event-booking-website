/**
 * Environment configuration.
 *
 * Rules for this file:
 * - Never read `process.env` directly anywhere else in the app — import from here so
 *   every variable has one documented home.
 * - Never throw at module scope. Values are resolved lazily so a missing secret only
 *   fails the request/feature that actually needs it (and never breaks `next build`).
 * - `NEXT_PUBLIC_*` values are inlined into the client bundle at build time. Anything
 *   without that prefix must only ever be read from server code.
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
