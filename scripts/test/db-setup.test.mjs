#!/usr/bin/env node
/**
 * The setup tooling, tested — `npm run db:setup:test`.
 *
 * Nothing here talks to a hosted database: it drives the same
 * `scripts/lib/apply-schema.mjs` the CLI uses, against the in-process PostgreSQL the
 * rest of the harness uses. What it proves:
 *
 *   1. a fresh database          → every section applied, nothing skipped
 *   2. an immediate re-run       → nothing applied, everything skipped, no error
 *   3. a part-applied database   → resumes at the right file (migrations are
 *                                  forward-only, so this is what the record is for)
 *   4. an edited file            → reported, not silently ignored
 *   5. a migrated database with
 *      no record                 → flagged for the operator
 *   6. `docs/one-shot-schema.sql` → applies as one batch on a bare PostgreSQL, and
 *                                  leaves the same bookkeeping, so a later
 *                                  `npm run db:setup` skips it instead of replaying
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");

const { createVerificationDb } = await import(join(REPO, "scripts/test/pglite.mjs"));
const { applySchema, listSections, verifySchema, TRACKING_SCHEMA, TRACKING_TABLE } = await import(
  join(REPO, "scripts/lib/apply-schema.mjs")
);

const results = [];
const check = (label, ok, detail = "") => {
  results.push({ label, ok });
  console.log(`  ${ok ? "\u001b[32m✓\u001b[0m" : "\u001b[31m✗\u001b[0m"} ${label}${ok || !detail ? "" : `\n      ${detail}`}`);
};
const section = (title) => console.log(`\n${title}`);

/** The adapter the CLI builds on postgres.js, built on PGlite instead. */
const adapterFor = (pg) => ({
  unsafe: (text) => pg.exec(text),
  query: async (text, params) => (await pg.query(text, params ?? [])).rows,
  begin: async (fn) => {
    await pg.exec("begin");

    try {
      const value = await fn({
        unsafe: (text) => pg.exec(text),
        query: async (text, params) => (await pg.query(text, params ?? [])).rows,
      });
      await pg.exec("commit");

      return value;
    } catch (error) {
      await pg.exec("rollback");
      throw error;
    }
  },
});

const fresh = async () => {
  const pg = await createVerificationDb();

  return { pg, db: adapterFor(pg) };
};

const sections = listSections({ root: REPO, seed: true });
const total = sections.length;

console.log(`\n${total} sections in a full run (prelude + every migration + seed)`);

section("1 · a fresh database");
const { pg, db } = await fresh();
const first = await applySchema({ db, root: REPO, seed: true });
check(
  `all ${total} sections applied`,
  first.applied.length === total,
  first.failures.map((f) => `${f.name}: ${f.code} ${f.message.split("\n")[0]}`).join("; "),
);
check("nothing skipped", first.skipped.length === 0, JSON.stringify(first.skipped));
check("no preflight warning", first.preflightWarning === null, String(first.preflightWarning));

const verified = await verifySchema(db);
check("the end state verifies", verified.checks.every((c) => c.ok), JSON.stringify(verified.checks.filter((c) => !c.ok)));

section("2 · the same database again");
const second = await applySchema({ db, root: REPO, seed: true });
check("no failures on the second run", second.failures.length === 0, JSON.stringify(second.failures));
check(`all ${total} sections skipped`, second.skipped.length === total, `skipped ${second.skipped.length}`);
check("nothing applied twice", second.applied.length === 0, JSON.stringify(second.applied));
check("no file reported as changed", second.changed.length === 0, JSON.stringify(second.changed));

const [afterRerun] = (
  await pg.query(`
    select (select count(*)::int from public.events) as events,
           (select count(*)::int from information_schema.tables where table_schema='public') as tables
  `)
).rows;
check(
  "the data is untouched by the re-run",
  afterRerun.events === 1 && afterRerun.tables === 10,
  JSON.stringify(afterRerun),
);

section("3 · a database that stopped part-way");
const partial = await fresh();

// Exactly what a failed run leaves behind: N sections applied and recorded.
await partial.db.unsafe(`
  create schema if not exists ${TRACKING_SCHEMA};
  create table if not exists ${TRACKING_SCHEMA}.${TRACKING_TABLE} (
    filename text primary key, checksum text, applied_at timestamptz not null default now()
  );
`);

for (const entry of sections.slice(0, 4)) {
  await partial.db.begin(async (tx) => {
    await tx.unsafe(entry.text);
    await tx.query(
      `insert into ${TRACKING_SCHEMA}.${TRACKING_TABLE} (filename, checksum) values ($1, $2)`,
      [entry.name, entry.checksum],
    );
  });
}

const resumed = await applySchema({ db: partial.db, root: REPO, seed: true });
check(
  "it resumes instead of replaying",
  resumed.applied.length === total - 4,
  `applied ${resumed.applied.length}, expected ${total - 4}`,
);
check("the four already-applied files are skipped", resumed.skipped.length === 4, JSON.stringify(resumed.skipped));
check("no failures while resuming", resumed.failures.length === 0, JSON.stringify(resumed.failures));
check("no preflight warning when a record exists", resumed.preflightWarning === null);

const resumedVerify = await verifySchema(partial.db);
check("the resumed database verifies", resumedVerify.checks.every((c) => c.ok), JSON.stringify(resumedVerify.checks.filter((c) => !c.ok)));

section("4 · an edited file, and a migrated database with no record");
await pg.exec(`
  update ${TRACKING_SCHEMA}.${TRACKING_TABLE}
     set checksum = 'changed'
   where filename = (select filename from ${TRACKING_SCHEMA}.${TRACKING_TABLE} order by filename limit 1)
`);
const edited = await applySchema({ db, root: REPO, seed: true });
check("an edited file is reported, not silently ignored", edited.changed.length === 1, JSON.stringify(edited.changed));

const orphan = await fresh();

for (const entry of sections.slice(0, 3)) {
  await orphan.db.unsafe(entry.text);
}

const warned = await applySchema({ db: orphan.db, root: REPO });
check(
  "a migrated database with no record is flagged for the operator",
  typeof warned.preflightWarning === "string",
  String(warned.preflightWarning),
);

section("5 · the one-shot paste (docs/one-shot-schema.sql)");
const pasted = await fresh();
const pasteSql = readFileSync(join(REPO, "docs/one-shot-schema.sql"), "utf8");

let pastedOk = true;
try {
  await pasted.db.unsafe(pasteSql);
} catch (error) {
  pastedOk = false;
  check("the whole batch runs in one statement", false, `${error.code ?? ""} ${String(error.message).split("\n")[0]}`);
}

if (pastedOk) {
  check(`the whole batch runs in one statement (${(Buffer.byteLength(pasteSql) / 1024).toFixed(0)} KB)`, true);

  const pastedVerify = await verifySchema(pasted.db);
  check("the pasted database verifies", pastedVerify.checks.every((c) => c.ok), JSON.stringify(pastedVerify.checks.filter((c) => !c.ok)));

  const recorded = (
    await pasted.pg.query(`select filename from ${TRACKING_SCHEMA}.${TRACKING_TABLE}`)
  ).rows.map((row) => row.filename);
  check(
    `the paste records all ${total} sections under the runner's names`,
    recorded.length === total && sections.every((entry) => recorded.includes(entry.name)),
    `${recorded.length} recorded; missing ${sections.map((s) => s.name).filter((n) => !recorded.includes(n)).join(", ")}`,
  );

  const afterPaste = await applySchema({ db: pasted.db, root: REPO, seed: true });
  check(
    "and a later db:setup therefore skips it rather than replaying forward-only migrations",
    afterPaste.applied.length === 0 && afterPaste.failures.length === 0,
    `applied ${afterPaste.applied.length}, failures ${JSON.stringify(afterPaste.failures)}`,
  );
}

await pg.close();
await partial.pg.close();
await orphan.pg.close();
await pasted.pg.close();

const failed = results.filter((r) => !r.ok).length;
console.log(
  failed === 0
    ? `\n\u001b[32m${results.length} passed, 0 failed\u001b[0m\n`
    : `\n\u001b[31m${results.length - failed} passed, ${failed} failed\u001b[0m\n`,
);
process.exit(failed === 0 ? 0 : 1);
