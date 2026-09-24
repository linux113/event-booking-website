import "server-only";

import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "@/generated/prisma/client";
import { normaliseRows } from "@/lib/db/normalise";

/**
 * The one database client.
 *
 * Everything that touches the database goes through here: Prisma Client for CRUD,
 * and the `sql` / `rpc` helpers for the PostgreSQL functions where capacity,
 * pricing, idempotency and double-check-in guarantees actually live.
 *
 * How it connects
 *   Through Neon's serverless driver adapter, over the pooled connection string
 *   in `DATABASE_URL` (the host with `-pooler`). Schema work wants the *direct*
 *   string — that is `npm run db:setup`'s business, not this file's.
 *
 * Why a singleton
 *   Next re-evaluates modules on every hot reload in development; caching on
 *   `globalThis` gives one client per process.
 *
 * Why lazy
 *   A missing `DATABASE_URL` must not make the site throw on import; pages render
 *   a "database not connected" state (`isDatabaseConfigured`) instead.
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * The connection string, or null when the app has not been configured yet.
 *
 * `channel_binding=require` is stripped: it is a libpq option Neon's dashboard
 * writes into the URL, and some drivers forward unknown parameters into the
 * PostgreSQL startup packet, which the server then rejects.
 */
function connectionString(): string | null {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) return null;

  const cleaned = value
    .replace(/([?&])channel_binding=[^&]*/g, "$1")
    .replace(/[?&]$/, "")
    .replace("?&", "?");

  return cleaned.length > 0 ? cleaned : null;
}

/** True when a database connection string is present. */
export function isDatabaseConfigured(): boolean {
  return connectionString() !== null;
}

/** Raised when something asks for the database before it is configured. */
export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "DATABASE_URL is not set. Copy .env.example to .env.local and paste the " +
        "connection string from Neon (Project → Connect → the pooled string).",
    );
    this.name = "DatabaseNotConfiguredError";
  }
}

/**
 * A database error normalised for the service layer: SQLSTATE in `code`,
 * human detail in `details` (Prisma may surface these on `meta`).
 */
export class DatabaseError extends Error {
  readonly code: string | undefined;
  readonly details: string | undefined;
  readonly hint: string | undefined;

  constructor(message: string, options: { code?: string; details?: string; hint?: string } = {}) {
    super(message);
    this.name = "DatabaseError";
    this.code = options.code;
    this.details = options.details;
    this.hint = options.hint;
  }
}

export function toDatabaseError(error: unknown): DatabaseError {
  if (error instanceof DatabaseError) {
    return error;
  }

  if (error instanceof Error) {
    const source = error as Error & {
      code?: unknown;
      meta?: Record<string, unknown>;
      detail?: unknown;
      hint?: unknown;
    };

    const meta = source.meta ?? {};
    const adapterError = asRecord(meta.driverAdapterError);
    const adapterCause = asRecord(adapterError.cause);
    const code = [
      adapterCause.originalCode,
      adapterCause.code,
      meta.databaseErrorCode,
      meta.code,
      source.code,
    ].find((candidate): candidate is string => typeof candidate === "string");
    const details = [
      adapterCause.detail,
      adapterCause.details,
      source.detail,
      meta.detail,
      meta.details,
    ].find((candidate): candidate is string => typeof candidate === "string");
    const hint = [adapterCause.hint, source.hint, meta.hint].find(
      (candidate): candidate is string => typeof candidate === "string",
    );
    const message =
      (typeof adapterCause.message === "string" ? adapterCause.message : undefined) ?? source.message;

    return new DatabaseError(message, { code, details, hint });
  }

  return new DatabaseError(String(error));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/**
 * True when the failure is PostgreSQL's "column … does not exist" (SQLSTATE
 * 42703), regardless of how the driver adapter dressed the error. Optional
 * `column` narrows the message check so one migration's rollout window can
 * degrade specific reads (e.g. `site_content`) without hiding real errors.
 */
export function isMissingColumnError(error: unknown, column?: string): boolean {
  const dbError = toDatabaseError(error);
  if (dbError.code === "42703") return true;
  if (!column) return false;

  const haystack = [dbError.message, dbError.details].filter(Boolean).join(" · ");
  return new RegExp(`column .+${column}.+ does not exist`, "i").test(haystack);
}

/** The client, created on first use. Throws when DATABASE_URL is missing. */
export function getDb(): PrismaClient {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;

  const url = connectionString();
  if (!url) throw new DatabaseNotConfiguredError();

  const client = new PrismaClient({
    adapter: new PrismaNeon({ connectionString: url }),
  });

  globalForPrisma.prisma = client;
  return client;
}

/** Drop the cached client (tests / hot-reload edge cases). */
export function resetDb(): void {
  delete globalForPrisma.prisma;
}

/**
 * Tagged-template SQL — parameters stay bound, never interpolated.
 *
 *   const [row] = await sql<Row[]>`select * from public.events limit 1`;
 *
 * Also accepts a plain string + values (used by `rpc`): the text is still
 * parameterised via `$queryRawUnsafe`'s bind markers, never string-interpolated.
 *
 * Results pass through `normaliseRows`: Prisma hands `date` / `time` /
 * `timestamptz` columns back as JS `Date` objects, while every row type in
 * this app is written against the plain strings the previous data layer
 * returned (`2026-10-11`, `19:00:00`, ISO timestamps). Restoring that contract
 * here — the single exit point for every query — is what keeps `.slice()`,
 * `.localeCompare()` and the formatters downstream honest.
 */
export function sql<T = unknown>(
  strings: TemplateStringsArray | string,
  ...values: unknown[]
): Promise<T> {
  try {
    const result =
      typeof strings === "string"
        ? // Called with a plain query text (from rpc): bind via unsafe raw API.
          getDb().$queryRawUnsafe<T>(strings, ...(values as never[]))
        : getDb().$queryRaw<T>(strings, ...values);

    // Errors from the query itself are asynchronous, so the try/catch alone
    // never sees them: rejections must be normalised too, or the service
    // layer reads the driver's raw error (undefined `code`) — which is how a
    // missing column once broke every bundled page in production while admins
    // still thought the 42703 fallback covered it.
    return result.then(
      (rows) => normaliseRows(rows),
      (error: unknown) => Promise.reject(toDatabaseError(error)),
    );
  } catch (error) {
    return Promise.reject(toDatabaseError(error));
  }
}

/** Run the promise and rethrow failures as `DatabaseError`. */
export async function withDb<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw toDatabaseError(error);
  }
}

const FN_NAME = /^[a-z][a-z0-9_]*$/;

/**
 * Call a PostgreSQL function the way the SQL defines it — named arguments,
 * result as rows:
 *
 *   const rows = await rpc("get_event_night_availability", {
 *     p_event_id: eventId,
 *   });
 *
 * The function name is allowlisted by shape (identifier only); arguments are
 * always bound parameters.
 */
export async function rpc<T = Record<string, unknown>>(
  fn: string,
  params: Record<string, unknown> = {},
): Promise<T[]> {
  if (!FN_NAME.test(fn)) {
    throw new DatabaseError(`Refusing to call unknown function shape: ${fn}`);
  }

  const keys = Object.keys(params);
  const args = keys.map((name, index) => `${name} => $${index + 1}`).join(", ");
  const values = keys.map((name) => params[name]);
  const query = `select * from public.${fn}(${args})`;

  try {
    return await sql<T[]>(query, ...values);
  } catch (error) {
    throw toDatabaseError(error);
  }
}

/**
 * Call a function that returns a single scalar (not a row set).
 *
 * Postgres answers `select * from fn()` as `[{ value }]` for some drivers and
 * may raise `0A000` for the form variant — retry with `select fn() as value`.
 */
export async function rpcScalar<T = unknown>(
  fn: string,
  params: Record<string, unknown> = {},
): Promise<T | null> {
  if (!FN_NAME.test(fn)) {
    throw new DatabaseError(`Refusing to call unknown function shape: ${fn}`);
  }

  const keys = Object.keys(params);
  const args = keys.map((name, index) => `${name} => $${index + 1}`).join(", ");
  const values = keys.map((name) => params[name]);

  try {
    const rows = await sql<Record<string, unknown>[]>(
      `select * from public.${fn}(${args})`,
      ...values,
    );
    const row = rows[0];
    if (!row) return null;
    const value = row.value ?? Object.values(row)[0];
    return (value ?? null) as T | null;
  } catch (error) {
    const dbError = toDatabaseError(error);

    // 0A000 — feature not supported for the set-returning form of a scalar.
    if (dbError.code === "0A000") {
      try {
        const rows = await sql<Record<string, unknown>[]>(
          `select public.${fn}(${args}) as value`,
          ...values,
        );
        return (rows[0]?.value ?? null) as T | null;
      } catch (retryError) {
        throw toDatabaseError(retryError);
      }
    }

    throw dbError;
  }
}
