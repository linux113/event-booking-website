/**
 * A real PostgreSQL, on a real socket, in this process.
 *
 * PGlite is PostgreSQL compiled to WASM, and `@electric-sql/pglite-socket`
 * exposes it over the Postgres wire protocol on a TCP port. Anything that speaks
 * that protocol can connect to it — including Prisma.
 *
 * Why this exists: the old verification harness shimmed PostgREST over HTTP,
 * because the app talked to Supabase over HTTP. The app now opens a proper
 * database connection, so the tests need a proper database to open it against.
 * This is that database: the same schema, the same functions, the same triggers,
 * the same constraints as Neon, on localhost.
 *
 * What it is not: Neon. The wire transport (the driver adapter, the pooler, TLS)
 * is not exercised by this — only the SQL is. Everything above the transport —
 * every query, every SQL function, every constraint — is real.
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
  if (seed) await db.exec(readFileSync(join(REPO_ROOT, "supabase", "seed.sql"), "utf8"));

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
  await db.exec(readFileSync(join(REPO_ROOT, "supabase", "migrations", name), "utf8"));
}

/** Every migration filename, in apply order. */
export function migrationFiles() {
  return readdirSync(join(REPO_ROOT, "supabase", "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort();
}
