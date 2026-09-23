/**
 * Result type shared by every service call.
 *
 * Services never throw: a page or component always receives either data or a
 * typed error it can render. That keeps a database outage (or a missing
 * configuration) from turning into a 500, and lets `next build` complete even
 * when Supabase is unreachable.
 */

export type ServiceErrorKind =
  /** NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY are not set. */
  | "not-configured"
  /** The query ran but the row does not exist. */
  | "not-found"
  /** The query failed (network, permissions, bad SQL…). */
  | "query-failed";

export interface ServiceError {
  kind: ServiceErrorKind;
  /** Safe to show in the UI: never contains SQL, tokens or connection details. */
  message: string;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: ServiceError };

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function fail<T>(kind: ServiceErrorKind, message: string): Result<T> {
  return { ok: false, error: { kind, message } };
}

/**
 * Logs the real error server-side and returns a generic message for the UI.
 * Postgres/Supabase errors can include table names, so they are never rendered.
 */
export function failFromPostgrest<T>(error: { message: string; code?: string }, context: string): Result<T> {
  console.error(`[services] ${context}:`, error.message, error.code ? `(${error.code})` : "");

  return fail<T>("query-failed", "We could not load this content right now.");
}
