/**
 * A real PostgreSQL, on a real socket, in this process.
 *
 * PGlite is PostgreSQL compiled to WASM, and `@electric-sql/pglite-socket`
 * exposes it over the Postgres wire protocol on a TCP port. Anything that speaks
 * that protocol can connect to it — including Prisma.
 *
 * This test database applies the same PostgreSQL migration chain and seed used by
 * Neon. It exercises real queries, SQL functions, triggers and constraints without
 * opening a connection to the hosted database.
 *
 * What it is not: Neon. The wire transport (the driver adapter, pooler and TLS) is
 * not exercised here — only the SQL is.
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const REPO_ROOT = join(import.meta.dirname, "..", "..");

/**
 * Boots a PostgreSQL with the whole schema (and optionally the seed) applied,
 * listening on a TCP port.
 *
 * Returns `{ db, server, port, close() }`. `port` is what a driver adapter needs;
 * `db` is the in-process handle, for assertions that are easier in SQL.
 */
export async function startPostgres({ seed = true, port = 0 } = {}) {
  const db = await PGlite.create();
  await db.exec(readFileSync(join(REPO_ROOT, "docs", "one-shot-schema.sql"), "utf8"));
  if (seed) await db.exec(readFileSync(join(REPO_ROOT, "database", "seed.sql"), "utf8"));

  const server = new PGLiteSocketServer({ db, port });
  await server.start();
  const address = server.server?.address?.() ?? {};
  const listeningPort = typeof address === "object" && address ? address.port : port;

  return {
    db,
    server,
    port: listeningPort,
    connectionString: `postgresql://postgres:postgres@127.0.0.1:${listeningPort}/postgres`,
    async close() {
      await server.stop();
      await db.close();
    },
  };
}

/** Applies a single migration file, for tests that start from an older schema. */
export async function applyMigration(db, name) {
  await db.exec(readFileSync(join(REPO_ROOT, "database", "migrations", name), "utf8"));
}

/** Every migration filename, in apply order. */
export function migrationFiles() {
  return readdirSync(join(REPO_ROOT, "database", "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort();
}
