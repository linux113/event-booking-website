import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Prisma CLI configuration.
 *
 * Prisma 7 moved connection URLs out of `schema.prisma` and into this file, so
 * this is where `prisma generate` and friends learn how to reach the database.
 *
 * Two things worth knowing:
 *
 * 1. The app never uses this file. At runtime it passes a Neon driver adapter to
 *    PrismaClient (src/lib/db/client.ts), which is what makes the pooled
 *    connection string work from Vercel's serverless functions.
 *
 * 2. There are no `prisma migrate` scripts in this project. The schema is the SQL
 *    in `supabase/migrations/`, applied by `npm run db:setup` — it carries 51
 *    functions, triggers, RLS policies and generated columns that Prisma Migrate
 *    cannot express. If you do run a CLI command that connects (introspection,
 *    `db pull`, `migrate diff`), use the **direct** connection string: schema work
 *    should not travel through a connection pooler.
 */
/**
 * The URL the CLI would connect to. `prisma generate` never opens a connection —
 * it only reads the schema — so a missing `DATABASE_URL` must not fail a build.
 * (Vercel builds must not depend on an env var being set before the first deploy,
 * and generating a client is not a reason to have the database's password.)
 *
 * Commands that really do connect get a clear error instead of a silent one:
 * the placeholder is obviously not a database.
 */
const url = process.env.DATABASE_URL?.trim() || "postgresql://unset:unset@localhost:5432/unset";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: { url },
});
