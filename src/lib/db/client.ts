import "server-only";

import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * The one database client.
 *
 * Everything that touches the database goes through here, and this module is
 * `server-only`: importing it from a client component is a build error, not a
 * runtime surprise. The browser never sees a connection string, never opens a
 * connection, and cannot reach the database at all.
 *
 * How it connects
 *   Through Neon's serverless driver adapter, over the pooled connection string
 *   in `DATABASE_URL`. That is the string with `-pooler` in the host: serverless
 *   functions open and close connections constantly, and the pooler is what makes
 *   that cheap instead of exhausting the database's connection limit.
 *
 *   Schema work is different — it wants the *direct* string. That is not this
 *   file's business: `npm run db:setup` takes the direct URL for the run and uses
 *   it for migrations only.
 *
 * Why a singleton
 *   Next re-evaluates modules on every hot reload in development, and a new
 *   PrismaClient per reload means a new pool per reload until the database stops
 *   answering. Caching on `globalThis` gives one client per process — in
 *   production the module is evaluated once anyway, so this only matters locally.
 *
 * Why lazy
 *   A missing `DATABASE_URL` must not make the site throw on import; the app has
 *   a "database is not connected yet" state that has to render instead (see
 *   `isDatabaseConfigured`). The client is therefore built on first use, not on
 *   import.
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * The connection string, or null when the app has not been configured yet.
 *
 * `channel_binding=require` is stripped. It is a libpq option — Neon's dashboard
 * writes it into the connection string it hands you — and it means nothing to a
 * Node driver. Some drivers forward unknown URL parameters into the PostgreSQL
 * startup packet, and the server rejects any parameter it does not recognise, so
 * the connection dies before it is made. `scripts/setup-database.mjs` strips it
 * for the same reason. TLS still applies: Neon always speaks it.
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
 * The client, created on first use.
 *
 * Throws `DatabaseNotConfiguredError` when there is no connection string — catch
 * that, or check `isDatabaseConfigured()` first, wherever the UI needs the
 * friendly "not connected yet" message rather than a 500.
 */
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

/**
 * Calls a database function with `$queryRaw`, exactly as the SQL defines it.
 *
 * The booking flow, the check-in verdict and the admin read models are 51
 * PostgreSQL functions; they are where capacity, pricing, idempotency and the
 * double-check-in guarantee actually live, and they are deliberately not
 * reimplemented in TypeScript. Prisma Client does CRUD; this does the functions.
 *
 * Tagged-template usage keeps the parameters bound, never interpolated:
 *
 *   const [booking] = await sql<BookingRow[]>`
 *     select * from public.create_pending_booking(
 *       ${eventId}::uuid, ${dateId}::uuid, ${passId}::uuid, ${name}, ${mobile},
 *       ${quantity}::integer, ${people}::integer, ${idempotencyKey}::text
 *     )`;
 */
export function sql<T = unknown>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<T> {
  return getDb().$queryRaw<T>(strings, ...values);
}
