#!/usr/bin/env node
/**
 * Apply the schema to a hosted PostgreSQL — Neon, or any other Postgres.
 *
 *   DATABASE_URL='postgresql://…?sslmode=require' npm run db:setup
 *   DATABASE_URL='…' npm run db:setup -- --seed
 *   DATABASE_URL='…' npm run db:setup -- --verify-only
 *   DATABASE_URL='…' npm run db:setup -- --mark-all-applied
 *
 * What it does:
 *   1. applies `supabase/prelude.sql` once (the `auth.users` + `auth.uid()` shim the
 *      schema expects — on Supabase that schema is part of the platform);
 *   2. applies every `supabase/migrations/*.sql` in filename order, each in its own
 *      transaction and recorded in `setup.applied_migrations`, stopping at the first
 *      failure so the database is never left half-migrated;
 *   3. optionally applies `supabase/seed.sql`;
 *   4. asserts the end state — counts, RLS flags, the hardening policy, and two
 *      boundaries a stranger must not cross.
 *
 * Re-running is safe and incremental: whatever is already recorded is skipped, and a
 * file whose contents changed since it was applied is reported. Migrations are
 * forward-only (two of them change a function's return shape), so replaying an applied
 * file is not possible by design — the record is what makes a second run work.
 *
 * The connection string is read from the environment, never from a file in the repo,
 * and never printed — the password in it is masked in every message. See
 * docs/neon-setup.md for the walkthrough.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

import { applySchema, verifySchema } from "./lib/apply-schema.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const GREEN = "\u001b[32m";
const RED = "\u001b[31m";
const YELLOW = "\u001b[33m";
const DIM = "\u001b[2m";
const RESET = "\u001b[0m";

const args = new Set(process.argv.slice(2));
const flags = {
  seed: args.has("--seed"),
  verifyOnly: args.has("--verify-only"),
  skipPrelude: args.has("--skip-prelude"),
  markAllApplied: args.has("--mark-all-applied"),
  allowLocal: args.has("--allow-local"),
};

/** Hides the password in a connection string before it reaches a log line. */
function mask(url) {
  return url.replace(/:\/\/[^:@/]+:[^@]*@/, "://$&").replace(/:\/\/([^:/@]+):[^@]*@/, "://$1:***@");
}

const rawUrl = process.env.DATABASE_URL?.trim();

if (!rawUrl) {
  console.error(
    `${RED}DATABASE_URL is not set.${RESET}\n\n` +
      `  DATABASE_URL='postgresql://user:password@host/db?sslmode=require' npm run db:setup\n\n` +
      `Use the direct (non-pooler) string from your database provider — the pooler is for\n` +
      `the app's runtime queries, not for migrations.`,
  );
  process.exit(1);
}

// `channel_binding` is a libpq parameter; the Node driver does not understand it, and
// the connection is already TLS-encrypted via `sslmode=require`.
const url = rawUrl
  .replace(/([?&])channel_binding=[^&]*/g, "$1")
  .replace(/[?&]$/, "")
  .replace("?&", "?");

if (
  !flags.allowLocal &&
  (url.includes("localhost") || url.includes("127.0.0.1") || url.includes("@[::1]"))
) {
  console.error(
    `${RED}That looks like a local database.${RESET} This script is for a hosted one.\n` +
      `For local work use ${DIM}npm run db:verify${RESET} — it boots its own throwaway PostgreSQL.`,
  );
  process.exit(1);
}

if (url.includes("-pooler")) {
  console.log(
    `${DIM}Note: the URL contains "-pooler". Migrations are happier on the direct string;\n` +
      `if this run fails on a long statement, switch to the direct one.${RESET}`,
  );
}

const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 20, onnotice: () => {} });

const db = {
  unsafe: (text) => sql.unsafe(text),
  query: async (text, params) => sql.unsafe(text, params ?? []),
  begin: (fn) =>
    sql.begin(async (tx) =>
      fn({
        unsafe: (text) => tx.unsafe(text),
        query: (text, params) => tx.unsafe(text, params ?? []),
      }),
    ),
};

console.log(`Applying the schema to ${mask(url)}\n`);

let failures = 0;

try {
  const report = await applySchema({
    db,
    root: ROOT,
    seed: flags.seed,
    verifyOnly: flags.verifyOnly,
    skipPrelude: flags.skipPrelude,
    markAllApplied: flags.markAllApplied,
  });

  if (report.preflightWarning) {
    console.log(`${YELLOW}Warning:${RESET} ${report.preflightWarning}\n`);
  }

  if (flags.verifyOnly) {
    console.log(`${DIM}--verify-only: nothing applied, checking what is there.${RESET}\n`);
  } else {
    const total = report.sections.length;

    for (const name of report.applied) {
      console.log(`  ${GREEN}✓${RESET} applied  ${name}`);
    }

    for (const name of report.skipped) {
      console.log(`  ${DIM}·${RESET} ${DIM}skipped  ${name} (already applied)${RESET}`);
    }

    for (const name of report.changed) {
      console.log(`  ${YELLOW}!${RESET} ${name} changed since it was applied — left alone`);
    }

    for (const failure of report.failures) {
      failures += 1;
      console.log(`  ${RED}✗${RESET} FAILED   ${failure.name}\n      ${failure.code} ${failure.message}`);
    }

    if (report.failures.length === 0) {
      console.log(
        `\n  ${report.applied.length} applied, ${report.skipped.length} skipped, of ${total} section(s).\n`,
      );
    }
  }

  if (failures > 0) {
    console.error(
      `${RED}Stopped at the failure above.${RESET} Everything before it is applied and recorded;\n` +
        `nothing after it is. Fix the cause and re-run — the applied files are skipped, so it\n` +
        `resumes where it stopped.\n`,
    );
    process.exitCode = 1;
  }

  const { checks, data } = await verifySchema(db);

  console.log("The schema as it now stands:");

  for (const check of checks) {
    if (!check.ok) {
      failures += 1;
    }

    console.log(`  ${check.ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`} ${check.label}${check.ok ? "" : ` — ${check.detail}`}`);
  }

  if (data.events > 0) {
    console.log(
      `\n  ${DIM}data: ${data.events} event(s), ${data.nights} night(s), ${data.passes} pass type(s)${RESET}`,
    );
  } else {
    console.log(
      `\n  ${DIM}data: no rows yet — the public site shows its "database is not connected" state\n` +
        `        until you add an event, or re-run with --seed${RESET}`,
    );
  }

  console.log(
    failures === 0
      ? `\n${GREEN}Done.${RESET} Every check passed.\n`
      : `\n${RED}${failures} check(s) failed — see above.${RESET}\n`,
  );
} catch (error) {
  console.error(`\n${RED}${error.message}${RESET}\n`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}

process.exit(failures === 0 ? 0 : 1);
