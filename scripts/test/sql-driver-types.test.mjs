#!/usr/bin/env node
/**
 * The wire contract, tested — `npm run test:db-types`.
 *
 * A page can be blanked by a *column type*, and that is not obvious from any
 * stack trace on the screen. On 2026-09-24 `/admin/bookings` answered
 * "Booking management is unavailable" for every request, because
 * `admin_search_bookings()` returned `check_in_times timestamptz[]` and the
 * runtime driver adapter (`@prisma/adapter-neon` — the pooled WebSocket transport
 * Vercel uses) has no entry for OID 1185 in its result-type table. The adapter
 * fails while it is still *describing* the result set:
 *
 *   P2010 · Raw query failed. Code: `N/A`. Message: `Failed to deserialize column
 *   of type 'Unknown'. … try casting this column to any supported Prisma type
 *   such as `String`.`
 *
 * No row had to exist for that to happen; the function's result *type* was enough.
 * `@prisma/adapter-pg` (the local test harness) maps 1185, which is why every test
 * passed while production was broken.
 *
 * So this test asks the two questions that failure taught us to ask:
 *
 *   1. Does every SQL function the app calls return only column types the *Neon*
 *      adapter can map? (The functions are read out of `src/`, so a new call site
 *      is covered the moment it is written.)
 *   2. Does any table or view in the schema carry a column of an unmappable type?
 *      (A `select *` from it would break the same way, before anyone noticed.)
 *
 * The list of types is **not** maintained here. It is read out of the installed
 * adapter as it is built — the `case ScalarColumnType.…` / `case ArrayColumnType.…`
 * arms of its own conversion table, with the scalar OIDs from the Neon driver's
 * `types.builtins`. A version bump that adds support for a type therefore relaxes
 * this test by itself, and one that removes support fails it. If the adapter's
 * internals change shape, the test fails loudly rather than passing quietly.
 *
 * Usage:
 *   node scripts/test/sql-driver-types.test.mjs [schema.sql]
 *
 * The optional argument is the schema to check (default: docs/one-shot-schema.sql),
 * for pointing the same audit at a database built elsewhere.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SCHEMA_FILE = process.argv[2] ? join(process.cwd(), process.argv[2]) : join(REPO, "docs/one-shot-schema.sql");

const { createVerificationDb } = await import(join(REPO, "scripts/test/pglite.mjs"));

const results = [];
const check = (label, ok, detail = "") => {
  results.push({ label, ok });
  console.log(`  ${ok ? "\u001b[32m✓\u001b[0m" : "\u001b[31m✗\u001b[0m"} ${label}${ok || !detail ? "" : `\n      ${detail}`}`);
};
const section = (title) => console.log(`\n${title}`);

// -----------------------------------------------------------------------------
// 1 · the adapter's own conversion table
// -----------------------------------------------------------------------------

const adapterDist = readFileSync(join(REPO, "node_modules/@prisma/adapter-neon/dist/index.js"), "utf8");

/** `var ArrayColumnType = { TEXT_ARRAY: 1009, … }` — the array OIDs the adapter names. */
const arrayOids = Object.fromEntries(
  [...adapterDist.matchAll(/^\s{2}([A-Z][A-Z0-9_]*): (-?\d+),$/gm)].map((match) => [match[1], Number(match[2])]),
);

/** The names each `case` arm handles — exactly what `fieldToColumnType()` accepts. */
const scalarNames = [...adapterDist.matchAll(/case ScalarColumnType\.([A-Z0-9_]+):/g)].map((m) => m[1]);
const arrayNames = [...adapterDist.matchAll(/case ArrayColumnType\.([A-Z0-9_]+):/g)].map((m) => m[1]);

/** Scalar OIDs come from the driver the adapter is built on, not from a copy here. */
const { types: neonTypes } = await import("@neondatabase/serverless");
const scalarOids = neonTypes.builtins;

/**
 * OIDs the adapter can map. Everything at or above 10000 is a user-defined type
 * and its `default:` arm calls it Text (an enum column reads as a string), so
 * those are fine by the adapter's own rule — the same rule the app relies on for
 * `gallery.status` and every other enum column.
 */
const supported = new Set();
for (const name of scalarNames) if (typeof scalarOids[name] === "number") supported.add(scalarOids[name]);
for (const name of arrayNames) if (typeof arrayOids[name] === "number") supported.add(arrayOids[name]);

const CUSTOM_TYPE_FLOOR = 10_000;
const isSupported = (oid) => oid >= CUSTOM_TYPE_FLOOR || supported.has(oid);
const why = (oid) => (oid >= CUSTOM_TYPE_FLOOR ? `${oid} (a user-defined type, read as text)` : `${oid} is not in the adapter's table`);

section("The adapter's conversion table");
check(
  "the Neon adapter's type table could be read",
  scalarNames.length >= 20 && arrayNames.length >= 20 && supported.size >= 40,
  `read ${scalarNames.length} scalar arms, ${arrayNames.length} array arms, ${supported.size} OIDs — ` +
    "the adapter's dist changed shape; update this test to match",
);

// -----------------------------------------------------------------------------
// 2 · the functions the app calls
// -----------------------------------------------------------------------------

/** Every `rpc("name")` / `rpcScalar<Row>("name")` call under `src/`. */
function functionsCalledByApp() {
  const found = new Map();
  const call = /\brpc(?:Scalar)?(?:<[^>]*>)?\(\s*"([a-z0-9_]+)"/g;

  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "generated" || entry === "node_modules") continue;
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.tsx?$/.test(entry)) continue;
      const source = readFileSync(path, "utf8");
      for (const match of source.matchAll(call)) {
        const where = relative(REPO, path);
        if (!found.has(match[1])) found.set(match[1], where);
      }
    }
  };

  walk(join(REPO, "src"));

  return found;
}

const called = functionsCalledByApp();

section("`src/` calls these SQL functions");
check(
  "the app's SQL function calls were found",
  called.size >= 20,
  `found ${called.size}: ${[...called.keys()].sort().join(", ")}`,
);

// -----------------------------------------------------------------------------
// 3 · against the real schema
// -----------------------------------------------------------------------------

const db = createVerificationDb();
await db.exec(readFileSync(SCHEMA_FILE, "utf8"));

// Result columns of every function, with the OID PostgreSQL reports for each.
const outColumns = await db.query(`
  select p.proname as fn, par.parameter_name as col, par.udt_name as typ, t.oid as oid
    from information_schema.parameters par
    join pg_proc p
      on par.specific_name = p.proname || '_' || p.oid
    join pg_type t
      on t.typname = par.udt_name and t.typnamespace = 'pg_catalog'::regnamespace
   where par.specific_schema = 'public'
     and par.parameter_mode in ('OUT', 'INOUT')
   order by p.proname, par.ordinal_position
`);

const byFunction = new Map();
for (const row of outColumns.rows) {
  if (!byFunction.has(row.fn)) byFunction.set(row.fn, []);
  byFunction.get(row.fn).push(row);
}

section(`Every function the app calls returns types the Neon adapter maps  (${SCHEMA_FILE})`);

const missing = [...called.keys()].filter((fn) => !byFunction.has(fn)).sort();
check(
  "every function the app calls exists in the schema",
  missing.length === 0,
  `not defined in public: ${missing.join(", ")}`,
);

const unmappable = [];
for (const [fn, file] of [...called.entries()].sort()) {
  const columns = byFunction.get(fn);
  if (!columns) continue; // already reported as missing

  const bad = columns.filter((column) => !isSupported(Number(column.oid)));
  check(
    `${fn}() (${file})`,
    bad.length === 0,
    bad.map((column) => `${column.col} ${column.typ} — OID ${why(Number(column.oid))}`).join("; "),
  );
  unmappable.push(...bad.map((column) => ({ fn, ...column })));
}

// -----------------------------------------------------------------------------
// 4 · nothing anywhere else in the schema is a landmine either
// -----------------------------------------------------------------------------

const tableColumns = await db.query(`
  select c.table_name, c.column_name, c.udt_name, t.oid as oid
    from information_schema.columns c
    join pg_type t
      on t.typname = c.udt_name and t.typnamespace = 'pg_catalog'::regnamespace
   where c.table_schema = 'public'
   order by c.table_name, c.ordinal_position
`);

const badColumns = tableColumns.rows.filter((row) => !isSupported(Number(row.oid)));

section("Every table and view column is a type the Neon adapter maps");
check(
  "no column is unmappable",
  badColumns.length === 0,
  badColumns
    .map((row) => `${row.table_name}.${row.column_name} ${row.udt_name} — OID ${why(Number(row.oid))}`)
    .join("; "),
);

await db.close();

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);

if (failed.length > 0) {
  console.log(`
A column type the Neon adapter cannot map fails the *whole* query, before a row is
read, and the screen only shows "we could not load that right now". Return the
column as a type the adapter knows — for a list of timestamps, \`text[]\` of
ISO-8601 strings (see database/migrations/20260925130000_booking_check_in_times_text.sql).
${unmappable.length > 0 ? `\nOffending columns:\n${unmappable.map((c) => `  ${c.fn}.${c.col} ${c.typ} (OID ${c.oid})`).join("\n")}\n` : ""}`);
}

process.exit(failed.length === 0 ? 0 : 1);
