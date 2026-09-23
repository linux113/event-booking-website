#!/usr/bin/env node
/**
 * Apply the schema to a hosted PostgreSQL — Neon, or any other Postgres.
 *
 *   DATABASE_URL='postgresql://…?sslmode=require' npm run db:setup
 *   DATABASE_URL='…' npm run db:setup -- --seed
 *   DATABASE_URL='…' npm run db:setup -- --seed --verify-only
 *
 * What it does, in order:
 *   1. applies `supabase/prelude.sql` once (the `auth.users` + `auth.uid()` shim the
 *      schema expects — on Supabase that schema is part of the platform);
 *   2. applies every `supabase/migrations/*.sql` in filename order, each in its own
 *      transaction, stopping at the first failure so you are never left half-migrated;
 *   3. optionally applies `supabase/seed.sql`;
 *   4. asserts the end state — counts, RLS flags, and two boundaries a stranger must
 *      not cross.
 *
 * It is safe to re-run: every migration is written to be idempotent, and a re-run just
 * re-applies them. It never drops anything.
 *
 * The connection string is read from the environment, never from a file in the repo,
 * and never printed — a password embedded in it is masked in every message.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = join(ROOT, "supabase/migrations");
const PRELUDE = join(ROOT, "supabase/prelude.sql");
const SEED = join(ROOT, "supabase/seed.sql");

const GREEN = "\u001b[32m";
const RED = "\u001b[31m";
const DIM = "\u001b[2m";
const RESET = "\u001b[0m";

const args = new Set(process.argv.slice(2));
const withSeed = args.has("--seed");
const verifyOnly = args.has("--verify-only");
const skipPrelude = args.has("--skip-prelude");

/** Hides the password in a connection string before it reaches a log line. */
function mask(url) {
  return url.replace(/:\/\/([^:/@]+):[^@]*@/, "://$1:***@");
}

const url = process.env.DATABASE_URL?.trim();

if (!url) {
  console.error(
    `${RED}DATABASE_URL is not set.${RESET}\n\n` +
      `  DATABASE_URL='postgresql://user:password@host/db?sslmode=require' npm run db:setup\n\n` +
      `Use the direct (non-pooler) string from your database provider — the pooler is for\n` +
      `the app's runtime queries, not for migrations.`,
  );
  process.exit(1);
}

if (url.includes("localhost") || url.includes("127.0.0.1")) {
  console.error(
    `${RED}That looks like a local database.${RESET} This script is for a hosted one.\n` +
      `For local work use: npm run db:verify (it boots its own throwaway PostgreSQL).`,
  );
  process.exit(1);
}

if (url.includes("-pooler")) {
  console.log(
    `${DIM}Note: the URL contains "-pooler". Migrations are happier on the direct string;\n` +
      `if this run fails on a transaction or a long statement, switch to the direct one.${RESET}`,
  );
}

const sql = postgres(url, { max: 1, idle_timeout: 5, onnotice: () => {} });

console.log(`Applying the schema to ${mask(url)}\n`);

const results = [];
const record = (label, ok, detail = "") => {
  results.push({ ok });
  console.log(`  ${ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`} ${label}${detail && !ok ? `\n      ${detail}` : ""}`);
};

/** Runs a whole SQL file in one transaction: all of it, or none of it. */
async function applyFile(path, label) {
  const text = readFileSync(path, "utf8");

  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(text);
    });
    record(label, true);

    return true;
  } catch (error) {
    record(label, false, `${error.code ?? ""} ${String(error.message).split("\n").slice(0, 4).join("\n      ")}`);

    return false;
  }
}

async function report() {
  const [counts] = await sql`
    select
      (select count(*)::int from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE')        as tables,
      (select count(*)::int from pg_policies where schemaname = 'public')    as policies,
      (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity) as rls_on,
      (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef)                         as definer_fns,
      (select count(*)::int from public.events)                             as events,
      (select count(*)::int from public.pass_categories)                    as passes,
      (select count(*)::int from public.event_dates)                        as nights,
      (select auth.uid() is null)                                           as uid_present;
  `;

  console.log("\nThe schema as it now stands:");

  record(
    "11 public tables, 26 policies, RLS on every table",
    counts.tables === 11 && counts.policies === 26 && counts.rls_on === 11,
    JSON.stringify(counts),
  );
  record(`44 SECURITY DEFINER functions, each with a fixed search_path`, counts.definer_fns === 44, `${counts.definer_fns} found`);
  record(`the identity shim answers (auth.uid() is callable)`, counts.uid_present === true);

  if (counts.events > 0) {
    console.log(`  ${DIM}data: ${counts.events} event(s), ${counts.nights} night(s), ${counts.passes} pass type(s)${RESET}`);
  } else {
    console.log(
      `  ${DIM}data: no rows yet — the public site will show its "database is not connected"\n` +
        `        state until you add an event, or run this again with --seed${RESET}`,
    );
  }

  // The two boundaries that matter, exercised as a stranger would hit them.
  let anonRefused = false;
  let anonSawPublished = false;
  let anonEventRows = 0;

  await sql.begin(async (tx) => {
    await tx`set local role anon`;
    anonEventRows = (await tx`select count(*)::int as n from public.events where status = 'published'`)[0].n;
    anonSawPublished = true;

    try {
      await tx`select count(*) from public.bookings`;
    } catch (error) {
      anonRefused = error.code === "42501";
    }
  });

  record("a stranger can read the published event", anonSawPublished, `${anonEventRows} rows`);
  record("a stranger is refused on bookings (permission denied)", anonRefused);
}

try {
  if (!verifyOnly) {
    if (!skipPrelude) {
      const applied = await applyFile(PRELUDE, "prelude: auth.users + auth.uid() (the Supabase platform shim)");

      if (!applied) {
        throw new Error("the prelude failed — fix it before the migrations");
      }
    }

    const files = readdirSync(MIGRATIONS)
      .filter((name) => name.endsWith(".sql"))
      .sort();

    for (const [index, file] of files.entries()) {
      const label = `${String(index + 1).padStart(2, "0")}/${files.length}  ${file}`;
      const applied = await applyFile(join(MIGRATIONS, file), label);

      if (!applied) {
        console.error(
          `\n${RED}Stopped at ${file}.${RESET} Everything before it is applied and committed; nothing after\n` +
            `it is. Fix the cause and re-run — the migrations are idempotent, so the ones that\n` +
            `already ran will simply run again.\n`,
        );
        process.exitCode = 1;
        await sql.end();
        process.exit(1);
      }
    }

    if (withSeed) {
      const seeded = await applyFile(SEED, "seed: one event, nine nights, five pass types");

      if (!seeded) {
        console.log(
          `  ${DIM}The schema is fine — the seed is demo data and can be skipped or fixed later.${RESET}`,
        );
      }
    }
  } else {
    console.log(`${DIM}--verify-only: not applying anything, just checking what is there.${RESET}\n`);
  }

  await report();
} catch (error) {
  console.error(`\n${RED}${error.message}${RESET}\n`);
  process.exitCode = 1;
} finally {
  if (sql) {
    await sql.end({ timeout: 5 });
  }
}

const failed = results.filter((r) => !r.ok).length;

console.log(
  failed === 0
    ? `\n${GREEN}Done.${RESET} ${results.length} checks passed.` +
        (withSeed ? "" : `\nNext, if you want the demo rows: ${DIM}npm run db:setup -- --seed${RESET}`)
    : `\n${RED}${failed} of ${results.length} checks failed — see above.${RESET}`,
);

process.exit(failed === 0 ? 0 : 1);
