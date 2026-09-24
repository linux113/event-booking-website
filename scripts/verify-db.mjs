/**
 * HISTORICAL harness from the Supabase era (customer email, roles, storage doubles).
 * Not part of the post-migration acceptance path; use test:prisma, db:setup:test,
 * typecheck, lint and build instead.
 *
 * Schema verification — runs the real migrations and seed against PostgreSQL.
 *
 * PGlite is PostgreSQL compiled to WebAssembly, so this exercises genuine
 * Postgres behaviour (constraints, triggers, cascades, Row Level Security)
 * without needing a Supabase project or Docker. Supabase-provided pieces are
 * stubbed exactly as Supabase offers them: the anon / authenticated /
 * service_role roles, the `auth` schema, auth.users and auth.uid() (driven by a
 * session setting, the same way PostgREST supplies the JWT claim).
 *
 * Run with:  npm run db:verify
 *
 * It is a development-only check: PGlite is a devDependency and nothing here is
 * bundled into the app or deployed.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createVerificationDb } from "./test/pglite.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");
const SEED_FILE = join(REPO_ROOT, "supabase", "seed.sql");

// Fixtures from seed.sql — kept in sync by the assertions below.
const NIGHT_1 = "d0000000-0000-4000-8000-000000000001";
const COUPLE_PASS = "c0000000-0000-4000-8000-000000000002";
const FAMILY_PASS = "c0000000-0000-4000-8000-000000000005";

const GREEN = "\u001b[32m";
const RED = "\u001b[31m";
const BOLD = "\u001b[1m";
const RESET = "\u001b[0m";

let passed = 0;
const failures = [];

const db = createVerificationDb();

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ${GREEN}✓${RESET} ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ${RED}✗${RESET} ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n${BOLD}${title}${RESET}`);
}

async function q(sql, params) {
  const result = await db.query(sql, params);
  return result.rows;
}

async function run(sql) {
  await db.exec(sql);
}

/** Runs a statement expected to fail and returns the error message (or null). */
async function expectError(sql) {
  try {
    await db.exec(sql);
    return null;
  } catch (error) {
    return error.message ?? String(error);
  }
}

/** Runs a query as another Postgres role so RLS applies. */
async function asRole(role, sql) {
  await run(`set role ${role};`);

  try {
    return await q(sql);
  } finally {
    await run("reset role;");
  }
}

async function count(table, where = "") {
  const rows = await q(`select count(*)::int as n from public.${table} ${where};`);
  return rows[0].n;
}

async function main() {
  // ---------------------------------------------------------------------------
  section("Bootstrap: Supabase-compatible environment");
  // ---------------------------------------------------------------------------
  await run(`
    create schema if not exists auth;

    create table if not exists auth.users (
      id uuid primary key,
      email text unique
    );

    create or replace function auth.uid() returns uuid
    language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
  `);
  check("auth schema, auth.users and auth.uid() stubbed", true);

  // ---------------------------------------------------------------------------
  section("Migrations apply cleanly");
  // ---------------------------------------------------------------------------
  const migrations = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  check("migration files found", migrations.length > 0, `${migrations.length} files`);

  for (const file of migrations) {
    const error = await expectError(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    check(`applied ${file}`, error === null, error ?? "");
  }

  await run("grant usage on schema auth to anon, authenticated, service_role;");

  // ---------------------------------------------------------------------------
  section("Schema structure");
  // ---------------------------------------------------------------------------
  const expectedTables = [
    "admin_users",
    "bookings",
    "check_ins",
    "digital_passes",
    "event_dates",
    "event_features",
    "event_highlights",
    "events",
    "gallery",
    "pass_categories",
    "payment_events",
  ];
  const tables = (await q(`select tablename from pg_tables where schemaname = 'public';`)).map(
    (row) => row.tablename,
  );
  check(
    "all expected tables exist",
    expectedTables.every((table) => tables.includes(table)),
    `found: ${tables.join(", ")}`,
  );

  const requiredColumns = {
    bookings: [
      "id", "booking_id", "customer_name", "customer_mobile", "customer_email",
      "event_date_id", "pass_category_id", "quantity", "number_of_people",
      "subtotal", "total_amount", "booking_status", "payment_status",
      "razorpay_order_id", "razorpay_payment_id", "idempotency_key", "public_token",
      "created_at", "updated_at",
    ],
    payment_events: [
      "id", "event_id", "event_type", "razorpay_order_id", "razorpay_payment_id",
      "amount_paise", "outcome", "received_at", "processed_at",
    ],
    digital_passes: [
      "id", "booking_id", "pass_id", "qr_token", "qr_code_url", "valid_date",
      "pass_number", "status", "checked_in", "checked_in_at", "created_at",
    ],
  };

  for (const [table, columns] of Object.entries(requiredColumns)) {
    const found = (
      await q(
        `select column_name from information_schema.columns
         where table_schema = 'public' and table_name = $1;`,
        [table],
      )
    ).map((row) => row.column_name);

    const missing = columns.filter((column) => !found.includes(column));
    check(`${table} has every required column`, missing.length === 0, `missing: ${missing.join(", ")}`);
  }

  const primaryKeys = await q(`
    select count(*)::int as n from information_schema.table_constraints
    where table_schema = 'public' and constraint_type = 'PRIMARY KEY';
  `);
  check(
    "every table has a primary key",
    primaryKeys[0].n === expectedTables.length,
    `found ${primaryKeys[0].n} of ${expectedTables.length}`,
  );

  // pg_constraint is authoritative: information_schema hides foreign keys that
  // reference another schema (admin_users.user_id -> auth.users).
  const fkDefs = (
    await q(`
      select pg_get_constraintdef(oid) as def from pg_constraint
      where contype = 'f' and connamespace = 'public'::regnamespace;
    `)
  )
    .map((row) => row.def.replace(/public\./g, ""))
    .join(" | ");

  const expectedFks = [
    "FOREIGN KEY (event_id) REFERENCES events(id)",
    "FOREIGN KEY (event_date_id) REFERENCES event_dates(id)",
    "FOREIGN KEY (pass_category_id) REFERENCES pass_categories(id)",
    "FOREIGN KEY (booking_id) REFERENCES bookings(id)",
    "FOREIGN KEY (digital_pass_id) REFERENCES digital_passes(id)",
    "FOREIGN KEY (checked_in_by) REFERENCES admin_users(id)",
    "FOREIGN KEY (user_id) REFERENCES auth.users(id)",
  ];
  const missingFks = expectedFks.filter((fk) => !fkDefs.includes(fk));
  check("expected foreign keys exist", missingFks.length === 0, `missing: ${missingFks.join(" , ")}`);

  const uniqueDefs = (
    await q(`
      select conrelid::regclass::text as tbl, pg_get_constraintdef(oid) as def
      from pg_constraint where contype = 'u' and connamespace = 'public'::regnamespace;
    `)
  )
    .map((row) => `${row.tbl} ${row.def}`)
    .join(" | ");

  check("bookings.booking_id is unique", uniqueDefs.includes("booking_id"));
  check("one row per event night", /event_dates UNIQUE \(event_id, event_date\)/.test(uniqueDefs));
  check("one check-in per digital pass", /check_ins UNIQUE \(digital_pass_id\)/.test(uniqueDefs));
  check("one code per pass category per event", /pass_categories UNIQUE \(event_id, code\)/.test(uniqueDefs));

  const indexCount = await q(`select count(*)::int as n from pg_indexes where schemaname = 'public';`);
  check("indexes created", indexCount[0].n >= 30, `${indexCount[0].n} indexes`);

  const triggerNames = (
    await q(`
      select tgname from pg_trigger
      where not tgisinternal
        and tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace);
    `)
  ).map((row) => row.tgname);

  check(
    "updated_at triggers attached to every table with that column",
    ["events", "event_dates", "pass_categories", "bookings", "gallery", "admin_users"].every((table) =>
      triggerNames.includes(`${table}_set_updated_at`),
    ),
    triggerNames.join(", "),
  );
  check("booking amount trigger attached", triggerNames.includes("bookings_set_amounts"));

  const rlsDisabled = (
    await q(`
      select relname from pg_class
      where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity;
    `)
  ).map((row) => row.relname);
  check("RLS enabled on every table", rlsDisabled.length === 0, `off: ${rlsDisabled.join(", ")}`);
  check("RLS applies to the new event tables", (await q(`select relrowsecurity from pg_class where relname in ('event_highlights','event_features');`)).every((row) => row.relrowsecurity));

  const policyCount = await q(`select count(*)::int as n from pg_policies where schemaname = 'public';`);
  check("RLS policies defined", policyCount[0].n >= 20, `${policyCount[0].n} policies`);

  // ---------------------------------------------------------------------------
  section("Seed data");
  // ---------------------------------------------------------------------------
  const seedError = await expectError(readFileSync(SEED_FILE, "utf8"));
  check("seed.sql applies", seedError === null, seedError ?? "");

  const events = await q(`select name, venue_name, city, status from public.events;`);
  check("one event seeded", events.length === 1, `${events.length} rows`);
  check("venue is the seeded venue", events[0]?.venue_name === "My Village Garden", events[0]?.venue_name);
  check("city is Jaipur", events[0]?.city === "Jaipur", events[0]?.city);
  check("event is published", events[0]?.status === "published", events[0]?.status);

  const seededDates = (await q(`select event_date from public.event_dates order by event_date;`)).map(
    (row) => new Date(row.event_date).toISOString().slice(0, 10),
  );
  const expectedDates = [
    "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15",
    "2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19",
  ];
  check("9 event dates seeded", seededDates.length === 9, `${seededDates.length} rows`);
  check(
    "dates are 11–19 October 2026",
    JSON.stringify(seededDates) === JSON.stringify(expectedDates),
    seededDates.join(", "),
  );

  const seededPasses = await q(
    `select code, composition, price_inr, number_of_people from public.pass_categories order by sort_order;`,
  );
  const expectedPasses = [
    ["girls-2", "2 Girls", 399, 2],
    ["couple", "1 Boy + 1 Girl", 499, 2],
    ["boy-2-girls", "1 Boy + 2 Girls", 599, 3],
    ["girls-4", "4 Girls", 799, 4],
    ["family", "Family", 1099, 4],
  ];
  check("5 pass categories seeded", seededPasses.length === 5, `${seededPasses.length} rows`);
  check(
    "prices match the brief (399 / 499 / 599 / 799 / 1099)",
    JSON.stringify(
      seededPasses.map((pass) => [pass.code, pass.composition, pass.price_inr, pass.number_of_people]),
    ) === JSON.stringify(expectedPasses),
    JSON.stringify(seededPasses),
  );

  check("gallery intentionally left empty", (await count("gallery")) === 0);
  check("6 highlights seeded", (await count("event_highlights")) === 6);
  check("6 features seeded", (await count("event_features")) === 6);
  check("no bookings seeded", (await count("bookings")) === 0);
  check("seed is re-runnable (idempotent)", (await expectError(readFileSync(SEED_FILE, "utf8"))) === null);
  check("re-running the seed does not duplicate", (await count("event_dates")) === 9);

  // ---------------------------------------------------------------------------
  section("Constraint and trigger behaviour");
  // ---------------------------------------------------------------------------
  await run(`
    insert into public.bookings (customer_name, customer_mobile, customer_email,
                                 event_date_id, pass_category_id, quantity, subtotal, total_amount)
    values ('Test Attendee', '+919812345678', 'test@example.com',
            '${NIGHT_1}', '${COUPLE_PASS}', 2, 1, 1);
  `);
  const booking = (
    await q(`select * from public.bookings where customer_email = 'test@example.com';`)
  )[0];

  check("booking_id auto-generated (DND202600001 style)", /^DND\d{9}$/.test(booking.booking_id), booking.booking_id);
  check("subtotal computed from the DB price (499 × 2)", booking.subtotal === 998, `got ${booking.subtotal}`);
  check(
    "client-supplied subtotal and total ignored on insert",
    booking.total_amount === 998,
    `got ${booking.total_amount}`,
  );
  check("number_of_people computed (2 passes × 2)", booking.number_of_people === 4, `got ${booking.number_of_people}`);
  check("booking_status defaults to pending", booking.booking_status === "pending");
  check("payment_status defaults to unpaid", booking.payment_status === "unpaid");
  check("created_at and updated_at set", Boolean(booking.created_at && booking.updated_at));

  const familyBooking = (
    await q(`
      insert into public.bookings (customer_name, customer_mobile, customer_email,
                                   event_date_id, pass_category_id, quantity)
      values ('Family Test', '9812345678', 'family@example.com', '${NIGHT_1}', '${FAMILY_PASS}', 1)
      returning subtotal, number_of_people;
    `)
  )[0];
  check("family pass priced from the DB (1099)", familyBooking.subtotal === 1099, `${familyBooking.subtotal}`);
  check("family pass admits 4 people", familyBooking.number_of_people === 4);

  const overMax = await expectError(`
    insert into public.bookings (customer_name, customer_mobile, customer_email,
                                 event_date_id, pass_category_id, quantity)
    values ('Too Many', '9812345678', 'big@example.com', '${NIGHT_1}', '${FAMILY_PASS}', 6);
  `);
  check(
    "quantity above max_per_booking rejected",
    overMax !== null && /max_per_booking/.test(overMax),
    overMax ?? "no error",
  );

  const overpayUpdate = await expectError(`
    update public.bookings set total_amount = 99999 where customer_email = 'test@example.com';
  `);
  check(
    "total_amount above subtotal rejected on update",
    overpayUpdate !== null && /cannot exceed subtotal/.test(overpayUpdate),
    overpayUpdate ?? "no error",
  );

  await run(`update public.bookings set total_amount = 900 where customer_email = 'test@example.com';`);
  const discounted = (
    await q(`select subtotal, total_amount from public.bookings where customer_email = 'test@example.com';`)
  )[0];
  check(
    "authorised discount (total below subtotal) allowed on update",
    discounted.total_amount === 900 && discounted.subtotal === 998,
    JSON.stringify(discounted),
  );

  const badFk = await expectError(`
    insert into public.bookings (customer_name, customer_mobile, customer_email,
                                 event_date_id, pass_category_id, quantity)
    values ('Bad Date', '9812345678', 'bad@example.com',
            'd0000000-0000-4000-8000-0000000000ff', '${COUPLE_PASS}', 1);
  `);
  check("unknown event_date_id rejected", badFk !== null && /foreign key/i.test(badFk), badFk ?? "no error");

  const badMobile = await expectError(`
    insert into public.bookings (customer_name, customer_mobile, customer_email,
                                 event_date_id, pass_category_id, quantity)
    values ('Bad Mobile', 'not-a-phone', 'x@example.com', '${NIGHT_1}', '${COUPLE_PASS}', 1);
  `);
  check("invalid mobile number rejected", badMobile !== null && /mobile/.test(badMobile), badMobile ?? "no error");

  const badEmail = await expectError(`
    insert into public.bookings (customer_name, customer_mobile, customer_email,
                                 event_date_id, pass_category_id, quantity)
    values ('Bad Email', '9812345678', 'nope', '${NIGHT_1}', '${COUPLE_PASS}', 1);
  `);
  check("invalid email rejected", badEmail !== null && /email/.test(badEmail), badEmail ?? "no error");

  await run(`update public.bookings set razorpay_order_id = 'order_TEST123' where id = '${booking.id}';`);
  const duplicateOrder = await expectError(`
    update public.bookings set razorpay_order_id = 'order_TEST123' where customer_email = 'family@example.com';
  `);
  check(
    "duplicate razorpay_order_id rejected",
    duplicateOrder !== null && /duplicate key/i.test(duplicateOrder),
    duplicateOrder ?? "no error",
  );

  await run(`update public.bookings set notes = 'touched' where id = '${booking.id}';`);
  const touched = (await q(`select updated_at from public.bookings where id = '${booking.id}';`))[0];
  check("updated_at refreshed by trigger", touched.updated_at > booking.updated_at);

  const badCheckIn = await expectError(`
    insert into public.digital_passes (booking_id, valid_date, pass_number, checked_in)
    values ('${booking.id}', '2026-10-11', 1, true);
  `);
  check("checked_in without checked_in_at rejected", badCheckIn !== null, badCheckIn ?? "no error");

  const digitalPass = (
    await q(`
      insert into public.digital_passes (booking_id, valid_date, pass_number)
      values ('${booking.id}', '2026-10-11', 1) returning *;
    `)
  )[0];
  check("pass_id auto-generated", /^PS-\d{6}$/.test(digitalPass.pass_id), digitalPass.pass_id);
  check(
    "qr_token auto-generated (64 hex characters)",
    /^[0-9a-f]{64}$/.test(digitalPass.qr_token),
    digitalPass.qr_token.slice(0, 16),
  );
  check(
    "pass defaults to active and not checked in",
    digitalPass.status === "active" && digitalPass.checked_in === false,
  );

  await run(`
    insert into public.check_ins (digital_pass_id, event_date_id, gate)
    values ('${digitalPass.id}', '${NIGHT_1}', 'Gate 1');
  `);
  const doubleScan = await expectError(`
    insert into public.check_ins (digital_pass_id, event_date_id, gate)
    values ('${digitalPass.id}', '${NIGHT_1}', 'Gate 2');
  `);
  check(
    "double check-in rejected",
    doubleScan !== null && /duplicate key/i.test(doubleScan),
    doubleScan ?? "no error",
  );

  const cascading = (
    await q(`
      insert into public.bookings (customer_name, customer_mobile, customer_email,
                                   event_date_id, pass_category_id, quantity)
      values ('Cascade Test', '9812345678', 'cascade@example.com', '${NIGHT_1}', '${COUPLE_PASS}', 1)
      returning id;
    `)
  )[0];
  await run(`
    insert into public.digital_passes (booking_id, valid_date, pass_number)
    values ('${cascading.id}', '2026-10-11', 1);
  `);
  await run(`delete from public.bookings where id = '${cascading.id}';`);
  check("deleting a booking cascades to its passes", (await count("digital_passes", `where booking_id = '${cascading.id}'`)) === 0);

  // ---------------------------------------------------------------------------
  section("Row Level Security");
  // ---------------------------------------------------------------------------
  await run(`
    insert into public.events (id, slug, name, venue_name, city, status)
    values ('e0000000-0000-4000-8000-0000000000aa', 'draft-test', 'Unpublished Draft',
            'Somewhere', 'Jaipur', 'draft');
  `);

  const anonEvents = await asRole("anon", `select status from public.events;`);
  check(
    "anon sees published events only",
    anonEvents.length === 1 && anonEvents[0].status === "published",
    JSON.stringify(anonEvents),
  );
  check("anon can read event dates", (await asRole("anon", `select count(*)::int as n from public.event_dates;`))[0].n === 9);
  check(
    "anon can read pass categories",
    (await asRole("anon", `select count(*)::int as n from public.pass_categories;`))[0].n === 5,
  );

  const anonBookingsError = await expectError("set role anon; select * from public.bookings;");
  check("anon cannot read bookings", anonBookingsError !== null, anonBookingsError ?? "rows returned");
  await run("reset role;");

  const anonInsert = await (async () => {
    await run("set role anon;");
    try {
      await q(`
        insert into public.bookings (customer_name, customer_mobile, customer_email,
                                     event_date_id, pass_category_id, quantity)
        values ('Anon', '9812345678', 'anon@example.com', '${NIGHT_1}', '${COUPLE_PASS}', 1);
      `);
      return null;
    } catch (error) {
      return error.message;
    } finally {
      await run("reset role;");
    }
  })();
  check("anon cannot create a booking", anonInsert !== null, anonInsert ?? "no error raised");

  const anonAdminError = await expectError("set role anon; select * from public.admin_users;");
  check("anon cannot read admin_users", anonAdminError !== null, anonAdminError ?? "rows returned");
  await run("reset role;");

  check(
    "signed-in non-admin sees no bookings",
    (await asRole("authenticated", `select count(*)::int as n from public.bookings;`))[0].n === 0,
  );
  check(
    "signed-in non-admin still sees published events",
    (await asRole("authenticated", `select count(*)::int as n from public.events;`))[0].n === 1,
  );

  // A disabled pass must stay visible to the public (shown as "not on sale"),
  // while remaining unbookable.
  await run(`update public.pass_categories set is_active = false where code = 'family';`);
  check(
    "anon still sees a disabled pass (shown as not on sale)",
    (await asRole("anon", `select count(*)::int as n from public.pass_categories;`))[0].n === 5,
  );
  await run(`update public.pass_categories set is_active = true where code = 'family';`);

  const ownerId = "aaaa0000-0000-4000-8000-000000000001";
  const scannerId = "aaaa0000-0000-4000-8000-000000000002";
  await run(`
    insert into auth.users (id, email) values ('${ownerId}', 'owner@example.com');
    insert into auth.users (id, email) values ('${scannerId}', 'scanner@example.com');

    insert into public.admin_users (user_id, email, full_name, role)
    values ('${ownerId}', 'owner@example.com', 'Test Owner', 'super_admin');

    insert into public.admin_users (user_id, email, role)
    values ('${scannerId}', 'scanner@example.com', 'staff');
  `);

  await run(`set request.jwt.claim.sub = '${ownerId}';`);
  check(
    "admin can read bookings",
    (await asRole("authenticated", `select count(*)::int as n from public.bookings;`))[0].n >= 2,
  );
  check(
    "admin also sees draft events",
    (await asRole("authenticated", `select count(*)::int as n from public.events;`))[0].n === 2,
  );
  check(
    "a super admin can read admin_users",
    (await asRole("authenticated", `select count(*)::int as n from public.admin_users;`))[0].n === 2,
  );

  await run(`set request.jwt.claim.sub = '${scannerId}';`);
  check(
    "staff cannot read bookings",
    (await asRole("authenticated", `select count(*)::int as n from public.bookings;`))[0].n === 0,
  );
  check(
    "staff cannot read digital passes",
    (await asRole("authenticated", `select count(*)::int as n from public.digital_passes;`))[0].n === 0,
  );
  check(
    "staff cannot read admin_users",
    (await asRole("authenticated", `select count(*)::int as n from public.admin_users;`))[0].n === 0,
  );
  check(
    "staff can read the night's check-in log",
    (await asRole("authenticated", `select count(*)::int as n from public.check_ins;`))[0].n >= 1,
  );

  // A gate scanner holds a real session on a phone, so the database must be the
  // second lock: none of these writes may land, whoever is holding the phone. The
  // attempt is allowed to throw (a refusal) — what is checked is the stored value
  // afterwards, because "affected 0 rows" and "rejected" are different answers and
  // only the second one means the row is safe.
  async function staffWriteFails(label, sql, verifySql) {
    await run(`set request.jwt.claim.sub = '${scannerId}';`);
    let refused = false;

    await run("set role authenticated;");
    try {
      await q(sql);
    } catch {
      refused = true;
    } finally {
      await run("reset role;");
    }

    const after = await q(verifySql);
    check(label, after[0].v === true, `${refused ? "refused" : "statement ran"} → stored ${JSON.stringify(after[0].v)}`);
  }

  await run(`
    update public.digital_passes
       set checked_in = true, checked_in_at = now(), status = 'used'
     where id = '${digitalPass.id}';
  `);

  await staffWriteFails(
    "staff cannot mark a booking paid",
    `update public.bookings set payment_status = 'paid' where id = '${booking.id}';`,
    `select (payment_status = 'unpaid') as v from public.bookings where id = '${booking.id}';`,
  );
  await staffWriteFails(
    "staff cannot cancel somebody's booking",
    `update public.bookings set booking_status = 'cancelled' where id = '${booking.id}';`,
    `select (booking_status = 'pending') as v from public.bookings where id = '${booking.id}';`,
  );
  await staffWriteFails(
    "staff cannot reset a used pass",
    `update public.digital_passes set checked_in = false, checked_in_at = null, status = 'active' where id = '${digitalPass.id}';`,
    `select (checked_in and status = 'used') as v from public.digital_passes where id = '${digitalPass.id}';`,
  );
  await staffWriteFails(
    "staff cannot move a pass to another night",
    `update public.digital_passes set valid_date = '2026-10-19' where id = '${digitalPass.id}';`,
    `select (valid_date = '2026-10-11') as v from public.digital_passes where id = '${digitalPass.id}';`,
  );
  await staffWriteFails(
    "staff cannot forge a check-in",
    `insert into public.check_ins (digital_pass_id, event_date_id, gate) values ('${digitalPass.id}', '${NIGHT_1}', 'forged');`,
    `select (count(*) = 0) as v from public.check_ins where digital_pass_id = '${digitalPass.id}' and gate = 'forged';`,
  );
  await staffWriteFails(
    "staff cannot promote themselves",
    `update public.admin_users set role = 'super_admin' where user_id = '${scannerId}';`,
    `select (role = 'staff') as v from public.admin_users where user_id = '${scannerId}';`,
  );

  // The same writes must still be available to an admin, so this is a role split
  // rather than a lock-out.
  await run(`set request.jwt.claim.sub = '${ownerId}';`);
  const adminTouch = await (async () => {
    await run("set role authenticated;");
    try {
      await q(`update public.bookings set notes = 'admin touch' where id = '${booking.id}';`);
      return (await q(`select notes from public.bookings where id = '${booking.id}';`))[0].notes;
    } catch (error) {
      return `refused: ${error.message}`;
    } finally {
      await run("reset role;");
    }
  })();
  check("an admin can still update a booking", adminTouch === "admin touch", String(adminTouch));

  // Back to the scanner for the next check: the event edit below must be attempted
  // as the gate role, not as the admin we just used.
  await run(`set request.jwt.claim.sub = '${scannerId}';`);

  const scannerEdit = await (async () => {
    await run("set role authenticated;");
    try {
      await q(`update public.events set name = 'Hacked' where slug = 'navratri-2026-jaipur';`);
      return (await q(`select count(*)::int as n from public.events where name = 'Hacked';`))[0].n;
    } catch {
      return -1;
    } finally {
      await run("reset role;");
    }
  })();
  check("staff cannot edit events", scannerEdit <= 0, `affected rows: ${scannerEdit}`);

  await run("reset request.jwt.claim.sub;");


  // ---------------------------------------------------------------------------
  section("Booking flow: reference, duplicate protection, atomic create");
  // ---------------------------------------------------------------------------
  const EVENT = "e0000000-0000-4000-8000-000000000001";
  const COUPLE = "c0000000-0000-4000-8000-000000000002"; // 499 INR, 2 people, max 10
  const FAMILY = "c0000000-0000-4000-8000-000000000005"; // 1099 INR, 4 people, max 5
  const TRIO = "c0000000-0000-4000-8000-000000000003"; // 599 INR, 3 people, max 10
  const NIGHT_FREE = "d0000000-0000-4000-8000-000000000004";
  const NIGHT_CANCEL = "d0000000-0000-4000-8000-000000000005";
  const NIGHT_FULL = "d0000000-0000-4000-8000-000000000006";
  const BOOKING_FN =
    "public.create_pending_booking(uuid, uuid, uuid, text, text, text, integer, integer, text)";

  async function createBooking(overrides = {}) {
    const args = {
      p_event_id: EVENT,
      p_event_date_id: NIGHT_FREE,
      p_pass_category_id: COUPLE,
      p_customer_name: "Asha Patel",
      p_customer_mobile: "+919812345678",
      p_customer_email: "asha@example.com",
      p_quantity: 2,
      p_number_of_people: 4,
      p_idempotency_key: null,
      ...overrides,
    };

    const names = Object.keys(args);
    const placeholders = names.map((name, index) => `${name} => $${index + 1}`).join(", ");
    const rows = await q(`select * from public.create_pending_booking(${placeholders})`, Object.values(args));

    return rows[0];
  }

  /** Runs a booking expected to be rejected and returns the Postgres error. */
  async function createBookingError(overrides = {}) {
    try {
      await createBooking(overrides);
      return null;
    } catch (error) {
      return error;
    }
  }

  const bookingRef = (await q("select public.generate_booking_id() as ref;"))[0].ref;
  check("booking reference uses the DND<year><5 digits> format", /^DND\d{4}\d{5}$/.test(bookingRef), bookingRef);

  const idempotencyIndex = await q(`
    select indexdef from pg_indexes
    where schemaname = 'public' and tablename = 'bookings' and indexname = 'bookings_idempotency_key_idx';
  `);
  check(
    "idempotency keys are unique at the database level",
    idempotencyIndex.length === 1 && /unique/i.test(idempotencyIndex[0].indexdef),
  );

  const [fnSecurity] = await q(`
    select p.prosecdef as is_definer,
           coalesce(array_to_string(p.proconfig, ','), '') as config,
           pg_get_function_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_pending_booking';
  `);
  check("booking function is SECURITY DEFINER", fnSecurity?.is_definer === true);
  check(
    "booking function pins search_path",
    (fnSecurity?.config ?? "").includes("search_path=public"),
    fnSecurity?.config ?? "",
  );
  check(
    "booking function accepts no amount from the caller",
    !/price|subtotal|total|amount/i.test(fnSecurity?.args ?? ""),
    fnSecurity?.args ?? "",
  );

  const [fnGrants] = await q(`
    select
      has_function_privilege('anon', '${BOOKING_FN}', 'execute') as anon_can,
      has_function_privilege('authenticated', '${BOOKING_FN}', 'execute') as authenticated_can,
      has_function_privilege('service_role', '${BOOKING_FN}', 'execute') as service_can;
  `);
  check("anon cannot execute the booking function", fnGrants.anon_can === false);
  check("authenticated cannot execute the booking function", fnGrants.authenticated_can === false);
  check("service_role can execute the booking function", fnGrants.service_can === true);

  const anonDirectInsert = await (async () => {
    await run("set role anon;");
    try {
      await q(`
        insert into public.bookings (customer_name, customer_mobile, customer_email,
                                     event_date_id, pass_category_id, quantity)
        values ('Rogue', '+919812345678', 'rogue@example.com', '${NIGHT_FREE}', '${COUPLE}', 1);
      `);
      return null;
    } catch (error) {
      return error;
    } finally {
      await run("reset role;");
    }
  })();
  check(
    "anon still cannot insert a booking directly",
    anonDirectInsert !== null,
    anonDirectInsert?.code ?? "insert succeeded",
  );

  // A valid booking: price and head count must come from the database.
  const created = await createBooking({ p_idempotency_key: "test-key-1" });
  check("booking is created with status pending", created.booking_status === "pending", created.booking_status);
  check("booking is created unpaid", created.payment_status === "unpaid", created.payment_status);
  check("booking reference matches the generator", /^DND\d{9}$/.test(created.booking_reference), created.booking_reference);
  check("subtotal is quantity x database price", created.subtotal === 2 * 499, `${created.subtotal}`);
  check("total equals the subtotal", created.total_amount === created.subtotal);
  check("people are derived from the pass category", created.number_of_people === 4, `${created.number_of_people}`);
  check("first attempt is not flagged as reused", created.was_existing === false);

  const [stored] = await q(`select * from public.bookings where id = '${created.booking_uuid}';`);
  check("booking row is persisted", Boolean(stored));
  check("booking row stores the idempotency key", stored.idempotency_key === "test-key-1");
  check("no payment identifiers are set", stored.razorpay_order_id === null && stored.razorpay_payment_id === null);
  check(
    "no digital pass is issued before payment",
    (await q(`select count(*)::int as n from public.digital_passes where booking_id = '${created.booking_uuid}';`))[0].n === 0,
  );

  // Duplicate submission: same key.
  const replay = await createBooking({ p_idempotency_key: "test-key-1" });
  check("replaying the same key returns the same booking", replay.booking_reference === created.booking_reference);
  check("the replay is flagged as reused", replay.was_existing === true);
  check(
    "the replay created no second row",
    (await q(`select count(*)::int as n from public.bookings where idempotency_key = 'test-key-1';`))[0].n === 1,
  );

  // Duplicate submission: new key, identical content (page reload).
  const contentDuplicate = await createBooking({ p_idempotency_key: "test-key-2" });
  check("an identical booking attempt is reused, not duplicated", contentDuplicate.was_existing === true);
  check(
    "identical content did not add a row",
    (
      await q(
        `select count(*)::int as n from public.bookings where event_date_id = '${NIGHT_FREE}' and customer_mobile = '+919812345678';`,
      )
    )[0].n === 1,
  );

  // A genuinely different booking is still allowed.
  const different = await createBooking({ p_quantity: 1, p_number_of_people: 2, p_idempotency_key: "test-key-3" });
  check("a different booking is still created", different.was_existing === false);

  // Rejections.
  const tooMany = await createBookingError({
    p_pass_category_id: FAMILY,
    p_quantity: 6,
    p_number_of_people: 24,
    p_idempotency_key: "test-key-4",
  });
  check("quantity above max_per_booking is rejected", tooMany?.code === "PB004", tooMany?.code ?? "no error");

  const wrongPeople = await createBookingError({
    p_quantity: 2,
    p_number_of_people: 3,
    p_idempotency_key: "test-key-5",
  });
  check("a head count that contradicts the pass is rejected", wrongPeople?.code === "PB005", wrongPeople?.code ?? "no error");
  check("the rejection reports the expected head count", wrongPeople?.detail === "4", wrongPeople?.detail ?? "");

  await run(`update public.pass_categories set is_active = false where id = '${FAMILY}';`);
  const disabledPass = await createBookingError({
    p_pass_category_id: FAMILY,
    p_quantity: 1,
    p_number_of_people: 4,
    p_idempotency_key: "test-key-6",
  });
  check("a pass that is off sale cannot be booked", disabledPass?.code === "PB003", disabledPass?.code ?? "no error");
  await run(`update public.pass_categories set is_active = true where id = '${FAMILY}';`);

  await run(`update public.event_dates set status = 'cancelled' where id = '${NIGHT_CANCEL}';`);
  const cancelled = await createBookingError({
    p_event_date_id: NIGHT_CANCEL,
    p_idempotency_key: "test-key-7",
  });
  check("a cancelled night cannot be booked", cancelled?.code === "PB002", cancelled?.code ?? "no error");
  await run(`update public.event_dates set status = 'scheduled' where id = '${NIGHT_CANCEL}';`);

  const unknownNight = await createBookingError({
    p_event_date_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    p_idempotency_key: "test-key-8",
  });
  check("an unknown night is rejected", unknownNight?.code === "PB006", unknownNight?.code ?? "no error");

  const wrongEvent = await createBookingError({
    p_event_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    p_idempotency_key: "test-key-9",
  });
  check("a night that belongs to another event is rejected", wrongEvent?.code === "PB006", wrongEvent?.code ?? "no error");

  // Capacity: 4 places, 4 already paid for.
  await run(`update public.event_dates set capacity = 4 where id = '${NIGHT_FULL}';`);
  await run(`
    insert into public.bookings (customer_name, customer_mobile, customer_email, event_date_id,
                                 pass_category_id, quantity, booking_status, payment_status)
    values ('Paid Guest', '+919800000001', 'paid@example.com', '${NIGHT_FULL}', '${COUPLE}', 2, 'confirmed', 'paid');
  `);
  const overCapacity = await createBookingError({
    p_event_date_id: NIGHT_FULL,
    p_quantity: 1,
    p_number_of_people: 2,
    p_idempotency_key: "test-key-10",
  });
  check("a full night cannot take another booking", overCapacity?.code === "PB001", overCapacity?.code ?? "no error");
  check("the capacity error reports 0 places left", overCapacity?.detail === "0", overCapacity?.detail ?? "");

  // A pending booking must not consume capacity (nothing is paid yet).
  const availability = await q(`select * from public.get_event_night_availability('${EVENT}');`);
  const freeNight = availability.find((row) => row.event_date_id === NIGHT_FREE);
  check(
    "pending bookings do not consume capacity",
    freeNight.booked_people === 0 && freeNight.is_bookable === true,
    `booked ${freeNight.booked_people}`,
  );
  const fullNight = availability.find((row) => row.event_date_id === NIGHT_FULL);
  check(
    "paid bookings do fill a night",
    fullNight.is_fully_booked === true && fullNight.remaining === 0,
    `remaining ${fullNight.remaining}`,
  );

  await run(`update public.event_dates set capacity = 1500 where id = '${NIGHT_FULL}';`);

  // ---------------------------------------------------------------------------
  section("Payments: order attachment, server verification, webhook idempotency");
  // ---------------------------------------------------------------------------
  const ORDER_1 = "order_TEST000000000001";
  const ORDER_2 = "order_TEST000000000002";
  const ORDER_3 = "order_TEST000000000003";
  const PAYMENT_1 = "pay_TEST000000000001";
  const PAYMENT_2 = "pay_TEST000000000002";
  const PAYMENT_3 = "pay_TEST000000000003";

  /** Calls a payment function with named arguments. */
  async function rpc(name, args) {
    const names = Object.keys(args);
    const placeholders = names.map((key, index) => `${key} => $${index + 1}`).join(", ");
    return q(`select * from public.${name}(${placeholders})`, Object.values(args));
  }

  /** Runs a payment call expected to fail and returns the Postgres error. */
  async function rpcError(name, args) {
    try {
      await rpc(name, args);
      return null;
    } catch (error) {
      return error;
    }
  }

  const paymentFunctions = [
    "public.attach_razorpay_order(uuid, text)",
    "public.confirm_booking_payment(text, text, integer)",
    "public.fail_booking_payment(text, text)",
    "public.refund_booking_payment(text)",
    "public.apply_razorpay_event(text, text, text, text, integer)",
    "public.get_booking_status(uuid)",
  ];

  for (const fn of paymentFunctions) {
    const [grants] = await q(`
      select has_function_privilege('anon', '${fn}', 'execute') as anon_can,
             has_function_privilege('authenticated', '${fn}', 'execute') as authenticated_can,
             has_function_privilege('service_role', '${fn}', 'execute') as service_can;
    `);
    check(
      `${fn.split("(")[0].replace("public.", "")} is service_role only`,
      grants.anon_can === false && grants.authenticated_can === false && grants.service_can === true,
      JSON.stringify(grants),
    );
  }

  const [paymentFnMeta] = await q(`
    select p.prosecdef as is_definer,
           coalesce(array_to_string(p.proconfig, ','), '') as config
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'confirm_booking_payment';
  `);
  check("payment confirmation is SECURITY DEFINER", paymentFnMeta?.is_definer === true);
  check(
    "payment confirmation pins search_path",
    (paymentFnMeta?.config ?? "").includes("search_path=public"),
    paymentFnMeta?.config ?? "",
  );

  const tokenIndex = await q(`
    select indexdef from pg_indexes
    where schemaname = 'public' and tablename = 'bookings' and indexname = 'bookings_public_token_idx';
  `);
  check(
    "public tokens are unique at the database level",
    tokenIndex.length === 1 && /unique/i.test(tokenIndex[0].indexdef),
    tokenIndex[0]?.indexdef ?? "missing",
  );

  const eventsRls = await (async () => {
    await run("set role anon;");
    try {
      const rows = await q("select count(*)::int as n from public.payment_events;");
      return { rows: rows[0].n, error: null };
    } catch (error) {
      return { rows: null, error: error.message };
    } finally {
      await run("reset role;");
    }
  })();
  check(
    "anon cannot read payment_events",
    eventsRls.error !== null || eventsRls.rows === 0,
    JSON.stringify(eventsRls),
  );

  // ---- order attachment ------------------------------------------------------
  const payA = await createBooking({ p_customer_mobile: "+919800000101", p_idempotency_key: "pay-key-1" });
  check("a new booking gets a public token", /^[0-9a-f-]{36}$/.test(payA.public_token), payA.public_token);

  const attached = (await rpc("attach_razorpay_order", {
    p_booking_id: payA.booking_uuid,
    p_razorpay_order_id: ORDER_1,
  }))[0];
  check("the order id is stored on the pending booking", attached.razorpay_order_id === ORDER_1 && attached.attached === true);
  check(
    "the booking row keeps the order id",
    (await q(`select razorpay_order_id from public.bookings where id = '${payA.booking_uuid}';`))[0]
      .razorpay_order_id === ORDER_1,
  );

  const attachedAgain = (await rpc("attach_razorpay_order", {
    p_booking_id: payA.booking_uuid,
    p_razorpay_order_id: ORDER_2,
  }))[0];
  check(
    "attaching twice reuses the first order (no second order for one booking)",
    attachedAgain.razorpay_order_id === ORDER_1 && attachedAgain.attached === false,
    JSON.stringify(attachedAgain),
  );

  const attachUnknown = await rpcError("attach_razorpay_order", {
    p_booking_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    p_razorpay_order_id: ORDER_3,
  });
  check("attaching an order to an unknown booking fails", attachUnknown?.code === "PC004", attachUnknown?.code ?? "no error");

  // ---- confirmation ---------------------------------------------------------
  const unknownOrder = await rpcError("confirm_booking_payment", {
    p_razorpay_order_id: "order_TEST999999999999",
    p_razorpay_payment_id: PAYMENT_1,
    p_amount_paise: 99800,
  });
  check("an unknown order cannot be confirmed", unknownOrder?.code === "PC001", unknownOrder?.code ?? "no error");

  const wrongAmount = await rpcError("confirm_booking_payment", {
    p_razorpay_order_id: ORDER_1,
    p_razorpay_payment_id: PAYMENT_1,
    p_amount_paise: 100,
  });
  check("a payment below the booking amount is rejected", wrongAmount?.code === "PC002", wrongAmount?.code ?? "no error");

  const noPaymentId = await rpcError("confirm_booking_payment", {
    p_razorpay_order_id: ORDER_1,
    p_razorpay_payment_id: null,
    p_amount_paise: 99800,
  });
  check("a confirmation without a payment id is rejected", noPaymentId?.code === "PC005", noPaymentId?.code ?? "no error");

  const confirmed = (await rpc("confirm_booking_payment", {
    p_razorpay_order_id: ORDER_1,
    p_razorpay_payment_id: PAYMENT_1,
    p_amount_paise: 99800,
  }))[0];
  check("a verified payment marks the booking paid", confirmed.payment_status === "paid", confirmed.payment_status);
  check("a verified payment confirms the booking", confirmed.booking_status === "confirmed", confirmed.booking_status);
  check("confirmation is not flagged as a replay", confirmed.already_confirmed === false);
  check("one digital pass per purchased pass is issued", confirmed.passes_issued === 2, `${confirmed.passes_issued}`);

  const paidRow = (
    await q(`select payment_status, booking_status, razorpay_payment_id from public.bookings where id = '${payA.booking_uuid}';`)
  )[0];
  check(
    "the booking row stores paid + confirmed + the payment id",
    paidRow.payment_status === "paid" && paidRow.booking_status === "confirmed" && paidRow.razorpay_payment_id === PAYMENT_1,
    JSON.stringify(paidRow),
  );

  const passRows = await q(
    `select status, valid_date from public.digital_passes where booking_id = '${payA.booking_uuid}';`,
  );
  check("exactly two passes exist for a quantity-2 booking", passRows.length === 2, `${passRows.length} passes`);
  check(
    "each pass is active and valid on the booked night",
    passRows.every((row) => row.status === "active" && new Date(row.valid_date).toISOString().slice(0, 10) === "2026-10-14"),
    JSON.stringify(passRows),
  );

  const replayConfirm = (await rpc("confirm_booking_payment", {
    p_razorpay_order_id: ORDER_1,
    p_razorpay_payment_id: PAYMENT_1,
    p_amount_paise: 99800,
  }))[0];
  check("a repeated confirmation is reported as already confirmed", replayConfirm.already_confirmed === true);
  check("the replay issues no extra passes", replayConfirm.passes_issued === 2, `${replayConfirm.passes_issued}`);
  check(
    "the pass count did not grow on replay",
    (await q(`select count(*)::int as n from public.digital_passes where booking_id = '${payA.booking_uuid}';`))[0].n === 2,
  );

  const payB = await createBooking({ p_customer_mobile: "+919800000102", p_idempotency_key: "pay-key-2" });
  await rpc("attach_razorpay_order", { p_booking_id: payB.booking_uuid, p_razorpay_order_id: ORDER_2 });
  const reusedPayment = await rpcError("confirm_booking_payment", {
    p_razorpay_order_id: ORDER_2,
    p_razorpay_payment_id: PAYMENT_1,
    p_amount_paise: 99800,
  });
  check("one payment cannot confirm a second booking", reusedPayment?.code === "PC003", reusedPayment?.code ?? "no error");

  const confirmedB = (await rpc("confirm_booking_payment", {
    p_razorpay_order_id: ORDER_2,
    p_razorpay_payment_id: PAYMENT_2,
    p_amount_paise: 99800,
  }))[0];
  check("the second booking confirms with its own payment", confirmedB.payment_status === "paid");

  // Capacity can still run out between checkout and payment: that must never
  // silently drop a paid booking.
  const payC = await createBooking({ p_customer_mobile: "+919800000103", p_idempotency_key: "pay-key-3" });
  await rpc("attach_razorpay_order", { p_booking_id: payC.booking_uuid, p_razorpay_order_id: ORDER_3 });

  // The organiser re-counts the room and finds it holds exactly what is already
  // sold. Lowering the capacity *to* the people paid for is allowed — it takes
  // nothing away from anybody — while lowering it below them is refused (PT004,
  // checked further down). The pending booking now has nowhere to go.
  const [nightRoom] = await q(`
    select coalesce(sum(b.number_of_people) filter (where b.payment_status = 'paid'), 0)::integer as paid
      from public.bookings b where b.event_date_id = '${NIGHT_FREE}';
  `);
  await run(`update public.event_dates set capacity = ${nightRoom.paid} where id = '${NIGHT_FREE}';`);
  const overflow = (await rpc("confirm_booking_payment", {
    p_razorpay_order_id: ORDER_3,
    p_razorpay_payment_id: PAYMENT_3,
    p_amount_paise: 99800,
  }))[0];
  check("a paid booking is still confirmed when the night filled up", overflow.booking_status === "confirmed");
  check(
    "the overflow is recorded for the organiser instead of dropping the booking",
    typeof overflow.capacity_note === "string" && /capacity exceeded/.test(overflow.capacity_note),
    overflow.capacity_note ?? "",
  );
  await run(`update public.event_dates set capacity = 1500 where id = '${NIGHT_FREE}';`);

  // ---- failure and refund ---------------------------------------------------
  const payD = await createBooking({ p_customer_mobile: "+919800000104", p_idempotency_key: "pay-key-4" });
  await rpc("attach_razorpay_order", { p_booking_id: payD.booking_uuid, p_razorpay_order_id: "order_TEST000000000004" });
  const failedOutcome = (await rpc("fail_booking_payment", {
    p_razorpay_order_id: "order_TEST000000000004",
    p_razorpay_payment_id: "pay_TEST000000000004",
  }))[0].fail_booking_payment;
  check("a failed payment is recorded", failedOutcome === "failed", failedOutcome);
  check(
    "the booking stays pending but is marked failed",
    (await q(`select booking_status, payment_status from public.bookings where id = '${payD.booking_uuid}';`))[0]
      .payment_status === "failed",
  );
  const failPaid = (await rpc("fail_booking_payment", {
    p_razorpay_order_id: ORDER_1,
    p_razorpay_payment_id: "pay_TEST000000000099",
  }))[0].fail_booking_payment;
  check("a late failure never downgrades a paid booking", failPaid === "already_paid", failPaid);

  const refunded = (await rpc("refund_booking_payment", { p_razorpay_payment_id: PAYMENT_2 }))[0].refund_booking_payment;
  check("a refund marks the booking refunded", refunded === "refunded", refunded);
  check(
    "refunded bookings and their passes are updated together",
    (await q(`select booking_status, payment_status from public.bookings where id = '${payB.booking_uuid}';`))[0]
      .booking_status === "refunded" &&
      (await q(`select count(*)::int as n from public.digital_passes where booking_id = '${payB.booking_uuid}' and status = 'cancelled';`))[0]
        .n === 2,
  );
  const refundAgain = (await rpc("refund_booking_payment", { p_razorpay_payment_id: PAYMENT_2 }))[0]
    .refund_booking_payment;
  check("a repeated refund is idempotent", refundAgain === "already_refunded", refundAgain);

  // ---- webhook dispatcher ---------------------------------------------------
  const payE = await createBooking({ p_customer_mobile: "+919800000105", p_idempotency_key: "pay-key-5" });
  const ORDER_5 = "order_TEST000000000005";
  const PAYMENT_5 = "pay_TEST000000000005";
  await rpc("attach_razorpay_order", { p_booking_id: payE.booking_uuid, p_razorpay_order_id: ORDER_5 });

  const ignoredOrderPaid = (await rpc("apply_razorpay_event", {
    p_event_id: "evt_order_paid_no_payment",
    p_event_type: "order.paid",
    p_razorpay_order_id: ORDER_5,
    p_razorpay_payment_id: null,
    p_amount_paise: 99800,
  }))[0];
  check(
    "an order.paid delivery without a payment id is recorded and left alone",
    ignoredOrderPaid.duplicate === false && ignoredOrderPaid.outcome === "ignored",
    JSON.stringify(ignoredOrderPaid),
  );

  const captured = (await rpc("apply_razorpay_event", {
    p_event_id: "evt_captured_1",
    p_event_type: "payment.captured",
    p_razorpay_order_id: ORDER_5,
    p_razorpay_payment_id: PAYMENT_5,
    p_amount_paise: 99800,
  }))[0];
  check("payment.captured confirms the booking", captured.outcome === "confirmed", captured.outcome);
  check("the webhook reports the booking reference", captured.booking_reference === payE.booking_reference);
  check("the webhook reports the passes it issued", captured.passes_issued === 2, `${captured.passes_issued}`);

  const duplicateDelivery = (await rpc("apply_razorpay_event", {
    p_event_id: "evt_captured_1",
    p_event_type: "payment.captured",
    p_razorpay_order_id: ORDER_5,
    p_razorpay_payment_id: PAYMENT_5,
    p_amount_paise: 99800,
  }))[0];
  check("a retried delivery is recognised as a duplicate", duplicateDelivery.duplicate === true && duplicateDelivery.outcome === "duplicate");
  check(
    "the duplicate delivery did not issue more passes",
    (await q(`select count(*)::int as n from public.digital_passes where booking_id = '${payE.booking_uuid}';`))[0].n === 2,
  );
  check(
    "the booking was confirmed exactly once (one payment id)",
    (await q(`select count(*)::int as n from public.bookings where razorpay_payment_id = '${PAYMENT_5}';`))[0].n === 1,
  );

  const foreignOrder = (await rpc("apply_razorpay_event", {
    p_event_id: "evt_unknown_order",
    p_event_type: "payment.captured",
    p_razorpay_order_id: "order_TEST_NOT_OURS",
    p_razorpay_payment_id: "pay_TEST000000000099",
    p_amount_paise: 100,
  }))[0];
  check("an event for an order we do not know is ignored", foreignOrder.outcome === "ignored", foreignOrder.outcome);

  const payF = await createBooking({ p_customer_mobile: "+919800000106", p_idempotency_key: "pay-key-6" });
  const ORDER_6 = "order_TEST000000000006";
  await rpc("attach_razorpay_order", { p_booking_id: payF.booking_uuid, p_razorpay_order_id: ORDER_6 });
  const failedEvent = (await rpc("apply_razorpay_event", {
    p_event_id: "evt_failed_1",
    p_event_type: "payment.failed",
    p_razorpay_order_id: ORDER_6,
    p_razorpay_payment_id: "pay_TEST000000000006",
    p_amount_paise: 99800,
  }))[0];
  check("payment.failed marks the pending booking failed", failedEvent.outcome === "failed", failedEvent.outcome);

  const refundEvent = (await rpc("apply_razorpay_event", {
    p_event_id: "evt_refund_1",
    p_event_type: "refund.processed",
    p_razorpay_order_id: ORDER_5,
    p_razorpay_payment_id: PAYMENT_5,
    p_amount_paise: 99800,
  }))[0];
  check("refund.processed refunds the booking", refundEvent.outcome === "refunded", refundEvent.outcome);
  check(
    "refunded passes are cancelled",
    (await q(`select count(*)::int as n from public.digital_passes where booking_id = '${payE.booking_uuid}' and status = 'cancelled';`))[0].n === 2,
  );

  const eventRows = await q(`select event_id, event_type, outcome, processed_at from public.payment_events order by received_at;`);
  check("every unique delivery is recorded exactly once", eventRows.length === 5, `${eventRows.length} rows`);
  check(
    "a retried delivery is not recorded twice",
    (await q(`select count(*)::int as n from public.payment_events where event_id = 'evt_captured_1';`))[0].n === 1,
  );
  check(
    "each delivery records the ids it carried",
    (await q(`select razorpay_order_id, razorpay_payment_id from public.payment_events where event_id = 'evt_captured_1';`))[0]
      .razorpay_payment_id === PAYMENT_5,
  );
  check("every recorded delivery has an outcome and a timestamp", eventRows.every((row) => row.outcome && row.processed_at !== null));
  check(
    "deliveries are unique by event id",
    new Set(eventRows.map((row) => row.event_id)).size === eventRows.length,
  );

  // ---- customer-facing status lookup ----------------------------------------
  const status = (await rpc("get_booking_status", { p_public_token: payA.public_token }))[0];
  check("the customer can look their booking up by token", status.booking_reference === payA.booking_reference);
  check("the status view reports the pass count", status.passes_issued === 2, `${status.passes_issued}`);
  check("the status view carries no personal details", !("customer_mobile" in status) && !("customer_email" in status));
  check("the status view names the event and night", status.event_name === "Garba Nights Navratri Utsav" && Boolean(status.event_date));
  const unknownToken = await rpc("get_booking_status", { p_public_token: "ffffffff-ffff-4fff-8fff-ffffffffffff" });
  check("an unknown token returns nothing", unknownToken.length === 0);

  // ---------------------------------------------------------------------------
  section("Digital pass: slots, QR tokens, ticket reads");
  // ---------------------------------------------------------------------------
  const slotIndex = await q(`
    select indexdef from pg_indexes
    where schemaname = 'public' and indexname = 'digital_passes_booking_pass_number_idx';
  `);
  check(
    "one pass per slot is enforced by a unique index",
    slotIndex.length === 1 && /unique/i.test(slotIndex[0].indexdef),
    slotIndex[0]?.indexdef ?? "missing",
  );

  const [qrTokenIndex] = await q(`
    select indexdef from pg_indexes
    where schemaname = 'public' and indexname = 'digital_passes_qr_token_key';
  `);
  check("QR tokens are unique", /unique/i.test(qrTokenIndex?.indexdef ?? ""), qrTokenIndex?.indexdef ?? "missing");

  const passesOfA = await rpc("get_booking_passes", { p_public_token: payA.public_token });
  check("the customer's own passes come back for a paid booking", passesOfA.length === 2, `${passesOfA.length} rows`);
  check(
    "every pass has a human-readable id",
    passesOfA.every((row) => /^PS-\d{6}$/.test(row.pass_id)),
    passesOfA.map((row) => row.pass_id).join(", "),
  );
  check(
    "passes are numbered 1..quantity",
    JSON.stringify(passesOfA.map((row) => row.pass_number)) === JSON.stringify([1, 2]),
    passesOfA.map((row) => row.pass_number).join(", "),
  );
  check("the ticket knows how many passes the booking has", passesOfA.every((row) => row.pass_total === 2));
  check(
    "every QR token is 64 hex characters of random",
    passesOfA.every((row) => /^[0-9a-f]{64}$/.test(row.qr_token)),
    passesOfA.map((row) => row.qr_token.slice(0, 12)).join(", "),
  );
  check(
    "the two tokens are different",
    passesOfA[0].qr_token !== passesOfA[1].qr_token,
  );
  check(
    "no token leaks the booking reference or the pass id",
    passesOfA.every((row) => !row.qr_token.includes("DND") && !row.qr_token.includes("PS")),
  );
  check(
    "a pass read carries no mobile number or email",
    !Object.keys(passesOfA[0]).some((key) => /mobile|email/i.test(key)),
    Object.keys(passesOfA[0]).join(", "),
  );
  check(
    "the stored pass rows match the read function",
    (await q(`select count(*)::int as n from public.digital_passes where booking_id = '${payA.booking_uuid}';`))[0].n === 2,
  );

  // The database, not a code path, is what stops a booking from having two pass 1s.
  const duplicateSlot = await (async () => {
    try {
      await q(`
        insert into public.digital_passes (booking_id, valid_date, pass_number)
        values ('${payA.booking_uuid}', '2026-10-14', 1);
      `);
      return null;
    } catch (error) {
      return error;
    }
  })();
  check(
    "a booking cannot get a second pass in the same slot",
    duplicateSlot?.code === "23505",
    `${duplicateSlot?.code ?? "insert succeeded"}`,
  );

  const zeroSlot = await (async () => {
    try {
      await q(`
        insert into public.digital_passes (booking_id, valid_date, pass_number)
        values ('${payA.booking_uuid}', '2026-10-14', 0);
      `);
      return null;
    } catch (error) {
      return error;
    }
  })();
  check("a pass slot must be at least 1", zeroSlot?.code === "23514", `${zeroSlot?.code ?? "insert succeeded"}`);

  const [ticket] = await rpc("get_pass_by_token", { p_qr_token: passesOfA[0].qr_token });
  check("the QR token resolves to its pass", ticket?.pass_id === passesOfA[0].pass_id, ticket?.pass_id ?? "none");
  check("the ticket names the event", ticket?.event_name === "Garba Nights Navratri Utsav", ticket?.event_name ?? "");
  const [bookedGuest] = await q(`select customer_name from public.bookings where id = '${payA.booking_uuid}';`);
  check("the ticket names the guest on the booking", ticket?.customer_name === bookedGuest.customer_name, ticket?.customer_name ?? "");
  check("the ticket names the pass category", Boolean(ticket?.pass_name), ticket?.pass_name ?? "");
  check("the ticket carries the booking reference", /^DND\d{9}$/.test(ticket?.booking_reference ?? ""), ticket?.booking_reference ?? "");
  check("the ticket reports the payment as paid", ticket?.payment_status === "paid", ticket?.payment_status ?? "");
  check("the ticket starts valid", ticket?.pass_status === "active" && ticket?.checked_in === false);
  check("the ticket knows which pass of how many it is", ticket?.pass_number === 1 && ticket?.pass_total === 2);
  check("the ticket says which night it admits", new Date(ticket?.valid_date).toISOString().slice(0, 10) === "2026-10-14");
  check(
    "the ticket read carries no mobile number or email",
    !Object.keys(ticket).some((key) => /mobile|email/i.test(key)),
    Object.keys(ticket).join(", "),
  );

  const unknownQrToken = await rpc("get_pass_by_token", { p_qr_token: "0".repeat(64) });
  check("an unknown QR token resolves to nothing", unknownQrToken.length === 0);

  // A gate scan flips the pass; the reads have to show it.
  await run(`
    update public.digital_passes
    set checked_in = true, checked_in_at = now(), status = 'used'
    where booking_id = '${payA.booking_uuid}' and pass_number = 1;
  `);
  const [scanned] = await rpc("get_pass_by_token", { p_qr_token: passesOfA[0].qr_token });
  check("a scanned pass reports as used and checked in", scanned?.pass_status === "used" && scanned?.checked_in === true);
  check("a scanned pass keeps its check-in time", Boolean(scanned?.checked_in_at));
  await run(`
    update public.digital_passes
    set checked_in = false, checked_in_at = null, status = 'active'
    where booking_id = '${payA.booking_uuid}' and pass_number = 1;
  `);

  // Refunds cancel passes: the same read must show it, not a stale VALID.
  const refundedPasses = await rpc("get_booking_passes", { p_public_token: payB.public_token });
  check(
    "a refunded booking's passes read as cancelled",
    refundedPasses.length === 2 && refundedPasses.every((row) => row.pass_status === "cancelled"),
    refundedPasses.map((row) => row.pass_status).join(", "),
  );

  const noPassesBooking = await createBooking({ p_customer_mobile: "+919800000107", p_idempotency_key: "pay-key-7" });
  check(
    "a booking without passes returns no rows",
    (await rpc("get_booking_passes", { p_public_token: noPassesBooking.public_token })).length === 0,
  );

  const [duplicateReplay] = await rpc("confirm_booking_payment", {
    p_razorpay_order_id: ORDER_1,
    p_razorpay_payment_id: PAYMENT_1,
    p_amount_paise: 99800,
  });
  check("re-confirming does not add a pass", duplicateReplay.passes_issued === 2, `${duplicateReplay.passes_issued}`);
  check(
    "the booking still has exactly one pass per slot",
    (await q(`
      select count(*)::int as n, count(distinct pass_number)::int as slots
      from public.digital_passes where booking_id = '${payA.booking_uuid}';
    `))[0].n === 2 &&
      (await q(`select count(distinct pass_number)::int as slots from public.digital_passes where booking_id = '${payA.booking_uuid}';`))[0]
        .slots === 2,
  );

  for (const [fn, signature] of [
    ["get_booking_passes", "uuid"],
    ["get_pass_by_token", "text"],
  ]) {
    const [grants] = await q(`
      select has_function_privilege('anon', 'public.${fn}(${signature})', 'execute') as anon_can,
             has_function_privilege('authenticated', 'public.${fn}(${signature})', 'execute') as authenticated_can,
             has_function_privilege('service_role', 'public.${fn}(${signature})', 'execute') as service_can;
    `);
    check(
      `${fn} is service_role only`,
      grants.anon_can === false && grants.authenticated_can === false && grants.service_can === true,
      JSON.stringify(grants),
    );
  }

  const scanStraightFromTable = await (async () => {
    await run("set role anon;");
    try {
      await q(`select pass_id, qr_token from public.digital_passes;`);
      return { rows: true, error: null };
    } catch (error) {
      return { rows: false, error: error.message };
    } finally {
      await run("reset role;");
    }
  })();
  check(
    "anon cannot read digital passes",
    scanStraightFromTable.rows === false,
    scanStraightFromTable.error ?? "rows were returned",
  );

  // ---------------------------------------------------------------------------
  section("Gate check-in: scan a pass, admit a guest exactly once");
  // ---------------------------------------------------------------------------
  // The gate date is a parameter: the server computes it from the venue's timezone
  // (src/config/site.ts) and never takes it from a browser. Here it is the night the
  // passes are actually for.
  const gateStaffId = scannerId;
  const [gateNightRow] = await q(
    `select event_date::text as gate_date, status from public.event_dates where id = '${NIGHT_FREE}';`,
  );
  const gateDate = gateNightRow.gate_date;
  const gatePasses = await rpc("get_booking_passes", { p_public_token: payA.public_token });
  const gateToken = gatePasses[0].qr_token;
  const [gatePassRow] = await q(
    `select id::text as id, checked_in_at::text as checked_in_at from public.digital_passes where qr_token = '${gateToken}';`,
  );
  const [gateBookingRow] = await q(
    `select customer_name, booking_id from public.bookings where id = '${payA.booking_uuid}';`,
  );

  const gateScan = async (overrides = {}) =>
    (
      await rpc("scan_pass", {
        p_qr_token: gateToken,
        p_gate_date: gateDate,
        p_staff_user_id: gateStaffId,
        ...overrides,
      })
    )[0];

  const gateCheckIn = async (overrides = {}) =>
    (
      await rpc("check_in_pass", {
        p_qr_token: gateToken,
        p_gate_date: gateDate,
        p_staff_user_id: gateStaffId,
        ...overrides,
      })
    )[0];

  const gateEntryRows = async () =>
    Number(
      (
        await q(`select count(*)::int as n from public.check_ins where digital_pass_id = '${gatePassRow.id}';`)
      )[0].n,
    );

  // ---- the preview: everything the scanner shows before the button is pressed --
  const gatePreview = await gateScan();
  check("a paid, unused pass for tonight scans as valid", gatePreview.outcome === "valid", gatePreview.outcome ?? "");
  check(
    "the scan returns the guest, the pass and the booking",
    gatePreview.customer_name === gateBookingRow.customer_name &&
      gatePreview.booking_reference === gateBookingRow.booking_id &&
      /^PS-\d{6}$/.test(gatePreview.pass_id ?? ""),
    `${gatePreview.customer_name} / ${gatePreview.booking_reference}`,
  );
  check(
    "the scan confirms the booking is confirmed and paid",
    gatePreview.booking_status === "confirmed" && gatePreview.payment_status === "paid",
    `${gatePreview.booking_status}/${gatePreview.payment_status}`,
  );
  check(
    "the scan reports the night and which pass of how many",
    gatePreview.gate_date === gateDate && gatePreview.pass_number === 1 && gatePreview.pass_total === 2,
    `${gatePreview.pass_number}/${gatePreview.pass_total}`,
  );
  check(
    "the scan carries no mobile number or email address",
    !Object.keys(gatePreview).some((key) => /mobile|email|token/i.test(key)),
    Object.keys(gatePreview).join(", "),
  );
  check(
    "a preview writes nothing",
    (await q(`select checked_in from public.digital_passes where id = '${gatePassRow.id}';`))[0].checked_in === false,
  );

  // ---- who is allowed to ask --------------------------------------------------
  const gateUnknownStaff = await gateScan({ p_staff_user_id: "ffffffff-ffff-4fff-8fff-ffffffffffff" });
  check(
    "an unknown staff id is refused and learns nothing",
    gateUnknownStaff.outcome === "not_authorised" && gateUnknownStaff.pass_id === null,
    `${gateUnknownStaff.outcome} ${gateUnknownStaff.pass_id ?? ""}`,
  );

  const gateNullStaff = await gateScan({ p_staff_user_id: null });
  check("a scan without a staff id is refused", gateNullStaff.outcome === "not_authorised", gateNullStaff.outcome ?? "");

  const inactiveStaffUserId = "aaaa0000-0000-4000-8000-0000000000ff";
  await run(`
    insert into auth.users (id, email) values ('${inactiveStaffUserId}', 'suspended@example.com');
    insert into public.admin_users (user_id, email, full_name, role, is_active)
    values ('${inactiveStaffUserId}', 'suspended@example.com', 'Suspended Scanner', 'staff', false);
  `);
  const gateInactiveStaff = await gateScan({ p_staff_user_id: inactiveStaffUserId });
  check(
    "a deactivated staff account cannot scan passes",
    gateInactiveStaff.outcome === "not_authorised",
    gateInactiveStaff.outcome ?? "",
  );

  // ---- the check-in ------------------------------------------------------------
  const gateFirst = await gateCheckIn({ p_gate: "Gate A" });
  check("the guest is checked in", gateFirst.outcome === "checked_in", gateFirst.outcome ?? "");
  check("the check-in reports the staff member who did it", gateFirst.staff_name === "scanner@example.com", gateFirst.staff_name ?? "");
  check("the check-in returns the audit row id", typeof gateFirst.check_in_id === "string", `${gateFirst.check_in_id}`);

  const [gateUsedRow] = await q(
    `select checked_in, status, checked_in_at::text as checked_in_at from public.digital_passes where id = '${gatePassRow.id}';`,
  );
  check("the pass row is marked used and checked in", gateUsedRow.checked_in === true && gateUsedRow.status === "used", JSON.stringify(gateUsedRow));
  check("the pass stores when it was checked in", Boolean(gateUsedRow.checked_in_at));

  const [gateEntry] = await q(`
    select ci.checked_in_at::text as checked_in_at,
           ci.gate,
           ci.notes,
           ci.event_date_id::text as event_date_id,
           au.email as staff_email
    from public.check_ins ci
    left join public.admin_users au on au.id = ci.checked_in_by
    where ci.digital_pass_id = '${gatePassRow.id}';
  `);
  check("a check_ins row is written", Boolean(gateEntry));
  check("the entry records the staff member", gateEntry.staff_email === "scanner@example.com", gateEntry.staff_email ?? "");
  check(
    "the entry records the gate and the source",
    gateEntry.gate === "Gate A" && gateEntry.notes === "web scanner",
    `${gateEntry.gate} / ${gateEntry.notes}`,
  );
  check("the entry is logged against the night of the pass", gateEntry.event_date_id === NIGHT_FREE, gateEntry.event_date_id ?? "");
  check(
    "the entry timestamp is the pass's check-in time",
    gateEntry.checked_in_at === gateUsedRow.checked_in_at,
    `${gateEntry.checked_in_at} vs ${gateUsedRow.checked_in_at}`,
  );
  check("exactly one entry row exists for the pass", (await gateEntryRows()) === 1, `${await gateEntryRows()}`);

  // ---- the second scanner ------------------------------------------------------
  const gateSecond = await gateCheckIn({ p_gate: "Gate B" });
  check("a second check-in reports the pass as already used", gateSecond.outcome === "already_used", gateSecond.outcome ?? "");
  check(
    "the second scan does not move the check-in time",
    (await q(`select checked_in_at::text as t from public.digital_passes where id = '${gatePassRow.id}';`))[0].t ===
      gateUsedRow.checked_in_at,
  );
  check("the second scan writes no second entry", (await gateEntryRows()) === 1, `${await gateEntryRows()}`);
  check(
    "the second scan reports the first entry's time",
    new Date(gateSecond.checked_in_at).toISOString() === new Date(gateUsedRow.checked_in_at).toISOString(),
    `${gateSecond.checked_in_at} vs ${gateUsedRow.checked_in_at}`,
  );
  check(
    "the second scan does not overwrite the gate that admitted the guest",
    (await q(`select gate from public.check_ins where digital_pass_id = '${gatePassRow.id}';`))[0].gate === "Gate A",
  );
  const gateScanUsed = await gateScan();
  check("a used pass no longer scans as valid", gateScanUsed.outcome === "already_used", gateScanUsed.outcome ?? "");

  // The losing half of a race cannot flip the pass again: the write is conditional
  // on the pass still being unused, so the row count is what decides the winner.
  const gateCasLoser = await q(`
    update public.digital_passes
    set checked_in = true, checked_in_at = now(), status = 'used'
    where id = '${gatePassRow.id}' and checked_in = false and status = 'active'
    returning id;
  `);
  check("the compare-and-swap lets exactly one scanner win", gateCasLoser.length === 0, `${gateCasLoser.length} rows updated`);

  const gateDuplicateEntry = await expectError(
    `insert into public.check_ins (digital_pass_id, event_date_id) values ('${gatePassRow.id}', '${NIGHT_FREE}');`,
  );
  check(
    "the database refuses a second entry row for one pass",
    /check_ins_one_per_pass|duplicate key/i.test(gateDuplicateEntry ?? ""),
    gateDuplicateEntry ?? "the insert succeeded",
  );

  // ---- every way a pass can be refused ----------------------------------------
  const gateSecondPassToken = gatePasses[1].qr_token;
  const gateYesterday = await q(`select ('${gateDate}'::date - 1)::text as d;`);
  const gateTomorrow = await q(`select ('${gateDate}'::date + 1)::text as d;`);

  const gateNotYet = await gateScan({ p_qr_token: gateSecondPassToken, p_gate_date: gateYesterday[0].d });
  check("a pass for a later night is refused as not yet valid", gateNotYet.outcome === "not_yet_valid", gateNotYet.outcome ?? "");
  const gateExpired = await gateScan({ p_qr_token: gateSecondPassToken, p_gate_date: gateTomorrow[0].d });
  check("a pass for a night that has passed is refused as expired", gateExpired.outcome === "expired", gateExpired.outcome ?? "");
  check(
    "a refused scan leaves the pass untouched",
    (await q(`select checked_in from public.digital_passes where qr_token = '${gateSecondPassToken}';`))[0].checked_in === false,
  );
  const gateWrongNightCheckIn = await gateCheckIn({ p_qr_token: gateSecondPassToken, p_gate_date: gateTomorrow[0].d });
  check(
    "the check-in refuses a pass for another night too",
    gateWrongNightCheckIn.outcome === "expired",
    gateWrongNightCheckIn.outcome ?? "",
  );

  const gateUnknownToken = await gateScan({ p_qr_token: "a".repeat(64) });
  check("an unknown token is refused as invalid", gateUnknownToken.outcome === "invalid", gateUnknownToken.outcome ?? "");
  check("an unknown token returns no pass details", gateUnknownToken.pass_id === null && gateUnknownToken.customer_name === null);
  const gateMalformed = await gateScan({ p_qr_token: "PS-000001" });
  check("a malformed code is refused without a lookup", gateMalformed.outcome === "invalid", gateMalformed.outcome ?? "");
  const gateNullToken = await gateScan({ p_qr_token: null });
  check("a missing code is refused", gateNullToken.outcome === "invalid", gateNullToken.outcome ?? "");

  // A pass whose booking was never paid: the row can exist (a failed callback leaves
  // the booking unpaid) but the guest must not be admitted.
  const gateUnpaidBooking = await createBooking({
    p_customer_mobile: "+919800000122",
    p_idempotency_key: "gate-unpaid",
  });
  await run(`
    insert into public.digital_passes (booking_id, valid_date, pass_number)
    values ('${gateUnpaidBooking.booking_uuid}', '${gateDate}', 1);
  `);
  const gateUnpaidToken = (await q(`
    select qr_token from public.digital_passes
    where booking_id = '${gateUnpaidBooking.booking_uuid}';
  `))[0].qr_token;
  const gateUnpaid = await gateCheckIn({ p_qr_token: gateUnpaidToken });
  check("a pass on an unpaid booking is refused", gateUnpaid.outcome === "payment_not_verified", gateUnpaid.outcome ?? "");
  check(
    "the refused pass is not marked used",
    (await q(`select checked_in from public.digital_passes where qr_token = '${gateUnpaidToken}';`))[0].checked_in === false,
  );

  // A refunded booking cancels its passes, so its codes must never open the gate.
  const gateRefundedPasses = await rpc("get_booking_passes", { p_public_token: payB.public_token });
  const gateRefunded = await gateCheckIn({ p_qr_token: gateRefundedPasses[0].qr_token });
  check("a refunded booking's pass is refused", gateRefunded.outcome === "refunded", gateRefunded.outcome ?? "");
  check(
    "the refund refusal names the booking state",
    /refund|cancel/i.test(gateRefunded.reason ?? ""),
    gateRefunded.reason ?? "",
  );

  // A cancelled night takes nobody, whatever the pass says.
  await run(`update public.event_dates set status = 'cancelled' where id = '${NIGHT_FREE}';`);
  const gateCancelledNight = await gateScan({ p_qr_token: gateSecondPassToken });
  check("a cancelled night refuses every pass", gateCancelledNight.outcome === "invalid", gateCancelledNight.outcome ?? "");
  check("the refusal explains why", /not taking place/i.test(gateCancelledNight.reason ?? ""), gateCancelledNight.reason ?? "");
  await run(
    `update public.event_dates set status = '${gateNightRow.status}' where id = '${NIGHT_FREE}';`,
  );
  check(
    "the night fixture is restored",
    (await q(`select status from public.event_dates where id = '${NIGHT_FREE}';`))[0].status === gateNightRow.status,
  );

  // ---- grants ------------------------------------------------------------------
  for (const [fn, signature] of [
    ["scan_pass", "text, date, uuid"],
    ["check_in_pass", "text, date, uuid, text"],
  ]) {
    const [grants] = await q(`
      select has_function_privilege('anon', 'public.${fn}(${signature})', 'execute') as anon_can,
             has_function_privilege('authenticated', 'public.${fn}(${signature})', 'execute') as authenticated_can,
             has_function_privilege('service_role', 'public.${fn}(${signature})', 'execute') as service_can;
    `);
    check(
      `${fn} is service_role only`,
      grants.anon_can === false && grants.authenticated_can === false && grants.service_can === true,
      JSON.stringify(grants),
    );
  }

  const gateInternalPrivilege = await q(
    `select has_function_privilege('service_role', 'public.pass_entry(text, date, uuid, boolean, text)', 'execute') as can;`,
  );
  check(
    "the verdict implementation itself is not callable by any role",
    gateInternalPrivilege[0].can === false,
    `${gateInternalPrivilege[0].can}`,
  );

  const gateAnonAttempt = await (async () => {
    await run("set role anon;");

    try {
      await q(`select * from public.check_in_pass('${gateSecondPassToken}', '${gateDate}', '${gateStaffId}');`);
      return null;
    } catch (error) {
      return error;
    } finally {
      await run("reset role;");
    }
  })();
  check("a browser key cannot check anybody in", gateAnonAttempt !== null, gateAnonAttempt ? "refused" : "allowed");
  check(
    "the second pass is still unused after every refusal",
    (await q(`select checked_in from public.digital_passes where qr_token = '${gateSecondPassToken}';`))[0]
      .checked_in === false,
  );

  // ---------------------------------------------------------------------------
  section("Admin roles: three roles, enforced in the database");
  // ---------------------------------------------------------------------------
  // The allow-list is the authorisation table. These checks pin down what each role
  // means *inside* Postgres — the app's permission model is only as good as this.
  const roleSuperId = "aaaa0000-0000-4000-8000-000000000011";
  const roleAdminId = "aaaa0000-0000-4000-8000-000000000012";
  const roleStaffId = "aaaa0000-0000-4000-8000-000000000013";
  const roleInactiveId = "aaaa0000-0000-4000-8000-000000000014";

  await run(`
    insert into auth.users (id, email) values
      ('${roleSuperId}', 'super@example.com'),
      ('${roleAdminId}', 'admin2@example.com'),
      ('${roleStaffId}', 'staff2@example.com'),
      ('${roleInactiveId}', 'inactive-super@example.com');

    insert into public.admin_users (user_id, email, full_name, role) values
      ('${roleSuperId}', 'super@example.com', 'Super One', 'super_admin'),
      ('${roleAdminId}', 'admin2@example.com', 'Admin Two', 'admin'),
      ('${roleStaffId}', 'staff2@example.com', 'Staff Three', 'staff');

    insert into public.admin_users (user_id, email, full_name, role, is_active)
    values ('${roleInactiveId}', 'inactive-super@example.com', 'Dormant Super', 'super_admin', false);
  `);

  const roleFlags = async (userId) =>
    (
      await q(`
        select public.is_staff('${userId}'::uuid) as staff,
               public.is_admin('${userId}'::uuid) as admin,
               public.is_super_admin('${userId}'::uuid) as super;
      `)
    )[0];

  const superFlags = await roleFlags(roleSuperId);
  check(
    "a super admin is staff, admin and super admin",
    superFlags.staff && superFlags.admin && superFlags.super,
    JSON.stringify(superFlags),
  );

  const adminFlags = await roleFlags(roleAdminId);
  check(
    "an admin is staff and admin, but not a super admin",
    adminFlags.staff && adminFlags.admin && !adminFlags.super,
    JSON.stringify(adminFlags),
  );

  const staffFlags = await roleFlags(roleStaffId);
  check(
    "staff are staff only — no management powers",
    staffFlags.staff && !staffFlags.admin && !staffFlags.super,
    JSON.stringify(staffFlags),
  );

  const inactiveFlags = await roleFlags(roleInactiveId);
  check(
    "a deactivated account holds no role at all, whatever its role column says",
    inactiveFlags.staff === false && inactiveFlags.admin === false && inactiveFlags.super === false,
    JSON.stringify(inactiveFlags),
  );

  // `current_staff_role()` is what the request hook asks: the caller's own role, and
  // nothing about anybody else.
  await run(`select set_config('request.jwt.claim.sub', '${roleSuperId}', false);`);
  check(
    "the caller's own role comes back when they are active staff",
    (await q(`select public.current_staff_role() as role;`))[0].role === "super_admin",
    (await q(`select public.current_staff_role() as role;`))[0].role ?? "null",
  );

  check(
    "a different account sees its own role, not the previous one",
    (await (async () => {
      await run(`select set_config('request.jwt.claim.sub', '${roleStaffId}', false);`);
      return q(`select public.current_staff_role() as role;`);
    })())[0].role === "staff",
  );

  check(
    "a deactivated account has no role to show",
    (await (async () => {
      await run(`select set_config('request.jwt.claim.sub', '${roleInactiveId}', false);`);
      return q(`select public.current_staff_role() as role;`);
    })())[0].role === null,
  );

  check(
    "somebody with no allow-list row has no role to show",
    (await (async () => {
      await run(`select set_config('request.jwt.claim.sub', 'ffffffff-ffff-4fff-8fff-ffffffffffff', false);`);
      return q(`select public.current_staff_role() as role;`);
    })())[0].role === null,
  );

  check(
    "a request with no session at all has no role",
    (await (async () => {
      await run(`select set_config('request.jwt.claim.sub', '', false);`);
      return q(`select public.current_staff_role() as role;`);
    })())[0].role === null,
  );
  const strangerFlags = await roleFlags("ffffffff-ffff-4fff-8fff-ffffffffffff");
  check(
    "a user who is not on the allow-list holds nothing",
    strangerFlags.staff === false && strangerFlags.admin === false && strangerFlags.super === false,
  );

  // The old role names must be rejected outright: a row saying "owner" would
  // otherwise be a row that no helper understands and every policy has to guess at.
  // Each attempt gets its own auth user, so the refusal can only be the role check —
  // and the message is asserted, so a different error cannot pass for it.
  const legacyRoles = ["owner", "manager", "scanner", "superuser", "SUPER_ADMIN"];

  for (const [index, legacyRole] of legacyRoles.entries()) {
    const legacyUserId = `aaaa0000-0000-4000-8000-0000000000${(20 + index).toString().padStart(2, "0")}`;

    // The auth user exists, so nothing here can fail on a missing parent row.
    await run(`
      insert into auth.users (id, email) values ('${legacyUserId}', 'legacy-${index}@example.com')
      on conflict (id) do nothing;
    `);

    const legacyError = await expectError(`
      insert into public.admin_users (user_id, email, role)
      values ('${legacyUserId}', 'legacy-${index}@example.com', '${legacyRole}');
    `);

    check(
      `the database refuses the role "${legacyRole}"`,
      typeof legacyError === "string" && /admin_users_role_check/.test(legacyError),
      legacyError ?? "the insert succeeded",
    );
  }

  const defaultRoleUserId = "aaaa0000-0000-4000-8000-000000000030";
  await run(`
    insert into auth.users (id, email) values ('${defaultRoleUserId}', 'no-role-given@example.com')
    on conflict (id) do nothing;
    insert into public.admin_users (user_id, email)
    values ('${defaultRoleUserId}', 'no-role-given@example.com');
  `);
  const defaultRole = (
    await q(`select role from public.admin_users where user_id = '${defaultRoleUserId}';`)
  )[0].role;
  check(
    "an allow-list row without a role is the least powerful one",
    defaultRole === "staff",
    defaultRole ?? "no row",
  );
  await run(`delete from public.admin_users where user_id = '${defaultRoleUserId}';`);

  // Only a super admin may write the allow-list (the RLS policy that replaced the
  // old owner-only one).
  await run(`set request.jwt.claim.sub = '${roleAdminId}';`);
  const adminAllowListWrite = await (async () => {
    await run("set role authenticated;");
    try {
      await q(`update public.admin_users set role = 'super_admin' where user_id = '${roleAdminId}';`);
      return (await q(`select role from public.admin_users where user_id = '${roleAdminId}';`))[0].role;
    } catch {
      return "refused";
    } finally {
      await run("reset role;");
    }
  })();
  check(
    "an admin cannot promote themselves",
    adminAllowListWrite === "admin",
    adminAllowListWrite,
  );

  await run(`set request.jwt.claim.sub = '${roleSuperId}';`);
  const superAllowListWrite = await (async () => {
    await run("set role authenticated;");
    try {
      await q(`update public.admin_users set full_name = 'Super One (edited)' where user_id = '${roleSuperId}';`);
      return (await q(`select full_name from public.admin_users where user_id = '${roleSuperId}';`))[0].full_name;
    } finally {
      await run("reset role;");
    }
  })();
  check(
    "a super admin may edit the allow-list",
    superAllowListWrite === "Super One (edited)",
    superAllowListWrite,
  );
  await run("reset request.jwt.claim.sub;");

  // ---------------------------------------------------------------------------
  section("Admin lookups: booking search and dashboard counts");
  // ---------------------------------------------------------------------------
  const lookupBooking = (
    await q(`
      select b.booking_id, b.customer_mobile, b.customer_name, b.total_amount, b.created_at
        from public.bookings b
       where b.id = '${payA.booking_uuid}';
    `)
  )[0];
  check(
    "the search fixture is a paid booking with the details a search returns",
    Boolean(lookupBooking?.booking_id && lookupBooking?.customer_mobile),
    JSON.stringify(lookupBooking ?? null),
  );

  const lookupByReference = await rpc("admin_search_bookings", { p_query: lookupBooking.booking_id });
  check(
    "a booking is found by its reference",
    lookupByReference.length === 1 && lookupByReference[0].booking_id === lookupBooking.booking_id,
    `${lookupByReference.length} rows`,
  );
  check(
    "the search returns the guest, the night and the pass",
    lookupByReference[0]?.customer_name === lookupBooking.customer_name &&
      /^\d{4}-\d{2}-\d{2}T?/.test(lookupByReference[0]?.event_date ?? "") &&
      Boolean(lookupByReference[0]?.pass_name),
    `${lookupByReference[0]?.customer_name ?? ""} / ${lookupByReference[0]?.pass_name ?? ""}`,
  );
  check(
    "the full view carries the contact details and the amount",
    lookupByReference[0]?.customer_mobile === lookupBooking.customer_mobile &&
      lookupByReference[0]?.total_amount === lookupBooking.total_amount,
    `${lookupByReference[0]?.customer_mobile ?? ""} / ${lookupByReference[0]?.total_amount ?? ""}`,
  );
  check(
    "the search counts the booking's passes and how many are in",
    lookupByReference[0]?.passes_issued === 2 && Number(lookupByReference[0]?.passes_checked_in) >= 0,
    `${lookupByReference[0]?.passes_issued ?? ""} issued`,
  );

  const lookupLimited = await rpc("admin_search_bookings", {
    p_query: lookupBooking.booking_id,
    p_include_contact: false,
  });
  check(
    "the limited view withholds the mobile number, the email and the amount",
    lookupLimited[0]?.customer_mobile === null &&
      lookupLimited[0]?.customer_email === null &&
      lookupLimited[0]?.total_amount === null &&
      lookupLimited[0]?.razorpay_order_id === null &&
      lookupLimited[0]?.razorpay_payment_id === null,
    JSON.stringify({
      mobile: lookupLimited[0]?.customer_mobile,
      amount: lookupLimited[0]?.total_amount,
    }),
  );
  check(
    "the limited view still identifies the guest and the pass",
    lookupLimited[0]?.booking_id === lookupBooking.booking_id &&
      lookupLimited[0]?.customer_name === lookupBooking.customer_name &&
      Boolean(lookupLimited[0]?.pass_name),
  );

  const lookupByName = await rpc("admin_search_bookings", {
    p_query: lookupBooking.customer_name.slice(0, 4),
    p_include_contact: false,
  });
  check(
    "a partial guest name finds the booking",
    lookupByName.some((row) => row.booking_id === lookupBooking.booking_id),
    `${lookupByName.length} rows`,
  );

  const spacedMobile = `+91 ${lookupBooking.customer_mobile.slice(3)}`;
  const lookupByMobile = await rpc("admin_search_bookings", {
    p_query: spacedMobile,
    p_include_contact: false,
  });
  check(
    "a mobile number typed with spaces finds the booking",
    lookupByMobile.some((row) => row.booking_id === lookupBooking.booking_id),
    `${lookupByMobile.length} rows`,
  );

  // An empty search box is the management list, not an empty answer: the screen has
  // to open on the bookings, and the row count says how many there are.
  const lookupEmpty = await rpc("admin_search_bookings", { p_query: "" });
  check(
    "an empty search is the list itself, with the size of the result set",
    lookupEmpty.length > 0 && lookupEmpty[0].total_count >= lookupEmpty.length,
    `${lookupEmpty.length} rows of ${lookupEmpty[0]?.total_count ?? "?"}`,
  );

  const lookupPunctuation = await rpc("admin_search_bookings", { p_query: "+-() " });
  check(
    "a search with no digits and no letters returns nothing, not everything",
    lookupPunctuation.length === 0,
    `${lookupPunctuation.length} rows`,
  );

  const lookupUnknown = await rpc("admin_search_bookings", { p_query: "DND999999999" });
  check("an unknown reference returns nothing", lookupUnknown.length === 0, `${lookupUnknown.length} rows`);

  const lookupLimitedRows = await rpc("admin_search_bookings", { p_query: "1", p_limit: 1 });
  check("the search honours the caller's page size", lookupLimitedRows.length <= 1, `${lookupLimitedRows.length} rows`);

  const lookupGrants = await q(`
    select
      has_function_privilege('anon', 'public.admin_search_bookings(text, date, date, uuid, text, text, text, boolean, integer, integer)', 'execute') as anon,
      has_function_privilege('authenticated', 'public.admin_search_bookings(text, date, date, uuid, text, text, text, boolean, integer, integer)', 'execute') as authenticated,
      has_function_privilege('service_role', 'public.admin_search_bookings(text, date, date, uuid, text, text, text, boolean, integer, integer)', 'execute') as service;
  `);
  check(
    "only the service role may search bookings",
    lookupGrants[0].anon === false && lookupGrants[0].authenticated === false && lookupGrants[0].service === true,
    JSON.stringify(lookupGrants[0]),
  );

  const anonLookup = await expectError(`set role anon; select * from public.admin_search_bookings('x');`);
  check("an anon session cannot call the search", anonLookup !== null, anonLookup ?? "call succeeded");
  await run("reset role;");

  const retiredLookup = await q(`
    select count(*)::integer as n
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'admin_lookup_bookings';
  `);
  check(
    "the retired lookup is gone: one search, one set of matching rules",
    retiredLookup[0].n === 0,
    `${retiredLookup[0].n} definitions left`,
  );

  const statsGrants = await q(`
    select
      has_function_privilege('anon', 'public.admin_dashboard_stats(date, text, boolean)', 'execute') as anon,
      has_function_privilege('authenticated', 'public.admin_dashboard_stats(date, text, boolean)', 'execute') as authenticated,
      has_function_privilege('service_role', 'public.admin_dashboard_stats(date, text, boolean)', 'execute') as service;
  `);
  check(
    "only the service role may read the dashboard counts",
    statsGrants[0].anon === false && statsGrants[0].authenticated === false && statsGrants[0].service === true,
    JSON.stringify(statsGrants[0]),
  );

  // The dashboard counts days in the venue's timezone (its `p_tz`), so "today" here has
  // to be the venue's today as well. Reading it as the server's UTC date would be a
  // different question entirely — and, between midnight and 5:30 in Jaipur, a different
  // answer.
  const venueTz = "Asia/Kolkata";
  const [statsToday] = await q(`
    select ((now() at time zone '${venueTz}')::date)::text as today,
           (((now() at time zone '${venueTz}')::date) - 1)::text as yesterday;
  `);
  const statsForToday = (await rpc("admin_dashboard_stats", { p_today: statsToday.today, p_tz: venueTz }))[0];
  const statsForYesterday = (await rpc("admin_dashboard_stats", {
    p_today: statsToday.yesterday,
    p_tz: venueTz,
  }))[0];

  check(
    "the dashboard counts bookings, passes and staff",
    statsForToday.bookings_total >= 1 &&
      statsForToday.passes_issued >= 1 &&
      statsForToday.staff_active >= 3 &&
      statsForToday.staff_total >= 4 &&
      statsForToday.nights_total >= 9,
    JSON.stringify(statsForToday),
  );
  check(
    "check-ins are counted for the day they asked about",
    statsForToday.check_ins_today >= 1 && statsForYesterday.check_ins_today === 0,
    `today ${statsForToday.check_ins_today} / yesterday ${statsForYesterday.check_ins_today}`,
  );
  // `passes_active` counts passes that are active and unused; `passes_used` counts
  // passes that have been through the gate. They are subsets of what was issued, not
  // two halves of it — a hand-edited fixture can be both — so each is bounded.
  check(
    "issued passes bound both the used and the unused counts",
    statsForToday.passes_used <= statsForToday.passes_issued &&
      statsForToday.passes_active <= statsForToday.passes_issued,
    `${statsForToday.passes_used} used + ${statsForToday.passes_active} unused / ${statsForToday.passes_issued} issued`,
  );
  check(
    "a check-in never outnumbers the passes in existence",
    statsForToday.check_ins_total <= statsForToday.passes_issued,
    `${statsForToday.check_ins_total} entries / ${statsForToday.passes_issued} passes`,
  );
  check(
    "paid bookings never exceed all bookings",
    statsForToday.bookings_paid <= statsForToday.bookings_total &&
      statsForToday.bookings_pending + statsForToday.bookings_refunded <= statsForToday.bookings_total,
    JSON.stringify({
      total: statsForToday.bookings_total,
      paid: statsForToday.bookings_paid,
      pending: statsForToday.bookings_pending,
      refunded: statsForToday.bookings_refunded,
    }),
  );

  // The old owner-only helper is gone: two names for one question is how a policy
  // ends up asking the wrong one.
  const ownerFunction = await expectError(`select public.is_owner();`);
  check(
    "the retired is_owner() helper no longer exists",
    ownerFunction !== null,
    ownerFunction ?? "is_owner() still callable",
  );

  // ---------------------------------------------------------------------------
  section("Admin dashboard: statistics against the rows they count");
  // ---------------------------------------------------------------------------
  // A dashboard is only as trustworthy as the arithmetic under it, so the numbers
  // are checked two ways. First as deltas: a fixture is inserted whose effect on
  // every counter is known by hand, including a refund and a check-in. Then against
  // a second, separately written query over the same tables, so a statistic that
  // quietly stops matching its own rows fails here rather than on the wall chart.
  const DASH_TZ = "Asia/Kolkata";
  const DASH_NIGHT = "d0000000-0000-4000-8000-0000000000d9";
  const DASH_ORDER_1 = "order_DASH000000000001";
  const DASH_ORDER_2 = "order_DASH000000000002";
  const DASH_PAYMENT_1 = "pay_DASH000000000001";
  const DASH_PAYMENT_2 = "pay_DASH000000000002";
  const dashToday = (await q(`select (now() at time zone '${DASH_TZ}')::date::text as today;`))[0].today;
  const utcToday = (await q(`select (now() at time zone 'UTC')::date::text as today;`))[0].today;
  const dayString = (value) => new Date(value).toISOString().slice(0, 10);

  const dashStats = async (overrides = {}) =>
    (
      await rpc("admin_dashboard_stats", {
        p_today: dashToday,
        p_tz: DASH_TZ,
        p_include_revenue: true,
        ...overrides,
      })
    )[0];
  const dashSeries = async (overrides = {}) =>
    rpc("admin_booking_series", {
      p_today: dashToday,
      p_days: 14,
      p_tz: DASH_TZ,
      p_include_revenue: true,
      ...overrides,
    });
  const dashBreakdown = async (overrides = {}) =>
    rpc("admin_pass_breakdown", { p_include_revenue: true, ...overrides });
  const dashRecent = async (overrides = {}) =>
    rpc("admin_recent_bookings", { p_limit: 8, p_include_contact: true, ...overrides });

  const before = await dashStats();

  // ---- the fixture: one more night, four bookings, one refund, one check-in ---
  await run(`
    insert into public.event_dates (id, event_id, event_date, start_time, capacity, status)
    values ('${DASH_NIGHT}', '${EVENT}', '${dashToday}'::date + 40, '19:00', 40, 'scheduled');
  `);

  const paidToday = await createBooking({
    p_event_date_id: DASH_NIGHT,
    p_pass_category_id: COUPLE,
    p_customer_name: "Dashboard Paid Today",
    p_customer_mobile: "+919800000911",
    p_quantity: 1,
    p_number_of_people: 2, // one Couple Pass is two people
    p_idempotency_key: "dash-1",
  });
  await rpc("attach_razorpay_order", { p_booking_id: paidToday.booking_uuid, p_razorpay_order_id: DASH_ORDER_1 });
  await rpc("confirm_booking_payment", {
    p_razorpay_order_id: DASH_ORDER_1,
    p_razorpay_payment_id: DASH_PAYMENT_1,
    p_amount_paise: paidToday.total_amount * 100,
  });

  const unpaidFuture = await createBooking({
    p_event_date_id: DASH_NIGHT,
    p_pass_category_id: FAMILY,
    p_customer_name: "Dashboard Unpaid",
    p_customer_mobile: "+919800000912",
    p_quantity: 1,
    p_number_of_people: 4, // one Family Pass is four people
    p_idempotency_key: "dash-2",
  });

  const paidYesterday = await createBooking({
    p_event_date_id: DASH_NIGHT,
    p_pass_category_id: COUPLE,
    p_customer_name: "Dashboard Paid Yesterday",
    p_customer_mobile: "+919800000913",
    p_quantity: 2,
    p_number_of_people: 4, // two Couple Passes, two people each
    p_idempotency_key: "dash-3",
  });
  await rpc("attach_razorpay_order", { p_booking_id: paidYesterday.booking_uuid, p_razorpay_order_id: DASH_ORDER_2 });
  await rpc("confirm_booking_payment", {
    p_razorpay_order_id: DASH_ORDER_2,
    p_razorpay_payment_id: DASH_PAYMENT_2,
    p_amount_paise: paidYesterday.total_amount * 100,
  });
  // Booked on an earlier venue day, so its money belongs to that day's figures.
  await run(`
    update public.bookings
       set created_at = (('${dashToday}'::date - 1)::timestamp at time zone '${DASH_TZ}')
     where id = '${paidYesterday.booking_uuid}';
  `);

  const afterBookings = await dashStats();
  const moved = (field) => Number(afterBookings[field]) - Number(before[field]);

  check(
    "three bookings move the booking counters by exactly three",
    moved("bookings_total") === 3 &&
      moved("bookings_confirmed") === 2 &&
      moved("bookings_paid") === 2 &&
      moved("bookings_pending") === 1 &&
      moved("bookings_refunded") === 0,
    JSON.stringify({
      total: moved("bookings_total"),
      confirmed: moved("bookings_confirmed"),
      paid: moved("bookings_paid"),
      pending: moved("bookings_pending"),
    }),
  );
  check(
    "today's bookings count the two made today and not the one made yesterday",
    moved("bookings_today") === 2,
    `${moved("bookings_today")}`,
  );
  // COUPLE is 499 for two people; the quantity-2 booking is 998. Only paid money counts,
  // and only money taken today is today's.
  check(
    "revenue adds up to what the paid bookings were worth",
    moved("revenue_total") === 1497 && moved("revenue_today") === 499 && moved("revenue_refunded") === 0,
    `total ${moved("revenue_total")} / today ${moved("revenue_today")} / refunded ${moved("revenue_refunded")}`,
  );
  check(
    "the unpaid booking contributes no money and no capacity",
    moved("revenue_total") === 1497 && moved("capacity_taken") === 6,
    `capacity taken ${moved("capacity_taken")} for 2 + 4 paid people`,
  );
  check(
    "a new night adds its capacity to the venue, and paid people reduce what is left",
    moved("capacity_total") === 40 &&
      moved("capacity_taken") === 6 &&
      moved("capacity_available") === 34 &&
      moved("nights_total") === 1 &&
      moved("nights_upcoming") === 1,
    JSON.stringify({
      total: moved("capacity_total"),
      taken: moved("capacity_taken"),
      available: moved("capacity_available"),
    }),
  );
  const unpaidState = (
    await q(`
      select b.payment_status, b.booking_status,
             (select count(*)::int from public.digital_passes d where d.booking_id = b.id) as passes
        from public.bookings b
       where b.id = '${unpaidFuture.booking_uuid}';
    `)
  )[0];
  check(
    "the unpaid fixture really is unpaid: no verified payment, no pass issued",
    unpaidState.payment_status === "unpaid" && unpaidState.booking_status === "pending" && unpaidState.passes === 0,
    JSON.stringify(unpaidState),
  );

  check(
    "passes are issued per purchased pass: one for quantity 1, two for quantity 2",
    moved("passes_issued") === 3 && moved("passes_active") === 3 && moved("passes_used") === 0,
    JSON.stringify({
      issued: moved("passes_issued"),
      active: moved("passes_active"),
      used: moved("passes_used"),
    }),
  );

  // ---- the gate ---------------------------------------------------------------
  const [dashPass] = await q(
    `select id from public.digital_passes where booking_id = '${paidToday.booking_uuid}' limit 1;`,
  );
  await run(`
    update public.digital_passes
       set checked_in = true, checked_in_at = now(), status = 'used'
     where id = '${dashPass.id}';
    insert into public.check_ins (digital_pass_id, event_date_id, checked_in_at, gate)
    values ('${dashPass.id}', '${DASH_NIGHT}', now(), 'Dashboard Test Gate');
  `);
  const afterCheckIn = await dashStats();
  const movedIn = (field) => Number(afterCheckIn[field]) - Number(before[field]);
  check(
    "a check-in lands in both the total and today's check-ins",
    movedIn("check_ins_total") === 1 && movedIn("check_ins_today") === 1,
    `total ${movedIn("check_ins_total")} / today ${movedIn("check_ins_today")}`,
  );
  check(
    "the pass that went through the gate stops counting as unused",
    movedIn("passes_used") === 1 && movedIn("passes_active") === 2 && movedIn("passes_issued") === 3,
    JSON.stringify({
      used: movedIn("passes_used"),
      active: movedIn("passes_active"),
      issued: movedIn("passes_issued"),
    }),
  );
  check(
    "a check-in is not a booking and a booking is not a check-in",
    movedIn("bookings_total") === 3 && movedIn("capacity_taken") === 6,
    JSON.stringify({ bookings: movedIn("bookings_total"), taken: movedIn("capacity_taken") }),
  );

  // ---- the refund -------------------------------------------------------------
  const refundOutcome = await rpc("refund_booking_payment", { p_razorpay_payment_id: DASH_PAYMENT_2 });
  check(
    "the refund fixture really refunded the booking",
    JSON.stringify(refundOutcome).includes("refunded"),
    JSON.stringify(refundOutcome),
  );
  const afterRefund = await dashStats();
  const movedBack = (field) => Number(afterRefund[field]) - Number(before[field]);
  check(
    "a refunded booking stops counting as revenue the moment it is refunded",
    movedBack("revenue_total") === 499 &&
      movedBack("revenue_today") === 499 &&
      movedBack("revenue_refunded") === 998,
    JSON.stringify({
      total: movedBack("revenue_total"),
      today: movedBack("revenue_today"),
      refunded: movedBack("revenue_refunded"),
    }),
  );
  check(
    "a refunded booking stops counting as paid and starts counting as refunded",
    movedBack("bookings_paid") === 1 &&
      movedBack("bookings_refunded") === 1 &&
      movedBack("bookings_confirmed") === 1 &&
      movedBack("bookings_total") === 3,
    JSON.stringify({
      paid: movedBack("bookings_paid"),
      refunded: movedBack("bookings_refunded"),
      confirmed: movedBack("bookings_confirmed"),
    }),
  );
  check(
    "refunded people release the capacity they were holding",
    movedBack("capacity_taken") === 2 && movedBack("capacity_available") === 38 && movedBack("people_paid") === 2,
    JSON.stringify({
      taken: movedBack("capacity_taken"),
      available: movedBack("capacity_available"),
      people: movedBack("people_paid"),
    }),
  );
  check(
    "the refunded booking's passes are cancelled, not still active",
    movedBack("passes_active") === 0 && movedBack("passes_used") === 1 && movedBack("passes_issued") === 3,
    JSON.stringify({
      active: movedBack("passes_active"),
      used: movedBack("passes_used"),
      issued: movedBack("passes_issued"),
    }),
  );

  // ---- the venue's day, not the server's --------------------------------------
  const paidEarly = await createBooking({
    p_event_date_id: DASH_NIGHT,
    p_pass_category_id: FAMILY,
    p_customer_name: "Dashboard Just After Midnight",
    p_customer_mobile: "+919800000914",
    p_quantity: 1,
    p_number_of_people: 4,
    p_idempotency_key: "dash-4",
  });
  await rpc("attach_razorpay_order", { p_booking_id: paidEarly.booking_uuid, p_razorpay_order_id: "order_DASH000000000003" });
  await rpc("confirm_booking_payment", {
    p_razorpay_order_id: "order_DASH000000000003",
    p_razorpay_payment_id: "pay_DASH000000000003",
    p_amount_paise: paidEarly.total_amount * 100,
  });
  // Half past midnight in Jaipur is the previous evening in UTC: one instant, two
  // calendar days. The booking is placed on a quiet day 200 nights back — a day nothing
  // else in this harness has ever written to — so what follows is a statement about
  // this instant and not about whatever else happens to have been booked today. (That
  // distinction matters: between midnight and 5:30 in Jaipur, *every* booking made
  // "now" straddles the same two days, and a count of the whole table would say more
  // about the hour the harness ran at than about the timezone handling.)
  await run(`
    update public.bookings
       set created_at = ((('${dashToday}'::date - 200))::timestamp + interval '30 minutes') at time zone '${DASH_TZ}'
     where id = '${paidEarly.booking_uuid}';
  `);
  const [earlyDays] = await q(`
    select (created_at at time zone '${DASH_TZ}')::date::text as venue_day,
           (created_at at time zone 'UTC')::date::text as utc_day,
           to_char(created_at at time zone 'UTC', 'HH24:MI') as utc_clock,
           to_char(created_at at time zone '${DASH_TZ}', 'HH24:MI') as venue_clock
      from public.bookings where id = '${paidEarly.booking_uuid}';
  `);
  check(
    "the midnight fixture really sits on two different calendar days",
    earlyDays.venue_day !== earlyDays.utc_day,
    JSON.stringify(earlyDays),
  );

  // The same rows through two lenses: Jaipur's day and UTC's day. Each is compared
  // field by field against a hand-written count further down.
  const venueNow = await dashStats();
  const utcNow = (
    await rpc("admin_dashboard_stats", { p_today: utcToday, p_tz: "UTC", p_include_revenue: true })
  )[0];

  /** `bookings_today` for one calendar day, counted in one timezone. */
  const countedOn = async (day, tz) =>
    Number((await rpc("admin_dashboard_stats", { p_today: day, p_tz: tz, p_include_revenue: true }))[0].bookings_today);

  check(
    "the booking made after midnight in Jaipur counts towards the venue's day",
    (await countedOn(earlyDays.venue_day, DASH_TZ)) >= 1 &&
      (await countedOn(earlyDays.utc_day, DASH_TZ)) === 0,
    `${earlyDays.venue_clock} Jaipur on ${earlyDays.venue_day}`,
  );
  check(
    "and the same instant, counted in UTC, belongs to the day before — not to both, and not to neither",
    (await countedOn(earlyDays.utc_day, "UTC")) >= 1 && (await countedOn(earlyDays.venue_day, "UTC")) === 0,
    `${earlyDays.utc_clock} UTC on ${earlyDays.utc_day}`,
  );

  // ---- the same numbers, counted a second way ---------------------------------
  // Written out by hand from the tables rather than reused from the migration: if the
  // two ever disagree, one of them is wrong and the dashboard is the one showing it.
  const dashLedger = async (today, tz) => {
    const [row] = await q(
      `
      select
        (select count(*)::int from public.bookings) as bookings_total,
        (select count(*)::int from public.bookings b where b.booking_status = 'confirmed') as bookings_confirmed,
        (select count(*)::int from public.bookings b where b.payment_status = 'paid') as bookings_paid,
        (select count(*)::int from public.bookings b where b.payment_status = 'unpaid') as bookings_pending,
        (select count(*)::int from public.bookings b where b.payment_status = 'refunded') as bookings_refunded,
        (select count(*)::int from public.bookings b
          where (b.created_at at time zone $2::text)::date = $1::date) as bookings_today,
        (select coalesce(sum(b.total_amount), 0)::int from public.bookings b
          where b.payment_status = 'paid') as revenue_total,
        (select coalesce(sum(b.total_amount), 0)::int from public.bookings b
          where b.payment_status = 'paid'
            and (b.created_at at time zone $2::text)::date = $1::date) as revenue_today,
        (select coalesce(sum(b.total_amount), 0)::int from public.bookings b
          where b.payment_status = 'refunded') as revenue_refunded,
        (select count(*)::int from public.check_ins) as check_ins_total,
        (select count(*)::int from public.check_ins c
          where (c.checked_in_at at time zone $2::text)::date = $1::date) as check_ins_today,
        (select coalesce(sum(b.number_of_people), 0)::int from public.bookings b
          where b.payment_status = 'paid') as people_paid,
        (select count(*)::int from public.digital_passes) as passes_issued,
        (select count(*)::int from public.digital_passes p
          where p.status = 'active' and not p.checked_in) as passes_active,
        (select count(*)::int from public.digital_passes p where p.checked_in) as passes_used,
        (select coalesce(sum(d.capacity), 0)::int from public.event_dates d
          where d.status = 'scheduled' and d.event_date >= $1::date) as capacity_total,
        (select coalesce(sum(b.number_of_people), 0)::int from public.bookings b
           join public.event_dates d on d.id = b.event_date_id
          where b.payment_status = 'paid' and d.status = 'scheduled'
            and d.event_date >= $1::date) as capacity_taken,
        (select coalesce(sum(d.capacity), 0)::int from public.event_dates d
          where d.status = 'scheduled' and d.event_date = $1::date) as tonight_capacity,
        (select coalesce(sum(b.number_of_people), 0)::int from public.bookings b
           join public.event_dates d on d.id = b.event_date_id
          where b.payment_status = 'paid' and d.status = 'scheduled'
            and d.event_date = $1::date) as tonight_taken,
        (select count(*)::int from public.event_dates) as nights_total,
        (select count(*)::int from public.event_dates d
          where d.event_date >= $1::date and d.status = 'scheduled') as nights_upcoming,
        (select count(*)::int from public.gallery g where g.status = 'published') as gallery_published,
        (select count(*)::int from public.gallery g where g.status <> 'published') as gallery_draft,
        (select count(*)::int from public.admin_users a where a.is_active) as staff_active,
        (select count(*)::int from public.admin_users a) as staff_total;
    `,
      [today, tz],
    );
    return row;
  };

  const DASH_FIELDS = [
    "bookings_total",
    "bookings_confirmed",
    "bookings_paid",
    "bookings_pending",
    "bookings_refunded",
    "bookings_today",
    "revenue_total",
    "revenue_today",
    "revenue_refunded",
    "check_ins_total",
    "check_ins_today",
    "people_paid",
    "passes_issued",
    "passes_active",
    "passes_used",
    "capacity_total",
    "capacity_taken",
    "capacity_available",
    "tonight_date",
    "tonight_capacity",
    "tonight_taken",
    "tonight_available",
    "nights_total",
    "nights_upcoming",
    "gallery_published",
    "gallery_draft",
    "staff_active",
    "staff_total",
  ];

  const ledgerFor = async (today, tz) => {
    const raw = await dashLedger(today, tz);
    return {
      ...raw,
      // Derived rather than counted twice, exactly as the migration derives them.
      capacity_available: Math.max(0, Number(raw.capacity_total) - Number(raw.capacity_taken)),
      tonight_available: Math.max(0, Number(raw.tonight_capacity) - Number(raw.tonight_taken)),
      tonight_date: raw.tonight_capacity > 0 || raw.tonight_taken > 0 ? today : null,
    };
  };

  const compareFields = (label, stats, ledger) => {
    const wrong = DASH_FIELDS.filter((field) => {
      const reported = stats[field];
      const expected = ledger[field];
      if (reported === null || reported === undefined) return !(expected === null || expected === undefined);
      return Number(reported) !== Number(expected);
    });
    check(
      label,
      wrong.length === 0,
      wrong.length === 0 ? "all 28 fields match" : wrong.map((f) => `${f}: ${stats[f]} vs ${ledger[f]}`).join(", "),
    );
  };

  compareFields(
    "every headline number matches the bookings table, counted by hand in Jaipur's days",
    venueNow,
    await ledgerFor(dashToday, DASH_TZ),
  );
  compareFields(
    "and the same holds when the caller asks in UTC",
    utcNow,
    await ledgerFor(utcToday, "UTC"),
  );
  check(
    "capacity left is the capacity there is minus the people it holds",
    Number(venueNow.capacity_available) === Math.max(0, Number(venueNow.capacity_total) - Number(venueNow.capacity_taken)),
    `${venueNow.capacity_available} / ${venueNow.capacity_total} - ${venueNow.capacity_taken}`,
  );

  // ---- money is withheld, not merely hidden -----------------------------------
  const withheldMoney = await dashStats({ p_include_revenue: false });
  check(
    "a caller who may not see money receives no money, only nulls",
    withheldMoney.revenue_total === null &&
      withheldMoney.revenue_today === null &&
      withheldMoney.revenue_refunded === null,
    JSON.stringify({
      total: withheldMoney.revenue_total,
      today: withheldMoney.revenue_today,
      refunded: withheldMoney.revenue_refunded,
    }),
  );
  const nonMoney = DASH_FIELDS.filter((field) => !field.startsWith("revenue_"));
  check(
    "withholding the money changes nothing else on the dashboard",
    nonMoney.every((field) => String(withheldMoney[field]) === String(venueNow[field])),
    nonMoney
      .filter((field) => String(withheldMoney[field]) !== String(venueNow[field]))
      .map((f) => `${f}: ${withheldMoney[f]} vs ${venueNow[f]}`)
      .join(", ") || "identical",
  );

  // ---- the charts' data -------------------------------------------------------
  const series = await dashSeries();
  const seriesDays = series.map((row) => dayString(row.day));
  check(
    "the series covers the requested window, ending on the day asked about",
    series.length === 14 && seriesDays.at(-1) === dashToday,
    `${series.length} days, ${seriesDays[0]} to ${seriesDays.at(-1)}`,
  );
  check(
    "the window starts thirteen days before today",
    (() => {
      const expected = new Date(`${dashToday}T00:00:00Z`);
      expected.setUTCDate(expected.getUTCDate() - 13);
      return seriesDays[0] === expected.toISOString().slice(0, 10);
    })(),
    `${seriesDays[0]} (expected 13 days before ${dashToday})`,
  );
  check(
    "there are no gaps: a quiet night is a zero, not a missing row",
    seriesDays.every((day, index) => {
      if (index === 0) return true;
      const previous = new Date(`${seriesDays[index - 1]}T00:00:00Z`);
      previous.setUTCDate(previous.getUTCDate() + 1);
      return previous.toISOString().slice(0, 10) === day;
    }),
    seriesDays.join(" "),
  );

  const seriesLedger = await q(
    `
    select to_char(s.day, 'YYYY-MM-DD') as day,
      (select count(*)::int from public.bookings b
        where (b.created_at at time zone $3::text)::date = s.day) as bookings,
      (select count(*)::int from public.bookings b
        where (b.created_at at time zone $3::text)::date = s.day
          and b.booking_status = 'confirmed') as confirmed,
      (select coalesce(sum(b.total_amount), 0)::int from public.bookings b
        where (b.created_at at time zone $3::text)::date = s.day
          and b.payment_status = 'paid') as revenue
    from generate_series($1::date, $2::date, interval '1 day') as s(day)
    order by s.day;
  `,
    [seriesDays[0], seriesDays.at(-1), DASH_TZ],
  );
  const seriesWrong = seriesLedger.filter((row, index) => {
    const reported = series[index];
    return (
      dayString(reported.day) !== row.day ||
      Number(reported.bookings) !== Number(row.bookings) ||
      Number(reported.confirmed) !== Number(row.confirmed) ||
      Number(reported.revenue) !== Number(row.revenue)
    );
  });
  check(
    "every day of the series matches the bookings made that day",
    seriesWrong.length === 0,
    seriesWrong
      .map((row) => `${row.day}: reported ${JSON.stringify(series[seriesLedger.indexOf(row)])} vs ${JSON.stringify(row)}`)
      .join(" | ") || `${series.length} days agree`,
  );
  check(
    "the series totals reconcile with the headline revenue for the window",
    Number(series.reduce((sum, row) => sum + Number(row.revenue), 0)) ===
      Number((await q(
        `select coalesce(sum(b.total_amount), 0)::int as revenue from public.bookings b
          where b.payment_status = 'paid'
            and (b.created_at at time zone '${DASH_TZ}')::date between $1::date and $2::date;`,
        [seriesDays[0], seriesDays.at(-1)],
      ))[0].revenue),
    `${series.reduce((sum, row) => sum + Number(row.revenue), 0)}`,
  );

  const shortSeries = await dashSeries({ p_days: 0 });
  check("a series of zero days is still a series of one", shortSeries.length === 1, `${shortSeries.length} days`);
  const longSeries = await dashSeries({ p_days: 3650 });
  check("a decade of days is clamped to a chart that fits", longSeries.length === 90, `${longSeries.length} days`);
  const seriesNoMoney = await dashSeries({ p_include_revenue: false });
  check(
    "a series without money returns no money at all",
    seriesNoMoney.every((row) => row.revenue === null) &&
      seriesNoMoney.every((row, index) => Number(row.bookings) === Number(series[index].bookings)),
    JSON.stringify(seriesNoMoney.filter((row) => row.revenue !== null).slice(0, 2)),
  );

  // ---- the pass-category distribution -----------------------------------------
  const breakdown = await dashBreakdown();
  check(
    "every pass category is on the chart, including the ones nobody bought",
    breakdown.length === Number((await q(`select count(*)::int as n from public.pass_categories;`))[0].n),
    `${breakdown.length} rows`,
  );
  check(
    "the biggest category is first",
    breakdown.every((row, index) => index === 0 || Number(breakdown[index - 1].bookings) >= Number(row.bookings)),
    breakdown.map((row) => `${row.pass_name}:${row.bookings}`).join(" "),
  );

  const breakdownLedger = await q(`
    select p.id::text as pass_category_id,
      (select count(*)::int from public.bookings b where b.pass_category_id = p.id) as bookings,
      (select count(*)::int from public.bookings b
        where b.pass_category_id = p.id and b.payment_status = 'paid') as paid_bookings,
      (select count(*)::int from public.digital_passes d
         join public.bookings b on b.id = d.booking_id
        where b.pass_category_id = p.id) as passes_issued,
      (select coalesce(sum(b.number_of_people), 0)::int from public.bookings b
        where b.pass_category_id = p.id and b.payment_status = 'paid') as people,
      (select coalesce(sum(b.total_amount), 0)::int from public.bookings b
        where b.pass_category_id = p.id and b.payment_status = 'paid') as revenue
    from public.pass_categories p;
  `);
  const breakdownWrong = breakdown.filter((row) => {
    const ledger = breakdownLedger.find((candidate) => candidate.pass_category_id === row.pass_category_id);
    if (!ledger) return true;
    return (
      Number(row.bookings) !== Number(ledger.bookings) ||
      Number(row.paid_bookings) !== Number(ledger.paid_bookings) ||
      Number(row.passes_issued) !== Number(ledger.passes_issued) ||
      Number(row.people) !== Number(ledger.people) ||
      Number(row.revenue) !== Number(ledger.revenue)
    );
  });
  check(
    "each category reports the bookings, people and money it actually has",
    breakdownWrong.length === 0,
    breakdownWrong
      .map((row) => `${row.pass_name}: reported ${row.bookings}/${row.people}/${row.revenue} vs ${JSON.stringify(breakdownLedger.find((c) => c.pass_category_id === row.pass_category_id))}`)
      .join(" | ") || `${breakdown.length} categories agree`,
  );
  // Joining bookings to their passes in one query multiplies every booking by its pass
  // count, and a category holding a multi-pass booking is where that shows up. This is
  // the regression test for exactly that mistake.
  const [fanOut] = await q(`
    select b.pass_category_id::text as pass_category_id, b.id::text as booking_uuid,
           count(*)::int as passes_on_one_booking
      from public.digital_passes d
      join public.bookings b on b.id = d.booking_id
     group by b.pass_category_id, b.id
    having count(*) > 1
     limit 1;
  `);
  check(
    "the fixture really contains a booking holding more than one pass",
    Number(fanOut?.passes_on_one_booking) > 1,
    JSON.stringify(fanOut ?? null),
  );
  const fanOutRow = breakdown.find((row) => row.pass_category_id === fanOut.pass_category_id);
  const fanOutLedger = breakdownLedger.find((row) => row.pass_category_id === fanOut.pass_category_id);
  check(
    "a multi-pass booking does not multiply its category's people or money",
    Number(fanOutRow.people) === Number(fanOutLedger.people) &&
      Number(fanOutRow.revenue) === Number(fanOutLedger.revenue) &&
      Number(fanOutRow.bookings) === Number(fanOutLedger.bookings),
    JSON.stringify({ reported: fanOutRow, counted: fanOutLedger }),
  );
  const breakdownNoMoney = await dashBreakdown({ p_include_revenue: false });
  check(
    "the distribution still shows its shape without the money",
    breakdownNoMoney.every((row) => row.revenue === null) &&
      breakdownNoMoney.length === breakdown.length &&
      breakdownNoMoney.every((row, index) => Number(row.bookings) === Number(breakdown[index].bookings)),
    JSON.stringify(breakdownNoMoney.filter((row) => row.revenue !== null).slice(0, 2)),
  );

  // ---- the recent bookings table ----------------------------------------------
  const recent = await dashRecent();
  check("the recent list is a short list, not the whole ledger", recent.length === 8, `${recent.length} rows`);
  const recentLedger = await q(`
    select b.id::text as id, b.booking_id, b.customer_name, b.customer_mobile, b.customer_email,
           b.total_amount, b.quantity, b.number_of_people, b.booking_status, b.payment_status,
           b.created_at, d.event_date, p.name as pass_name
      from public.bookings b
      join public.event_dates d on d.id = b.event_date_id
      join public.pass_categories p on p.id = b.pass_category_id
     order by b.created_at desc, b.id desc
     limit ${recent.length};
  `);
  const recentWrong = recent.filter((row, index) => {
    const ledger = recentLedger[index];
    if (!ledger) return true;
    return (
      row.booking_uuid !== ledger.id ||
      row.customer_mobile !== ledger.customer_mobile ||
      row.customer_email !== ledger.customer_email ||
      Number(row.total_amount) !== Number(ledger.total_amount) ||
      Number(row.quantity) !== Number(ledger.quantity) ||
      Number(row.number_of_people) !== Number(ledger.number_of_people) ||
      row.booking_status !== ledger.booking_status ||
      row.payment_status !== ledger.payment_status ||
      row.pass_name !== ledger.pass_name ||
      dayString(row.event_date) !== dayString(ledger.event_date)
    );
  });
  check(
    "the table is the newest bookings first, with each row's own night and pass",
    recentWrong.length === 0,
    recentWrong.map((row) => `${row.booking_id} vs ledger`).join(", ") || `${recent.length} rows agree`,
  );
  check(
    "the newest row really is the newest booking",
    recent[0].booking_uuid ===
      (await q(`select id::text as id from public.bookings order by created_at desc, id desc limit 1;`))[0].id,
    `${recent[0]?.booking_id ?? "none"}`,
  );
  check(
    "both figures on a row are the ones stored on the booking",
    recent.every(
      (row, index) =>
        Number(row.total_amount) === Number(recentLedger[index].total_amount) && row.pass_name === recentLedger[index].pass_name,
    ),
    `${recent.length} rows`,
  );

  const recentSmall = await dashRecent({ p_limit: 0 });
  check("a list of zero bookings is still a list, never an empty query", recentSmall.length === 1, `${recentSmall.length} rows`);
  const recentHuge = await dashRecent({ p_limit: 10000 });
  check("an enormous page is clamped to something a page can show", recentHuge.length <= 50, `${recentHuge.length} rows`);

  const recentHidden = await dashRecent({ p_include_contact: false });
  check(
    "a staff member's recent list has no contact details and no amounts",
    recentHidden.every((row) => row.customer_mobile === null && row.customer_email === null && row.total_amount === null),
    JSON.stringify(recentHidden.filter((row) => row.customer_mobile !== null || row.total_amount !== null).slice(0, 2)),
  );
  check(
    "and it still names the guest, the night and the pass",
    recentHidden.length === recent.length &&
      recentHidden.every(
        (row, index) =>
          row.customer_name === recent[index].customer_name &&
          row.pass_name === recent[index].pass_name &&
          dayString(row.event_date) === dayString(recent[index].event_date),
      ),
    `${recentHidden.length} rows`,
  );

  // ---- one function per question, and only the service role may ask ------------
  const statsOverloads = await q(`
    select count(*)::int as n from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'admin_dashboard_stats';
  `);
  check(
    "there is exactly one dashboard statistics function, not two that can disagree",
    statsOverloads[0].n === 1,
    `${statsOverloads[0].n} overloads`,
  );

  const dashboardGrants = await q(`
    select
      has_function_privilege('anon', 'public.admin_booking_series(date, integer, text, boolean)', 'execute') as series_anon,
      has_function_privilege('authenticated', 'public.admin_booking_series(date, integer, text, boolean)', 'execute') as series_auth,
      has_function_privilege('service_role', 'public.admin_booking_series(date, integer, text, boolean)', 'execute') as series_service,
      has_function_privilege('anon', 'public.admin_pass_breakdown(boolean)', 'execute') as breakdown_anon,
      has_function_privilege('authenticated', 'public.admin_pass_breakdown(boolean)', 'execute') as breakdown_auth,
      has_function_privilege('service_role', 'public.admin_pass_breakdown(boolean)', 'execute') as breakdown_service,
      has_function_privilege('anon', 'public.admin_recent_bookings(integer, boolean)', 'execute') as recent_anon,
      has_function_privilege('authenticated', 'public.admin_recent_bookings(integer, boolean)', 'execute') as recent_auth,
      has_function_privilege('service_role', 'public.admin_recent_bookings(integer, boolean)', 'execute') as recent_service;
  `);
  const grants = dashboardGrants[0];
  check(
    "only the service role may read the charts or the recent bookings",
    grants.series_anon === false &&
      grants.series_auth === false &&
      grants.series_service === true &&
      grants.breakdown_anon === false &&
      grants.breakdown_auth === false &&
      grants.breakdown_service === true &&
      grants.recent_anon === false &&
      grants.recent_auth === false &&
      grants.recent_service === true,
    JSON.stringify(grants),
  );

  const anonSeries = await expectError(
    `set role anon; select * from public.admin_booking_series('${dashToday}'::date, 7, '${DASH_TZ}', true);`,
  );
  check("an anon session cannot read the series", anonSeries !== null, anonSeries ?? "the call succeeded");
  await run("reset role;");
  const anonRecent = await expectError(`set role anon; select * from public.admin_recent_bookings(5, true);`);
  check("an anon session cannot read the recent bookings", anonRecent !== null, anonRecent ?? "the call succeeded");
  await run("reset role;");
  const authedBreakdown = await expectError(
    `set role authenticated; select * from public.admin_pass_breakdown(true);`,
  );
  check(
    "a signed-in visitor is not staff either: the aggregates stay closed",
    authedBreakdown !== null,
    authedBreakdown ?? "the call succeeded",
  );
  await run("reset role;");

  // ---------------------------------------------------------------------------
  section("Admin booking management: search, filters, detail and the payment guard");
  // ---------------------------------------------------------------------------
  // The management screen is only as good as its search, and a search is only
  // trustworthy if its negative answers are too: every filter is checked from both
  // sides — the rows it must return, and the rows it must not.
  const MANAGE_NIGHT = "d0000000-0000-4000-8000-0000000000e1";
  const manageDay = (await q(`select (now() at time zone '${DASH_TZ}')::date::text as today;`))[0].today;
  const manageNightDate = (
    await q(`select (('${manageDay}'::date + 50))::text as event_date;`)
  )[0].event_date;

  await run(`
    insert into public.event_dates (id, event_id, event_date, start_time, capacity, status)
    values ('${MANAGE_NIGHT}', '${EVENT}', '${manageNightDate}'::date, '19:00', 60, 'scheduled');
  `);

  /** A booking on the management fixture night, with a known shape. */
  const manageBooking = async (label, category, quantity, people, idempotency) => {
    const created = await createBooking({
      p_event_date_id: MANAGE_NIGHT,
      p_pass_category_id: category,
      p_customer_name: `Manage ${label}`,
      p_customer_mobile: "+919800001001",
      p_customer_email: `manage.${label.toLowerCase()}@example.com`,
      p_quantity: quantity,
      p_number_of_people: people,
      p_idempotency_key: idempotency,
    });

    return created;
  };

  const payFor = async (booking, orderId, paymentId) => {
    await rpc("attach_razorpay_order", { p_booking_id: booking.booking_uuid, p_razorpay_order_id: orderId });
    await rpc("confirm_booking_payment", {
      p_razorpay_order_id: orderId,
      p_razorpay_payment_id: paymentId,
      p_amount_paise: booking.total_amount * 100,
    });
  };

  const managePaid = await manageBooking("Paid", COUPLE, 1, 2, "manage-1");
  await payFor(managePaid, "order_MANAGE00000000001", "pay_MANAGE00000000001");

  const manageUnpaid = await manageBooking("Unpaid", FAMILY, 1, 4, "manage-2");

  const manageSplit = await manageBooking("Split", COUPLE, 2, 4, "manage-3");
  await payFor(manageSplit, "order_MANAGE00000000002", "pay_MANAGE00000000002");

  const manageRefunded = await manageBooking("Refunded", TRIO, 1, 3, "manage-4");
  await payFor(manageRefunded, "order_MANAGE00000000003", "pay_MANAGE00000000003");
  await rpc("refund_booking_payment", { p_razorpay_payment_id: "pay_MANAGE00000000003" });

  const manageAll = await manageBooking("Inside", COUPLE, 1, 2, "manage-5");
  await payFor(manageAll, "order_MANAGE00000000004", "pay_MANAGE00000000004");

  // Two of the fixture bookings hold two passes each; half of one group is inside,
  // and the other booking is entirely in. Those are the two check-in states that a
  // door actually asks about.
  const [splitFirstPass] = await q(
    `select id from public.digital_passes where booking_id = '${manageSplit.booking_uuid}' order by pass_number limit 1;`,
  );
  const [insidePass] = await q(
    `select id from public.digital_passes where booking_id = '${manageAll.booking_uuid}' limit 1;`,
  );
  const [manageStaff] = await q(`
    select id, coalesce(nullif(btrim(full_name), ''), email) as who
      from public.admin_users
     where is_active
     order by created_at
     limit 1;
  `);
  await run(`
    insert into public.check_ins (digital_pass_id, event_date_id, checked_in_at, gate, checked_in_by)
    values ('${splitFirstPass.id}', '${MANAGE_NIGHT}', now(), 'Management Test Gate', '${manageStaff.id}'),
           ('${insidePass.id}', '${MANAGE_NIGHT}', now(), 'Management Test Gate', '${manageStaff.id}');
    update public.digital_passes set checked_in = true, checked_in_at = now(), status = 'used'
     where id in ('${splitFirstPass.id}', '${insidePass.id}');
  `);

  const search = (overrides = {}) =>
    rpc("admin_search_bookings", { p_query: null, p_limit: 25, p_offset: 0, ...overrides });

  const onNight = (row) => new Date(row.event_date).toISOString().slice(0, 10) === manageNightDate;
  const fixtureIds = [managePaid, manageUnpaid, manageSplit, manageRefunded, manageAll].map(
    (booking) => booking.booking_reference,
  );

  // ---- the six search fields --------------------------------------------------
  const byReference = await search({ p_query: managePaid.booking_reference });
  check(
    "a booking is found by its reference",
    byReference.some((row) => row.booking_id === managePaid.booking_reference),
    byReference.map((row) => row.booking_id).join(" "),
  );

  const byName = await search({ p_query: "manage paid" });
  check(
    "and by the guest's name, whatever the case was typed in",
    byName.some((row) => row.booking_id === managePaid.booking_reference),
    `${byName.length} rows`,
  );

  const byMobile = await search({ p_query: "+91 98000 01001" });
  check(
    "and by the mobile number, spaces and all",
    byMobile.some((row) => row.booking_id === managePaid.booking_reference),
    `${byMobile.length} rows`,
  );

  // The digits in a search are a phone number only when the search *is* one. These two
  // checks are the pair: a name with a number in it must not sweep in every mobile
  // containing those digits, and a two-digit search must not either.
  const digitsInsideWords = await rpc("admin_search_bookings", {
    p_query: "Manage 10",
    p_include_contact: false,
  });
  check(
    "a name with a number in it does not turn those digits into a phone search",
    digitsInsideWords.length === 0,
    `${digitsInsideWords.length} rows`,
  );

  // "80" is in every fixture mobile number and in no reference, name or email, so an
  // answer of zero rows proves the digits were not used as a phone search.
  const shortDigits = await rpc("admin_search_bookings", { p_query: "80", p_include_contact: false });
  check(
    "a two-digit search does not match every mobile number containing them",
    shortDigits.length === 0,
    `${shortDigits.length} rows`,
  );

  const longDigits = await rpc("admin_search_bookings", {
    p_query: "800001001",
    p_include_contact: true,
  });
  check(
    "while a phone number typed as digits still finds the guest who owns it",
    longDigits.length === 5 && longDigits.every((row) => row.customer_mobile === "+919800001001"),
    longDigits.map((row) => row.customer_name).join(", ") || "no rows",
  );

  const byEmail = await search({ p_query: "Manage.Paid@Example" });
  check(
    "and by the email address",
    byEmail.some((row) => row.booking_id === managePaid.booking_reference),
    `${byEmail.length} rows`,
  );

  const byPaymentId = await search({ p_query: "pay_MANAGE00000000001" });
  check(
    "and by the Razorpay payment id",
    byPaymentId.some((row) => row.booking_id === managePaid.booking_reference),
    `${byPaymentId.length} rows`,
  );

  const byOrderId = await search({ p_query: "order_MANAGE00000000002" });
  check(
    "and by the Razorpay order id, which is what most support threads quote",
    byOrderId.some((row) => row.booking_id === manageSplit.booking_reference),
    `${byOrderId.length} rows`,
  );

  const [managePass] = await q(
    `select pass_id, booking_id from public.digital_passes where booking_id = '${managePaid.booking_uuid}' limit 1;`,
  );
  const byPassId = await search({ p_query: managePass.pass_id });
  check(
    "and by a pass id, as printed on the guest's ticket",
    byPassId.some((row) => row.booking_uuid === managePass.booking_id) && byPassId.length === 1,
    `${managePass.pass_id}: ${byPassId.length} rows`,
  );

  // A search term is a term, not a wildcard: "%" would otherwise return the event.
  const byWildcard = await search({ p_query: "%" });
  check(
    "a search for a literal % finds nothing rather than everything",
    byWildcard.length === 0,
    `${byWildcard.length} rows`,
  );
  const byQuote = await search({ p_query: "'; drop table public.bookings; --" });
  check(
    "a search that looks like SQL is just a string that matches nothing",
    byQuote.length === 0 &&
      (await q(`select count(*)::int as n from public.bookings;`))[0].n > 0,
    `${byQuote.length} rows`,
  );

  // ---- the five filters -------------------------------------------------------
  const nightRows = await search({ p_event_date_from: manageNightDate, p_event_date_to: manageNightDate });
  check(
    "the date filter returns exactly the bookings for that night",
    nightRows.length === fixtureIds.length && nightRows.every(onNight),
    `${nightRows.length} rows on ${manageNightDate}`,
  );
  check(
    "and the count it reports is the size of the whole result set",
    nightRows.every((row) => Number(row.total_count) === fixtureIds.length),
    `${nightRows[0]?.total_count ?? "?"} reported`,
  );

  const otherNight = await search({
    p_event_date_from: manageNightDate,
    p_event_date_to: (await q(`select (('${manageNightDate}'::date - 1))::text as d;`))[0].d,
  });
  check(
    "a date range that ends before it starts returns nothing rather than everything",
    otherNight.length === 0,
    `${otherNight.length} rows`,
  );

  const coupleOnly = await search({
    p_event_date_from: manageNightDate,
    p_event_date_to: manageNightDate,
    p_pass_category_id: COUPLE,
  });
  check(
    "the pass filter narrows to one pass category",
    coupleOnly.length === 3 && coupleOnly.every((row) => ["Manage Paid", "Manage Split", "Manage Inside"].includes(row.customer_name)),
    coupleOnly.map((row) => row.customer_name).join(", "),
  );

  const paidOnly = await search({
    p_event_date_from: manageNightDate,
    p_event_date_to: manageNightDate,
    p_payment_status: "paid",
  });
  check(
    "the payment filter returns the bookings the gateway confirmed",
    paidOnly.length === 3 && paidOnly.every((row) => row.payment_status === "paid"),
    paidOnly.map((row) => `${row.customer_name}:${row.payment_status}`).join(" "),
  );

  const unpaidOnly = await search({
    p_event_date_from: manageNightDate,
    p_event_date_to: manageNightDate,
    p_payment_status: "unpaid",
  });
  check(
    "and it keeps an unpaid booking out of the paid list",
    unpaidOnly.length === 1 && unpaidOnly[0].booking_uuid === manageUnpaid.booking_uuid,
    unpaidOnly.map((row) => row.customer_name).join(", "),
  );

  const refundedOnly = await search({
    p_event_date_from: manageNightDate,
    p_event_date_to: manageNightDate,
    p_payment_status: "refunded",
  });
  check(
    "a refunded booking is filtered as refunded, not as paid",
    refundedOnly.length === 1 && refundedOnly[0].booking_uuid === manageRefunded.booking_uuid,
    refundedOnly.map((row) => `${row.customer_name}:${row.payment_status}`).join(" "),
  );

  const confirmedOnly = await search({
    p_event_date_from: manageNightDate,
    p_event_date_to: manageNightDate,
    p_booking_status: "confirmed",
  });
  check(
    "the booking-status filter follows the booking's own lifecycle",
    confirmedOnly.length === 3 && confirmedOnly.every((row) => row.booking_status === "confirmed"),
    confirmedOnly.map((row) => row.booking_status).join(" "),
  );

  const unknownStatus = await search({
    p_event_date_from: manageNightDate,
    p_event_date_to: manageNightDate,
    p_payment_status: "partially-refunded",
    p_booking_status: "nonsense",
  });
  check(
    "a status the schema does not know narrows nothing instead of matching nothing",
    unknownStatus.length === fixtureIds.length,
    `${unknownStatus.length} rows for two unknown filters`,
  );

  const nobodyIn = await search({ p_check_in_status: "none" });
  check(
    "the check-in filter finds the bookings nobody has been admitted from",
    nobodyIn.length > 0 && nobodyIn.every((row) => Number(row.passes_checked_in) === 0),
    `${nobodyIn.length} rows, all with 0 in`,
  );
  check(
    "and that includes the fixtures, including the one with no passes at all",
    nobodyIn.some((row) => row.booking_uuid === managePaid.booking_uuid) &&
      nobodyIn.some((row) => row.booking_uuid === manageUnpaid.booking_uuid),
  );

  const partlyIn = await search({ p_check_in_status: "some" });
  check(
    "the partial check-in filter finds the groups half inside",
    partlyIn.length > 0 &&
      partlyIn.every((row) => Number(row.passes_checked_in) > 0 && Number(row.passes_checked_in) < Number(row.passes_issued)) &&
      partlyIn.some((row) => row.booking_uuid === manageSplit.booking_uuid),
    `${partlyIn.length} rows, e.g. ${partlyIn[0]?.passes_checked_in}/${partlyIn[0]?.passes_issued}`,
  );

  const allIn = await search({ p_check_in_status: "all" });
  check(
    "the complete check-in filter finds the bookings that are entirely inside",
    allIn.length > 0 &&
      allIn.every(
        (row) => Number(row.passes_issued) > 0 && Number(row.passes_checked_in) === Number(row.passes_issued),
      ) &&
      allIn.some((row) => row.booking_uuid === manageAll.booking_uuid),
    `${allIn.length} rows`,
  );

  const combined = await search({
    p_query: "Manage",
    p_event_date_from: manageNightDate,
    p_event_date_to: manageNightDate,
    p_pass_category_id: COUPLE,
    p_payment_status: "paid",
    p_booking_status: "confirmed",
    p_check_in_status: "some",
  });
  check(
    "all six filters compose: the result is the intersection, not the union",
    combined.length === 1 && combined[0].booking_uuid === manageSplit.booking_uuid,
    combined.map((row) => row.customer_name).join(", ") || "no rows",
  );

  // ---- paging -----------------------------------------------------------------
  const firstPage = await search({ p_query: "Manage", p_limit: 2, p_offset: 0 });
  const secondPage = await search({ p_query: "Manage", p_limit: 2, p_offset: 2 });
  check(
    "paging returns the requested slice and never overlaps the previous one",
    firstPage.length === 2 &&
      secondPage.length === 2 &&
      !firstPage.some((row) => secondPage.some((other) => other.booking_uuid === row.booking_uuid)),
    `${firstPage.length} + ${secondPage.length}`,
  );
  check(
    "every page reports the same total",
    firstPage[0].total_count === secondPage[0].total_count &&
      Number(firstPage[0].total_count) >= fixtureIds.length,
    `${firstPage[0].total_count} / ${secondPage[0].total_count}`,
  );
  check(
    "the newest booking is on the first page, not wherever the database felt like it",
    new Date(firstPage[0].created_at).getTime() >= new Date(secondPage[0].created_at).getTime(),
  );

  const beyond = await search({ p_query: "Manage", p_limit: 2, p_offset: 500 });
  check(
    "a page past the end is empty rather than an error",
    beyond.length === 0,
    `${beyond.length} rows`,
  );

  const hugePage = await search({ p_limit: 100000 });
  check("an enormous page size is clamped to something sane", hugePage.length <= 100, `${hugePage.length} rows`);
  const zeroPage = await search({ p_limit: 0 });
  check("a page size of zero still returns one row", zeroPage.length === 1, `${zeroPage.length} rows`);
  const negativePage = await search({ p_limit: 5, p_offset: -10 });
  check("a negative offset is treated as the start of the list", negativePage.length === 5, `${negativePage.length} rows`);

  // ---- the staff view of the same screen --------------------------------------
  const staffView = await search({ p_query: "Manage", p_include_contact: false, p_limit: 25 });
  check(
    "the staff view of the list carries no contact details, amounts or gateway ids",
    staffView.length > 0 &&
      staffView.every(
        (row) =>
          row.customer_mobile === null &&
          row.customer_email === null &&
          row.total_amount === null &&
          row.razorpay_order_id === null &&
          row.razorpay_payment_id === null,
      ),
    JSON.stringify(staffView[0] ?? null),
  );
  check(
    "but it still shows the guest, the night, the pass and the check-in state",
    staffView.every(
      (row) => Boolean(row.customer_name) && Boolean(row.pass_name) && Number.isInteger(Number(row.passes_issued)),
    ),
    JSON.stringify({ name: staffView[0]?.customer_name, issued: staffView[0]?.passes_issued }),
  );
  check(
    "and it can still be searched by a payment id the guest read out over the phone",
    (
      await search({ p_query: "pay_MANAGE00000000001", p_include_contact: false })
    ).some((row) => row.booking_uuid === managePaid.booking_uuid),
  );

  // ---- one booking, completely -------------------------------------------------
  const detailByReference = (await rpc("admin_booking_detail", { p_lookup: manageSplit.booking_reference }))[0];
  check(
    "the detail is found by the booking reference",
    detailByReference?.booking_uuid === manageSplit.booking_uuid,
    detailByReference?.booking_id ?? "no row",
  );
  check(
    "it carries the whole booking: guest, venue, night, pass and money",
    detailByReference.customer_name === "Manage Split" &&
      detailByReference.city === "Jaipur" &&
      Boolean(detailByReference.venue_name) &&
      new Date(detailByReference.event_date).toISOString().slice(0, 10) === manageNightDate &&
      Number(detailByReference.total_amount) === Number(manageSplit.total_amount) &&
      Number(detailByReference.subtotal) >= Number(detailByReference.total_amount) &&
      detailByReference.razorpay_payment_id === "pay_MANAGE00000000002" &&
      detailByReference.razorpay_order_id === "order_MANAGE00000000002",
    JSON.stringify({
      city: detailByReference.city,
      amount: detailByReference.total_amount,
      payment: detailByReference.razorpay_payment_id,
    }),
  );
  check(
    "it lists every pass on the booking with its own state",
    Array.isArray(detailByReference.passes) &&
      detailByReference.passes.length === 2 &&
      detailByReference.passes.filter((pass) => pass.checked_in).length === 1,
    JSON.stringify(detailByReference.passes),
  );
  check(
    "and every gate entry, with the staff member who made it",
    Array.isArray(detailByReference.check_ins) &&
      detailByReference.check_ins.length === 1 &&
      detailByReference.check_ins[0].staff === manageStaff.who &&
      detailByReference.check_ins[0].gate === "Management Test Gate" &&
      Boolean(detailByReference.check_ins[0].checked_in_at),
    JSON.stringify(detailByReference.check_ins),
  );
  check(
    "the pass token is not in the detail: the credential that admits is not a screen's business",
    !JSON.stringify(detailByReference).includes("qr_token") &&
      !JSON.stringify(detailByReference).match(/[0-9a-f]{64}/),
    Object.keys(detailByReference).join(","),
  );

  const detailByPass = (await rpc("admin_booking_detail", { p_lookup: managePass.pass_id }))[0];
  check(
    "the same booking is found by a pass id",
    detailByPass?.booking_uuid === managePaid.booking_uuid,
    detailByPass?.booking_id ?? "no row",
  );
  const detailByPayment = (await rpc("admin_booking_detail", { p_lookup: "pay_MANAGE00000000003" }))[0];
  check(
    "and by the payment id on the Razorpay receipt",
    detailByPayment?.booking_uuid === manageRefunded.booking_uuid &&
      detailByPayment.payment_status === "refunded",
    detailByPayment?.booking_id ?? "no row",
  );
  const detailByOrder = (await rpc("admin_booking_detail", { p_lookup: "order_MANAGE00000000003" }))[0];
  check("and by the order id", detailByOrder?.booking_uuid === manageRefunded.booking_uuid);

  const detailMissing = await rpc("admin_booking_detail", { p_lookup: "DND999999999" });
  check("an unknown reference returns no detail at all", detailMissing.length === 0, `${detailMissing.length} rows`);
  const detailEmpty = await rpc("admin_booking_detail", { p_lookup: "" });
  check("an empty lookup returns no detail either", detailEmpty.length === 0, `${detailEmpty.length} rows`);

  const detailLimited = (await rpc("admin_booking_detail", {
    p_lookup: manageSplit.booking_reference,
    p_include_contact: false,
  }))[0];
  check(
    "the staff view of the detail withholds the contact details, the money and the gateway ids",
    detailLimited.customer_mobile === null &&
      detailLimited.customer_email === null &&
      detailLimited.subtotal === null &&
      detailLimited.total_amount === null &&
      detailLimited.razorpay_order_id === null &&
      detailLimited.razorpay_payment_id === null &&
      detailLimited.payment_events === null,
    JSON.stringify(detailLimited),
  );
  check(
    "but keeps what a person at the door needs: the guest, the passes and the entries",
    detailLimited.customer_name === "Manage Split" &&
      detailLimited.passes.length === 2 &&
      detailLimited.check_ins.length === 1,
    `${detailLimited.passes?.length} passes / ${detailLimited.check_ins?.length} entries`,
  );

  // ---- the payment audit trail -------------------------------------------------
  const [eventFixture] = await q(`
    select count(*)::integer as n from public.payment_events where razorpay_order_id = 'order_MANAGE00000000003';
  `);
  const webhookOrder = "order_MANAGE00000000004";
  await rpc("apply_razorpay_event", {
    p_event_id: "evt_MANAGE_REFUND_1",
    p_event_type: "refund.processed",
    p_razorpay_order_id: webhookOrder,
    p_razorpay_payment_id: "pay_MANAGE00000000004",
    p_amount_paise: 49900,
  });
  const detailWithEvents = (await rpc("admin_booking_detail", { p_lookup: manageAll.booking_reference }))[0];
  check(
    "the detail shows what the gateway actually reported for this order",
    Array.isArray(detailWithEvents.payment_events) &&
      detailWithEvents.payment_events.some(
        (event) => event.event_type === "refund.processed" && event.outcome === "refunded",
      ),
    JSON.stringify(detailWithEvents.payment_events),
  );
  check(
    "including the refund it applied to a booking that was paid",
    detailWithEvents.payment_status === "refunded",
    detailWithEvents.payment_status,
  );
  check(
    "the earlier unpaid fixture has no gateway events at all, which is the honest answer",
    (await rpc("admin_booking_detail", { p_lookup: manageUnpaid.booking_reference }))[0].payment_events.length === 0 &&
      eventFixture.n >= 0,
  );

  // ---- the payment guard -------------------------------------------------------
  // Everything above went through the gateway functions. Now the thing the guard is
  // for: a hand-written status change.
  await run(`select set_config('app.payment_proof', '', true);`);
  const manualPaid = await expectError(`
    update public.bookings set payment_status = 'paid' where id = '${manageUnpaid.booking_uuid}';
  `);
  check(
    "a hand-written update cannot mark a booking paid",
    typeof manualPaid === "string" && /payment_status may only change/.test(manualPaid),
    manualPaid ?? "the update succeeded",
  );
  const manualRefund = await expectError(`
    update public.bookings set payment_status = 'refunded', booking_status = 'refunded'
     where id = '${managePaid.booking_uuid}';
  `);
  check(
    "nor silently refund one",
    typeof manualRefund === "string" && /payment_status may only change/.test(manualRefund),
    manualRefund ?? "the update succeeded",
  );
  check(
    "the booking is untouched by the refused updates",
    (await q(`select payment_status from public.bookings where id = '${manageUnpaid.booking_uuid}';`))[0]
      .payment_status === "unpaid" &&
      (await q(`select payment_status from public.bookings where id = '${managePaid.booking_uuid}';`))[0]
        .payment_status === "paid",
  );
  check(
    "the guard only watches the payment status: an ordinary edit still saves",
    (await (async () => {
      await run(`update public.bookings set notes = 'Called the guest about a wheelchair.' where id = '${managePaid.booking_uuid}';`);
      return q(`select notes from public.bookings where id = '${managePaid.booking_uuid}';`);
    })())[0].notes === "Called the guest about a wheelchair.",
  );
  check(
    "the payment functions can still move it, which is the whole point",
    (await q(`select payment_status from public.bookings where id = '${manageRefunded.booking_uuid}';`))[0]
      .payment_status === "refunded",
  );
  const guardTrigger = await q(`
    select t.tgname, p.proname
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_proc p on p.oid = t.tgfoid
     where c.relname = 'bookings' and t.tgname = 'bookings_guard_payment_status';
  `);
  check(
    "and the guard is a trigger on the table, not a convention in the app",
    guardTrigger.length === 1 && guardTrigger[0].proname === "guard_booking_payment_status",
    JSON.stringify(guardTrigger),
  );

  // ---- the reads are reads, and they are closed --------------------------------
  const manageReads = await q(`
    select p.proname, p.provolatile
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('admin_search_bookings', 'admin_booking_detail')
     order by p.proname;
  `);
  check(
    "both management reads are declared stable: they cannot write, whatever they are passed",
    manageReads.length === 2 && manageReads.every((row) => row.provolatile === "s"),
    JSON.stringify(manageReads),
  );

  const detailGrants = await q(`
    select
      has_function_privilege('anon', 'public.admin_booking_detail(text, boolean)', 'execute') as anon,
      has_function_privilege('authenticated', 'public.admin_booking_detail(text, boolean)', 'execute') as authenticated,
      has_function_privilege('service_role', 'public.admin_booking_detail(text, boolean)', 'execute') as service;
  `);
  check(
    "only the service role may read a booking in full",
    detailGrants[0].anon === false && detailGrants[0].authenticated === false && detailGrants[0].service === true,
    JSON.stringify(detailGrants[0]),
  );
  const anonDetail = await expectError(`set role anon; select * from public.admin_booking_detail('DND202600001');`);
  check("an anon session cannot read a booking's detail", anonDetail !== null, anonDetail ?? "call succeeded");
  await run("reset role;");
  const authedDetail = await expectError(
    `set role authenticated; select * from public.admin_booking_detail('${managePaid.booking_reference}');`,
  );
  check(
    "nor can a signed-in visitor who is not staff",
    authedDetail !== null,
    authedDetail ?? "call succeeded",
  );
  await run("reset role;");

  // ---------------------------------------------------------------------------
  section("Admin payments and passes: the gateway's record and the door list");
  // ---------------------------------------------------------------------------
  // Two read-only screens. What is checked here is the part a screen cannot fake: that
  // the delivery log reports what the gateway actually sent (including the deliveries
  // nothing could be done with), that the attention list contains exactly the rows whose
  // payment state contradicts the rest of the row, and that the pass list knows where
  // every pass is — without ever handing out the token that admits one.
  const payAttentionMobile = "+919800001230";
  const payAttentionBooking = await createBooking({
    p_event_date_id: DASH_NIGHT,
    p_pass_category_id: COUPLE,
    p_customer_name: "Gateway Trouble",
    p_customer_mobile: payAttentionMobile,
    p_customer_email: "trouble@example.com",
    p_quantity: 1,
    p_number_of_people: 2,
    p_idempotency_key: "pay-attention-1",
  });

  // The order is attached before anything looks for it: an event log searched for a
  // null order id would be searched for nothing at all, and would answer with the log.
  await rpc("attach_razorpay_order", {
    p_booking_id: payAttentionBooking.booking_uuid,
    p_razorpay_order_id: "order_ATTENTION0000001",
  });
  const [attentionBookingRow] = await q(`
    select booking_id, razorpay_order_id, razorpay_payment_id, payment_status, booking_status
      from public.bookings where id = '${payAttentionBooking.booking_uuid}';
  `);
  check(
    "the attention fixture is a booking with an order and no verified payment yet",
    attentionBookingRow.razorpay_order_id === "order_ATTENTION0000001" &&
      attentionBookingRow.payment_status === "unpaid",
    JSON.stringify(attentionBookingRow),
  );

  // Confirmed through the gateway's own dispatcher, so the delivery log below has a row
  // to find and the fixture starts from a state the app genuinely produces — before this
  // section breaks it on purpose.
  const attentionEvent = await rpc("apply_razorpay_event", {
    p_event_id: "evt_ATTENTION0000001",
    p_event_type: "payment.captured",
    p_razorpay_order_id: "order_ATTENTION0000001",
    p_razorpay_payment_id: "pay_ATTENTION0000001",
    p_amount_paise: payAttentionBooking.total_amount * 100,
  });
  check(
    "the attention fixture is confirmed through the gateway's dispatcher, as a real payment is",
    attentionEvent[0]?.outcome === "confirmed",
    JSON.stringify(attentionEvent[0] ?? null),
  );

  // ---- the delivery log ---------------------------------------------------------
  const eventsAll = await rpc("admin_payment_events", { p_include_contact: true, p_limit: 100 });
  const [eventLedger] = await q(`select count(*)::int as n from public.payment_events;`);

  check(
    "the delivery log lists every event the gateway sent",
    eventsAll.length === eventLedger.n && eventsAll.length > 0,
    `${eventsAll.length} rows / ${eventLedger.n} events`,
  );
  check(
    "newest delivery first",
    eventsAll.every((row, index) => index === 0 || new Date(eventsAll[index - 1].received_at) >= new Date(row.received_at)),
  );
  check(
    "each row carries what the gateway said and what the site did",
    eventsAll.every(
      (row) =>
        typeof row.event_type === "string" &&
        typeof row.outcome === "string" &&
        typeof row.event_id === "string" &&
        row.received_at !== null,
    ),
    JSON.stringify(eventsAll[0] ?? null).slice(0, 200),
  );
  check(
    "and the booking it belongs to, where one can be identified",
    eventsAll.some((row) => row.booking_id === attentionBookingRow.booking_id) &&
      eventsAll.some((row) => row.booking_uuid !== null),
  );
  const unmatched = eventsAll.filter((row) => row.booking_uuid === null);
  check(
    "an event that matches no booking is still listed, with an honest null on every booking column",
    unmatched.length > 0 &&
      unmatched.every(
        (row) =>
          row.booking_id === null &&
          row.customer_name === null &&
          row.customer_mobile === null &&
          row.total_amount === null &&
          row.payment_status === null,
      ),
    `${unmatched.length} deliveries belong to no booking we hold`,
  );

  const ignoredOutcome = await rpc("admin_payment_events", { p_outcome: "ignored", p_limit: 100 });
  check(
    "filtering by outcome returns only that outcome",
    ignoredOutcome.length > 0 && ignoredOutcome.every((row) => row.outcome === "ignored"),
    `${ignoredOutcome.length} ignored`,
  );
  const confirmedOutcome = await rpc("admin_payment_events", { p_outcome: "confirmed", p_limit: 100 });
  check(
    "and a different outcome returns a different set",
    confirmedOutcome.length > 0 &&
      confirmedOutcome.every((row) => row.outcome === "confirmed") &&
      !confirmedOutcome.some((row) => row.event_uuid === ignoredOutcome[0]?.event_uuid),
  );
  const unknownOutcome = await rpc("admin_payment_events", { p_outcome: "nonsense", p_limit: 100 });
  check(
    "an outcome the schema does not know narrows nothing rather than matching nothing",
    unknownOutcome.length === eventsAll.length,
    `${unknownOutcome.length} rows for an unknown outcome`,
  );

  const capturedOnly = await rpc("admin_payment_events", { p_event_type: "payment.captured", p_limit: 100 });
  check(
    "the event-type filter is exact",
    capturedOnly.length > 0 && capturedOnly.every((row) => row.event_type === "payment.captured"),
    capturedOnly.map((row) => row.event_type).join(", ") || "no rows",
  );

  const eventByOrderId = await rpc("admin_payment_events", {
    p_query: attentionBookingRow.razorpay_order_id,
    p_include_contact: true,
    p_limit: 100,
  });
  check(
    "a delivery is found by the gateway order id",
    eventByOrderId.length > 0 && eventByOrderId.every((row) => row.booking_uuid === payAttentionBooking.booking_uuid),
    `${eventByOrderId.length} rows`,
  );
  const eventByBooking = await rpc("admin_payment_events", {
    p_query: attentionBookingRow.booking_id,
    p_limit: 100,
  });
  check(
    "and by anything about the booking it belongs to",
    eventByBooking.length > 0 &&
      eventByBooking.every((row) => row.booking_uuid === payAttentionBooking.booking_uuid),
    `${eventByBooking.length} rows`,
  );
  const eventByMobile = await rpc("admin_payment_events", { p_query: "+91 98000 01230", p_limit: 100 });
  check(
    "and by the guest's mobile number, however it was typed",
    eventByMobile.length > 0 && eventByMobile.every((row) => row.booking_uuid === payAttentionBooking.booking_uuid),
    `${eventByMobile.length} rows`,
  );
  const noDigitsForNames = await rpc("admin_payment_events", { p_query: "payment.captured 2", p_limit: 100 });
  check(
    "a term with letters in it is never treated as a phone number",
    noDigitsForNames.every((row) => row.booking_uuid === null || row.event_type === "payment.captured"),
    `${noDigitsForNames.length} rows`,
  );

  const todayUtc = (await q(`select (now() at time zone 'UTC')::date::text as today;`))[0].today;
  const tomorrowUtc = (
    await q(`select ((now() at time zone 'UTC')::date + 1)::text as tomorrow;`)
  )[0].tomorrow;
  const datedFrom = await rpc("admin_payment_events", { p_from: todayUtc, p_limit: 100 });
  const datedTo = await rpc("admin_payment_events", { p_to: tomorrowUtc, p_limit: 100 });
  const datedFuture = await rpc("admin_payment_events", { p_from: tomorrowUtc, p_limit: 100 });
  check(
    "the date range is inclusive at both ends and empty outside",
    datedFrom.length === eventsAll.length && datedTo.length > 0 && datedFuture.length === 0,
    `${datedFrom.length} from today / ${datedFuture.length} from tomorrow`,
  );

  const eventPage = await rpc("admin_payment_events", { p_limit: 2, p_offset: 0 });
  const eventPageTwo = await rpc("admin_payment_events", { p_limit: 2, p_offset: 2 });
  check(
    "the log pages without repeating a row, and every page reports the same total",
    eventPage.length === 2 &&
      eventPageTwo.length === 2 &&
      !eventPage.some((row) => eventPageTwo.some((other) => other.event_uuid === row.event_uuid)) &&
      eventPage[0].total_count === eventPageTwo[0].total_count,
    `${eventPage[0]?.total_count ?? "?"} total`,
  );

  const eventsStaff = await rpc("admin_payment_events", { p_include_contact: false, p_limit: 100 });
  check(
    "the staff view of the log withholds the amount, the booking's amount and the contact details",
    eventsStaff.length > 0 &&
      eventsStaff.every(
        (row) => row.amount_paise === null && row.total_amount === null && row.customer_mobile === null,
      ) &&
      eventsStaff.some((row) => row.booking_uuid !== null),
    JSON.stringify(eventsStaff.find((row) => row.booking_uuid !== null) ?? {}),
  );
  check(
    "but still shows what happened and to which order",
    eventsStaff.every((row) => typeof row.outcome === "string" && typeof row.event_type === "string"),
  );

  // ---- the counts ---------------------------------------------------------------
  const gatewaySummary = (await rpc("admin_payment_summary", { p_include_contact: true }))[0];
  const [summaryLedger] = await q(`
    select
      (select count(*)::int from public.payment_events) as total,
      (select count(*)::int from public.payment_events where outcome in ('confirmed', 'already_confirmed')) as confirmed,
      (select count(*)::int from public.payment_events where outcome = 'failed') as failed,
      (select count(*)::int from public.payment_events where outcome = 'refunded') as refunded,
      (select count(*)::int from public.payment_events where outcome = 'ignored') as ignored,
      (select count(*)::int from public.payment_events where outcome = 'duplicate') as duplicate,
      (select coalesce(sum(amount_paise) filter (where outcome in ('confirmed', 'already_confirmed')), 0)::bigint
         from public.payment_events) as captured,
      (select coalesce(sum(amount_paise) filter (where outcome = 'refunded'), 0)::bigint
         from public.payment_events) as refunded_amount,
      (select count(*)::int from public.bookings b
        where b.razorpay_order_id is not null and b.payment_status in ('unpaid', 'created', 'failed')) as awaiting;
  `);
  check(
    "every count above the log matches the gateway rows it describes",
    Number(gatewaySummary.events_total) === Number(summaryLedger.total) &&
      Number(gatewaySummary.events_confirmed) === Number(summaryLedger.confirmed) &&
      Number(gatewaySummary.events_failed) === Number(summaryLedger.failed) &&
      Number(gatewaySummary.events_refunded) === Number(summaryLedger.refunded) &&
      Number(gatewaySummary.events_ignored) === Number(summaryLedger.ignored) &&
      Number(gatewaySummary.events_duplicate) === Number(summaryLedger.duplicate) &&
      Number(gatewaySummary.orders_awaiting) === Number(summaryLedger.awaiting),
    JSON.stringify(gatewaySummary),
  );
  check(
    "the captured and refunded figures are the gateway's own amounts, not the bookings'",
    Number(gatewaySummary.captured_paise) === Number(summaryLedger.captured) &&
      Number(gatewaySummary.refunded_paise) === Number(summaryLedger.refunded_amount) &&
      Number(gatewaySummary.captured_paise) > 0,
    `${gatewaySummary.captured_paise} captured / ${gatewaySummary.refunded_paise} refunded`,
  );
  check(
    "and neither sum is a booking total: they are the gateway's paise, not the site's rupees",
    Number(gatewaySummary.captured_paise) % 100 === 0 &&
      Number(gatewaySummary.refunded_paise) % 100 === 0 &&
      Number(gatewaySummary.captured_paise) !==
        Number(
          (
            await q(`select coalesce(sum(total_amount), 0)::int as n from public.bookings where payment_status = 'paid';`)
          )[0].n,
        ),
    `${gatewaySummary.captured_paise} paise captured vs the paid bookings' rupees`,
  );
  const summaryStaff = (await rpc("admin_payment_summary", { p_include_contact: false }))[0];
  check(
    "a caller who may not see money receives no money at all, only nulls",
    summaryStaff.captured_paise === null &&
      summaryStaff.refunded_paise === null &&
      Number(summaryStaff.events_total) === Number(gatewaySummary.events_total),
    JSON.stringify(summaryStaff),
  );

  // ---- rows that contradict themselves -------------------------------------------
  // A paid booking that holds its passes is not a contradiction either: this list is
  // about states, not about suspicion.
  const healthyAttention = await rpc("admin_payment_attention", { p_include_contact: true, p_limit: 100 });
  check(
    "a paid booking holding its pass is not listed",
    !healthyAttention.some((row) => row.booking_uuid === payAttentionBooking.booking_uuid),
    `${healthyAttention.length} rows need attention`,
  );

  // A state the app cannot produce (a paid booking always gets its passes) and the
  // database does not forbid: exactly what this list exists to catch.
  await run(`
    delete from public.digital_passes where booking_id = '${payAttentionBooking.booking_uuid}';
  `);

  const paidNoPass = await rpc("admin_payment_attention", { p_include_contact: true, p_limit: 100 });
  const paidNoPassRow = paidNoPass.find((row) => row.booking_uuid === payAttentionBooking.booking_uuid);
  check(
    "a paid booking with no pass is listed, with the reason and the action",
    paidNoPassRow?.reason_code === "paid-no-pass" &&
      /no pass was ever issued/i.test(paidNoPassRow.reason) &&
      /resend|re-deliver/i.test(paidNoPassRow.action),
    JSON.stringify(paidNoPassRow ?? null).slice(0, 200),
  );
  check(
    "and the row carries the identifiers needed to act on it",
    paidNoPassRow.booking_id === attentionBookingRow.booking_id &&
      paidNoPassRow.razorpay_order_id === "order_ATTENTION0000001" &&
      paidNoPassRow.customer_name === "Gateway Trouble" &&
      Number(paidNoPassRow.total_amount) === Number(payAttentionBooking.total_amount),
  );

  // The pass put back by hand — the same shape of fixture the gate section uses — so
  // the list's rule can be tested from both sides: it is the *absence* of a pass that
  // is the contradiction, not a marker on some row.
  await run(`
    insert into public.digital_passes (booking_id, valid_date, pass_number)
    values ('${payAttentionBooking.booking_uuid}', '${manageNightDate}'::date, 1);
  `);
  const afterReissue = await rpc("admin_payment_attention", { p_include_contact: true, p_limit: 100 });
  check(
    "a paid booking that holds a pass is no longer listed",
    !afterReissue.some((row) => row.booking_uuid === payAttentionBooking.booking_uuid),
    `${afterReissue.length} rows need attention`,
  );

  await rpc("refund_booking_payment", { p_razorpay_payment_id: "pay_ATTENTION0000001" });
  await run(`
    update public.digital_passes set status = 'active', checked_in = false, checked_in_at = null
     where booking_id = '${payAttentionBooking.booking_uuid}';
  `);
  const refundedWithPass = await rpc("admin_payment_attention", { p_include_contact: true, p_limit: 100 });
  const refundedRow = refundedWithPass.find((row) => row.booking_uuid === payAttentionBooking.booking_uuid);
  check(
    "a refunded booking holding an active pass is listed, and says to cancel it",
    refundedRow?.reason_code === "refunded-with-active-pass" &&
      Number(refundedRow.passes_active) === 1 &&
      /cancel the pass/i.test(refundedRow.action),
    JSON.stringify(refundedRow ?? null).slice(0, 200),
  );

  const attentionStaff = await rpc("admin_payment_attention", { p_include_contact: false, p_limit: 100 });
  const attentionStaffRow = attentionStaff.find((row) => row.booking_uuid === payAttentionBooking.booking_uuid);
  check(
    "the staff view of the attention list withholds the money and the gateway ids",
    attentionStaffRow?.total_amount === null &&
      attentionStaffRow.razorpay_order_id === null &&
      attentionStaffRow.customer_mobile === null &&
      Boolean(attentionStaffRow.reason),
    JSON.stringify(attentionStaffRow ?? null).slice(0, 200),
  );

  const attentionFiltered = await rpc("admin_payment_attention", { p_include_contact: true, p_limit: 1 });
  check(
    "the attention list respects its own limit while still reporting the full count",
    attentionFiltered.length === 1 && Number(attentionFiltered[0].total_count) >= refundedWithPass.length,
    `${attentionFiltered[0]?.total_count ?? "?"} rows need attention`,
  );

  // Put the fixture night back to a state the rest of the harness can reason about.
  await run(`
    update public.digital_passes set status = 'cancelled'
     where booking_id = '${payAttentionBooking.booking_uuid}';
  `);

  // ---- the pass list ------------------------------------------------------------
  const allPasses = await rpc("admin_pass_list", { p_include_contact: true, p_limit: 100, p_offset: 0 });
  const [passLedger] = await q(`select count(*)::int as n from public.digital_passes;`);

  check(
    "the pass list has one row per pass there is, and says how many that is",
    Number(allPasses[0]?.total_count) === passLedger.n && allPasses.length === Math.min(100, passLedger.n),
    `${allPasses[0]?.total_count ?? "?"} passes / ${passLedger.n} rows in the table`,
  );
  check(
    "every row carries the pass, the booking, the night and the guest",
    allPasses.every(
      (row) =>
        /^PS-\d{6}$/.test(row.pass_id) &&
        typeof row.booking_id === "string" &&
        typeof row.valid_date === "string" &&
        typeof row.customer_name === "string" &&
        typeof row.pass_name === "string" &&
        Number(row.passes_on_booking) >= 1,
    ),
    JSON.stringify(allPasses[0] ?? null).slice(0, 240),
  );
  check(
    "the token that admits a guest is not in the list, in any column",
    !JSON.stringify(allPasses).includes("qr_token") && !JSON.stringify(allPasses).match(/[0-9a-f]{64}/),
    Object.keys(allPasses[0] ?? {}).join(","),
  );
  check(
    "the entry record is carried on the pass that was admitted",
    allPasses.some((row) => row.checked_in === true && row.checked_in_at !== null && row.gate !== null),
    `${allPasses.filter((row) => row.checked_in).length} admitted`,
  );

  await run(`
    update public.digital_passes set checked_in = true, checked_in_at = now(), status = 'used'
     where id = (select dp.id from public.digital_passes dp
                  join public.bookings b on b.id = dp.booking_id
                 where b.customer_name like 'Manage %'
                 order by dp.pass_id limit 1);
  `);
  const admittedPass = await rpc("admin_pass_list", { p_query: "Manage", p_include_contact: true, p_limit: 100 });
  check(
    "a pass that was admitted says when, where and by whom",
    admittedPass.some((row) => row.checked_in && row.gate === "Management Test Gate" && row.admitted_by !== null),
    `${admittedPass.filter((row) => row.checked_in).length} of ${admittedPass.length} admitted`,
  );

  const inFilter = await rpc("admin_pass_list", { p_check_in: "in", p_limit: 100 });
  const outFilter = await rpc("admin_pass_list", { p_check_in: "out", p_limit: 100 });
  check(
    "the entry filter splits the list into admitted and not, with nothing in both",
    inFilter.length > 0 &&
      outFilter.length > 0 &&
      inFilter.every((row) => row.checked_in) &&
      outFilter.every((row) => !row.checked_in) &&
      Number(inFilter[0].total_count) + Number(outFilter[0].total_count) === passLedger.n,
    `${inFilter.length} in / ${outFilter.length} out of ${passLedger.n}`,
  );
  const unknownEntry = await rpc("admin_pass_list", { p_check_in: "maybe", p_limit: 100 });
  check(
    "an entry filter the schema does not know narrows nothing",
    Number(unknownEntry[0]?.total_count) === passLedger.n,
    `${unknownEntry[0]?.total_count ?? "?"} rows`,
  );

  const usedOnly = await rpc("admin_pass_list", { p_status: "used", p_limit: 100 });
  check(
    "the status filter follows the pass's own state",
    usedOnly.length > 0 && usedOnly.every((row) => row.pass_status === "used"),
    usedOnly.map((row) => row.pass_status).join(", ") || "no rows",
  );
  const unknownStatusFilter = await rpc("admin_pass_list", { p_status: "lost", p_limit: 100 });
  check(
    "a pass status the schema does not know narrows nothing rather than matching nothing",
    Number(unknownStatusFilter[0]?.total_count) === passLedger.n,
    `${unknownStatusFilter[0]?.total_count ?? "?"} rows`,
  );

  const passByPassId = await rpc("admin_pass_list", { p_query: allPasses[0].pass_id, p_limit: 100 });
  check(
    "a pass is found by its id",
    passByPassId.length === 1 && passByPassId[0].pass_uuid === allPasses[0].pass_uuid,
    `${passByPassId.length} rows`,
  );
  const passesByBooking = await rpc("admin_pass_list", { p_query: allPasses[0].booking_id, p_limit: 100 });
  check(
    "and by its booking reference, which brings the whole group with it",
    passesByBooking.length === Number(allPasses[0].passes_on_booking) &&
      passesByBooking.every((row) => row.booking_id === allPasses[0].booking_id),
    `${passesByBooking.length} passes on ${allPasses[0].booking_id}`,
  );

  const nightFilter = await rpc("admin_pass_list", {
    p_event_date_id: MANAGE_NIGHT,
    p_limit: 100,
  });
  check(
    "the night filter takes a night, not a date",
    nightFilter.length > 0 &&
      nightFilter.every((row) => new Date(row.valid_date).toISOString().slice(0, 10) === manageNightDate) &&
      nightFilter.length < passLedger.n,
    `${nightFilter.length} passes for ${manageNightDate} of ${passLedger.n}`,
  );
  const nightWithNoPasses = await rpc("admin_pass_list", { p_from: "2099-01-01", p_limit: 100 });
  check(
    "a date range with nothing in it returns nothing rather than everything",
    nightWithNoPasses.length === 0,
    `${nightWithNoPasses.length} rows`,
  );

  const passPages = await rpc("admin_pass_list", { p_limit: 3, p_offset: 0 });
  const passPageTwo = await rpc("admin_pass_list", { p_limit: 3, p_offset: 3 });
  check(
    "the pass list pages without repeating a row",
    passPages.length === 3 &&
      passPageTwo.length === 3 &&
      !passPages.some((row) => passPageTwo.some((other) => other.pass_uuid === row.pass_uuid)) &&
      passPages[0].total_count === passPageTwo[0].total_count,
    `${passPages[0]?.total_count ?? "?"} passes`,
  );
  check(
    "and the passes of one booking stay together, in order",
    passPages.every((row, index) => index === 0 || row.booking_id !== passPages[index - 1].booking_id || row.pass_number <= passPages[index - 1].pass_number),
  );

  const passListStaff = await rpc("admin_pass_list", { p_include_contact: false, p_limit: 100 });
  check(
    "the staff view of the door list withholds the mobile number and the amount",
    passListStaff.length > 0 &&
      passListStaff.every((row) => row.customer_mobile === null && row.total_amount === null) &&
      passListStaff.every((row) => typeof row.pass_id === "string" && typeof row.checked_in === "boolean"),
    JSON.stringify(passListStaff[0] ?? null).slice(0, 200),
  );

  // ---- the counts above the door list -------------------------------------------
  const passSummary = (await rpc("admin_pass_summary", { p_tz: "Asia/Kolkata", p_include_contact: true }))[0];
  const [passSummaryLedger] = await q(`
    select
      (select count(*)::int from public.digital_passes) as issued,
      (select count(*)::int from public.digital_passes where status = 'active') as active,
      (select count(*)::int from public.digital_passes where status = 'used') as used,
      (select count(*)::int from public.digital_passes where status = 'cancelled') as cancelled,
      (select count(*)::int from public.digital_passes where status = 'expired') as expired,
      (select count(distinct booking_id)::int from public.digital_passes) as bookings,
      (select count(*)::int from public.digital_passes where checked_in) as checked_in,
      (select count(distinct ci.gate)::int from public.check_ins ci) as gates,
      (select max(ci.checked_in_at) from public.check_ins ci) as last_at,
      (select coalesce(sum(b.total_amount), 0)::int from public.bookings b
        where b.payment_status = 'paid'
          and exists (select 1 from public.digital_passes dp where dp.booking_id = b.id)) as revenue;
  `);
  check(
    "every pass count matches the table it counts",
    Number(passSummary.passes_issued) === Number(passSummaryLedger.issued) &&
      Number(passSummary.passes_active) === Number(passSummaryLedger.active) &&
      Number(passSummary.passes_used) === Number(passSummaryLedger.used) &&
      Number(passSummary.passes_cancelled) === Number(passSummaryLedger.cancelled) &&
      Number(passSummary.passes_expired) === Number(passSummaryLedger.expired) &&
      Number(passSummary.bookings_with_passes) === Number(passSummaryLedger.bookings) &&
      Number(passSummary.checked_in_total) === Number(passSummaryLedger.checked_in) &&
      Number(passSummary.gates_used) === Number(passSummaryLedger.gates),
    JSON.stringify(passSummary),
  );
  check(
    "the money behind the passes is counted once per booking, not once per pass",
    Number(passSummary.passes_revenue) === Number(passSummaryLedger.revenue) &&
      Number(passSummary.passes_revenue) > 0,
    `${passSummary.passes_revenue} / ${passSummaryLedger.revenue}`,
  );
  check(
    "a booking with more than one pass is not counted more than once",
    Number(passSummary.passes_revenue) <
      Number(
        (
          await q(`select coalesce(sum(b.total_amount), 0)::int as n from public.bookings b
                    join public.digital_passes dp on dp.booking_id = b.id
                   where b.payment_status = 'paid';`)
        )[0].n,
      ),
    "revenue is lower than the fan-out figure, as it must be",
  );
  check(
    "check-ins today are counted in the venue's days",
    Number(passSummary.checked_in_today) <= Number(passSummary.checked_in_total) &&
      Number(passSummary.checked_in_today) > 0,
    `${passSummary.checked_in_today} of ${passSummary.checked_in_total}`,
  );
  check(
    "the last entry is the newest one written",
    passSummary.last_check_in_at !== null &&
      new Date(passSummary.last_check_in_at).getTime() === new Date(passSummaryLedger.last_at).getTime(),
  );
  const passSummaryStaff = (await rpc("admin_pass_summary", { p_include_contact: false }))[0];
  check(
    "a caller who may not see money receives no figure, only a null",
    passSummaryStaff.passes_revenue === null &&
      Number(passSummaryStaff.passes_issued) === Number(passSummary.passes_issued),
    JSON.stringify(passSummaryStaff),
  );

  // ---- one set of search rules, shared -------------------------------------------
  // Escaping is checked in SQL, where a backslash means one thing: comparing escaped
  // strings inside a JavaScript literal is a good way to test the test.
  const escapedPattern = await q(`
    select public.admin_search_pattern('50%_off') = '50\\%\\_off' as percent_and_underscore,
           public.admin_search_pattern('%') = '\\%' as only_wildcard,
           public.admin_search_pattern('  padded  ') = 'padded' as trimmed,
           public.admin_search_pattern(left('x' || repeat('y', 200), 200)) = left('x' || repeat('y', 200), 64) as capped;
  `);
  check(
    "the search helpers escape LIKE wildcards, trim, and cap a term",
    escapedPattern[0].percent_and_underscore === true &&
      escapedPattern[0].only_wildcard === true &&
      escapedPattern[0].trimmed === true &&
      escapedPattern[0].capped === true,
    JSON.stringify(escapedPattern[0]),
  );
  check(
    "and decide whether a term is a phone number at all",
    (await q(`select public.admin_search_digits('98123 45678') as d,
                     public.admin_search_digits('Gate 4') as words,
                     public.admin_search_digits('42') as short;`))[0].d === "9812345678" &&
      (await q(`select public.admin_search_digits('Gate 4') as words;`))[0].words === "" &&
      (await q(`select public.admin_search_digits('42') as short;`))[0].short === "",
  );
  check(
    "the booking search and the two new lists agree about a term with no digits and no letters",
    (await rpc("admin_search_bookings", { p_query: "%%", p_limit: 5 })).length === 0 &&
      (await rpc("admin_pass_list", { p_query: "%%", p_limit: 5 })).length === 0,
  );

  // ---- the reads are reads, and they are closed ----------------------------------
  const operationsReads = await q(`
    select p.proname, p.provolatile, p.prosecdef,
           coalesce(array_to_string(p.proconfig, ','), '') as config
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('admin_payment_events', 'admin_payment_attention', 'admin_payment_summary',
                         'admin_pass_list', 'admin_pass_summary')
     order by p.proname;
  `);
  check(
    "all five operations reads are declared stable and security definer with a pinned search_path",
    operationsReads.length === 5 &&
      operationsReads.every(
        (row) => row.provolatile === "s" && row.prosecdef === true && row.config.includes("search_path=public"),
      ),
    JSON.stringify(operationsReads),
  );

  const operationsGrants = await q(`
    select
      has_function_privilege('anon', 'public.admin_payment_events(text, text, text, date, date, boolean, integer, integer)', 'execute') as events_anon,
      has_function_privilege('authenticated', 'public.admin_payment_events(text, text, text, date, date, boolean, integer, integer)', 'execute') as events_auth,
      has_function_privilege('service_role', 'public.admin_payment_events(text, text, text, date, date, boolean, integer, integer)', 'execute') as events_service,
      has_function_privilege('anon', 'public.admin_pass_list(text, text, text, uuid, date, date, boolean, integer, integer)', 'execute') as passes_anon,
      has_function_privilege('authenticated', 'public.admin_pass_list(text, text, text, uuid, date, date, boolean, integer, integer)', 'execute') as passes_auth,
      has_function_privilege('service_role', 'public.admin_pass_list(text, text, text, uuid, date, date, boolean, integer, integer)', 'execute') as passes_service,
      has_function_privilege('anon', 'public.admin_payment_summary(boolean)', 'execute') as summary_anon,
      has_function_privilege('authenticated', 'public.admin_payment_summary(boolean)', 'execute') as summary_auth,
      has_function_privilege('service_role', 'public.admin_payment_summary(boolean)', 'execute') as summary_service,
      has_function_privilege('anon', 'public.admin_pass_summary(text, boolean)', 'execute') as pass_summary_anon,
      has_function_privilege('authenticated', 'public.admin_pass_summary(text, boolean)', 'execute') as pass_summary_auth,
      has_function_privilege('service_role', 'public.admin_pass_summary(text, boolean)', 'execute') as pass_summary_service,
      has_function_privilege('anon', 'public.admin_payment_attention(boolean, integer)', 'execute') as attention_anon,
      has_function_privilege('service_role', 'public.admin_payment_attention(boolean, integer)', 'execute') as attention_service,
      has_function_privilege('anon', 'public.admin_search_pattern(text)', 'execute') as pattern_anon,
      has_function_privilege('service_role', 'public.admin_search_pattern(text)', 'execute') as pattern_service;
  `);
  check(
    "only the service role may read the gateway log or the pass list",
    operationsGrants[0].events_anon === false &&
      operationsGrants[0].events_auth === false &&
      operationsGrants[0].events_service === true &&
      operationsGrants[0].passes_anon === false &&
      operationsGrants[0].passes_auth === false &&
      operationsGrants[0].passes_service === true &&
      operationsGrants[0].summary_anon === false &&
      operationsGrants[0].summary_auth === false &&
      operationsGrants[0].summary_service === true &&
      operationsGrants[0].pass_summary_anon === false &&
      operationsGrants[0].pass_summary_auth === false &&
      operationsGrants[0].pass_summary_service === true &&
      operationsGrants[0].attention_anon === false &&
      operationsGrants[0].attention_service === true &&
      operationsGrants[0].pattern_anon === false &&
      operationsGrants[0].pattern_service === true,
    JSON.stringify(operationsGrants[0]),
  );

  const anonPassList = await expectError(`set role anon; select * from public.admin_pass_list('PS-000001');`);
  check("an anon session cannot read the pass list", anonPassList !== null, anonPassList ?? "call succeeded");
  await run("reset role;");
  const anonEventLog = await expectError(`set role anon; select * from public.admin_payment_events();`);
  check("nor the gateway log", anonEventLog !== null, anonEventLog ?? "call succeeded");
  await run("reset role;");

  // A screen cannot write, whichever key it holds: the guard is still the guard.
  const screenCannotMarkPaid = await expectError(`
    update public.bookings set payment_status = 'paid'
     where id = '${payAttentionBooking.booking_uuid}';
  `);
  check(
    "and nothing on these screens can move a payment status, because the database still refuses the write",
    typeof screenCannotMarkPaid === "string" && /payment_status may only change/.test(screenCannotMarkPaid),
    screenCannotMarkPaid ?? "the update succeeded",
  );

  // ---------------------------------------------------------------------------
  section("Admin pass and date management: prices, capacity and the booking window");
  // ---------------------------------------------------------------------------
  // The two screens an organiser runs the event from: the pass catalogue (what is on
  // sale, at what price, for whom) and the nights (how many seats, how many held back,
  // whether booking is open). Every rule is checked from both sides — do the valid
  // thing, then try to break it — because a form that refuses is worth nothing if a
  // hand-written UPDATE can write the same bad row, and a capacity rule is worth
  // nothing unless the booking path obeys it too.
  const pdmDay1 = "2099-05-01";
  const pdmDay2 = "2099-05-02";
  const pdmDay3 = "2099-05-03";

  /** Pays for a booking the way the site does: attach the order, then confirm it. */
  const pdmPay = async (booking, orderId, paymentId) => {
    await rpc("attach_razorpay_order", { p_booking_id: booking.booking_uuid, p_razorpay_order_id: orderId });
    await rpc("confirm_booking_payment", {
      p_razorpay_order_id: orderId,
      p_razorpay_payment_id: paymentId,
      p_amount_paise: booking.total_amount * 100,
    });
  };

  // ---- 1. the row shape, and the constraints behind it ------------------------
  const pdmDateColumns = await q(`
    select column_name, is_nullable, column_default
      from information_schema.columns
     where table_schema = 'public' and table_name = 'event_dates'
       and column_name in ('capacity_held', 'booking_open')
     order by column_name;
  `);
  const pdmMinAgeColumn = (
    await q(`
      select column_default from information_schema.columns
       where table_schema = 'public' and table_name = 'pass_categories' and column_name = 'min_age';
    `)
  )[0];

  check(
    "a night can hold seats back from online sale, and can have booking closed",
    pdmDateColumns.length === 2 &&
      pdmDateColumns.every((row) => row.is_nullable === "NO") &&
      /true/.test(pdmDateColumns.find((row) => row.column_name === "booking_open")?.column_default ?? ""),
    pdmDateColumns.map((row) => `${row.column_name}=${row.column_default}`).join(" "),
  );
  check(
    "and a pass carries its age restriction as a number, meaning none by default",
    /0/.test(pdmMinAgeColumn?.column_default ?? "missing"),
    pdmMinAgeColumn?.column_default ?? "column missing",
  );

  const pdmConstraints = (
    await q(`
      select conname from pg_constraint
       where conrelid in ('public.event_dates'::regclass, 'public.pass_categories'::regclass)
         and conname in ('event_dates_capacity_held_range', 'event_dates_capacity_held_within_capacity',
                         'pass_categories_min_age_range')
       order by conname;
    `)
  ).map((row) => row.conname);
  check(
    "the impossible rows are unrepresentable, not merely discouraged",
    pdmConstraints.length === 3,
    pdmConstraints.join(","),
  );

  const pdmHeldAboveCapacity = await expectError(`
    update public.event_dates set capacity_held = capacity + 1 where id = '${NIGHT_1}';
  `);
  check(
    "a hand-written update cannot hold back more seats than the night has",
    /capacity_held_above_capacity/.test(pdmHeldAboveCapacity ?? ""),
    pdmHeldAboveCapacity ?? "the update succeeded",
  );
  const pdmZeroCapacity = await expectError(`
    update public.event_dates set capacity = 0 where id = '${NIGHT_1}';
  `);
  check(
    "nor shrink a night to nothing",
    /capacity_below_one/.test(pdmZeroCapacity ?? ""),
    pdmZeroCapacity ?? "the update succeeded",
  );
  const pdmBadAge = await expectError(`
    update public.pass_categories set min_age = 121 where id = '${COUPLE}';
  `);
  check(
    "nor set an age restriction no guest could satisfy",
    /pass_categories_min_age_range/.test(pdmBadAge ?? ""),
    pdmBadAge ?? "the update succeeded",
  );

  // ---- 2. creating a pass -----------------------------------------------------
  const pdmCreated = (
    await rpc("admin_save_pass_category", {
      p_id: null,
      p_event_id: null,
      p_code: "Test Duo 4",
      p_name: "Verification Table Pass",
      p_composition: "4 Guests",
      p_description: "Created by the verification run.",
      p_price_inr: 1499,
      p_number_of_people: 4,
      p_max_per_booking: 3,
      p_min_age: 18,
      p_sort_order: 90,
      p_is_active: true,
    })
  )[0];

  check(
    "an organiser can create a pass, and the code is hyphenated on the way in",
    pdmCreated?.code === "Test-Duo-4" &&
      pdmCreated?.name === "Verification Table Pass" &&
      pdmCreated?.price_inr === 1499 &&
      pdmCreated?.number_of_people === 4 &&
      pdmCreated?.max_per_booking === 3 &&
      pdmCreated?.min_age === 18,
    JSON.stringify(pdmCreated ?? null).slice(0, 200),
  );
  check(
    "a pass that has just been created has nothing sold on it",
    (await q(`select count(*)::int as n from public.bookings where pass_category_id = '${pdmCreated.pass_uuid}';`))[0]
      .n === 0,
  );

  const pdmDuplicateCode = await rpcError("admin_save_pass_category", {
    p_id: null,
    p_event_id: null,
    p_code: "TEST DUO 4",
    p_name: "Another Table Pass",
    p_composition: "4 Guests",
    p_description: null,
    p_price_inr: 999,
    p_number_of_people: 4,
    p_max_per_booking: 2,
    p_min_age: 0,
    p_sort_order: 91,
    p_is_active: true,
  });
  check(
    "and the same code spelled differently is still a duplicate",
    pdmDuplicateCode?.code === "PC003" && pdmDuplicateCode?.detail === "code",
    `${pdmDuplicateCode?.code} / ${pdmDuplicateCode?.detail}`,
  );

  const pdmBadPasses = [
    ["a pass with no name", { p_name: "  " }, "PC001", "name"],
    ["a code that is punctuation", { p_code: "!!!" }, "PC002", "code"],
    ["a composition that says nothing", { p_composition: " " }, "PC009", "composition"],
    ["a free pass", { p_price_inr: 0 }, "PC004", "price_inr"],
    ["a pass priced above the ceiling", { p_price_inr: 500001 }, "PC004", "price_inr"],
    ["a pass that admits nobody", { p_number_of_people: 0 }, "PC005", "number_of_people"],
    ["a pass admitting fifty-one people", { p_number_of_people: 51 }, "PC005", "number_of_people"],
    ["a booking limit of zero", { p_max_per_booking: 0 }, "PC006", "max_per_booking"],
    ["an age restriction of 121", { p_min_age: 121 }, "PC007", "min_age"],
    ["a sort order of 10000", { p_sort_order: 10000 }, "PC011", "sort_order"],
  ];

  for (const [pdmLabel, pdmOverrides, pdmCode, pdmField] of pdmBadPasses) {
    const pdmRefused = await rpcError("admin_save_pass_category", {
      p_id: null,
      p_event_id: null,
      p_code: "verification-refused",
      p_name: "Refused Pass",
      p_composition: "2 Guests",
      p_description: null,
      p_price_inr: 500,
      p_number_of_people: 2,
      p_max_per_booking: 2,
      p_min_age: 0,
      p_sort_order: 99,
      p_is_active: true,
      ...pdmOverrides,
    });

    check(
      `${pdmLabel} is refused with ${pdmCode}, naming the field`,
      pdmRefused?.code === pdmCode && pdmRefused?.detail === pdmField,
      `${pdmRefused?.code} / ${pdmRefused?.detail} — ${pdmRefused?.message ?? "no error"}`,
    );
  }
  check(
    "and none of those attempts left a row behind",
    (await q(`select count(*)::int as n from public.pass_categories where code = 'VERIFICATION-REFUSED';`))[0].n === 0,
  );

  // ---- 3. editing a pass: price, description, limit, age ----------------------
  const pdmEdited = (
    await rpc("admin_save_pass_category", {
      p_id: pdmCreated.pass_uuid,
      p_event_id: null,
      p_code: "test-duo-4",
      p_name: "Verification Table Pass",
      p_composition: "4 Guests",
      p_description: "Repriced for the second weekend.",
      p_price_inr: 1199,
      p_number_of_people: 4,
      p_max_per_booking: 5,
      p_min_age: 21,
      p_sort_order: 90,
      p_is_active: true,
    })
  )[0];

  check(
    "an organiser can change the price, the description, the limit and the age restriction",
    pdmEdited?.price_inr === 1199 &&
      pdmEdited?.description === "Repriced for the second weekend." &&
      pdmEdited?.max_per_booking === 5 &&
      pdmEdited?.min_age === 21 &&
      // Editing with the code re-typed in another case keeps the row as one row, and
      // stores the spelling it was given.
      pdmEdited?.code === "test-duo-4",
    JSON.stringify(pdmEdited ?? null).slice(0, 220),
  );

  const pdmUnknownPass = await rpcError("admin_save_pass_category", {
    p_id: "00000000-0000-4000-8000-0000000000ff",
    p_event_id: null,
    p_code: "ghost",
    p_name: "Ghost Pass",
    p_composition: "2 Guests",
    p_description: null,
    p_price_inr: 100,
    p_number_of_people: 2,
    p_max_per_booking: 2,
    p_min_age: 0,
    p_sort_order: 99,
    p_is_active: true,
  });
  check(
    "editing a pass that does not exist is refused",
    pdmUnknownPass?.code === "PC008",
    pdmUnknownPass?.code ?? "no error",
  );

  // ---- 4. enabling and disabling a pass ---------------------------------------
  const pdmDisabled = (await rpc("admin_set_pass_category_active", { p_id: pdmCreated.pass_uuid, p_is_active: false }))[0];
  check(
    "an organiser can take a pass off sale without deleting it",
    pdmDisabled?.is_active === false &&
      pdmDisabled?.pass_uuid === pdmCreated.pass_uuid &&
      (await q(`select count(*)::int as n from public.pass_categories where id = '${pdmCreated.pass_uuid}';`))[0].n === 1,
    JSON.stringify(pdmDisabled ?? null).slice(0, 160),
  );

  const pdmAnonCatalogueRow = await asRole(
    "anon",
    `select count(*)::int as n from public.pass_categories where id = '${pdmCreated.pass_uuid}' and is_active;`,
  );
  check("and an off-sale pass stops being offered to the booking page", pdmAnonCatalogueRow[0].n === 0);

  const pdmOffSaleBooking = await createBookingError({
    p_event_date_id: NIGHT_FREE,
    p_pass_category_id: pdmCreated.pass_uuid,
    p_customer_name: "Off Sale",
    p_customer_mobile: "+919800001910",
    p_customer_email: "off.sale@example.com",
    p_quantity: 1,
    p_number_of_people: 4,
    p_idempotency_key: "pdm-off-sale",
  });
  check(
    "and cannot be booked, even by somebody who kept the link",
    pdmOffSaleBooking?.code === "PB003",
    pdmOffSaleBooking?.code ?? "no error",
  );

  const pdmReEnabled = (await rpc("admin_set_pass_category_active", { p_id: pdmCreated.pass_uuid, p_is_active: true }))[0];
  check("putting it back on sale is one call that touches nothing else", pdmReEnabled?.is_active === true);

  const pdmUnknownToggle = await rpcError("admin_set_pass_category_active", {
    p_id: "00000000-0000-4000-8000-0000000000fe",
    p_is_active: false,
  });
  check("toggling a pass that does not exist is refused", pdmUnknownToggle?.code === "PC008", pdmUnknownToggle?.code ?? "");

  // Repricing a pass that has already sold: the money already taken must not move.
  const pdmBookingsBeforeReprice = await q(`
    select booking_id, subtotal, total_amount, payment_status
      from public.bookings where pass_category_id = '${COUPLE}' order by created_at limit 1;
  `);
  const pdmCoupleBefore = (await q(`select price_inr from public.pass_categories where id = '${COUPLE}';`))[0].price_inr;

  await rpc("admin_save_pass_category", {
    p_id: COUPLE,
    p_event_id: null,
    p_code: "couple",
    p_name: "Couple Pass",
    p_composition: "1 Boy + 1 Girl",
    p_description: null,
    p_price_inr: 777,
    p_number_of_people: 2,
    p_max_per_booking: 10,
    p_min_age: 18,
    p_sort_order: 2,
    p_is_active: true,
  });

  const pdmBookingsAfterReprice = await q(`
    select booking_id, subtotal, total_amount, payment_status
      from public.bookings where pass_category_id = '${COUPLE}' order by created_at limit 1;
  `);
  check(
    "repricing a pass that has already sold applies to the next guest, not the last one",
    JSON.stringify(pdmBookingsBeforeReprice) === JSON.stringify(pdmBookingsAfterReprice) &&
      Number(pdmCoupleBefore) === 499,
    `${JSON.stringify(pdmBookingsBeforeReprice)} → ${JSON.stringify(pdmBookingsAfterReprice)}`,
  );

  const pdmBookingOnRepriced = await createBooking({
    p_event_date_id: NIGHT_FREE,
    p_pass_category_id: COUPLE,
    p_customer_name: "Repriced Guest",
    p_customer_mobile: "+919800001911",
    p_customer_email: "repriced@example.com",
    p_quantity: 1,
    p_number_of_people: 2,
    p_idempotency_key: "pdm-repriced",
  });
  check(
    "and the next guest is charged the new price, computed in the database",
    Number(pdmBookingOnRepriced.total_amount) === 777,
    `${pdmBookingOnRepriced.total_amount}`,
  );

  await run(`
    update public.bookings set booking_status = 'cancelled' where id = '${pdmBookingOnRepriced.booking_uuid}';
    update public.pass_categories set price_inr = ${pdmCoupleBefore}, min_age = 0 where id = '${COUPLE}';
  `);
  check(
    "the price is put back, so the rest of the run reads the seed price",
    (await q(`select price_inr from public.pass_categories where id = '${COUPLE}';`))[0].price_inr === 499,
  );

  // ---- 5. the catalogue read ---------------------------------------------------
  const pdmCatalogue = await rpc("admin_pass_catalogue", { p_event_id: null });
  const pdmCatalogueExplicit = await rpc("admin_pass_catalogue", { p_event_id: EVENT });
  const pdmLedger = (
    await q(`
      select
        (select count(*)::int from public.pass_categories where event_id = '${EVENT}') as types,
        (select count(*)::int from public.bookings where pass_category_id = '${COUPLE}') as couple_bookings,
        (select count(*)::int from public.bookings
          where pass_category_id = '${COUPLE}' and payment_status = 'paid') as couple_paid,
        (select coalesce(sum(total_amount) filter (where payment_status = 'paid'), 0)::int
           from public.bookings where pass_category_id = '${COUPLE}') as couple_revenue,
        (select coalesce(sum(number_of_people) filter (where payment_status = 'paid'), 0)::int
           from public.bookings where pass_category_id = '${COUPLE}') as couple_people,
        (select count(*)::int from public.digital_passes dp
           join public.bookings b on b.id = dp.booking_id
          where b.pass_category_id = '${COUPLE}' and b.payment_status = 'paid') as couple_passes;
    `)
  )[0];
  const pdmCoupleRow = pdmCatalogue.find((row) => row.pass_uuid === COUPLE);

  check(
    "the catalogue lists every pass type of the event, on sale or not, by id or by default",
    pdmCatalogue.length === pdmLedger.types && pdmCatalogue.length === pdmCatalogueExplicit.length,
    `${pdmCatalogue.length} rows / ${pdmLedger.types} types`,
  );
  check(
    "with the selling numbers counted in the database, not in the screen",
    Number(pdmCoupleRow?.bookings_count) === Number(pdmLedger.couple_bookings) &&
      Number(pdmCoupleRow?.paid_bookings) === Number(pdmLedger.couple_paid) &&
      Number(pdmCoupleRow?.revenue_inr) === Number(pdmLedger.couple_revenue) &&
      Number(pdmCoupleRow?.people_sold) === Number(pdmLedger.couple_people) &&
      Number(pdmCoupleRow?.passes_issued) === Number(pdmLedger.couple_passes),
    JSON.stringify({
      bookings: pdmCoupleRow?.bookings_count,
      paid: pdmCoupleRow?.paid_bookings,
      revenue: pdmCoupleRow?.revenue_inr,
      people: pdmCoupleRow?.people_sold,
      passes: pdmCoupleRow?.passes_issued,
    }),
  );
  check(
    "and in the order the booking page lists them: sort order, then price",
    pdmCatalogue.every(
      (row, index) =>
        index === 0 ||
        row.sort_order > pdmCatalogue[index - 1].sort_order ||
        (row.sort_order === pdmCatalogue[index - 1].sort_order && row.price_inr >= pdmCatalogue[index - 1].price_inr),
    ),
    pdmCatalogue.map((row) => `${row.code}:${row.sort_order}/${row.price_inr}`).join(" "),
  );

  // ---- 6. creating a night -----------------------------------------------------
  const pdmNight = (
    await rpc("admin_save_event_date", {
      p_id: null,
      p_event_id: null,
      p_event_date: pdmDay1,
      p_start_time: "20:00",
      p_end_time: "23:45",
      p_capacity: 400,
      p_capacity_held: 50,
      p_status: "scheduled",
      p_booking_open: true,
      p_notes: "Created by the verification run.",
    })
  )[0];

  check(
    "an organiser can add a night and hold seats back from online sale",
    pdmNight?.event_date === pdmDay1 &&
      Number(pdmNight?.capacity) === 400 &&
      Number(pdmNight?.capacity_held) === 50 &&
      Number(pdmNight?.seats_available) === 350 &&
      pdmNight?.booking_open === true,
    JSON.stringify(pdmNight ?? null).slice(0, 220),
  );

  const pdmNightId = pdmNight.date_uuid;

  const pdmDuplicateNight = await rpcError("admin_save_event_date", {
    p_id: null,
    p_event_id: null,
    p_event_date: pdmDay1,
    p_start_time: "20:00",
    p_end_time: "23:45",
    p_capacity: 100,
    p_capacity_held: 0,
    p_status: "scheduled",
    p_booking_open: true,
    p_notes: null,
  });
  check(
    "the same event cannot have two nights on one date",
    pdmDuplicateNight?.code === "PT006" && pdmDuplicateNight?.detail === "event_date",
    `${pdmDuplicateNight?.code} / ${pdmDuplicateNight?.detail}`,
  );

  const pdmBadNights = [
    ["a night with no capacity", { p_capacity: 0 }, "PT001", "capacity"],
    ["a negative capacity", { p_capacity: -10 }, "PT001", "capacity"],
    ["negative held-back seats", { p_capacity_held: -1 }, "PT002", "capacity_held"],
    ["more seats held back than the night holds", { p_capacity_held: 401 }, "PT003", "capacity_held"],
    ["a status the schema does not know", { p_status: "maybe" }, "PT010", "status"],
    ["a night that ends before it starts", { p_end_time: "19:00" }, "PT008", "end_time"],
    ["a night with no date at all", { p_event_date: null }, "PT009", "event_date"],
  ];

  for (const [pdmLabel, pdmOverrides, pdmCode, pdmField] of pdmBadNights) {
    const pdmRefused = await rpcError("admin_save_event_date", {
      p_id: pdmNightId,
      p_event_id: null,
      p_event_date: pdmDay1,
      p_start_time: "20:00",
      p_end_time: "23:45",
      p_capacity: 400,
      p_capacity_held: 50,
      p_status: "scheduled",
      p_booking_open: true,
      p_notes: null,
      ...pdmOverrides,
    });

    check(
      `${pdmLabel} is refused with ${pdmCode}, naming the field`,
      pdmRefused?.code === pdmCode && pdmRefused?.detail === pdmField,
      `${pdmRefused?.code} / ${pdmRefused?.detail} — ${pdmRefused?.message ?? "no error"}`,
    );
  }

  const pdmNightAfterRefusals = (
    await q(`
      select event_date::text as d, capacity, capacity_held, status, booking_open
        from public.event_dates where id = '${pdmNightId}';
    `)
  )[0];
  check(
    "and every refusal left the night exactly as it was",
    pdmNightAfterRefusals.d === pdmDay1 &&
      Number(pdmNightAfterRefusals.capacity) === 400 &&
      Number(pdmNightAfterRefusals.capacity_held) === 50 &&
      pdmNightAfterRefusals.status === "scheduled" &&
      pdmNightAfterRefusals.booking_open === true,
    JSON.stringify(pdmNightAfterRefusals),
  );

  const pdmUnknownNight = await rpcError("admin_save_event_date", {
    p_id: "00000000-0000-4000-8000-0000000000fd",
    p_event_id: null,
    p_event_date: pdmDay2,
    p_start_time: null,
    p_end_time: null,
    p_capacity: 100,
    p_capacity_held: 0,
    p_status: "scheduled",
    p_booking_open: true,
    p_notes: null,
  });
  check(
    "editing a night that does not exist is refused",
    pdmUnknownNight?.code === "PT007",
    pdmUnknownNight?.code ?? "no error",
  );

  // ---- 7. the public figure and the booking path agree --------------------------
  const pdmAvailability = (await rpc("get_event_night_availability", { p_event_id: EVENT })).find(
    (row) => row.event_date_id === pdmNightId,
  );
  check(
    "the website is offered capacity minus the seats held back, not the raw capacity",
    Number(pdmAvailability?.capacity) === 400 &&
      Number(pdmAvailability?.capacity_held) === 50 &&
      Number(pdmAvailability?.remaining) === 350 &&
      pdmAvailability?.is_bookable === true,
    JSON.stringify(pdmAvailability ?? null),
  );

  const pdmBooking = await createBooking({
    p_event_date_id: pdmNightId,
    p_pass_category_id: COUPLE,
    p_customer_name: "Capacity Guest",
    p_customer_mobile: "+919800001920",
    p_customer_email: "capacity@example.com",
    p_quantity: 1,
    p_number_of_people: 2,
    p_idempotency_key: "pdm-capacity",
  });
  check(
    "and a booking taken on the new night is priced from the catalogue, not from the request",
    Number(pdmBooking.total_amount) === 499,
    `${pdmBooking.total_amount}`,
  );

  // ---- 8. seats held back are not on sale ---------------------------------------
  const pdmLowered = (
    await rpc("admin_set_event_date_capacity", { p_id: pdmNightId, p_capacity: 350, p_capacity_held: 50 })
  )[0];
  check(
    "capacity can be lowered to exactly what is on sale — that takes nothing from anyone",
    Number(pdmLowered.capacity) === 350 &&
      Number(pdmLowered.capacity_held) === 50 &&
      Number(pdmLowered.seats_available) === 300,
    JSON.stringify(pdmLowered ?? null),
  );

  const pdmHeldTooHigh = await rpcError("admin_set_event_date_capacity", {
    p_id: pdmNightId,
    p_capacity: 49,
    p_capacity_held: 50,
  });
  check(
    "but not below the seats already held back for the gate",
    pdmHeldTooHigh?.code === "PT003" && pdmHeldTooHigh?.detail === "capacity_held",
    `${pdmHeldTooHigh?.code} / ${pdmHeldTooHigh?.detail}`,
  );

  const pdmAllHeld = (
    await rpc("admin_set_event_date_capacity", { p_id: pdmNightId, p_capacity: 50, p_capacity_held: 50 })
  )[0];
  check(
    "a night whose seats are all held back has nothing left to sell, and says so",
    Number(pdmAllHeld.seats_available) === 0,
    JSON.stringify(pdmAllHeld ?? null),
  );

  const pdmBookingWhenAllHeld = await createBookingError({
    p_event_date_id: pdmNightId,
    p_pass_category_id: COUPLE,
    p_customer_name: "Held Back",
    p_customer_mobile: "+919800001921",
    p_customer_email: "held.back@example.com",
    p_quantity: 1,
    p_number_of_people: 2,
    p_idempotency_key: "pdm-all-held",
  });
  check(
    "and the booking path refuses it with no places left — held seats are not online seats",
    pdmBookingWhenAllHeld?.code === "PB001" && pdmBookingWhenAllHeld?.detail === "0",
    `${pdmBookingWhenAllHeld?.code} / ${pdmBookingWhenAllHeld?.detail}`,
  );

  const pdmRaised = (
    await rpc("admin_set_event_date_capacity", { p_id: pdmNightId, p_capacity: 900, p_capacity_held: 50 })
  )[0];
  check(
    "raising the capacity is always allowed — the queue is longer than we thought",
    Number(pdmRaised.capacity) === 900 && Number(pdmRaised.seats_available) === 850,
    JSON.stringify(pdmRaised ?? null),
  );

  const pdmCapacityZero = await rpcError("admin_set_event_date_capacity", { p_id: pdmNightId, p_capacity: 0 });
  check("a capacity of zero is refused whatever else is set", pdmCapacityZero?.code === "PT001");
  const pdmNegativeCapacity = await rpcError("admin_set_event_date_capacity", { p_id: pdmNightId, p_capacity: -5 });
  check("and so is a negative one", pdmNegativeCapacity?.code === "PT001");
  const pdmUnknownCapacity = await rpcError("admin_set_event_date_capacity", {
    p_id: "00000000-0000-4000-8000-0000000000fc",
    p_capacity: 100,
  });
  check("setting the capacity of a night that does not exist is refused", pdmUnknownCapacity?.code === "PT007");

  const pdmInvariants = (
    await q(`
      select
        count(*)::int                                          as nights,
        count(*) filter (where capacity < 1)::int              as below_one,
        count(*) filter (where capacity_held < 0)::int         as negative_held,
        count(*) filter (where capacity_held > capacity)::int  as held_above_capacity
        from public.event_dates;
    `)
  )[0];
  check(
    "no night in the database has an impossible capacity",
    pdmInvariants.below_one === 0 &&
      pdmInvariants.negative_held === 0 &&
      pdmInvariants.held_above_capacity === 0 &&
      pdmInvariants.nights > 9,
    `${pdmInvariants.nights} nights checked`,
  );

  const pdmAvailabilityFigures = await rpc("get_event_night_availability", { p_event_id: EVENT });
  check(
    "and the public availability figure is never negative, on any night",
    pdmAvailabilityFigures.every(
      (row) =>
        Number(row.remaining) >= 0 &&
        Number(row.capacity_held) >= 0 &&
        Number(row.booked_people) >= 0 &&
        Number(row.capacity_held) <= Number(row.capacity),
    ),
    `${pdmAvailabilityFigures.length} nights`,
  );

  const pdmAdminNights = await rpc("admin_event_dates", { p_event_id: null });
  const pdmNightsLedger = await q(`
    select
      d.id,
      coalesce(sum(b.number_of_people) filter (where b.payment_status = 'paid'), 0)::int as paid,
      count(b.id) filter (where b.payment_status = 'paid')::int as paid_bookings,
      (select count(*)::int from public.digital_passes dp
         join public.bookings pb on pb.id = dp.booking_id
        where pb.event_date_id = d.id and pb.payment_status = 'paid') as passes
      from public.event_dates d
      left join public.bookings b on b.event_date_id = d.id
     where d.event_id = '${EVENT}'
     group by d.id;
  `);
  const pdmNightsAgree = pdmAdminNights.every((night) => {
    const ledger = pdmNightsLedger.find((row) => row.id === night.date_uuid);
    return (
      ledger &&
      Number(night.booked_people) === Number(ledger.paid) &&
      Number(night.booked_bookings) === Number(ledger.paid_bookings) &&
      Number(night.passes_issued) === Number(ledger.passes) &&
      Number(night.seats_on_sale) === Number(night.capacity) - Number(night.capacity_held) &&
      Number(night.seats_available) ===
        Math.max(Number(night.capacity) - Number(night.capacity_held) - Number(ledger.paid), 0) &&
      night.is_full ===
        (night.night_status === "sold_out" ||
          Number(ledger.paid) + Number(night.capacity_held) >= Number(night.capacity))
    );
  });
  check(
    "the nights screen is handed the same figures a ledger query computes",
    pdmNightsAgree && pdmAdminNights.length === pdmNightsLedger.length,
    `${pdmAdminNights.length} nights / ${pdmNightsLedger.length} in the ledger`,
  );

  // ---- 9. a night people have paid for ------------------------------------------
  await pdmPay(pdmBooking, "order_PDMNIGHT000000001", "pay_PDMNIGHT000000001");
  const pdmPaidPeople = (
    await q(`
      select coalesce(sum(number_of_people), 0)::int as paid
        from public.bookings
       where event_date_id = '${pdmNightId}' and payment_status = 'paid';
    `)
  )[0].paid;

  const pdmShrinkBelowPaid = await rpcError("admin_set_event_date_capacity", {
    p_id: pdmNightId,
    p_capacity: Number(pdmPaidPeople) - 1,
    p_capacity_held: 0,
  });
  check(
    "capacity cannot be cut below the people who have already paid",
    pdmShrinkBelowPaid?.code === "PT004" && Number(pdmShrinkBelowPaid?.detail) === Number(pdmPaidPeople),
    `${pdmShrinkBelowPaid?.code} / floor ${pdmShrinkBelowPaid?.detail} (paid ${pdmPaidPeople})`,
  );

  const pdmExactlyPaid = (
    await rpc("admin_set_event_date_capacity", {
      p_id: pdmNightId,
      p_capacity: pdmPaidPeople,
      p_capacity_held: 0,
    })
  )[0];
  check(
    "while a capacity of exactly what is paid for is allowed, and reads as no seats left",
    Number(pdmExactlyPaid.capacity) === Number(pdmPaidPeople) && Number(pdmExactlyPaid.seats_available) === 0,
    JSON.stringify(pdmExactlyPaid ?? null),
  );

  const pdmRawShrink = await expectError(`
    update public.event_dates set capacity = 1 where id = '${pdmNightId}';
  `);
  check(
    "and a hand-written UPDATE cannot take those seats away either — the guard is on the table, not on the function",
    /capacity_below_taken/.test(pdmRawShrink ?? ""),
    pdmRawShrink ?? "the update succeeded",
  );

  const pdmRawRaise = (
    await q(`
      update public.event_dates set capacity = 5000 where id = '${pdmNightId}'
      returning capacity, capacity_held, capacity - capacity_held - ${pdmPaidPeople} as seats_available;
    `)
  )[0];
  await run(`update public.event_dates set capacity = ${pdmPaidPeople} where id = '${pdmNightId}';`);
  check(
    "while raising it by hand is still allowed, so a busy night can always be made bigger",
    Number(pdmRawRaise.capacity) === 5000 && Number(pdmRawRaise.seats_available) === 5000 - Number(pdmPaidPeople),
    JSON.stringify(pdmRawRaise),
  );

  const pdmDateMove = await rpcError("admin_save_event_date", {
    p_id: pdmNightId,
    p_event_id: null,
    p_event_date: pdmDay2,
    p_start_time: "20:00",
    p_end_time: "23:45",
    p_capacity: Number(pdmPaidPeople),
    p_capacity_held: 0,
    p_status: "scheduled",
    p_booking_open: true,
    p_notes: null,
  });
  check(
    "a night with paid bookings cannot be moved to another date — the passes carry the date",
    pdmDateMove?.code === "PT005" && Number(pdmDateMove?.detail) === Number(pdmPaidPeople),
    `${pdmDateMove?.code} / ${pdmDateMove?.detail}`,
  );

  const pdmStillEditable = (
    await rpc("admin_save_event_date", {
      p_id: pdmNightId,
      p_event_id: null,
      p_event_date: pdmDay1,
      p_start_time: "20:30",
      p_end_time: "23:45",
      p_capacity: Number(pdmPaidPeople),
      p_capacity_held: 0,
      p_status: "sold_out",
      p_booking_open: false,
      p_notes: "Full — gate sales only.",
    })
  )[0];
  check(
    "but everything that takes nothing away still works: times, status, notes, booking window",
    pdmStillEditable?.night_status === "sold_out" &&
      pdmStillEditable?.booking_open === false &&
      String(pdmStillEditable?.start_time).startsWith("20:30") &&
      pdmStillEditable?.notes === "Full — gate sales only." &&
      Number(pdmStillEditable?.capacity) === Number(pdmPaidPeople),
    JSON.stringify(pdmStillEditable ?? null).slice(0, 220),
  );

  const pdmFullNight = (await rpc("admin_event_dates", { p_event_id: null })).find(
    (row) => row.date_uuid === pdmNightId,
  );
  check(
    "and the night reads as full, with nothing left on sale",
    pdmFullNight?.is_full === true && Number(pdmFullNight?.seats_available) === 0,
    JSON.stringify({ is_full: pdmFullNight?.is_full, seats_available: pdmFullNight?.seats_available }),
  );

  // ---- 10. opening and closing booking -----------------------------------------
  const pdmClosed = (await rpc("admin_set_event_date_booking", { p_id: pdmNightId, p_booking_open: false }))[0];
  check(
    "booking can be closed on a single night without cancelling it",
    pdmClosed?.booking_open === false && pdmClosed?.night_status === "sold_out",
    JSON.stringify(pdmClosed ?? null).slice(0, 200),
  );

  const pdmReopened = (await rpc("admin_set_event_date_booking", { p_id: pdmNightId, p_booking_open: true }))[0];
  check(
    "and reopened later with the capacity and the bookings untouched",
    pdmReopened?.booking_open === true &&
      Number(pdmReopened?.capacity) === Number(pdmPaidPeople) &&
      Number(pdmReopened?.booked_people) === Number(pdmPaidPeople),
    JSON.stringify(pdmReopened ?? null).slice(0, 200),
  );

  const pdmUnknownBookingToggle = await rpcError("admin_set_event_date_booking", {
    p_id: "00000000-0000-4000-8000-0000000000fb",
    p_booking_open: false,
  });
  check("opening or closing a night that does not exist is refused", pdmUnknownBookingToggle?.code === "PT007");

  // A night that is otherwise wide open, with booking closed on it: the website must
  // stop offering it and the booking path must refuse it with the same code a
  // cancelled night gives.
  const pdmClosedNight = (
    await rpc("admin_save_event_date", {
      p_id: null,
      p_event_id: null,
      p_event_date: pdmDay3,
      p_start_time: "20:00",
      p_end_time: "23:45",
      p_capacity: 500,
      p_capacity_held: 0,
      p_status: "scheduled",
      p_booking_open: true,
      p_notes: null,
    })
  )[0];
  const pdmClosedId = pdmClosedNight.date_uuid;

  await rpc("admin_set_event_date_booking", { p_id: pdmClosedId, p_booking_open: false });
  const pdmAvailabilityClosed = (await rpc("get_event_night_availability", { p_event_id: EVENT })).find(
    (row) => row.event_date_id === pdmClosedId,
  );
  check(
    "the website stops offering a night the moment booking closes",
    pdmAvailabilityClosed?.is_booking_open === false &&
      pdmAvailabilityClosed?.is_bookable === false &&
      pdmAvailabilityClosed?.is_fully_booked === false,
    JSON.stringify(pdmAvailabilityClosed ?? null),
  );

  const pdmBookingOnClosed = await createBookingError({
    p_event_date_id: pdmClosedId,
    p_pass_category_id: COUPLE,
    p_customer_name: "Closed Night",
    p_customer_mobile: "+919800001930",
    p_customer_email: "closed@example.com",
    p_quantity: 1,
    p_number_of_people: 2,
    p_idempotency_key: "pdm-closed-night",
  });
  check(
    "and the booking path refuses it, with the same code a cancelled night gives",
    pdmBookingOnClosed?.code === "PB002",
    pdmBookingOnClosed?.code ?? "no error",
  );

  const pdmStillClosed = (await q(`select booking_open from public.event_dates where id = '${pdmClosedId}';`))[0];
  check("and a refused booking does not reopen the night", pdmStillClosed.booking_open === false);

  // ---- 11. capacity is defended by the booking path too ------------------------
  // One pass fits: capacity 2, no seats held back, a two-person pass. The first
  // booking takes it and pays; the three after it must all be refused with the
  // remaining count, or a capacity would mean nothing to customers.
  const pdmLastSeatNight = (
    await rpc("admin_save_event_date", {
      p_id: null,
      p_event_id: null,
      p_event_date: pdmDay2,
      p_start_time: "20:00",
      p_end_time: "23:45",
      p_capacity: 2,
      p_capacity_held: 0,
      p_status: "scheduled",
      p_booking_open: true,
      p_notes: null,
    })
  )[0];

  const pdmLastSeatAttempts = [];
  for (const pdmAttempt of [1, 2, 3, 4]) {
    const pdmTried = await createBookingError({
      p_event_date_id: pdmLastSeatNight.date_uuid,
      p_pass_category_id: COUPLE,
      p_customer_name: `Last Seat ${pdmAttempt}`,
      p_customer_mobile: `+91980000194${pdmAttempt}`,
      p_customer_email: `last.seat.${pdmAttempt}@example.com`,
      p_quantity: 1,
      p_number_of_people: 2,
      p_idempotency_key: `pdm-last-seat-${pdmAttempt}`,
    });
    pdmLastSeatAttempts.push(pdmTried);

    if (pdmTried === null) {
      const [pdmPlaced] = await q(`
        select id, total_amount from public.bookings
         where event_date_id = '${pdmLastSeatNight.date_uuid}' and idempotency_key = 'pdm-last-seat-${pdmAttempt}';
      `);
      await pdmPay(
        { booking_uuid: pdmPlaced.id, total_amount: pdmPlaced.total_amount },
        `order_PDMLAST00000000${pdmAttempt}`,
        `pay_PDMLAST00000000${pdmAttempt}`,
      );
    }
  }

  const pdmLastSeatTaken = (
    await q(`
      select count(*) filter (where payment_status = 'paid')::int as paid_bookings,
             coalesce(sum(number_of_people) filter (where payment_status = 'paid'), 0)::int as paid_people
        from public.bookings where event_date_id = '${pdmLastSeatNight.date_uuid}';
    `)
  )[0];
  check(
    "a night with room for one pass takes exactly one pass, whatever else arrives",
    Number(pdmLastSeatTaken.paid_bookings) === 1 && Number(pdmLastSeatTaken.paid_people) === 2,
    `${pdmLastSeatTaken.paid_bookings} paid booking(s) / ${pdmLastSeatTaken.paid_people} people`,
  );
  check(
    "and every attempt after the room ran out is refused by the capacity rule, with no places left",
    pdmLastSeatAttempts.filter((error) => error === null).length === 1 &&
      pdmLastSeatAttempts.filter((error) => error?.code === "PB001").length === 3 &&
      pdmLastSeatAttempts.filter((error) => error?.code === "PB001").every((error) => error.detail === "0"),
    pdmLastSeatAttempts.map((error) => `${error?.code ?? "accepted"}:${error?.detail ?? "-"}`).join(" "),
  );

  const pdmLastSeatAvailability = (await rpc("get_event_night_availability", { p_event_id: EVENT })).find(
    (row) => row.event_date_id === pdmLastSeatNight.date_uuid,
  );
  check(
    "and the website says the same thing the booking path just did",
    pdmLastSeatAvailability?.is_fully_booked === true &&
      pdmLastSeatAvailability?.is_bookable === false &&
      Number(pdmLastSeatAvailability?.remaining) === 0,
    JSON.stringify(pdmLastSeatAvailability ?? null),
  );

  // PGlite runs one connection, so a genuine race cannot be staged here. What can be
  // checked — and what the concurrency claim actually rests on — is that every writer
  // that counts seats for a night takes that night's row lock first, and that the
  // booking path still refuses when the seats are gone. That is a fact about the SQL,
  // and it is the difference between "the rule held in this run" and "the rule is
  // enforced for whoever calls it".
  const pdmWriters = await q(`
    select p.proname, pg_get_functiondef(p.oid) as body
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('create_pending_booking', 'admin_save_event_date',
                         'admin_set_event_date_capacity', 'admin_set_event_date_booking');
  `);
  const pdmLockers = pdmWriters
    .filter((row) => /for update/i.test(row.body))
    .map((row) => row.proname)
    .sort();
  check(
    "every writer that counts a night's seats locks the night row first",
    pdmLockers.length === 4,
    pdmLockers.join(", ") || "none",
  );
  check(
    "and the booking path still refuses under that lock when the seats are gone",
    /capacity_unavailable/.test(pdmWriters.find((row) => row.proname === "create_pending_booking")?.body ?? "") &&
      /for update/i.test(pdmWriters.find((row) => row.proname === "create_pending_booking")?.body ?? ""),
  );

  // ---- 12. who may do any of this ----------------------------------------------
  const pdmFunctions = [
    "public.admin_default_event_id()",
    "public.admin_pass_catalogue(uuid)",
    "public.admin_save_pass_category(uuid, uuid, text, text, text, text, integer, integer, integer, integer, integer, boolean)",
    "public.admin_set_pass_category_active(uuid, boolean)",
    "public.admin_event_dates(uuid)",
    "public.admin_save_event_date(uuid, uuid, date, time, time, integer, integer, text, boolean, text)",
    "public.admin_set_event_date_capacity(uuid, integer, integer)",
    "public.admin_set_event_date_booking(uuid, boolean)",
  ];

  for (const pdmFunction of pdmFunctions) {
    const [pdmGrants] = await q(`
      select has_function_privilege('anon', '${pdmFunction}', 'execute')           as anon_can,
             has_function_privilege('authenticated', '${pdmFunction}', 'execute')  as authenticated_can,
             has_function_privilege('service_role', '${pdmFunction}', 'execute')   as service_can;
    `);

    check(
      `${pdmFunction.split("(")[0].replace("public.", "")} is service-role only`,
      pdmGrants.anon_can === false && pdmGrants.authenticated_can === false && pdmGrants.service_can === true,
      JSON.stringify(pdmGrants),
    );
  }

  const [pdmAvailabilityGrants] = await q(`
    select has_function_privilege('anon', 'public.get_event_night_availability(uuid)', 'execute') as anon_can,
           has_function_privilege('service_role', 'public.get_event_night_availability(uuid)', 'execute') as service_can;
  `);
  check(
    "while the website can still ask how full a night is, and only that",
    pdmAvailabilityGrants.anon_can === true && pdmAvailabilityGrants.service_can === true,
    JSON.stringify(pdmAvailabilityGrants),
  );

  const pdmAnonCapacity = await expectError(`
    set role anon;
    select public.admin_set_event_date_capacity('${pdmNightId}', 1, 0);
  `);
  await run("reset role;");
  check(
    "an anonymous session cannot change a capacity even by calling the function by name",
    /permission denied/i.test(pdmAnonCapacity ?? ""),
    pdmAnonCapacity ?? "the call succeeded",
  );

  const pdmAnonCatalogue = await expectError(`set role anon; select * from public.admin_pass_catalogue();`);
  await run("reset role;");
  check(
    "and cannot enumerate the catalogue or its takings",
    /permission denied/i.test(pdmAnonCatalogue ?? ""),
    pdmAnonCatalogue ?? "the read succeeded",
  );

  const pdmAuthPass = await expectError(`
    set role authenticated;
    select public.admin_save_pass_category(null, null, 'x', 'X Pass', '1 Guest', null, 100, 1, 1, 0, 1, true);
  `);
  await run("reset role;");
  check(
    "a signed-in-but-not-admin session cannot write a price either",
    /permission denied/i.test(pdmAuthPass ?? ""),
    pdmAuthPass ?? "the call succeeded",
  );

  check(
    "and nothing in this section left the seeded price changed",
    (await q(`select price_inr from public.pass_categories where id = '${COUPLE}';`))[0].price_inr === 499,
  );

  // ---------------------------------------------------------------------------
  section("Gallery management: two buckets, object keys and the running order");
  // ---------------------------------------------------------------------------
  // The gallery is the first part of the site that stores *files*, and the rule the
  // whole design turns on is this one:
  //
  //     a photograph that is not published is not merely unlisted, it is not
  //     publicly reachable — the object lives in a private bucket, and only the
  //     service role can touch either bucket.
  //
  // What is checked here is the half of that promise the database can keep: the row
  // is the record of where the file lives, the object key is safe to hand to storage,
  // the status is the only thing that decides whether the public can see the
  // photograph, and every write is refused to anybody but the service role. The other
  // half — the file actually moving between buckets — is exercised against the
  // storage double in `verify-web`.

  // ---- the columns and constraints the step added -------------------------------
  const galGalleryColumns = await q(`
    select column_name
      from information_schema.columns
     where table_schema = 'public' and table_name = 'gallery'
       and column_name in ('storage_path', 'thumbnail_path', 'width', 'height', 'byte_size');
  `);

  check(
    "gallery records where both versions of the file live, and how heavy it is",
    galGalleryColumns.length === 5,
    galGalleryColumns.map((row) => row.column_name).join(", "),
  );

  const galGalleryIndexes = await q(`
    select indexname
      from pg_indexes
     where schemaname = 'public' and tablename = 'gallery'
       and indexname in ('gallery_storage_path_unique', 'gallery_thumbnail_path_unique');
  `);

  check(
    "one row per stored object — a full image and a thumbnail are each unique",
    galGalleryIndexes.length === 2,
    galGalleryIndexes.map((row) => row.indexname).join(", "),
  );

  const galGalleryChecks = await q(`
    select conname
      from pg_constraint
     where conrelid = 'public.gallery'::regclass and contype = 'c'
       and conname in ('gallery_has_source', 'gallery_alt_text_not_blank', 'gallery_dimensions_range', 'gallery_byte_size_range');
  `);

  check(
    "and the row's own rules are constraints, not conventions",
    galGalleryChecks.length === 4,
    galGalleryChecks.map((row) => row.conname).join(", "),
  );

  // ---- the two buckets, created by the migration --------------------------------
  // The storage schema belongs to Supabase, not to this project, and a deployment may
  // not have rights on it — so the migration is written to skip the buckets rather
  // than fail. Both halves of that are checked: the skip (which is what happened when
  // the migration ran at the top of this file, with no storage schema present) and
  // the creation, by standing up the two tables Supabase has and applying it again.
  const galMigrationFile = readFileSync(join(MIGRATIONS_DIR, "20260922091300_gallery_management.sql"), "utf8");

  const galReapplied = await expectError(galMigrationFile);

  check(
    "re-applying the migration without a storage schema is a silent no-op",
    galReapplied === null,
    galReapplied ?? "",
  );

  await run(`
    create schema if not exists storage;

    create table if not exists storage.buckets (
      id                 text primary key,
      name               text not null,
      public             boolean not null default false,
      file_size_limit    bigint,
      allowed_mime_types text[],
      created_at         timestamptz not null default now()
    );

    create table if not exists storage.objects (
      id         uuid primary key default gen_random_uuid(),
      bucket_id  text,
      name       text,
      owner      uuid,
      created_at timestamptz not null default now()
    );
  `);

  const galBuckedRun = await expectError(galMigrationFile);

  check(
    "with a storage schema present, the migration creates the buckets",
    galBuckedRun === null,
    galBuckedRun ?? "",
  );

  const galBucketRows = await q(`
    select id, public, file_size_limit, allowed_mime_types
      from storage.buckets
     where id in ('gallery', 'gallery-inbox')
     order by id;
  `);

  check(
    "there are two buckets and only one of them is public",
    galBucketRows.length === 2 &&
      galBucketRows.find((row) => row.id === "gallery")?.public === true &&
      galBucketRows.find((row) => row.id === "gallery-inbox")?.public === false,
    galBucketRows.map((row) => `${row.id}:${row.public}`).join(", "),
  );

  check(
    "both buckets cap the upload at 8 MiB and accept only image formats",
    galBucketRows.every(
      (row) =>
        Number(row.file_size_limit) === 8388608 &&
        ["image/webp", "image/jpeg", "image/png", "image/avif"].every((type) =>
          (row.allowed_mime_types ?? []).includes(type),
        ),
    ),
    JSON.stringify(galBucketRows.map((row) => row.allowed_mime_types)),
  );

  const [galObjectRls] = await q(`
    select relrowsecurity as enabled
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'storage' and c.relname = 'objects';
  `);

  check("storage.objects has row level security switched on", galObjectRls?.enabled === true);

  const [galObjectPolicies] = await q(`
    select count(*)::int as n
      from pg_policies
     where schemaname = 'storage' and tablename = 'objects';
  `);

  check(
    "and nothing grants anon or authenticated access to a gallery object",
    galObjectPolicies?.n === 0,
    `${galObjectPolicies?.n} policies`,
  );

  // ---- the functions exist, and only the service role may call them -------------
  const galGalleryFunctions = [
    "public.admin_gallery_items(uuid)",
    "public.gallery_check_metadata(text, text, text, text, integer)",
    "public.admin_add_gallery_item(uuid, uuid, text, text, text, integer, integer, integer, text, text, text, text, date, integer, text)",
    "public.admin_update_gallery_item(uuid, text, text, text, text, date, integer)",
    "public.admin_move_gallery_item(uuid, text)",
    "public.admin_set_gallery_status(uuid, text)",
    "public.admin_delete_gallery_item(uuid)",
  ];

  for (const fn of galGalleryFunctions) {
    const [grants] = await q(`
      select has_function_privilege('anon', '${fn}', 'execute') as anon_can,
             has_function_privilege('authenticated', '${fn}', 'execute') as authenticated_can,
             has_function_privilege('service_role', '${fn}', 'execute') as service_can;
    `);

    check(
      `${fn.split("(")[0].replace("public.", "")} is callable only with the service role`,
      grants.anon_can === false && grants.authenticated_can === false && grants.service_can === true,
      `anon=${grants.anon_can} authenticated=${grants.authenticated_can} service=${grants.service_can}`,
    );
  }

  const galAnonGallery = await expectError(`
    set role anon;
    select * from public.admin_gallery_items(null);
  `);
  await run("reset role;");

  check(
    "a visitor cannot list the gallery rows either",
    /permission denied/i.test(galAnonGallery ?? ""),
    galAnonGallery ?? "the read succeeded",
  );

  // ---- the rules a photograph has to pass ---------------------------------------
  const galNewItemId = (suffix) => `9a000000-0000-4000-8000-0000000000${suffix}`;

  /** The arguments of a well-formed upload, so each refusal changes one thing. */
  const galUpload = (overrides = {}) => ({
    p_id: galNewItemId("a1"),
    p_event_id: EVENT,
    p_storage_path: `${EVENT}/${galNewItemId("a1")}/full.webp`,
    p_thumbnail_path: `${EVENT}/${galNewItemId("a1")}/thumb.webp`,
    p_media_type: "image",
    p_width: 2000,
    p_height: 1500,
    p_byte_size: 250000,
    p_title: "Night one",
    p_description: null,
    p_alt_text: "Garba circle at full spin",
    p_album: "Night 1",
    p_captured_on: "2026-10-11",
    p_sort_order: 0,
    p_status: "draft",
    ...overrides,
  });

  const galAltTextRequired = await rpcError("admin_add_gallery_item", galUpload({ p_alt_text: "   " }));

  check(
    "a photograph without alternative text is refused",
    galAltTextRequired?.code === "PG001" && galAltTextRequired?.detail === "alt_text",
    `${galAltTextRequired?.code} / ${galAltTextRequired?.detail}`,
  );

  const galUrlAsKey = await rpcError(
    "admin_add_gallery_item",
    galUpload({ p_storage_path: "https://example.com/storage/v1/object/public/gallery/night-1.jpg" }),
  );

  check(
    "a storage path that is really a URL is refused",
    galUrlAsKey?.code === "PG005" && galUrlAsKey?.detail === "storage_path",
    `${galUrlAsKey?.code} / ${galUrlAsKey?.detail}`,
  );

  for (const escape of ["../outside/full.webp", "/leading/full.webp", "trailing/full.webp/"]) {
    const attempt = await rpcError("admin_add_gallery_item", galUpload({ p_storage_path: escape }));

    check(
      `the object key "${escape}" cannot escape its bucket`,
      attempt?.code === "PG005",
      attempt?.code ?? "it was accepted",
    );
  }

  const galLongTitle = await rpcError("admin_add_gallery_item", galUpload({ p_title: "N".repeat(121) }));

  check(
    "a title longer than the column is refused, and the field is named",
    galLongTitle?.code === "PG002" && galLongTitle?.detail === "title",
    `${galLongTitle?.code} / ${galLongTitle?.detail}`,
  );

  const galLongDescription = await rpcError(
    "admin_add_gallery_item",
    galUpload({ p_description: "D".repeat(401) }),
  );

  check(
    "so is a description beyond its limit",
    galLongDescription?.code === "PG003" && galLongDescription?.detail === "description",
    `${galLongDescription?.code} / ${galLongDescription?.detail}`,
  );

  const galBadOrder = await rpcError("admin_add_gallery_item", galUpload({ p_sort_order: -1 }));

  check(
    "a negative position in the running order is refused",
    galBadOrder?.code === "PG007" && galBadOrder?.detail === "sort_order",
    `${galBadOrder?.code} / ${galBadOrder?.detail}`,
  );

  const galHalfMeasured = await rpcError("admin_add_gallery_item", galUpload({ p_height: null }));

  check(
    "an image with a width but no height is refused",
    galHalfMeasured?.code === "PG009",
    galHalfMeasured?.code ?? "it was accepted",
  );

  const galHugeFile = await rpcError("admin_add_gallery_item", galUpload({ p_byte_size: 0 }));

  check(
    "a file size that cannot be real is refused",
    galHugeFile?.code === "PG010" && galHugeFile?.detail === "byte_size",
    `${galHugeFile?.code} / ${galHugeFile?.detail}`,
  );

  const galBadStatus = await rpcError("admin_add_gallery_item", galUpload({ p_status: "live" }));

  check(
    "a status outside the three the column allows is refused",
    galBadStatus?.code === "PG008" && galBadStatus?.detail === "status",
    `${galBadStatus?.code} / ${galBadStatus?.detail}`,
  );

  const galBadMedia = await rpcError("admin_add_gallery_item", galUpload({ p_media_type: "audio" }));

  check(
    "so is a media type that is neither an image nor a video",
    galBadMedia?.code === "PG008" && galBadMedia?.detail === "media_type",
    `${galBadMedia?.code} / ${galBadMedia?.detail}`,
  );

  const [galNothingWritten] = await q(`select count(*)::int as n from public.gallery;`);

  check("and none of those refusals left a row behind", galNothingWritten.n === 0, `${galNothingWritten.n} rows`);

  // ---- adding a photograph ------------------------------------------------------
  const galFirst = galNewItemId("b1");
  const galSecond = galNewItemId("b2");
  const galThird = galNewItemId("b3");
  const galBare = galNewItemId("b4");

  const galAdded = await rpc(
    "admin_add_gallery_item",
    galUpload({
      p_id: galFirst,
      p_storage_path: `${EVENT}/${galFirst}/full.webp`,
      p_thumbnail_path: `${EVENT}/${galFirst}/thumb.webp`,
      p_width: 2400,
      p_height: 1600,
      p_byte_size: 512000,
      p_title: "Garba circle at full spin",
      p_description: "The first night, photographed from the sound desk.",
      p_alt_text: "Dancers in a circle under blue stage light",
      p_sort_order: 0,
      p_status: "draft",
    }),
  );

  check(
    "an uploaded photograph is recorded as a draft, with its measured size",
    galAdded[0]?.item_id === galFirst &&
      galAdded[0]?.item_status === "draft" &&
      galAdded[0]?.sort_order === 0 &&
      galAdded[0]?.storage_path === `${EVENT}/${galFirst}/full.webp`,
    JSON.stringify(galAdded[0] ?? {}),
  );

  const [galStoredRow] = await q(
    `select width, height, byte_size, thumbnail_path from public.gallery where id = '${galFirst}';`,
  );

  check(
    "the row holds both object keys and the dimensions the grid needs",
    galStoredRow.width === 2400 &&
      galStoredRow.height === 1600 &&
      galStoredRow.byte_size === 512000 &&
      galStoredRow.thumbnail_path === `${EVENT}/${galFirst}/thumb.webp`,
    JSON.stringify(galStoredRow),
  );

  const galDuplicate = await rpcError(
    "admin_add_gallery_item",
    galUpload({
      p_id: galSecond,
      p_storage_path: `${EVENT}/${galFirst}/full.webp`,
      p_alt_text: "A duplicate that must not exist",
    }),
  );

  check(
    "two rows cannot point at the same stored object",
    galDuplicate?.code === "PG011" && galDuplicate?.detail === "storage_path",
    `${galDuplicate?.code} / ${galDuplicate?.detail}`,
  );

  for (const [id, order] of [
    [galSecond, 1],
    [galThird, 2],
  ]) {
    await rpc(
      "admin_add_gallery_item",
      galUpload({
        p_id: id,
        p_storage_path: `${EVENT}/${id}/full.webp`,
        p_thumbnail_path: `${EVENT}/${id}/thumb.webp`,
        p_width: 2400,
        p_height: 1600,
        p_byte_size: 480000,
        p_title: `Ordering test ${order}`,
        p_alt_text: `Ordering test photograph number ${order}`,
        p_sort_order: order,
      }),
    );
  }

  // A last one with no thumbnail of its own: a video hosted somewhere else, or an
  // upload that only ever produced the full image.
  await rpc(
    "admin_add_gallery_item",
    galUpload({
      p_id: galBare,
      p_storage_path: `${EVENT}/${galBare}/full.webp`,
      p_thumbnail_path: null,
      p_width: 1920,
      p_height: 1080,
      p_byte_size: 400000,
      p_title: "A photograph with no thumbnail",
      p_alt_text: "A wide shot of the whole ground",
      p_sort_order: 3,
    }),
  );

  const galListed = await rpc("admin_gallery_items", { p_event_id: EVENT });

  check(
    "the management list returns every row, published or not",
    galListed.length === 4 && galListed.every((row) => row.total_count === 4),
    `${galListed.length} rows`,
  );
  check(
    "and hands them back in the order the public grid will show them",
    galListed.map((row) => row.sort_order).join(",") === "0,1,2,3",
    galListed.map((row) => row.sort_order).join(","),
  );
  check(
    "each row carries the file facts the screen shows",
    galListed.every((row) => row.media_type === "image" && row.width > 0 && row.byte_size > 0),
  );
  check(
    "the item without a thumbnail is still a usable row",
    galListed.find((row) => row.item_id === galBare)?.thumbnail_path === null,
  );

  // ---- the words, and the running order -----------------------------------------
  const galEdited = await rpc("admin_update_gallery_item", {
    p_id: galFirst,
    p_title: "Garba circle, midnight",
    p_description: "Retitled after the second look.",
    p_alt_text: "Dancers in a circle under blue stage light, seen from above",
    p_album: "Night 1 — edited",
    p_captured_on: "2026-10-12",
    p_sort_order: 0,
  });

  check(
    "a caption can be changed without touching the file",
    galEdited[0]?.title === "Garba circle, midnight" &&
      galEdited[0]?.alt_text === "Dancers in a circle under blue stage light, seen from above" &&
      galEdited[0]?.album === "Night 1 — edited",
    JSON.stringify(galEdited[0] ?? {}),
  );

  const [galFileUnchanged] = await q(
    `select storage_path, thumbnail_path, width, byte_size from public.gallery where id = '${galFirst}';`,
  );

  check(
    "and the object keys are exactly where they were",
    galFileUnchanged.storage_path === `${EVENT}/${galFirst}/full.webp` &&
      galFileUnchanged.thumbnail_path === `${EVENT}/${galFirst}/thumb.webp` &&
      galFileUnchanged.width === 2400 &&
      galFileUnchanged.byte_size === 512000,
  );

  const galEditNoAlt = await rpcError("admin_update_gallery_item", {
    p_id: galFirst,
    p_title: "Garba circle, midnight",
    p_description: null,
    p_alt_text: "",
    p_album: null,
    p_captured_on: null,
    p_sort_order: 0,
  });

  check(
    "a caption cannot be saved without alternative text either",
    galEditNoAlt?.code === "PG001" && galEditNoAlt?.detail === "alt_text",
    `${galEditNoAlt?.code} / ${galEditNoAlt?.detail}`,
  );

  const galEditUnknown = await rpcError("admin_update_gallery_item", {
    p_id: "00000000-0000-4000-8000-0000000000ff",
    p_title: "Nowhere",
    p_description: null,
    p_alt_text: "Nothing",
    p_album: null,
    p_captured_on: null,
    p_sort_order: 0,
  });

  check(
    "editing a photograph that does not exist is refused by name",
    galEditUnknown?.code === "PG006",
    galEditUnknown?.code ?? "it was accepted",
  );

  const galMoveUp = await rpc("admin_move_gallery_item", { p_id: galThird, p_direction: "up" });

  check(
    "moving a photograph up puts it above the one that was above it",
    galMoveUp[0]?.moved === true && galMoveUp[0]?.sort_order === 1,
    JSON.stringify(galMoveUp[0] ?? {}),
  );

  const galOrderAfterMove = await rpc("admin_gallery_items", { p_event_id: EVENT });

  check(
    "and the list shows the new running order",
    galOrderAfterMove.map((row) => row.item_id).join(",") === `${galFirst},${galThird},${galSecond},${galBare}`,
    galOrderAfterMove.map((row) => row.item_id).join(","),
  );

  const galMoveTop = await rpc("admin_move_gallery_item", { p_id: galFirst, p_direction: "up" });

  check(
    "the first photograph cannot move up — that is an answer, not an error",
    galMoveTop[0]?.moved === false && galMoveTop[0]?.sort_order === 0,
    JSON.stringify(galMoveTop[0] ?? {}),
  );

  const galMoveBottom = await rpc("admin_move_gallery_item", { p_id: galBare, p_direction: "down" });

  check(
    "and the last one cannot move down",
    galMoveBottom[0]?.moved === false,
    JSON.stringify(galMoveBottom[0] ?? {}),
  );

  const galMoveBack = await rpc("admin_move_gallery_item", { p_id: galThird, p_direction: "down" });
  const galOrderAfterBack = await rpc("admin_gallery_items", { p_event_id: EVENT });

  check(
    "a move down puts it back below its neighbour",
    galMoveBack[0]?.moved === true &&
      galOrderAfterBack.map((row) => row.item_id).join(",") === `${galFirst},${galSecond},${galThird},${galBare}`,
    galOrderAfterBack.map((row) => row.item_id).join(","),
  );

  const galBadDirection = await rpcError("admin_move_gallery_item", { p_id: galFirst, p_direction: "sideways" });

  check(
    "an unknown direction is refused",
    galBadDirection?.code === "PG007" && galBadDirection?.detail === "direction",
    `${galBadDirection?.code} / ${galBadDirection?.detail}`,
  );

  // Ties: three photographs uploaded in the same second share a position, and the grid
  // shows the newest first among them. "Up" still has to mean visibly up, so the whole
  // list is renumbered with the pair exchanged rather than two numbers being swapped.
  await run(`
    update public.gallery
       set sort_order = 5,
           created_at = case id
                          when '${galFirst}'  then timestamptz '2026-10-11 20:00:00+05:30'
                          when '${galSecond}' then timestamptz '2026-10-11 20:01:00+05:30'
                          when '${galThird}'  then timestamptz '2026-10-11 20:02:00+05:30'
                          else                     timestamptz '2026-10-11 20:03:00+05:30'
                        end
     where id in ('${galFirst}', '${galSecond}', '${galThird}', '${galBare}');
  `);

  const galTiedBefore = await q(
    `select id from public.gallery where event_id = '${EVENT}' order by sort_order, created_at desc, id;`,
  );
  const galTiedMove = await rpc("admin_move_gallery_item", { p_id: galSecond, p_direction: "up" });
  const galTiedAfter = await q(
    `select id from public.gallery where event_id = '${EVENT}' order by sort_order, created_at desc, id;`,
  );

  check(
    "a tied list is numbered from zero, newest first, as the grid shows it",
    galTiedBefore.map((row) => row.id).join(",") === `${galBare},${galThird},${galSecond},${galFirst}`,
    galTiedBefore.map((row) => row.id).join(","),
  );
  check(
    "and moving one up still changes the order, from a tie",
    galTiedMove[0]?.moved === true &&
      galTiedAfter.map((row) => row.id).join(",") === `${galBare},${galSecond},${galThird},${galFirst}`,
    `${galTiedAfter.map((row) => row.id).join(",")} (sort_order ${galTiedMove[0]?.sort_order})`,
  );

  // ---- enable and disable -------------------------------------------------------
  const galPublished = await rpc("admin_set_gallery_status", { p_id: galFirst, p_status: "published" });

  check(
    "publishing a draft says where the file was and where it now belongs",
    galPublished[0]?.was_public === false &&
      galPublished[0]?.is_public === true &&
      galPublished[0]?.storage_path === `${EVENT}/${galFirst}/full.webp` &&
      galPublished[0]?.thumbnail_path === `${EVENT}/${galFirst}/thumb.webp`,
    JSON.stringify(galPublished[0] ?? {}),
  );

  const galAnonSees = await asRole("anon", `select count(*)::int as n from public.gallery where id = '${galFirst}';`);

  check("the published photograph is now readable by a visitor", galAnonSees[0].n === 1, `${galAnonSees[0].n}`);

  const galUnpublished = await rpc("admin_set_gallery_status", { p_id: galFirst, p_status: "draft" });

  check(
    "unpublishing says the file has to go back to the private bucket",
    galUnpublished[0]?.was_public === true && galUnpublished[0]?.is_public === false,
    JSON.stringify(galUnpublished[0] ?? {}),
  );

  const galAnonSeesAfter = await asRole(
    "anon",
    `select count(*)::int as n from public.gallery where id = '${galFirst}';`,
  );

  check(
    "and a disabled photograph is invisible to the public gallery",
    galAnonSeesAfter[0].n === 0,
    `${galAnonSeesAfter[0].n}`,
  );

  const galBadStatusToggle = await rpcError("admin_set_gallery_status", { p_id: galFirst, p_status: "hidden" });

  check(
    "only the three real statuses can be set",
    galBadStatusToggle?.code === "PG008" && galBadStatusToggle?.detail === "status",
    `${galBadStatusToggle?.code} / ${galBadStatusToggle?.detail}`,
  );

  const galUnknownToggle = await rpcError("admin_set_gallery_status", {
    p_id: "00000000-0000-4000-8000-0000000000ff",
    p_status: "published",
  });

  check(
    "and publishing something that does not exist is refused",
    galUnknownToggle?.code === "PG006",
    galUnknownToggle?.code ?? "it was accepted",
  );

  await rpc("admin_set_gallery_status", { p_id: galFirst, p_status: "published" });

  // ---- delete, and the files it hands back --------------------------------------
  const galDeleted = await rpc("admin_delete_gallery_item", { p_id: galFirst });

  check(
    "deleting a photograph hands back both objects so the app can clean up storage",
    galDeleted[0]?.storage_path === `${EVENT}/${galFirst}/full.webp` &&
      Array.isArray(galDeleted[0]?.removed_paths) &&
      galDeleted[0].removed_paths.length === 2 &&
      galDeleted[0].removed_paths.includes(`${EVENT}/${galFirst}/full.webp`) &&
      galDeleted[0].removed_paths.includes(`${EVENT}/${galFirst}/thumb.webp`) &&
      galDeleted[0].is_public === true,
    JSON.stringify(galDeleted[0] ?? {}),
  );

  check("and the row is gone", (await count("gallery", `where id = '${galFirst}'`)) === 0);

  const galDeleteAgain = await rpcError("admin_delete_gallery_item", { p_id: galFirst });

  check(
    "deleting it twice is refused rather than silently ignored",
    galDeleteAgain?.code === "PG006",
    galDeleteAgain?.code ?? "it was accepted",
  );

  const galDeletedBare = await rpc("admin_delete_gallery_item", { p_id: galBare });

  check(
    "an item with no thumbnail hands back just the one object to delete",
    galDeletedBare[0]?.thumbnail_path === null &&
      galDeletedBare[0]?.removed_paths?.length === 1 &&
      galDeletedBare[0]?.is_public === false,
    JSON.stringify(galDeletedBare[0] ?? {}),
  );

  check(
    "and the two items that are left were not touched",
    (await count("gallery")) === 2,
    `${await count("gallery")} rows`,
  );

  // ---- the row's own constraints are still the last word ------------------------
  const galNoSource = await expectError(`
    insert into public.gallery (event_id, title, alt_text, sort_order)
    values ('${EVENT}', 'Nowhere', 'A photograph with no file behind it', 0);
  `);

  check(
    "a gallery row still cannot exist without a file behind it",
    /gallery_has_source/i.test(galNoSource ?? ""),
    galNoSource ?? "the insert succeeded",
  );

  const galBlankAlt = await expectError(`
    insert into public.gallery (event_id, title, alt_text, url, sort_order)
    values ('${EVENT}', 'Nowhere', '   ', 'https://test.supabase.co/storage/v1/object/public/gallery/x.jpg', 0);
  `);

  check(
    "and never without alternative text",
    /gallery_alt_text_not_blank/i.test(galBlankAlt ?? ""),
    galBlankAlt ?? "the insert succeeded",
  );

  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  section("Contact details: event columns, the format rules, and who can read them");
  // ---------------------------------------------------------------------------

  const ctsColumns = await q(`
    select column_name, data_type, is_nullable, column_default
      from information_schema.columns
     where table_schema = 'public' and table_name = 'events'
       and column_name in ('whatsapp_number', 'instagram_url', 'facebook_url', 'youtube_url', 'support_hours')
     order by column_name;
  `);

  check(
    "the event carries the five contact columns the site's links are built from",
    ctsColumns.length === 5,
    JSON.stringify(ctsColumns.map((row) => row.column_name)),
  );
  check(
    "support hours are a text array that defaults to empty and can never be null",
    ctsColumns.find((row) => row.column_name === "support_hours")?.data_type === "ARRAY" &&
      ctsColumns.find((row) => row.column_name === "support_hours")?.is_nullable === "NO" &&
      String(ctsColumns.find((row) => row.column_name === "support_hours")?.column_default ?? "").includes("{}"),
    JSON.stringify(ctsColumns.find((row) => row.column_name === "support_hours") ?? {}),
  );

  // The site reads these as the public reader: a published event, anon role.
  const ctsPublicRow = await asRole(
    "anon",
    `select whatsapp_number, instagram_url, facebook_url, youtube_url, support_hours, contact_phone, contact_email
       from public.events where id = '${EVENT}';`,
  );

  check(
    "a visitor can read the contact block of the published event",
    ctsPublicRow.length === 1 && ctsPublicRow[0].whatsapp_number === "919358535894",
    JSON.stringify(ctsPublicRow[0] ?? {}),
  );
  check(
    "the seeded event publishes all three social profiles and two lines of support hours",
    ctsPublicRow[0]?.instagram_url === "https://www.instagram.com/" &&
      ctsPublicRow[0]?.facebook_url === "https://www.facebook.com/" &&
      ctsPublicRow[0]?.youtube_url === "https://www.youtube.com/" &&
      Array.isArray(ctsPublicRow[0]?.support_hours) &&
      ctsPublicRow[0].support_hours.length === 2,
    JSON.stringify(ctsPublicRow[0] ?? {}),
  );

  // The click-to-chat link is built by concatenation, so the column may only hold
  // digits in international format — no plus, no spaces, no leading zero.
  const ctsBadNumbers = [
    ["090000000012", "leading zero"],
    ["91900 0000 00", "spaces"],
    ["+919358535894", "a plus sign"],
    ["91123456789012345", "too many digits"],
    ["919000000", "too few digits"],
    ["", "an empty string instead of null"],
  ];

  for (const [value, why] of ctsBadNumbers) {
    const ctsError = await expectError(`update public.events set whatsapp_number = '${value}' where id = '${EVENT}';`);

    check(`a WhatsApp number with ${why} is refused`, ctsError !== null, ctsError ?? "accepted");
  }

  await run(`update public.events set whatsapp_number = '919111122233' where id = '${EVENT}';`);
  check(
    "a plain international number in digits passes the format rule",
    (await q(`select whatsapp_number from public.events where id = '${EVENT}';`))[0].whatsapp_number === "919111122233",
  );
  await run(`update public.events set whatsapp_number = '919358535894' where id = '${EVENT}';`);

  // A social link in the wrong column sends guests to somewhere the organiser did not
  // intend, so each column only accepts its own platform, over https.
  const ctsBadSocials = [
    ["instagram_url", "https://facebook.com/garbanights"],
    ["instagram_url", "http://instagram.com/garbanights"],
    ["instagram_url", "instagram.com/garbanights"],
    ["facebook_url", "https://instagram.com/garbanights"],
    ["facebook_url", "https://facebook.com.evil.example/garbanights"],
    ["youtube_url", "https://facebook.com/garbanights"],
    ["youtube_url", "https://youtube.com"],
  ];

  for (const [column, value] of ctsBadSocials) {
    const ctsError = await expectError(
      `update public.events set ${column} = '${value}' where id = '${EVENT}';`,
    );

    check(`${column.replace("_url", "")} refuses "${value}"`, ctsError !== null, ctsError ?? "accepted");
  }

  const ctsGoodSocials = [
    ["instagram_url", "https://instagram.com/garbanights"],
    ["facebook_url", "https://fb.com/garbanights"],
    ["youtube_url", "https://youtu.be/dQw4w9WgXcQ"],
  ];

  for (const [column, value] of ctsGoodSocials) {
    const ctsError = await expectError(
      `update public.events set ${column} = '${value}' where id = '${EVENT}';`,
    );

    check(`${column.replace("_url", "")} accepts its own platform over https`, ctsError === null, ctsError ?? "");
  }

  await run(`
    update public.events
       set instagram_url = 'https://www.instagram.com/',
           facebook_url  = 'https://www.facebook.com/',
           youtube_url   = 'https://www.youtube.com/'
     where id = '${EVENT}';
  `);
  check(
    "and the seeded profiles are restored afterwards",
    (await q(`select instagram_url from public.events where id = '${EVENT}';`))[0].instagram_url ===
      "https://www.instagram.com/",
  );

  // Support hours are a short list, not a document.
  const ctsTooManyHours = await expectError(`
    update public.events
       set support_hours = array['1','2','3','4','5','6','7']
     where id = '${EVENT}';
  `);
  check("seven lines of support hours are refused", ctsTooManyHours !== null, ctsTooManyHours ?? "accepted");

  await run(`
    update public.events set support_hours = array['One','Two','Three','Four','Five','Six'] where id = '${EVENT}';
  `);
  check(
    "six lines are the most an event may publish",
    (await q(`select array_length(support_hours, 1) as n from public.events where id = '${EVENT}';`))[0].n === 6,
  );

  await run(`update public.events set support_hours = '{}' where id = '${EVENT}';`);
  check(
    "and an event may publish none at all",
    (await q(`select support_hours from public.events where id = '${EVENT}';`))[0].support_hours.length === 0,
  );

  await run(`
    update public.events
       set support_hours = array['Monday – Saturday · 10:00 AM – 8:00 PM', 'Festival days · 10:00 AM – 11:00 PM']
     where id = '${EVENT}';
  `);
  check(
    "the seeded support hours are restored",
    (await q(`select support_hours from public.events where id = '${EVENT}';`))[0].support_hours.length === 2,
  );

  // The contact block is public read-only: a visitor may read it, never write it.
  const ctsAnonWrite = await expectError(
    `set role anon; update public.events set whatsapp_number = '919999999999' where id = '${EVENT}';`,
  );
  await run("reset role;");

  check("a visitor cannot change the contact block", ctsAnonWrite !== null, ctsAnonWrite ?? "accepted");
  check(
    "and the number in the row is untouched",
    (await q(`select whatsapp_number from public.events where id = '${EVENT}';`))[0].whatsapp_number ===
      "919358535894",
  );

  section("Result");
  // ---------------------------------------------------------------------------
  console.log(`\n  ${passed} passed, ${failures.length} failed\n`);

  if (failures.length > 0) {
    console.log("  Failures:");
    for (const failure of failures) console.log(`   • ${failure}`);
    console.log("");
  }

  await db.close();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error("\nVerification harness crashed:", error);
  await db.close();
  process.exit(1);
});
