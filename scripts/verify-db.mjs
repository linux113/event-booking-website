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
    "staff can read bookings (gate duty)",
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
  check("staff cannot edit events", scannerEdit <= 0, `affected rows: ${scannerEdit}`);

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
  await run(`update public.event_dates set capacity = 1 where id = '${NIGHT_FREE}';`);
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
    "the lookup fixture is a paid booking with the details a lookup returns",
    Boolean(lookupBooking?.booking_id && lookupBooking?.customer_mobile),
    JSON.stringify(lookupBooking ?? null),
  );

  const lookupByReference = await rpc("admin_lookup_bookings", { p_query: lookupBooking.booking_id });
  check(
    "a booking is found by its reference",
    lookupByReference.length === 1 && lookupByReference[0].booking_id === lookupBooking.booking_id,
    `${lookupByReference.length} rows`,
  );
  check(
    "the lookup returns the guest, the night and the pass",
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
    "the lookup counts the booking's passes and how many are in",
    lookupByReference[0]?.passes_issued === 2 && Number(lookupByReference[0]?.passes_checked_in) >= 0,
    `${lookupByReference[0]?.passes_issued ?? ""} issued`,
  );

  const lookupLimited = await rpc("admin_lookup_bookings", {
    p_query: lookupBooking.booking_id,
    p_include_contact: false,
  });
  check(
    "the limited view withholds the mobile number, the email and the amount",
    lookupLimited[0]?.customer_mobile === null &&
      lookupLimited[0]?.customer_email === null &&
      lookupLimited[0]?.total_amount === null &&
      lookupLimited[0]?.razorpay_order_id === null,
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

  const lookupByName = await rpc("admin_lookup_bookings", {
    p_query: lookupBooking.customer_name.slice(0, 4),
    p_include_contact: false,
  });
  check(
    "a partial guest name finds the booking",
    lookupByName.some((row) => row.booking_id === lookupBooking.booking_id),
    `${lookupByName.length} rows`,
  );

  const spacedMobile = `+91 ${lookupBooking.customer_mobile.slice(3)}`;
  const lookupByMobile = await rpc("admin_lookup_bookings", {
    p_query: spacedMobile,
    p_include_contact: false,
  });
  check(
    "a mobile number typed with spaces finds the booking",
    lookupByMobile.some((row) => row.booking_id === lookupBooking.booking_id),
    `${lookupByMobile.length} rows`,
  );

  const lookupEmpty = await rpc("admin_lookup_bookings", { p_query: "" });
  check("an empty search returns nothing at all", lookupEmpty.length === 0, `${lookupEmpty.length} rows`);

  const lookupPunctuation = await rpc("admin_lookup_bookings", { p_query: "+-() " });
  check(
    "a search with no digits and no letters returns nothing, not everything",
    lookupPunctuation.length === 0,
    `${lookupPunctuation.length} rows`,
  );

  const lookupUnknown = await rpc("admin_lookup_bookings", { p_query: "PS-999999" });
  check("an unknown reference returns nothing", lookupUnknown.length === 0, `${lookupUnknown.length} rows`);

  const lookupLimitedRows = await rpc("admin_lookup_bookings", { p_query: "1", p_limit: 1 });
  check("the lookup honours the caller's row limit", lookupLimitedRows.length <= 1, `${lookupLimitedRows.length} rows`);

  const lookupGrants = await q(`
    select
      has_function_privilege('anon', 'public.admin_lookup_bookings(text, boolean, integer)', 'execute') as anon,
      has_function_privilege('authenticated', 'public.admin_lookup_bookings(text, boolean, integer)', 'execute') as authenticated,
      has_function_privilege('service_role', 'public.admin_lookup_bookings(text, boolean, integer)', 'execute') as service;
  `);
  check(
    "only the service role may search bookings",
    lookupGrants[0].anon === false && lookupGrants[0].authenticated === false && lookupGrants[0].service === true,
    JSON.stringify(lookupGrants[0]),
  );

  const anonLookup = await expectError(`set role anon; select * from public.admin_lookup_bookings('x');`);
  check("an anon session cannot call the lookup", anonLookup !== null, anonLookup ?? "call succeeded");
  await run("reset role;");

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

  const [statsToday] = await q(`
    select ((now() at time zone 'UTC')::date)::text as today,
           (((now() at time zone 'UTC')::date) - 1)::text as yesterday;
  `);
  const venueTz = "Asia/Kolkata";
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
  // Half past midnight in Jaipur is the previous evening in UTC. The booking belongs
  // to the venue's day, and the dashboard has to agree.
  await run(`
    update public.bookings
       set created_at = (('${dashToday}'::date)::timestamp + interval '30 minutes') at time zone '${DASH_TZ}'
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

  const venueNow = await dashStats();
  const utcNow = (
    await rpc("admin_dashboard_stats", { p_today: utcToday, p_tz: "UTC", p_include_revenue: true })
  )[0];
  check(
    "today's bookings are the venue's today, not the server's today",
    Number(venueNow.bookings_today) !== Number(utcNow.bookings_today),
    `venue ${venueNow.bookings_today} / utc ${utcNow.bookings_today}`,
  );
  check(
    "the booking made after midnight in Jaipur counts towards the venue's day",
    Number(venueNow.bookings_today) - Number(utcNow.bookings_today) === 1,
    `${earlyDays.venue_clock} Jaipur / ${earlyDays.utc_clock} UTC`,
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
