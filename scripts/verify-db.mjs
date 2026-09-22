/**
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
      "razorpay_order_id", "razorpay_payment_id", "created_at", "updated_at",
    ],
    digital_passes: [
      "id", "booking_id", "pass_id", "qr_token", "qr_code_url", "valid_date",
      "status", "checked_in", "checked_in_at", "created_at",
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
    insert into public.digital_passes (booking_id, valid_date, checked_in)
    values ('${booking.id}', '2026-10-11', true);
  `);
  check("checked_in without checked_in_at rejected", badCheckIn !== null, badCheckIn ?? "no error");

  const digitalPass = (
    await q(`
      insert into public.digital_passes (booking_id, valid_date)
      values ('${booking.id}', '2026-10-11') returning *;
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
    insert into public.digital_passes (booking_id, valid_date)
    values ('${cascading.id}', '2026-10-11');
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
    values ('${ownerId}', 'owner@example.com', 'Test Owner', 'owner');

    insert into public.admin_users (user_id, email, role)
    values ('${scannerId}', 'scanner@example.com', 'scanner');
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
    "owner can read admin_users",
    (await asRole("authenticated", `select count(*)::int as n from public.admin_users;`))[0].n === 2,
  );

  await run(`set request.jwt.claim.sub = '${scannerId}';`);
  check(
    "scanner can read bookings (gate duty)",
    (await asRole("authenticated", `select count(*)::int as n from public.bookings;`))[0].n >= 2,
  );

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
  check("scanner cannot edit events", scannerEdit <= 0, `affected rows: ${scannerEdit}`);

  await run("reset request.jwt.claim.sub;");


  // ---------------------------------------------------------------------------
  section("Booking flow: reference, duplicate protection, atomic create");
  // ---------------------------------------------------------------------------
  const EVENT = "e0000000-0000-4000-8000-000000000001";
  const COUPLE = "c0000000-0000-4000-8000-000000000002"; // 499 INR, 2 people, max 10
  const FAMILY = "c0000000-0000-4000-8000-000000000005"; // 1099 INR, 4 people, max 5
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
