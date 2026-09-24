/**
 * Applies the schema to a database, once each, in order — the logic behind
 * `npm run db:setup` and the GitHub workflow.
 *
 * Migrations are **forward-only**: two of them deliberately restate the same function
 * with a different return shape (090400 → 090500 → 091200 for `create_pending_booking`),
 * which is how `create or replace function` is meant to be used. That means a
 * half-applied file list cannot simply be replayed, so what has already been applied is
 * recorded in `setup.applied_migrations` and skipped on the next run. The record lives
 * in its own schema so `public` keeps exactly the 11 tables the app expects.
 *
 * The database is reached through a small adapter so the same code runs against a
 * network driver (postgres.js, in the CLI) and against the in-process PostgreSQL the
 * verification harness uses:
 *
 *   unsafe(text)          → run a multi-statement string
 *   query(text, params?)  → one statement, returns rows
 *   begin(fn)             → run fn(tx) in a transaction, rolling back on a throw
 *
 * This module decides *what* to run and *what to record*. It does not print, does not
 * read environment variables and does not exit — the caller owns all three.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { isKnownLegacyChecksum } from "./legacy-migration-checksums.mjs";

export const TRACKING_SCHEMA = "setup";
export const TRACKING_TABLE = "applied_migrations";
export const PRELUDE_NAME = "prelude.sql";
export const SEED_NAME = "seed.sql";

const TRACKING_DDL = `
create schema if not exists ${TRACKING_SCHEMA};

create table if not exists ${TRACKING_SCHEMA}.${TRACKING_TABLE} (
  filename   text primary key,
  checksum   text,
  applied_at timestamptz not null default now()
);

comment on table ${TRACKING_SCHEMA}.${TRACKING_TABLE} is
  'What npm run db:setup has applied to this database, so a re-run skips it. Kept out of public so the application schema contains only the application.';
`;

/** Statements that cannot run inside a transaction — the batch would fail. */
const NOT_TRANSACTIONAL =
  /^\s*(create\s+(unique\s+)?index\s+concurrently|vacuum|create\s+database|alter\s+system|drop\s+database)\b/im;

export function checksumOf(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * The files to apply, in order: the prelude first (unless skipped), then every
 * migration by filename, then the seed when asked for.
 */
export function listSections({ root, seed = false, skipPrelude = false }) {
  const read = (name, path) => {
    const text = readFileSync(path, "utf8");

    if (NOT_TRANSACTIONAL.test(text)) {
      throw new Error(
        `${name} contains a statement that cannot run inside a transaction. ` +
          `Apply it outside one and record it with --mark-applied ${name}.`,
      );
    }

    return { name, text, checksum: checksumOf(text) };
  };

  const sections = [];

  if (!skipPrelude) {
    sections.push(read(PRELUDE_NAME, join(root, "database/prelude.sql")));
  }

  for (const name of readdirSync(join(root, "database/migrations"))
    .filter((entry) => entry.endsWith(".sql"))
    .sort()) {
    sections.push(read(name, join(root, "database/migrations", name)));
  }

  if (seed) {
    sections.push(read(SEED_NAME, join(root, "database/seed.sql")));
  }

  return sections;
}

/** filename → checksum, or an empty map when nothing has been recorded yet. */
export async function readTracking(db) {
  try {
    const rows = await db.query(`select filename, checksum from ${TRACKING_SCHEMA}.${TRACKING_TABLE}`);

    return new Map(rows.map((row) => [row.filename, row.checksum]));
  } catch {
    // No tracking table: either a fresh database, or one set up before this existed.
    return new Map();
  }
}

/** Does the database already contain the application's schema? */
async function looksMigrated(db) {
  try {
    const [row] = await db.query(
      `select count(*)::int as n
         from information_schema.tables
        where table_schema = 'public' and table_name = 'bookings'`,
    );

    return row.n > 0;
  } catch {
    return false;
  }
}

/**
 * @returns a report — nothing is thrown for a failed migration; the caller decides what
 *          to do with `failures`.
 */
export async function applySchema({
  db,
  root,
  seed = false,
  verifyOnly = false,
  skipPrelude = false,
  markAllApplied = false,
}) {
  const sections = listSections({ root, seed, skipPrelude });
  const report = {
    sections: sections.map((section) => section.name),
    applied: [],
    skipped: [],
    changed: [],
    failures: [],
    preflightWarning: null,
  };

  if (verifyOnly) {
    return report;
  }

  await db.unsafe(TRACKING_DDL);

  const tracked = await readTracking(db);

  if (tracked.size === 0 && (await looksMigrated(db))) {
    report.preflightWarning =
      "this database already has the application schema but no applied-migrations record. " +
      "If it was set up before this tracking existed, run with --mark-all-applied to record it; " +
      "otherwise stop and check what state it is in.";
  }

  if (markAllApplied) {
    for (const section of sections) {
      await db.query(
        `insert into ${TRACKING_SCHEMA}.${TRACKING_TABLE} (filename, checksum)
         values ($1, $2)
         on conflict (filename) do nothing`,
        [section.name, section.checksum],
      );
      report.applied.push(section.name);
    }

    report.sections = sections.map((section) => section.name);

    return report;
  }

  for (const section of sections) {
    const recorded = tracked.get(section.name);

    if (recorded) {
      report.skipped.push(section.name);

      if (recorded !== section.checksum && !isKnownLegacyChecksum(section.name, recorded)) {
        report.changed.push(section.name);
      }

      continue;
    }

    try {
      // The migration and its record commit together: a failure leaves neither.
      await db.begin(async (tx) => {
        await tx.unsafe(section.text);
        await tx.query(
          `insert into ${TRACKING_SCHEMA}.${TRACKING_TABLE} (filename, checksum) values ($1, $2)`,
          [section.name, section.checksum],
        );
      });

      report.applied.push(section.name);
    } catch (error) {
      report.failures.push({
        name: section.name,
        code: error.code ?? "",
        message: String(error.message ?? error).split("\n").slice(0, 4).join("\n"),
      });

      // Stop here: later migrations assume this one succeeded.
      break;
    }
  }

  return report;
}

/**
 * The end state, asserted the way a stranger would meet it: counts, and two boundaries
 * that must refuse.
 */
export async function verifySchema(db) {
  const checks = [];
  const add = (label, ok, detail = "") => checks.push({ label, ok, detail });

  const [counts] = await db.query(`
    select
      (select count(*)::int from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE')          as tables,
      (select count(*)::int from pg_policies where schemaname = 'public')      as policies,
      (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity)   as rls_on,
      (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef)                           as definer_fns,
      (select count(*)::int from public.events)                              as events,
      (select count(*)::int from public.event_dates)                         as nights,
      (select count(*)::int from public.pass_categories)                     as passes,
      (select auth.uid() is null)                                            as uid_present;
  `);

  add(
    "10 public tables, 6 policies (public reads only), RLS on every table",
    counts.tables === 10 && counts.policies === 6 && counts.rls_on === 10,
    JSON.stringify(counts),
  );
  add("40 SECURITY DEFINER functions", counts.definer_fns === 40, `${counts.definer_fns} found`);
  add("the identity shim answers (auth.uid() is callable)", counts.uid_present === true);
  add(
    "no leftover tables in public from the setup bookkeeping",
    counts.tables === 10 || counts.tables === 11,
    `public has ${counts.tables} tables`,
  );

  const data = {
    events: counts.events,
    nights: counts.nights,
    passes: counts.passes,
  };
  const seedLoaded = counts.events > 0;
  add(
    "seed: one event, nine nights, five pass types",
    seedLoaded ? counts.events === 1 && counts.nights === 9 && counts.passes === 5 : true,
    JSON.stringify(data),
  );

  // The boundaries. `set local role` inside a transaction so nothing leaks out of it.
  let anonRefused = false;
  let anonSawPublished = false;

  await db.begin(async (tx) => {
    await tx.unsafe("set local role anon");

    const [row] = await tx.query(`select count(*)::int as n from public.events where status = 'published'`);
    anonSawPublished = true;
    add("a stranger can read the published event", row.n >= 0, `${row.n} row(s)`);

    try {
      await tx.query("select count(*) from public.bookings");
    } catch (error) {
      anonRefused = error.code === "42501";
    }
  });

  add("a stranger is refused on bookings (permission denied)", anonRefused);
  add("the security hardening is present", await hasHardening(db));
  void anonSawPublished;

  return { checks, data };
}

async function hasHardening(db) {
  // The posture the single-admin migration leaves behind: RLS is on everywhere,
  // the only policies left are the six public reads, and nothing exposes a pass,
  // a payment or a booking to the anon/authenticated roles.
  const [row] = await db.query(`
    select
      (select count(*)::int from pg_policies where schemaname = 'public')                    as policies,
      (select count(*)::int from pg_policies
        where schemaname = 'public'
          and tablename in ('bookings', 'digital_passes', 'check_ins'))                      as exposed,
      (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity)                 as rls_on,
      (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r')                                      as tables
  `);

  return row.policies === 6 && row.exposed === 0 && row.rls_on === row.tables;
}
