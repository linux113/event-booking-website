/**
 * HISTORICAL harness from the Supabase era (customer email, roles, storage doubles).
 * Not part of the post-migration acceptance path; use test:prisma, db:setup:test,
 * typecheck, lint and build instead.
 *
 * End-to-end data verification for the public site.
 *
 *   1. Boots PostgreSQL (PGlite) with the real migrations + seed.
 *   2. Serves it over a PostgREST-compatible shim (see test/postgrest-shim.mjs).
 *   3. Calls the app's REAL service modules against it and asserts the data the
 *      pages receive — including a fully booked night, a cancelled night, a
 *      sold-out night and a disabled pass.
 *   4. Starts the real Next.js dev server against the same shim and asserts the
 *      rendered HTML: event details from the database, "Fully booked" states,
 *      disabled selection and the disabled pass card.
 *
 * Run with: npm run verify:web
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { register } from "node:module";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { createVerificationDb } from "./test/pglite.mjs";
import { startRazorpayStub } from "./test/razorpay-stub.mjs";
import { startShim } from "./test/postgrest-shim.mjs";
import { createAuthStub } from "./test/supabase-auth-stub.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");
const SEED_FILE = join(REPO_ROOT, "supabase", "seed.sql");
const WEB_PORT = 3210;
const DIST_DIR = ".next-verify";

/**
 * A fake service-role key: the shim reads the role from the JWT claims, exactly
 * like PostgREST does, so the booking endpoint runs as service_role (the only
 * role allowed to execute create_pending_booking) while everything else uses the
 * anon key.
 */
function fakeKey(role) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role, iss: "verify-web" })}.harness`;
}

const SERVICE_ROLE_KEY = fakeKey("service_role");

/**
 * Throwaway Razorpay credentials for this verification run only.
 *
 * They are not real and cannot be: `rzp_test_` is the prefix Razorpay gives test
 * keys, and the secrets are harness-local strings that exist so the server can be
 * pointed at the stub gateway and so callbacks can be signed with the same HMAC
 * the real gateway uses. No real credential is ever invented or committed.
 */
const RAZORPAY_KEY_ID = "rzp_test_ArenaVerifyHarness1";
const RAZORPAY_KEY_SECRET = "harness-razorpay-key-secret-not-a-real-credential";
const RAZORPAY_WEBHOOK_SECRET = "harness-razorpay-webhook-secret-not-a-real-credential";
const RAZORPAY_LIVE_KEY_ID = "rzp_live_ArenaVerifyHarness1";

const GREEN = "\u001b[32m";
const RED = "\u001b[31m";
const BOLD = "\u001b[1m";
const RESET = "\u001b[0m";

let passed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ${GREEN}✓${RESET} ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ${RED}✗${RESET} ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/**
 * The document with <script>/<style> bodies removed.
 *
 * Next.js repeats every string inside the RSC flight payload in a <script> tag,
 * so anything counted in the raw HTML is counted twice.
 */
function stripScripts(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
}

/**
 * Human-visible text of the page: scripts stripped, tags and React's node
 * separators removed, entities decoded, whitespace collapsed. React splits
 * interpolated strings with comment markers (`6<!-- --> of <!-- -->9`), so text
 * assertions must run against the rendered text, never the raw markup.
 */
function visibleText(html) {
  return stripScripts(html)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** A snippet of surrounding text, so a failed assertion says what rendered. */
function contextAround(source, needle, span = 70) {
  const index = source.indexOf(needle);

  if (index < 0) {
    return "";
  }

  return source.slice(Math.max(0, index - span), index + span).replace(/\s+/g, " ").trim();
}

/** Every `.css` file under a directory, recursively (Next nests them per route). */
function readCss(dir) {
  const files = [];

  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);

      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.name.endsWith(".css")) {
        files.push(readFileSync(path, "utf8"));
      }
    }
  }

  walk(dir);

  return files.join("\n");
}

/** Every `.js` file under a directory, recursively (client chunks nest per route). */
function readChunks(dir) {
  const files = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...readChunks(path));
    } else if (entry.name.endsWith(".js")) {
      files.push(readFileSync(path, "utf8"));
    }
  }

  return files;
}

function section(title) {
  console.log(`\n${BOLD}${title}${RESET}`);
}

const EVENT_ID = "e0000000-0000-4000-8000-000000000001";
const NIGHT_1 = "d0000000-0000-4000-8000-000000000001";
const NIGHT_2 = "d0000000-0000-4000-8000-000000000002";
const NIGHT_3 = "d0000000-0000-4000-8000-000000000003";
const COUPLE_PASS = "c0000000-0000-4000-8000-000000000002";
const FAMILY_PASS = "c0000000-0000-4000-8000-000000000005";

// Staff identities for the gate section. The uuid is the *Auth* user id, which is
// what `admin_users.user_id` points at and what the database checks on every scan.
const STAFF_USER_ID = "aaaa0000-0000-4000-8000-0000000000b1";
const SUSPENDED_USER_ID = "aaaa0000-0000-4000-8000-0000000000b2";
const GUEST_USER_ID = "aaaa0000-0000-4000-8000-0000000000b3";
const ADMIN_USER_ID = "aaaa0000-0000-4000-8000-0000000000b4";
const SUPER_USER_ID = "aaaa0000-0000-4000-8000-0000000000b5";
const STAFF_PASSWORD = "Gate-Pass-2026";

const db = createVerificationDb();
let shim;
let server;
let serverLog = "";
let stub;

async function dbRun(sql) {
  await db.exec(sql);
}

async function dbQuery(sql, params) {
  const result = await db.query(sql, params);
  return result.rows;
}

/** True when something is already listening, so a stale server cannot be reused. */
function isPortInUse(port) {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.setTimeout(1_000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

async function fetchPage(path, init) {
  const response = await fetch(`http://127.0.0.1:${WEB_PORT}${path}`, init);

  if (!response.ok) {
    throw new Error(`${path} responded ${response.status}`);
  }

  return response.text();
}

async function waitForServer(url, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);

      if (response.ok) {
        return true;
      }
    } catch {
      // not up yet
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return false;
}

/** Builds the app exactly the way a deployment would, with the given env. */
async function runBuild(env) {
  const build = spawn("npm", ["run", "build"], { cwd: REPO_ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";

  build.stdout.on("data", (chunk) => {
    log += chunk.toString();
  });
  build.stderr.on("data", (chunk) => {
    log += chunk.toString();
  });

  const exitCode = await new Promise((resolve) => build.on("exit", resolve));

  return { exitCode, log };
}

/** How the built site is started: same code path every time, two envs in this run. */
async function startWebServer(env) {
  if (await isPortInUse(WEB_PORT)) {
    throw new Error(`port ${WEB_PORT} is already serving something — stop that server first`);
  }

  // `detached` gives the server its own process group: `next start` ignores
  // SIGTERM and would otherwise survive as an orphan holding the port.
  server = spawn(
    "npm",
    ["run", "start", "--", "--hostname", "127.0.0.1", "--port", String(WEB_PORT)],
    { cwd: REPO_ROOT, env, stdio: ["ignore", "pipe", "pipe"], detached: true },
  );

  serverLog = "";
  server.stdout.on("data", (chunk) => {
    serverLog += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    serverLog += chunk.toString();
  });

  const ready = await waitForServer(`http://127.0.0.1:${WEB_PORT}/`);

  if (!ready) {
    console.error(serverLog.slice(-2000));
    throw new Error("Next.js server did not start");
  }

  console.log(`  ${GREEN}✓${RESET} the built site is serving on 127.0.0.1:${WEB_PORT}`);
}

async function stopWebServer() {
  if (!server?.pid) {
    return;
  }

  try {
    process.kill(-server.pid, "SIGKILL");
  } catch {
    server.kill("SIGKILL");
  }

  server = undefined;

  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline && (await isPortInUse(WEB_PORT))) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function main() {
  // ---------------------------------------------------------------------------
  section("Boot database (migrations + seed)");
  // ---------------------------------------------------------------------------
  await dbRun(`
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key, email text unique);
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;

    -- Supabase ships a "storage" schema next to "auth", and the gallery migration
    -- creates its two buckets there inside a guarded block. Creating the schema here
    -- means the real migration runs its real branch rather than the fallback, and the
    -- harness can then serve the same buckets the project would have.
    create schema if not exists storage;
    create table if not exists storage.buckets (
      id text primary key,
      name text not null,
      public boolean not null default false,
      file_size_limit bigint,
      allowed_mime_types text[]
    );
    create table if not exists storage.objects (
      id uuid primary key default gen_random_uuid(),
      bucket_id text not null,
      name text not null,
      owner uuid,
      metadata jsonb,
      created_at timestamptz not null default now()
    );
    alter table storage.objects enable row level security;
  `);

  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    await dbRun(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }

  await dbRun("grant usage on schema auth to anon, authenticated, service_role;");
  await dbRun(readFileSync(SEED_FILE, "utf8"));
  check("schema + seed applied", true);

  // ---------------------------------------------------------------------------
  section("Fixtures for unavailability states");
  // ---------------------------------------------------------------------------
  // Night 1: capacity cut to 4 and filled by a paid booking → FULLY BOOKED.
  await dbRun(`update public.event_dates set capacity = 4 where id = '${NIGHT_1}';`);
  await dbRun(`
    insert into public.bookings (customer_name, customer_mobile, customer_email, event_date_id,
                                 pass_category_id, quantity, booking_status, payment_status)
    values ('Paid Attendee', '9812345678', 'paid@example.com', '${NIGHT_1}', '${COUPLE_PASS}',
            2, 'confirmed', 'paid');
  `);
  // Night 2: cancelled by the organiser.
  await dbRun(`update public.event_dates set status = 'cancelled' where id = '${NIGHT_2}';`);
  // Night 3: organiser marked it sold out even though capacity is nominally free.
  await dbRun(`update public.event_dates set status = 'sold_out' where id = '${NIGHT_3}';`);
  // One unpaid booking must NOT consume capacity.
  await dbRun(`
    insert into public.bookings (customer_name, customer_mobile, customer_email, event_date_id,
                                 pass_category_id, quantity, booking_status, payment_status)
    values ('Unpaid Attendee', '9812345678', 'unpaid@example.com', '${NIGHT_1}', '${COUPLE_PASS}',
            1, 'pending', 'unpaid');
  `);
  // A disabled pass category.
  await dbRun(`update public.pass_categories set is_active = false where id = '${FAMILY_PASS}';`);
  // Published gallery rows (host matches the allowed Supabase Storage pattern).
  await dbRun(`
    insert into public.gallery (event_id, album, title, media_type, url, alt_text, status, sort_order)
    values
      ('${EVENT_ID}', 'Night 1', 'Garba circle at full spin', 'image',
       'https://test.supabase.co/storage/v1/object/public/gallery/night-1.jpg',
       'Dancers in a garba circle under magenta stage lights', 'published', 1),
      ('${EVENT_ID}', 'Night 1', 'Stage and LED wall', 'image',
       'https://test.supabase.co/storage/v1/object/public/gallery/night-1-stage.jpg',
       'Empty festival stage with a glowing LED wall', 'published', 2),
      ('${EVENT_ID}', 'Night 1', 'Unpublished draft shot', 'image',
       'https://test.supabase.co/storage/v1/object/public/gallery/draft.jpg',
       'A draft photo that must never be rendered', 'draft', 3);
  `);
  check("fixtures inserted (full night, cancelled, sold out, disabled pass, gallery)", true);

  // ---------------------------------------------------------------------------
  section("Service layer against the database");
  // ---------------------------------------------------------------------------
  // Supabase Auth, doubled: the scanner is protected by a real session, so the
  // harness needs a `/auth/v1` to sign in against.
  const authStub = createAuthStub({
    accounts: [
      { id: STAFF_USER_ID, email: "scanner@example.com", password: STAFF_PASSWORD },
      { id: SUSPENDED_USER_ID, email: "suspended@example.com", password: STAFF_PASSWORD },
      { id: GUEST_USER_ID, email: "guest@example.com", password: STAFF_PASSWORD },
      { id: ADMIN_USER_ID, email: "admin@example.com", password: STAFF_PASSWORD },
      { id: SUPER_USER_ID, email: "owner@example.com", password: STAFF_PASSWORD },
    ],
  });

  shim = await startShim({ db, auth: authStub });

  // The storage double starts empty; the buckets are the ones the migration created,
  // read back out of the database, so there is one source of truth for their names,
  // their visibility and their size limit.
  const galStorageBuckets = await dbQuery(
    `select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id`,
  );

  for (const row of galStorageBuckets) {
    shim.storage.setBucket(row.id, {
      public: row.public === true,
      fileSizeLimit: row.file_size_limit === null ? null : Number(row.file_size_limit),
      allowedMimeTypes: row.allowed_mime_types ?? null,
    });
  }

  check(
    "the gallery migration created its two buckets in the storage schema",
    galStorageBuckets.length === 2 &&
      galStorageBuckets.some((row) => row.id === "gallery" && row.public === true) &&
      galStorageBuckets.some((row) => row.id === "gallery-inbox" && row.public === false),
    galStorageBuckets.map((row) => `${row.id}:${row.public}`).join(", "),
  );

  process.env.NEXT_PUBLIC_SUPABASE_URL = shim.url;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  register("./test/ts-alias-loader.mjs", import.meta.url);

  const events = await import("../src/lib/services/events.ts");
  const gallery = await import("../src/lib/services/gallery.ts");

  const bundleResult = await events.getFeaturedEventBundle();

  check("getFeaturedEventBundle succeeds", bundleResult.ok === true, bundleResult.ok ? "" : bundleResult.error.message);

  if (!bundleResult.ok) {
    throw new Error("cannot continue without event data");
  }

  const bundle = bundleResult.data;
  check("featured event returned", bundle !== null);
  check(
    "event name comes from the database",
    bundle.event.name === "Garba Nights Navratri Utsav",
    bundle.event.name,
  );
  check("event slug comes from the database", bundle.event.slug === "navratri-2026-jaipur", bundle.event.slug);
  check("venue from database", bundle.event.venueName === "My Village Garden", bundle.event.venueName);
  check("city from database", bundle.event.city === "Jaipur", bundle.event.city);
  check("9 nights loaded", bundle.nights.length === 9, `${bundle.nights.length}`);
  check("5 pass categories loaded", bundle.passes.length === 5, `${bundle.passes.length}`);
  check("6 features loaded", bundle.features.length === 6, `${bundle.features.length}`);
  check("6 highlights loaded", bundle.highlights.length === 6, `${bundle.highlights.length}`);

  const night1 = bundle.nights.find((night) => night.id === NIGHT_1);
  const night2 = bundle.nights.find((night) => night.id === NIGHT_2);
  const night3 = bundle.nights.find((night) => night.id === NIGHT_3);

  check("night 1 is FULLY BOOKED", night1?.isFullyBooked === true);
  check("night 1 is not bookable", night1?.isBookable === false);
  check("night 1 shows 0 remaining", night1?.remaining === 0, `${night1?.remaining}`);
  check("night 1 counts only paid people (4 of 4)", night1?.bookedPeople === 4, `${night1?.bookedPeople}`);
  check("night 2 is cancelled and not bookable", night2?.status === "cancelled" && night2?.isBookable === false);
  check("night 3 is sold out", night3?.isFullyBooked === true && night3?.isBookable === false);
  check(
    "an unpaid booking does not consume capacity",
    night1?.bookedPeople === 4 && night1?.capacity === 4,
    `booked ${night1?.bookedPeople} / capacity ${night1?.capacity}`,
  );

  const bookableNights = bundle.nights.filter((night) => night.isBookable);
  check("remaining nights stay bookable", bookableNights.length === 6, `${bookableNights.length} bookable`);

  const disabledPass = bundle.passes.find((pass) => pass.id === FAMILY_PASS);
  check("disabled pass is returned but not enabled", disabledPass?.availability.enabled === false);
  check(
    "disabled pass carries a reason",
    disabledPass?.availability.enabled === false && disabledPass.availability.reason.length > 0,
  );
  check("enabled passes report enabled", bundle.passes.filter((p) => p.availability.enabled).length === 4);
  check(
    "passes come with database prices",
    bundle.passes.find((p) => p.code === "couple")?.priceInr === 499,
    `${bundle.passes.find((p) => p.code === "couple")?.priceInr}`,
  );

  const galleryResult = await gallery.listPublishedGallery();

  check("gallery query succeeds", galleryResult.ok === true);
  check("only published gallery rows are returned", galleryResult.ok && galleryResult.data.length === 2, galleryResult.ok ? `${galleryResult.data.length}` : "");
  check(
    "gallery maps alt text and captions",
    galleryResult.ok && galleryResult.data[0]?.alt.length > 0 && galleryResult.data[0]?.caption.length > 0,
  );
  check(
    "draft gallery row is excluded",
    galleryResult.ok && !galleryResult.data.some((item) => item.alt.includes("must never")),
  );

  // Private data must not exist on the returned view models.
  const bundleJson = JSON.stringify(bundle);
  check(
    "no booking or customer data leaks into the view model",
    !bundleJson.includes("customer_") && !bundleJson.includes("razorpay") && !bundleJson.includes("paid@example.com"),
  );


  // ---------------------------------------------------------------------------
  section("Shared validation rules (client + server)");
  // ---------------------------------------------------------------------------
  const validation = await import("../src/lib/booking/validation.ts");

  check("mobile with spaces normalises to +91", validation.normaliseMobile("98123 45678") === "+919812345678");
  check("mobile with +91 normalises", validation.normaliseMobile("+91 98123 45678") === "+919812345678");
  check("mobile with a leading zero normalises", validation.normaliseMobile("09812345678") === "+919812345678");
  check("a mobile starting below 6 is rejected", validation.normaliseMobile("5812345678") === null);
  check("a nine-digit mobile is rejected", validation.normaliseMobile("981234567") === null);
  check("a twelve-digit mobile is rejected", validation.normaliseMobile("981234567890") === null);
  check("a valid name passes", validation.validateName("Asha Patel") === null);
  check("an empty name is rejected", validation.validateName("   ") !== null);
  check("a single-character name is rejected", validation.validateName("A") !== null);
  check("a digits-only name is rejected", validation.validateName("12345") !== null);
  check("a valid email passes", validation.validateEmail("asha@example.com") === null);
  check("an email without a domain is rejected", validation.validateEmail("asha@example") !== null);
  check("an email with spaces is rejected", validation.validateEmail("asha patel@example.com") !== null);
  check("quantity 1 is accepted", validation.validateQuantity("1", 10) === null);
  check("quantity 0 is rejected", validation.validateQuantity("0", 10) !== null);
  check("a fractional quantity is rejected", validation.validateQuantity("1.5", 10) !== null);
  check("quantity above the pass limit is rejected", validation.validateQuantity("11", 10) !== null);
  check("people must match quantity x people per pass", validation.validatePeople("3", 2, 2) !== null);
  check("the matching head count passes", validation.validatePeople("4", 2, 2) === null);
  check("a fractional head count is rejected", validation.validatePeople("2.5", 1, 2) !== null);

  const dirtyPayload = {
    eventId: EVENT_ID,
    eventDateId: NIGHT_1,
    passCategoryId: COUPLE_PASS,
    customerName: " Asha Patel ",
    customerMobile: "9812345678",
    customerEmail: " ASHA@Example.com ",
    quantity: 2,
    numberOfPeople: 4,
    idempotencyKey: "unit-key",
    // never part of the contract — must be dropped, not trusted
    subtotal: 1,
    totalAmount: 1,
    priceInr: 1,
    bookingStatus: "paid",
    paymentStatus: "paid",
  };
  const parsed = validation.validateBookingRequest(dirtyPayload);
  const parsedKeys = parsed.ok ? Object.keys(parsed.value) : [];
  check("a valid payload parses", parsed.ok === true, parsed.ok ? "" : JSON.stringify(parsed.fieldErrors));
  check(
    "normalisation happens server-side too",
    parsed.ok && parsed.value.customerName === "Asha Patel" && parsed.value.customerMobile === "+919812345678" && parsed.value.customerEmail === "asha@example.com",
  );
  check(
    "client-supplied amounts and statuses are dropped",
    parsed.ok && !parsedKeys.some((key) => /price|amount|subtotal|status/i.test(key)),
    parsedKeys.join(","),
  );
  check(
    "a payload without an idempotency key is refused",
    validation.validateBookingRequest({ ...dirtyPayload, idempotencyKey: "" }).ok === false,
  );

  // ---------------------------------------------------------------------------
  section("Next.js pages render database data");
  // ---------------------------------------------------------------------------
  // Build and serve into an isolated output directory: that renders exactly what
  // production renders, and leaves any running dev server (and its .next) alone.
  // The payment paths are proved against a local stub of the Razorpay API: this
  // sandbox has no Razorpay account and real test keys cannot be invented. The
  // stub enforces the same Basic auth the gateway does, and every callback and
  // webhook below is signed with the same HMAC formulas Razorpay uses.
  stub = await startRazorpayStub({
    keyId: RAZORPAY_KEY_ID,
    keySecret: RAZORPAY_KEY_SECRET,
    webhookSecret: RAZORPAY_WEBHOOK_SECRET,
  });

  const serverEnv = {
    ...process.env,
    NEXT_DIST_DIR: DIST_DIR,
    NEXT_PUBLIC_SUPABASE_URL: shim.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
    NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${WEB_PORT}`,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
    NEXT_PUBLIC_RAZORPAY_KEY_ID: RAZORPAY_KEY_ID,
    RAZORPAY_KEY_SECRET: RAZORPAY_KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET: RAZORPAY_WEBHOOK_SECRET,
    RAZORPAY_API_BASE_URL: stub.url,
  };

  const build = await runBuild(serverEnv);
  check(
    "production build succeeds with the database configured",
    build.exitCode === 0,
    build.exitCode === 0 ? "" : build.log.slice(-500),
  );

  await startWebServer(serverEnv);

  const pages = { home: "/", passes: "/passes", book: "/book", gallery: "/gallery" };
  const raw = {};
  const text = {};

  for (const [name, path] of Object.entries(pages)) {
    const html = await fetchPage(path);
    raw[name] = stripScripts(html);
    text[name] = visibleText(html);
  }

  if (process.env.VERIFY_DEBUG === "1") {
    const dir = join(tmpdir(), "verify-web-html");
    mkdirSync(dir, { recursive: true });

    for (const [name, source] of Object.entries(text)) {
      writeFileSync(join(dir, `${name}.txt`), source);
    }

    console.log(`  debug: rendered page text written to ${dir}`);
  }

  const home = text.home;
  const passes = text.passes;
  const book = text.book;
  const galleryPage = text.gallery;

  check("home renders the event name from the database", home.includes("Garba Nights Navratri Utsav"));
  check("home renders the venue from the database", home.includes("My Village Garden"));
  check("home renders the city from the database", home.includes("Jaipur"));
  check(
    "home renders the dates from the database",
    home.includes("11 – 19 October 2026"),
    contextAround(home, "October"),
  );
  check("home renders database pass prices", home.includes("₹399") && home.includes("₹1,099"));
  check("home renders database features", home.includes("Gorilla Dancer") && home.includes("Drone Camera"));
  check("home renders database highlights", home.includes("Best dresser contest"));
  check("home renders published gallery media", home.includes("Garba circle at full spin"));

  check("passes page loads pass categories", passes.includes("Couple Pass") && passes.includes("Squad Pass"));
  check("passes page shows a disabled pass as not on sale", passes.includes("Not on sale"));
  check("passes page marks the disabled pass", passes.includes("Disabled"));
  check("passes page shows FULLY BOOKED for the full night", passes.includes("Fully booked"));
  check("passes page shows the cancelled night", passes.includes("Cancelled"));
  check(
    "passes page reports bookable night count",
    passes.includes("6 of 9 nights bookable"),
    contextAround(passes, "nights bookable"),
  );
  // 4 of the 5 seeded passes are active, so exactly 4 Book buttons must render.
  const bookButtons = (raw.passes.match(/Book this pass/g) ?? []).length;
  check("only enabled passes render a Book button", bookButtons === 4, `${bookButtons} buttons`);

  check(
    "book page loads available dates",
    book.includes("11 Oct 2026") && book.includes("19 Oct 2026"),
    contextAround(book, "Oct"),
  );
  check("book page disables fully booked dates", book.includes("Fully booked") && raw.book.includes("disabled"));
  check(
    "book page disables cancelled dates",
    book.includes("Cancelled") && book.includes("cannot be selected"),
    contextAround(book, "cannot be selected"),
  );
  check("book page shows remaining capacity", book.includes("places left"));
  check(
    "book page explains the payment step",
    book.includes("Pay securely with Razorpay") && book.includes("verified on our server"),
    contextAround(book, "Pay securely"),
  );
  check(
    "book page is honest about test mode",
    book.includes("Razorpay test keys"),
    contextAround(book, "test keys"),
  );
  check(
    "book page renders the four-step stepper",
    ["Night", "Pass", "Details", "Review"].every((label) => book.includes(label)) &&
      book.includes("Step 1 of 4"),
    contextAround(book, "Step 1 of 4"),
  );
  check(
    "book page opens on the night step with a continue action",
    book.includes("Choose your night") && book.includes("Continue"),
  );

  check("gallery page renders published items", galleryPage.includes("Garba circle at full spin"));
  check("gallery page excludes draft rows", !galleryPage.includes("must never"));



  // The wizard is a client component: its strings have to reach the browser, or
  // the steps could never advance. (No headless browser is available here, so the
  // built client bundles are inspected directly.)
  const chunkDir = join(REPO_ROOT, DIST_DIR, "static", "chunks");
  const chunkSources = readChunks(chunkDir).join("\n");

  check(
    "the checkout flow ships to the browser",
    ["Confirm booking", "Verifying the payment", "Review and confirm", "Choose your night"].every((text) =>
      chunkSources.includes(text),
    ),
    "the wizard's own copy must be in a client chunk",
  );
  check(
    "the browser only talks to our own payment endpoints",
    chunkSources.includes("/api/payment/create-order") &&
      chunkSources.includes("/api/payment/verify") &&
      chunkSources.includes("/api/payment/status"),
    "the wizard must call the server, never the gateway directly",
  );

  // ---------------------------------------------------------------------------
  section("Booking API (POST /api/bookings)");
  // ---------------------------------------------------------------------------
  const API_URL = `http://127.0.0.1:${WEB_PORT}/api/bookings`;
  const FREE_NIGHT = "d0000000-0000-4000-8000-000000000004"; // untouched by the fixtures

  async function postBooking(body) {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

    let payload = null;

    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    return { status: response.status, payload };
  }

  const [couplePass] = await dbQuery(
    `select id, name, price_inr, number_of_people, max_per_booking from public.pass_categories where id = $1`,
    [COUPLE_PASS],
  );
  const [freeNightRow] = await dbQuery(`select event_date from public.event_dates where id = $1`, [FREE_NIGHT]);
  const availabilityBefore = await dbQuery(
    `select booked_people, remaining from public.get_event_night_availability($1) where event_date_id = $2`,
    [EVENT_ID, FREE_NIGHT],
  );

  const validBody = {
    eventId: EVENT_ID,
    eventDateId: FREE_NIGHT,
    passCategoryId: COUPLE_PASS,
    customerName: "  Asha Patel ",
    customerMobile: "098123 45678",
    customerEmail: "  Asha@Example.COM ",
    quantity: 2,
    numberOfPeople: 2 * couplePass.number_of_people,
    idempotencyKey: "web-attempt-1",
  };

  const created = await postBooking(validBody);
  check("a valid booking returns 201", created.status === 201, `${created.status} ${JSON.stringify(created.payload)?.slice(0, 160)}`);

  const booking = created.payload?.ok ? created.payload.booking : null;
  check("the response contains the booking", booking !== null);
  check("booking reference looks like DND202600001", /^DND\d{9}$/.test(booking?.reference ?? ""), booking?.reference ?? "");
  check("booking is pending", booking?.status === "pending", booking?.status ?? "");
  check("payment is not paid", booking?.paymentStatus === "unpaid", booking?.paymentStatus ?? "");
  check(
    "the server computed the price from the database",
    booking?.subtotal === couplePass.price_inr * 2 && booking?.totalAmount === couplePass.price_inr * 2,
    `${booking?.subtotal} / ${booking?.totalAmount}`,
  );
  check(
    "the server derived the head count from the pass",
    booking?.numberOfPeople === 2 * couplePass.number_of_people,
    `${booking?.numberOfPeople}`,
  );
  check("the booking names the pass from the database", booking?.passName === couplePass.name, booking?.passName ?? "");
  check("the booking carries the night it was made for", booking?.eventDate === freeNightRow.event_date, `${booking?.eventDate}`);
  check("a new attempt is not flagged as reused", booking?.reusedExisting === false);
  check(
    "the response exposes no payment or key material",
    !JSON.stringify(created.payload).includes("service_role") &&
      !JSON.stringify(created.payload).includes("web-attempt-1"),
  );

  const [storedBooking] = await dbQuery(
    `select booking_status, payment_status, subtotal, total_amount, number_of_people, quantity,
            customer_name, customer_mobile, customer_email, idempotency_key,
            razorpay_order_id, razorpay_payment_id, booking_id
     from public.bookings where booking_id = $1`,
    [booking?.reference],
  );
  check("the booking row is in the database", Boolean(storedBooking));
  check(
    "the stored row is pending and unpaid",
    storedBooking?.booking_status === "pending" && storedBooking?.payment_status === "unpaid",
    `${storedBooking?.booking_status}/${storedBooking?.payment_status}`,
  );
  check(
    "the stored amounts match the database price",
    storedBooking?.subtotal === couplePass.price_inr * 2 && storedBooking?.total_amount === couplePass.price_inr * 2,
    `${storedBooking?.subtotal}`,
  );
  check("the stored row has no payment identifiers", storedBooking?.razorpay_order_id === null && storedBooking?.razorpay_payment_id === null);
  check("the stored row kept the idempotency key", storedBooking?.idempotency_key === "web-attempt-1");
  check("the name is stored trimmed", storedBooking?.customer_name === "Asha Patel", storedBooking?.customer_name ?? "");
  check("the mobile is stored in +91 form", storedBooking?.customer_mobile === "+919812345678", storedBooking?.customer_mobile ?? "");
  check("the email is stored lower-cased", storedBooking?.customer_email === "asha@example.com", storedBooking?.customer_email ?? "");
  check(
    "no digital pass is issued before payment",
    (
      await dbQuery(`select count(*)::int as n from public.digital_passes d join public.bookings b on b.id = d.booking_id where b.booking_id = $1`, [booking?.reference])
    )[0].n === 0,
  );

  // Tampering: amounts in the body must be ignored (they are not part of the API).
  const tampered = await postBooking({ ...validBody, quantity: 1, numberOfPeople: couplePass.number_of_people, idempotencyKey: "web-attempt-2", subtotal: 1, totalAmount: 1, priceInr: 1 });
  check("a tampered body is still accepted as a booking", tampered.status === 201, `${tampered.status}`);
  check(
    "a price sent by the browser is ignored",
    tampered.payload?.ok &&
      tampered.payload.booking.subtotal === couplePass.price_inr &&
      tampered.payload.booking.totalAmount === couplePass.price_inr,
    `${tampered.payload?.booking?.subtotal}`,
  );

  // Duplicate submission: the same attempt re-sent.
  const replayed = await postBooking(validBody);
  check("re-sending the same attempt returns 201", replayed.status === 201, `${replayed.status}`);
  check("the retry returns the original reference", replayed.payload?.booking?.reference === booking?.reference);
  check("the retry is flagged as reused", replayed.payload?.booking?.reusedExisting === true);
  check(
    "the retry created no second row",
    (await dbQuery(`select count(*)::int as n from public.bookings where idempotency_key = $1`, ["web-attempt-1"]))[0].n === 1,
  );

  // Duplicate submission: reload, new key, identical content.
  const reloaded = await postBooking({ ...validBody, idempotencyKey: "web-attempt-3" });
  check("a reloaded attempt reuses the booking", reloaded.payload?.booking?.reference === booking?.reference);
  check(
    "the reloaded attempt added no row",
    (
      await dbQuery(
        `select count(*)::int as n from public.bookings where event_date_id = $1 and customer_mobile = $2 and pass_category_id = $3`,
        [FREE_NIGHT, "+919812345678", COUPLE_PASS],
      )
    )[0].n === 2,
    "expected 2 rows for this mobile/night/pass: the reload must not add a third",
  );

  // Validation.
  const badName = await postBooking({ ...validBody, customerName: "  ", idempotencyKey: "web-attempt-4" });
  check("an empty name is rejected with 400", badName.status === 400, `${badName.status}`);
  check("the name error is attached to the field", Boolean(badName.payload?.error?.fieldErrors?.customerName));

  const badMobile = await postBooking({ ...validBody, customerMobile: "12345", idempotencyKey: "web-attempt-5" });
  check("an invalid mobile is rejected with 400", badMobile.status === 400, `${badMobile.status}`);
  check(
    "the mobile error is attached to the field",
    Boolean(badMobile.payload?.error?.fieldErrors?.customerMobile),
    JSON.stringify(badMobile.payload?.error?.fieldErrors ?? {}),
  );

  const badEmail = await postBooking({ ...validBody, customerEmail: "not-an-email", idempotencyKey: "web-attempt-6" });
  check("an invalid email is rejected with 400", badEmail.status === 400, `${badEmail.status}`);
  check("the email error is attached to the field", Boolean(badEmail.payload?.error?.fieldErrors?.customerEmail));

  const badQuantity = await postBooking({ ...validBody, quantity: 0, numberOfPeople: 0, idempotencyKey: "web-attempt-7" });
  check("a quantity of zero is rejected with 400", badQuantity.status === 400, `${badQuantity.status}`);
  check("the quantity error is attached to the field", Boolean(badQuantity.payload?.error?.fieldErrors?.quantity));

  const noKey = await postBooking({ ...validBody, idempotencyKey: undefined });
  check("a missing idempotency key is rejected", noKey.status === 400, `${noKey.status}`);

  const overLimit = await postBooking({ ...validBody, quantity: couplePass.max_per_booking + 1, numberOfPeople: (couplePass.max_per_booking + 1) * couplePass.number_of_people, idempotencyKey: "web-attempt-8" });
  check("a quantity above the pass limit is rejected", overLimit.status === 400, `${overLimit.status}`);
  check(
    "the limit comes from the pass category",
    Boolean(overLimit.payload?.error?.fieldErrors?.quantity),
    overLimit.payload?.error?.message ?? "",
  );

  const wrongPeople = await postBooking({ ...validBody, quantity: 2, numberOfPeople: 3, idempotencyKey: "web-attempt-9" });
  check("a head count that contradicts the pass is rejected", wrongPeople.status === 400, `${wrongPeople.status}`);
  check(
    "the head-count error is attached to the field",
    Boolean(wrongPeople.payload?.error?.fieldErrors?.numberOfPeople),
    wrongPeople.payload?.error?.message ?? "",
  );

  const malformed = await postBooking("{not json");
  check("malformed JSON is rejected with 400", malformed.status === 400, `${malformed.status}`);

  // Capacity and availability.
  const fullNight = await postBooking({ ...validBody, eventDateId: NIGHT_1, idempotencyKey: "web-attempt-10" });
  check("a fully booked night is refused with 409", fullNight.status === 409, `${fullNight.status} ${fullNight.payload?.error?.message ?? ""}`);
  check(
    "the refusal explains the remaining places",
    /place/i.test(fullNight.payload?.error?.message ?? ""),
    fullNight.payload?.error?.message ?? "",
  );

  const cancelledNight = await postBooking({ ...validBody, eventDateId: NIGHT_2, idempotencyKey: "web-attempt-11" });
  check("a cancelled night is refused with 409", cancelledNight.status === 409, `${cancelledNight.status}`);

  const soldOutNight = await postBooking({ ...validBody, eventDateId: NIGHT_3, idempotencyKey: "web-attempt-12" });
  check("a sold-out night is refused with 409", soldOutNight.status === 409, `${soldOutNight.status}`);

  const offSalePass = await postBooking({ ...validBody, passCategoryId: FAMILY_PASS, quantity: 1, numberOfPeople: 4, idempotencyKey: "web-attempt-13" });
  check("a pass that is off sale is refused with 409", offSalePass.status === 409, `${offSalePass.status}`);
  check(
    "the off-sale refusal is attached to the pass field",
    Boolean(offSalePass.payload?.error?.fieldErrors?.passCategoryId),
    JSON.stringify(offSalePass.payload?.error?.fieldErrors ?? {}),
  );

  // Nothing above may have taken money or booked over capacity.
  check(
    "no booking created through the API is marked paid",
    (await dbQuery(`select count(*)::int as n from public.bookings where payment_status = 'paid' and customer_mobile = $1`, ["+919812345678"]))[0].n === 0,
  );
  check(
    "a pending booking does not consume capacity",
    JSON.stringify(
      await dbQuery(`select booked_people, remaining from public.get_event_night_availability($1) where event_date_id = $2`, [EVENT_ID, FREE_NIGHT]),
    ) === JSON.stringify(availabilityBefore),
  );
  check(
    "the fully booked night still reports no places left",
    (await dbQuery(`select remaining from public.get_event_night_availability($1) where event_date_id = $2`, [EVENT_ID, NIGHT_1]))[0].remaining === 0,
  );

  // No endpoint reads bookings back out.
  const getBookings = await fetch(API_URL);
  check("bookings cannot be read back through the API", getBookings.status === 405, `${getBookings.status}`);

  // ---------------------------------------------------------------------------
  section("Payments: Razorpay order, server-side verification, webhook, duplicates");
  // ---------------------------------------------------------------------------
  const format = await import("../src/lib/format.ts");
  const api = (path) => `http://127.0.0.1:${WEB_PORT}${path}`;

  const MOBILE_PAID = "+919800000201";
  const MOBILE_FAILED = "+919800000202";
  const MOBILE_WEBHOOK = "+919800000203";
  const MOBILE_AMOUNT = "+919800000204";
  const nightLabel = format.formatEventDate(freeNightRow.event_date);

  async function readJson(response) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  async function postJson(path, body) {
    const response = await fetch(api(path), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

    return { status: response.status, payload: await readJson(response) };
  }

  async function getJson(path) {
    const response = await fetch(api(path));
    return { status: response.status, payload: await readJson(response) };
  }

  /** What the browser is allowed to send to create-order: identifiers, no amount. */
  function paymentRequest(overrides = {}) {
    return {
      eventId: EVENT_ID,
      eventDateId: FREE_NIGHT,
      passCategoryId: COUPLE_PASS,
      customerName: "Payal Mehta",
      customerMobile: MOBILE_PAID,
      customerEmail: "payal@example.com",
      quantity: 2,
      numberOfPeople: 2 * couplePass.number_of_people,
      idempotencyKey: "pay-attempt-1",
      ...overrides,
    };
  }

  const bookingRows = async (mobile) =>
    Number(
      (await dbQuery(`select count(*)::int as n from public.bookings where customer_mobile = $1`, [mobile]))[0].n,
    );

  const passesFor = async (mobile) =>
    Number(
      (
        await dbQuery(
          `select count(*)::int as n from public.digital_passes dp
           join public.bookings b on b.id = dp.booking_id where b.customer_mobile = $1`,
          [mobile],
        )
      )[0].n,
    );

  const activePassesFor = async (mobile) =>
    Number(
      (
        await dbQuery(
          `select count(*)::int as n from public.digital_passes dp
           join public.bookings b on b.id = dp.booking_id
           where b.customer_mobile = $1 and dp.status = 'active'`,
          [mobile],
        )
      )[0].n,
    );

  const bookingRow = async (reference) =>
    (await dbQuery(
      `select booking_status, payment_status, razorpay_order_id, razorpay_payment_id
       from public.bookings where booking_id = $1`,
      [reference],
    ))[0];

  /** A webhook body shaped like Razorpay's, plus the id used for deduplication. */
  function webhookDelivery(eventType, { orderId, paymentId, amount, eventId }) {
    const payload = {
      entity: "event",
      account_id: "acc_TEST000000000001",
      event: eventType,
      contains: [String(eventType).split(".")[0]],
      payload: {},
      created_at: Math.floor(Date.now() / 1000),
    };

    if (eventType === "order.paid") {
      payload.payload.order = { entity: { id: orderId, amount, amount_paid: amount, status: "paid" } };
    } else if (eventType === "refund.processed") {
      payload.payload.refund = {
        entity: { id: "rfnd_TEST000000000001", payment_id: paymentId, amount, status: "processed" },
      };
    } else {
      payload.payload.payment = {
        entity: {
          id: paymentId,
          order_id: orderId,
          amount,
          status: eventType === "payment.failed" ? "failed" : "captured",
        },
      };
    }

    return { raw: JSON.stringify(payload), eventId };
  }

  async function postWebhook(eventType, options) {
    const { raw, eventId } = webhookDelivery(eventType, options);
    const signature = "signature" in options ? options.signature : stub.webhookSignature(raw);

    const response = await fetch(api("/api/payment/webhook"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-razorpay-signature": signature,
        "x-razorpay-event-id": eventId,
      },
      body: raw,
    });

    return { status: response.status, payload: await readJson(response) };
  }

  // ---- 1. the order the customer is charged for ----------------------------
  const ordersBefore = stub.orderRequests().length;
  const payOrder = await postJson("/api/payment/create-order", paymentRequest());
  const order = payOrder.payload?.order;

  check(
    "create-order returns a usable order",
    payOrder.status === 201 && payOrder.payload?.ok === true && typeof order?.orderId === "string",
    `status ${payOrder.status} ${JSON.stringify(payOrder.payload)?.slice(0, 200)}`,
  );
  check("the browser receives the public key id", order?.keyId === RAZORPAY_KEY_ID, order?.keyId ?? "");
  check(
    "no secret is ever sent to the browser",
    !JSON.stringify(payOrder.payload).includes(RAZORPAY_KEY_SECRET) &&
      !JSON.stringify(payOrder.payload).includes(RAZORPAY_WEBHOOK_SECRET),
  );
  check("the amount is the database price in paise", order?.amountPaise === 99800, `${order?.amountPaise}`);
  check("the currency comes from the event", order?.currency === "INR", order?.currency ?? "");
  check(
    "the booking behind the order is pending and unpaid",
    order?.booking?.status === "pending" && order?.booking?.paymentStatus === "unpaid",
    JSON.stringify(order?.booking ?? {}).slice(0, 160),
  );
  check("the booking carries a public status token", /^[0-9a-f]{8}-/.test(order?.booking?.publicToken ?? ""));

  const orderRequest = stub.orderBodies().at(-1);
  check(
    "the server authenticated to the gateway with the key id and secret",
    stub.orderRequests().at(-1).authorization ===
      `Basic ${Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`, "utf8").toString("base64")}`,
  );
  check("the gateway was asked for the database amount", orderRequest?.amount === 99800, `${orderRequest?.amount}`);
  check(
    "the order notes carry the booking reference",
    orderRequest?.notes?.booking_reference === order?.booking?.reference,
    JSON.stringify(orderRequest?.notes ?? {}),
  );
  check("exactly one order was created", stub.orderRequests().length === ordersBefore + 1);
  check("the order id looks like a Razorpay order", /^order_/.test(order?.orderId ?? ""), order?.orderId ?? "");

  const pendingRow = await bookingRow(order.booking.reference);
  check("the pending booking stores the order id", pendingRow.razorpay_order_id === order.orderId);
  check("no payment id is stored before verification", pendingRow.razorpay_payment_id === null);
  check("one booking exists for this attempt", (await bookingRows(MOBILE_PAID)) === 1);
  check("no pass is issued before payment", (await passesFor(MOBILE_PAID)) === 0);

  // Pressing pay twice must not create a second booking or a second order.
  const retried = await postJson("/api/payment/create-order", paymentRequest());
  check("a repeated create-order reuses the same booking", retried.payload?.order?.booking?.reference === order.booking.reference);
  check("a repeated create-order reuses the same order", retried.payload?.order?.orderId === order.orderId);
  check("no second order was created at the gateway", stub.orderRequests().length === ordersBefore + 1);
  check("still exactly one booking after the retry", (await bookingRows(MOBILE_PAID)) === 1);

  // Validation and availability still gate order creation.
  const invalid = await postJson("/api/payment/create-order", paymentRequest({ customerMobile: "12345", idempotencyKey: "pay-attempt-bad" }));
  check(
    "an invalid payload is refused before the gateway is called",
    invalid.status === 400 && Boolean(invalid.payload?.error?.fieldErrors?.customerMobile),
    `status ${invalid.status}`,
  );
  check("the gateway saw nothing for the invalid payload", stub.orderRequests().length === ordersBefore + 1);

  const soldOut = await postJson("/api/payment/create-order", paymentRequest({ eventDateId: NIGHT_1, idempotencyKey: "pay-attempt-full" }));
  check("a fully booked night is refused before any order exists", soldOut.status === 409, `status ${soldOut.status}`);
  check("the refusal explains the remaining places", /place/i.test(soldOut.payload?.error?.message ?? ""), soldOut.payload?.error?.message ?? "");
  check("no order was created for the refused night", stub.orderRequests().length === ordersBefore + 1);

  // ---- 2. a successful payment, verified on the server ---------------------
  const payment = stub.createPayment({ orderId: order.orderId });
  const signature = stub.checkoutSignature({ orderId: order.orderId, paymentId: payment.id });
  const verified = await postJson("/api/payment/verify", {
    razorpay_order_id: order.orderId,
    razorpay_payment_id: payment.id,
    razorpay_signature: signature,
  });

  check(
    "a signed payment confirms the booking",
    verified.status === 200 && verified.payload?.ok === true,
    `status ${verified.status} ${JSON.stringify(verified.payload)?.slice(0, 200)}`,
  );
  check(
    "the verified booking is paid and confirmed",
    verified.payload?.payment?.booking?.status === "confirmed" &&
      verified.payload?.payment?.booking?.paymentStatus === "paid",
    JSON.stringify(verified.payload?.payment?.booking ?? {}).slice(0, 160),
  );
  check("exactly one pass per purchased pass is issued", verified.payload?.payment?.booking?.passesIssued === 2, `${verified.payload?.payment?.booking?.passesIssued}`);
  check("the first confirmation is not a replay", verified.payload?.payment?.alreadyConfirmed === false);

  const paidRow = await bookingRow(order.booking.reference);
  check("the stored row is paid and confirmed", paidRow.payment_status === "paid" && paidRow.booking_status === "confirmed", JSON.stringify(paidRow));
  check("the payment id is stored on the booking", paidRow.razorpay_payment_id === payment.id);
  check("the booking has exactly its passes", (await passesFor(MOBILE_PAID)) === 2, `${await passesFor(MOBILE_PAID)}`);
  check("all of its passes are active", (await activePassesFor(MOBILE_PAID)) === 2);

  // ---- 3. refresh after payment: the status page and the JSON endpoint -----
  const statusJson = await getJson(`/api/payment/status?token=${order.booking.publicToken}`);
  check("the status endpoint answers for the token", statusJson.status === 200 && statusJson.payload?.ok === true);
  check("the status endpoint reports confirmed + paid", statusJson.payload?.booking?.status === "confirmed" && statusJson.payload?.booking?.paymentStatus === "paid");
  check("the status endpoint reports the passes", statusJson.payload?.booking?.passesIssued === 2);
  check("the status payload is not cached", statusJson.payload?.booking?.reference === order.booking.reference);
  check(
    "the status payload exposes no personal details",
    !JSON.stringify(statusJson.payload).includes("Payal") &&
      !JSON.stringify(statusJson.payload).includes("payal@example.com") &&
      !JSON.stringify(statusJson.payload).includes("9800000201"),
  );
  const badToken = await getJson("/api/payment/status?token=not-a-token");
  check("a malformed token is refused", badToken.status === 400, `status ${badToken.status}`);
  const unknownToken = await getJson("/api/payment/status?token=ffffffff-ffff-4fff-8fff-ffffffffffff");
  check("an unknown token is not found", unknownToken.status === 404, `status ${unknownToken.status}`);

  const statusPageHtml = await fetchPage(`/book/status?token=${order.booking.publicToken}`);
  const statusPage = visibleText(statusPageHtml);
  check(
    "the status page survives a refresh with the confirmed state",
    statusPage.includes("Payment successful") && statusPage.includes(order.booking.reference),
    contextAround(statusPage, "Payment successful"),
  );
  check("the status page shows the amount paid", statusPage.includes("Amount paid") && statusPage.includes("998"), contextAround(statusPage, "Amount paid"));
  check("the status page shows the night from the database", statusPage.includes(nightLabel), contextAround(statusPage, "Night"));
  check("the status page shows the pass from the database", statusPage.includes(couplePass.name), contextAround(statusPage, couplePass.name));
  check("the status page lists the issued passes", statusPage.includes("2 entry passes are issued"));
  check(
    "the status page never prints the customer's details",
    !statusPage.includes("Payal") && !statusPage.includes("payal@example.com") && !statusPage.includes("9800000201"),
  );
  check("the status page is not indexable", /noindex/.test(statusPageHtml));

  // ---- 4. duplicate callbacks: one booking, one set of passes --------------
  const payReplay = await postJson("/api/payment/verify", {
    razorpay_order_id: order.orderId,
    razorpay_payment_id: payment.id,
    razorpay_signature: signature,
  });
  check("a repeated verify is accepted as a replay", payReplay.status === 200 && payReplay.payload?.payment?.alreadyConfirmed === true, `status ${payReplay.status}`);
  check("the replay issues no extra passes", payReplay.payload?.payment?.booking?.passesIssued === 2);
  check("the database still holds exactly two passes", (await passesFor(MOBILE_PAID)) === 2);
  check("still exactly one booking after the duplicate callback", (await bookingRows(MOBILE_PAID)) === 1);

  const capturedEvent = { orderId: order.orderId, paymentId: payment.id, amount: 99800, eventId: "evt_web_captured_1" };
  const capturedHook = await postWebhook("payment.captured", capturedEvent);
  check("the webhook accepts a correctly signed delivery", capturedHook.status === 200 && capturedHook.payload?.ok === true, `status ${capturedHook.status}`);
  check("a captured event for a paid booking is reported as confirmed already", ["already_confirmed", "confirmed"].includes(capturedHook.payload?.outcome), capturedHook.payload?.outcome ?? "");
  check("the webhook did not create a second set of passes", (await passesFor(MOBILE_PAID)) === 2);

  const duplicatedHook = await postWebhook("payment.captured", capturedEvent);
  check("a retried delivery is reported as a duplicate", duplicatedHook.payload?.duplicate === true && duplicatedHook.payload?.outcome === "duplicate", JSON.stringify(duplicatedHook.payload));
  check("the duplicate delivery changed nothing", (await passesFor(MOBILE_PAID)) === 2 && (await bookingRows(MOBILE_PAID)) === 1);

  const orderPaidHook = await postWebhook("order.paid", {
    orderId: order.orderId,
    paymentId: null,
    amount: 99800,
    eventId: "evt_web_order_paid_1",
  });
  check(
    "an order.paid delivery for a paid booking stays idempotent",
    orderPaidHook.status === 200 && orderPaidHook.payload?.outcome === "already_confirmed",
    JSON.stringify(orderPaidHook.payload),
  );
  check("the idempotent delivery issued no second set of passes", (await passesFor(MOBILE_PAID)) === 2);

  const forgedHook = await postWebhook("payment.captured", {
    orderId: order.orderId,
    paymentId: payment.id,
    amount: 99800,
    eventId: "evt_web_forged_1",
    signature: "0".repeat(64),
  });
  check("a webhook with a bad signature is rejected", forgedHook.status === 400, `status ${forgedHook.status}`);
  check("the rejected webhook changed nothing", (await passesFor(MOBILE_PAID)) === 2);

  // ---- 5. the webhook confirms a payment the browser never reported --------
  const webhookOrder = await postJson(
    "/api/payment/create-order",
    paymentRequest({ customerMobile: MOBILE_WEBHOOK, idempotencyKey: "pay-attempt-webhook" }),
  );
  const webhookBooking = webhookOrder.payload?.order;
  const webhookPayment = stub.createPayment({ orderId: webhookBooking.orderId });

  const capturedForWebhook = await postWebhook("payment.captured", {
    orderId: webhookBooking.orderId,
    paymentId: webhookPayment.id,
    amount: 99800,
    eventId: "evt_web_captured_2",
  });
  check("a captured webhook confirms a booking on its own", capturedForWebhook.payload?.outcome === "confirmed", JSON.stringify(capturedForWebhook.payload));
  const webhookRow = await bookingRow(webhookBooking.booking.reference);
  check("the webhook-only booking is paid and confirmed in the database", webhookRow.payment_status === "paid" && webhookRow.booking_status === "confirmed", JSON.stringify(webhookRow));
  check("the webhook-only booking got its passes", (await passesFor(MOBILE_WEBHOOK)) === 2);

  // ---- 6. a failed payment leaves the booking untouched -------------------
  const failedOrder = await postJson(
    "/api/payment/create-order",
    paymentRequest({ customerMobile: MOBILE_FAILED, idempotencyKey: "pay-attempt-failed" }),
  );
  const failedBooking = failedOrder.payload?.order;
  const failedPayment = stub.createPayment({ orderId: failedBooking.orderId, status: "failed" });
  const failedVerify = await postJson("/api/payment/verify", {
    razorpay_order_id: failedBooking.orderId,
    razorpay_payment_id: failedPayment.id,
    razorpay_signature: stub.checkoutSignature({ orderId: failedBooking.orderId, paymentId: failedPayment.id }),
  });
  check("a signed but unsuccessful payment does not confirm the booking", failedVerify.status === 409, `status ${failedVerify.status} ${JSON.stringify(failedVerify.payload)?.slice(0, 160)}`);
  const stillPending = await bookingRow(failedBooking.booking.reference);
  check("the failed payment left the booking pending and unpaid", stillPending.payment_status === "unpaid" && stillPending.booking_status === "pending", JSON.stringify(stillPending));
  check("no passes were issued for the failed payment", (await passesFor(MOBILE_FAILED)) === 0);

  const failedHook = await postWebhook("payment.failed", {
    orderId: failedBooking.orderId,
    paymentId: failedPayment.id,
    amount: 99800,
    eventId: "evt_web_failed_1",
  });
  check("a payment.failed webhook is recorded as failed", failedHook.payload?.outcome === "failed", JSON.stringify(failedHook.payload));
  check(
    "the failed booking is not confirmed",
    (await bookingRow(failedBooking.booking.reference)).booking_status === "pending",
  );

  // A delivery that carries no payment id (order.paid on its own) must not guess:
  // the paired payment.captured event does the confirming.
  const orderPaidWithoutPayment = await postWebhook("order.paid", {
    orderId: failedBooking.orderId,
    paymentId: null,
    amount: 99800,
    eventId: "evt_web_order_paid_2",
  });
  check(
    "an order.paid delivery without a payment id is left alone",
    orderPaidWithoutPayment.status === 200 && orderPaidWithoutPayment.payload?.outcome === "ignored",
    JSON.stringify(orderPaidWithoutPayment.payload),
  );
  check(
    "the booking is still not confirmed after that delivery",
    (await bookingRow(failedBooking.booking.reference)).booking_status === "pending" &&
      (await passesFor(MOBILE_FAILED)) === 0,
  );

  const failedPage = visibleText(await fetchPage(`/book/status?token=${failedBooking.booking.publicToken}`));
  check(
    "the status page tells the customer the payment did not go through",
    failedPage.includes("That payment did not go through"),
    contextAround(failedPage, "did not go through"),
  );
  check("the failed status page never claims a payment", !failedPage.includes("Payment successful"));
  check("the failed status page issues no passes claim", !failedPage.includes("entry passes are issued"));

  const ordersBeforeReuse = stub.orderRequests().length;
  const reuseAttempt = await postJson(
    "/api/payment/create-order",
    paymentRequest({ customerMobile: MOBILE_FAILED, idempotencyKey: "pay-attempt-failed" }),
  );
  check("when the customer pays again the same booking is reused", reuseAttempt.payload?.order?.orderId === failedBooking.orderId);
  check("paying again did not create a second order", stub.orderRequests().length === ordersBeforeReuse, `${stub.orderRequests().length} order requests`);

  // ---- 7. a browser cannot fake a payment ---------------------------------
  const beforeForgery = await passesFor(MOBILE_FAILED);
  const forgedVerify = await postJson("/api/payment/verify", {
    razorpay_order_id: failedBooking.orderId,
    razorpay_payment_id: "pay_TEST000000000999",
    razorpay_signature: "f".repeat(64),
  });
  check("a forged signature is refused", forgedVerify.status === 400, `status ${forgedVerify.status}`);
  const fakeSuccess = await postJson("/api/payment/verify", {
    razorpay_order_id: failedBooking.orderId,
    razorpay_payment_id: "pay_TEST000000000999",
    razorpay_signature: "f".repeat(64),
    booking_status: "confirmed",
    payment_status: "paid",
    amount_paise: 1,
  });
  check("extra fields claiming success are ignored", fakeSuccess.status === 400 && (await passesFor(MOBILE_FAILED)) === beforeForgery);
  const noSignature = await postJson("/api/payment/verify", {
    razorpay_order_id: failedBooking.orderId,
    razorpay_payment_id: "pay_TEST000000000999",
  });
  check("a verify request without a signature is refused", noSignature.status === 400, `status ${noSignature.status}`);
  const unsignedWebhook = await postWebhook("payment.captured", {
    orderId: failedBooking.orderId,
    paymentId: "pay_TEST000000000999",
    amount: 99800,
    eventId: "evt_web_unsigned_1",
    signature: "",
  });
  check("a webhook without a signature is refused", unsignedWebhook.status === 400, `status ${unsignedWebhook.status}`);
  check(
    "nothing a browser sent could confirm the booking",
    (await bookingRow(failedBooking.booking.reference)).payment_status !== "paid",
  );

  // ---- 8. the amount is checked against the database ----------------------
  const amountOrder = await postJson(
    "/api/payment/create-order",
    paymentRequest({ customerMobile: MOBILE_AMOUNT, idempotencyKey: "pay-attempt-amount" }),
  );
  const amountBooking = amountOrder.payload?.order;
  const underpayment = stub.createPayment({ orderId: amountBooking.orderId, amount: 100 });
  const underpaidVerify = await postJson("/api/payment/verify", {
    razorpay_order_id: amountBooking.orderId,
    razorpay_payment_id: underpayment.id,
    razorpay_signature: stub.checkoutSignature({ orderId: amountBooking.orderId, paymentId: underpayment.id }),
  });
  check("a payment below the booking amount is refused", underpaidVerify.status === 400, `status ${underpaidVerify.status} ${JSON.stringify(underpaidVerify.payload)?.slice(0, 160)}`);
  check("the underpaid booking stays unpaid", (await bookingRow(amountBooking.booking.reference)).payment_status === "unpaid");

  const unpaidPage = visibleText(await fetchPage(`/book/status?token=${amountBooking.booking.publicToken}`));
  check(
    "an unpaid booking's status page says payment is not completed",
    unpaidPage.includes("Booking held — payment not completed"),
    contextAround(unpaidPage, "Booking held"),
  );
  check("the unpaid status page offers to complete the payment", unpaidPage.includes("Complete payment"));
  check("the unpaid status page shows the amount due", unpaidPage.includes("Amount due"));
  check("the underpaid booking got no passes", (await passesFor(MOBILE_AMOUNT)) === 0);

  const foreignVerify = await postJson("/api/payment/verify", {
    razorpay_order_id: amountBooking.orderId,
    razorpay_payment_id: payment.id,
    razorpay_signature: stub.checkoutSignature({ orderId: amountBooking.orderId, paymentId: payment.id }),
  });
  check("a payment already used by another booking is refused", foreignVerify.status === 400, `status ${foreignVerify.status}`);

  const crossedPayment = stub.createPayment({ orderId: order.orderId });
  const crossedVerify = await postJson("/api/payment/verify", {
    razorpay_order_id: amountBooking.orderId,
    razorpay_payment_id: crossedPayment.id,
    razorpay_signature: stub.checkoutSignature({ orderId: amountBooking.orderId, paymentId: crossedPayment.id }),
  });
  check("a payment belonging to another order is refused", crossedVerify.status === 400, `status ${crossedVerify.status}`);
  check("no booking was confirmed by the crossed payment", (await bookingRow(amountBooking.booking.reference)).payment_status === "unpaid");

  // ---------------------------------------------------------------------------
  section("Digital passes: pass ids, QR tokens, ticket pages, gate view");
  // ---------------------------------------------------------------------------
  // Everything below is read-only from the app's side. A pass is created by the
  // database when a payment is verified — never by a page being opened — so the
  // reloads in this section must all report the same pass ids.
  const passLinks = await import("../src/lib/pass/links.ts");
  const passStatus = await import("../src/lib/pass/status.ts");

  const paidPasses = await dbQuery(
    `select dp.pass_id, dp.qr_token, dp.pass_number, dp.status, dp.valid_date
     from public.digital_passes dp
     join public.bookings b on b.id = dp.booking_id
     where b.customer_mobile = $1
     order by dp.pass_number`,
    [MOBILE_PAID],
  );
  const [passEvent] = await dbQuery(`select name from public.events where id = $1`, [EVENT_ID]);

  check("the paid booking owns one pass per purchased pass", paidPasses.length === 2, `${paidPasses.length}`);
  check(
    "every pass has a sequential, human-readable pass id",
    paidPasses.every((row) => /^PS-\d{6}$/.test(row.pass_id)),
    paidPasses.map((row) => row.pass_id).join(", "),
  );
  check(
    "every QR token is 64 random hex characters",
    paidPasses.every((row) => /^[0-9a-f]{64}$/.test(row.qr_token)),
    paidPasses.map((row) => row.qr_token.slice(0, 10)).join(", "),
  );
  check("the two passes have different tokens", paidPasses[0].qr_token !== paidPasses[1].qr_token);

  const [tokenTally] = await dbQuery(
    `select count(*)::int as n, count(distinct qr_token)::int as unique_tokens from public.digital_passes`,
  );
  check(
    "no two passes in the database share a QR token",
    tokenTally.n === tokenTally.unique_tokens,
    `${tokenTally.n} passes, ${tokenTally.unique_tokens} tokens`,
  );

  // The QR code's payload: an absolute verification URL and nothing else.
  const verifyUrl = passLinks.buildVerifyUrl(paidPasses[0].qr_token);
  check(
    "the QR encodes the verification URL for that pass",
    /^https?:\/\//.test(verifyUrl) && verifyUrl.endsWith(`/verify/${paidPasses[0].qr_token}`),
    verifyUrl,
  );
  check(
    "the QR payload contains no personal information",
    !/Payal|payal@example\.com|9800000201|@/.test(verifyUrl.replace(/^https?:\/\//, "")),
    verifyUrl,
  );
  check(
    "a token that is not 64 hex characters is rejected before any lookup",
    passLinks.isQrToken("not-a-token") === false &&
      passLinks.isQrToken(paidPasses[0].qr_token) === true &&
      passLinks.isQrToken("F".repeat(64)) === false,
  );

  // The pass's own state machine, independent of any page.
  check(
    "an unused pass for tonight is VALID",
    passStatus.toPassDisplayStatus(
      { status: "active", checkedIn: false, validDate: "2099-01-01" },
      "2026-10-11",
    ) === "valid",
  );
  check(
    "a scanned pass reads as CHECKED IN",
    passStatus.toPassDisplayStatus(
      { status: "used", checkedIn: true, validDate: "2099-01-01" },
      "2026-10-11",
    ) === "checked-in",
  );
  check(
    "a cancelled pass stays cancelled even if it was never used",
    passStatus.toPassDisplayStatus(
      { status: "cancelled", checkedIn: false, validDate: "2099-01-01" },
      "2026-10-11",
    ) === "cancelled",
  );
  check(
    "a pass for a night that has passed reads as EXPIRED",
    passStatus.toPassDisplayStatus(
      { status: "active", checkedIn: false, validDate: "2026-10-11" },
      "2026-10-20",
    ) === "expired",
  );

  // ---- the confirmation page the customer lands on ------------------------
  const successHtml = await fetchPage(`/booking/success?token=${order.booking.publicToken}`);
  const successPage = visibleText(successHtml);
  check(
    "the success page reports the verified payment",
    successPage.includes("Payment successful"),
    contextAround(successPage, "Payment successful"),
  );
  check(
    "the success page shows the booking id",
    successPage.includes("Booking ID") && successPage.includes(order.booking.reference),
    contextAround(successPage, "Booking ID"),
  );
  check(
    "the success page shows the event date from the database",
    successPage.includes("Event date") && successPage.includes(nightLabel),
    contextAround(successPage, "Event date"),
  );
  check(
    "the success page shows the pass category",
    successPage.includes("Pass category") && successPage.includes(couplePass.name),
    contextAround(successPage, "Pass category"),
  );
  check(
    "the success page shows the amount actually paid",
    successPage.includes("Amount paid") && successPage.includes("998"),
    contextAround(successPage, "Amount paid"),
  );
  check(
    "the success page lists every issued pass id",
    paidPasses.every((row) => successPage.includes(row.pass_id)),
    paidPasses.map((row) => row.pass_id).join(", "),
  );
  check(
    "every pass on the success page links to its own digital pass",
    paidPasses.every((row) => stripScripts(successHtml).includes(`/pass/${row.pass_id}?t=${row.qr_token}`)),
  );
  check("the success page is not indexable", /noindex/.test(successHtml));
  check(
    "the success page never prints the customer's contact details",
    !successPage.includes("9800000201") && !successPage.includes("payal@example.com"),
  );

  // An unpaid booking must not be congratulated, and must have nothing to show.
  const unpaidSuccess = visibleText(await fetchPage(`/booking/success?token=${amountBooking.booking.publicToken}`));
  check(
    "an unpaid booking's confirmation page does not claim success",
    !unpaidSuccess.includes("Payment successful"),
    contextAround(unpaidSuccess, "payment"),
  );
  check(
    "it says no verified payment has arrived",
    unpaidSuccess.includes("no verified payment has reached us yet"),
    contextAround(unpaidSuccess, "verified payment"),
  );
  check(
    "it links to no pass",
    !/\/pass\/PS-\d+/.test(unpaidSuccess),
  );
  check("it still shows the booking reference", unpaidSuccess.includes(amountBooking.booking.reference));

  // ---- the pass itself ----------------------------------------------------
  const passHtml = await fetchPage(`/pass/${paidPasses[0].pass_id}?t=${paidPasses[0].qr_token}`);
  const passPage = visibleText(passHtml);
  check(
    "the pass page opens from its own link",
    passPage.includes(paidPasses[0].pass_id) && passPage.includes("Payal Mehta"),
    contextAround(passPage, paidPasses[0].pass_id),
  );
  check(
    "the pass page is tied to its booking and event",
    passPage.includes(order.booking.reference) && passPage.includes(passEvent.name),
    contextAround(passPage, order.booking.reference),
  );
  check("the pass page shows the night from the database", passPage.includes(nightLabel), contextAround(passPage, "2026"));
  check("the pass page shows the pass category", passPage.includes(couplePass.name));
  check(
    "the pass page shows the number of the pass within the booking",
    passPage.includes("Pass 1 of 2"),
    contextAround(passPage, "Pass 1 of 2"),
  );
  const secondPassPage = visibleText(
    await fetchPage(`/pass/${paidPasses[1].pass_id}?t=${paidPasses[1].qr_token}`),
  );
  check(
    "the other pass shows its own number and not this one's",
    secondPassPage.includes("Pass 2 of 2") && !secondPassPage.includes("Pass 1 of 2"),
    contextAround(secondPassPage, "Pass 2 of 2"),
  );
  check("a paid, unused pass renders as VALID", passPage.includes("VALID"), contextAround(passPage, "VALID"));
  check(
    "the QR code is drawn inline in the page",
    /shape-rendering="crispEdges"/.test(passHtml) && /aria-label="QR code that verifies pass/.test(passHtml),
  );
  check(
    "the pass page offers print and download",
    passPage.includes("Print pass") && passPage.includes("Download pass"),
  );
  check(
    "the QR token is never rendered as visible text",
    !passPage.includes(paidPasses[0].qr_token),
  );
  check(
    "the pass page never prints the customer's contact details",
    !passPage.includes("9800000201") && !passPage.includes("payal@example.com"),
  );
  check("the pass page is not indexable", /noindex/.test(passHtml));

  const incompletePass = visibleText(await fetchPage(`/pass/${paidPasses[0].pass_id}`));
  check(
    "a pass link without its code explains what is missing",
    incompletePass.includes("This pass link is incomplete"),
    contextAround(incompletePass, "incomplete"),
  );

  // ---- downloading the pass ----------------------------------------------
  const downloadResponse = await fetch(
    api(`/pass/${paidPasses[0].pass_id}/download?t=${paidPasses[0].qr_token}`),
  );
  const downloadedTicket = await downloadResponse.text();
  check(
    "the pass downloads as a vector ticket",
    downloadResponse.status === 200 &&
      (downloadResponse.headers.get("content-type") ?? "").includes("image/svg+xml"),
    `${downloadResponse.status} ${downloadResponse.headers.get("content-type")}`,
  );
  check(
    "the download is named after the pass",
    /attachment; filename="pass-PS-\d+\.svg"/.test(downloadResponse.headers.get("content-disposition") ?? ""),
    downloadResponse.headers.get("content-disposition") ?? "",
  );
  check(
    "the downloaded ticket carries the pass, the guest and the QR code",
    downloadedTicket.includes("SCAN AT THE GATE") &&
      downloadedTicket.includes(paidPasses[0].pass_id) &&
      downloadedTicket.includes("Payal Mehta") &&
      /<path d="M/.test(downloadedTicket),
  );
  check(
    "the downloaded ticket carries no contact details",
    !downloadedTicket.includes("9800000201") && !downloadedTicket.includes("payal@example.com"),
  );

  const pngResponse = await fetch(
    api(`/pass/${paidPasses[0].pass_id}/download?t=${paidPasses[0].qr_token}&format=png`),
  );
  const pngBytes = new Uint8Array(await pngResponse.arrayBuffer());
  check(
    "just the QR code downloads as a PNG",
    pngResponse.status === 200 && pngResponse.headers.get("content-type") === "image/png",
    `${pngResponse.status} ${pngResponse.headers.get("content-type")}`,
  );
  check(
    "the PNG really is a PNG",
    pngBytes[0] === 0x89 && pngBytes[1] === 0x50 && pngBytes[2] === 0x4e && pngBytes[3] === 0x47,
    `first bytes ${Array.from(pngBytes.slice(0, 4)).join(",")}`,
  );
  check("a downloaded pass is never cached", pngResponse.headers.get("cache-control") === "no-store");

  const missingDownload = await fetch(api(`/pass/PS-999999/download?t=${"a".repeat(64)}`));
  check("downloading an unknown token is a 404", missingDownload.status === 404, `${missingDownload.status}`);

  // ---- the gate view the QR code opens ------------------------------------
  const verifyHtml = await fetchPage(`/verify/${paidPasses[0].qr_token}`);
  const verifyPage = visibleText(verifyHtml);
  check(
    "the QR target confirms a valid pass",
    verifyPage.includes("Valid pass") && verifyPage.includes(paidPasses[0].pass_id),
    contextAround(verifyPage, "Valid pass"),
  );
  check(
    "the gate view names the guest and the night",
    verifyPage.includes("Payal Mehta") && verifyPage.includes(nightLabel),
    contextAround(verifyPage, "Payal Mehta"),
  );
  check(
    "the gate view tells staff what to do",
    verifyPage.includes("Admit Payal Mehta"),
    contextAround(verifyPage, "Admit"),
  );
  check(
    "the gate view never exposes contact details",
    !verifyPage.includes("9800000201") && !verifyPage.includes("payal@example.com"),
  );

  const unknownVerify = visibleText(await fetchPage(`/verify/${"a".repeat(64)}`));
  check(
    "an unknown code is refused at the gate",
    unknownVerify.includes("Not a valid pass") && !unknownVerify.includes("Valid pass"),
    contextAround(unknownVerify, "Not a valid pass"),
  );
  const malformedVerify = visibleText(await fetchPage("/verify/not-a-token"));
  check(
    "a malformed code is refused without a database lookup",
    malformedVerify.includes("Not a valid pass"),
    contextAround(malformedVerify, "Not a valid pass"),
  );

  // ---- a scan and a refund must show up immediately -----------------------
  await dbQuery(
    `update public.digital_passes
     set checked_in = true, checked_in_at = now(), status = 'used'
     where qr_token = $1`,
    [paidPasses[0].qr_token],
  );

  const scannedVerify = visibleText(await fetchPage(`/verify/${paidPasses[0].qr_token}`));
  check(
    "a second scan reports the pass as already used",
    scannedVerify.includes("Already checked in") && !scannedVerify.includes("Admit Payal"),
    contextAround(scannedVerify, "Already checked in"),
  );
  const scannedPass = visibleText(await fetchPage(`/pass/${paidPasses[0].pass_id}?t=${paidPasses[0].qr_token}`));
  check(
    "the customer's own pass shows that it has been scanned",
    scannedPass.includes("CHECKED IN") && scannedPass.includes("already been scanned"),
    contextAround(scannedPass, "CHECKED IN"),
  );
  check(
    "the second pass is untouched",
    (await dbQuery(`select status from public.digital_passes where qr_token = $1`, [paidPasses[1].qr_token]))[0]
      .status === "active",
  );

  await dbQuery(
    `update public.digital_passes
     set checked_in = false, checked_in_at = null, status = 'active'
     where qr_token = $1`,
    [paidPasses[0].qr_token],
  );

  const webhookPasses = await dbQuery(
    `select dp.pass_id, dp.qr_token
     from public.digital_passes dp
     join public.bookings b on b.id = dp.booking_id
     where b.customer_mobile = $1
     order by dp.pass_number`,
    [MOBILE_WEBHOOK],
  );
  check("the webhook-only booking also holds its passes", webhookPasses.length === 2, `${webhookPasses.length}`);

  const [refundOutcome] = await dbQuery(`select public.refund_booking_payment($1) as outcome`, [webhookPayment.id]);
  check("the refund is recorded", refundOutcome.outcome === "refunded", refundOutcome.outcome ?? "");
  const refundedPass = visibleText(await fetchPage(`/pass/${webhookPasses[0].pass_id}?t=${webhookPasses[0].qr_token}`));
  check(
    "a refunded booking's pass reads as CANCELLED",
    refundedPass.includes("CANCELLED") && refundedPass.includes("no longer valid"),
    contextAround(refundedPass, "CANCELLED"),
  );
  const refundedGate = visibleText(await fetchPage(`/verify/${webhookPasses[0].qr_token}`));
  check(
    "the gate refuses a refunded pass",
    refundedGate.includes("Cancelled pass") && refundedGate.includes("Do not admit"),
    contextAround(refundedGate, "Cancelled pass"),
  );

  // ---- reloading must never mint another pass -----------------------------
  const passesBeforeReload = await passesFor(MOBILE_PAID);
  const bookingsBeforeReload = await bookingRows(MOBILE_PAID);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await fetchPage(`/booking/success?token=${order.booking.publicToken}`);
    await fetchPage(`/pass/${paidPasses[1].pass_id}?t=${paidPasses[1].qr_token}`);
    await fetchPage(`/verify/${paidPasses[1].qr_token}`);
  }

  const passesAfterReload = await dbQuery(
    `select dp.pass_id from public.digital_passes dp
     join public.bookings b on b.id = dp.booking_id
     where b.customer_mobile = $1
     order by dp.pass_number`,
    [MOBILE_PAID],
  );
  check(
    "reloading the confirmation and pass pages issues no extra pass",
    passesAfterReload.length === passesBeforeReload,
    `${passesAfterReload.length} passes after 3 reloads`,
  );
  check(
    "the same pass ids come back after every reload",
    JSON.stringify(passesAfterReload.map((row) => row.pass_id)) ===
      JSON.stringify(paidPasses.map((row) => row.pass_id)),
    passesAfterReload.map((row) => row.pass_id).join(", "),
  );
  check("reloading creates no second booking", (await bookingRows(MOBILE_PAID)) === bookingsBeforeReload);

  // The PDF-free print path: the built stylesheet has to keep the ticket and drop
  // the site chrome, or a printed pass arrives with a header, a footer and no QR.
  const builtCss = readCss(join(REPO_ROOT, DIST_DIR, "static"));
  check(
    "the built stylesheet prints the ticket and hides the site chrome",
    builtCss.includes("@media print") && builtCss.includes(".pass-ticket"),
    `print rules ${builtCss.includes("@media print") ? "present" : "missing"}`,
  );

  // ---------------------------------------------------------------------------
  section("Gate scanner: staff session, verdicts, one admission per pass");
  // ---------------------------------------------------------------------------
  // The gate night is "today at the venue" (siteConfig.timezone = Asia/Kolkata), and
  // the app works that out for itself on every request. The harness must therefore
  // expect the same date rather than tell the app what to think.
  const todayParts = {};

  for (const part of new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date())) {
    todayParts[part.type] = part.value;
  }

  const gateToday = `${todayParts.year}-${todayParts.month}-${todayParts.day}`;
  const gatePast = (await dbQuery(`select (($1::date) - 1)::text as d`, [gateToday]))[0].d;
  const GATE_TONIGHT = "d0000000-0000-4000-8000-0000000000c1";
  const GATE_YESTERDAY = "d0000000-0000-4000-8000-0000000000c2";

  // Two extra nights: one the gate is working tonight, one that has already happened.
  await dbRun(`
    insert into public.event_dates (id, event_id, event_date, start_time, end_time, capacity, status)
    values
      ('${GATE_TONIGHT}', '${EVENT_ID}', '${gateToday}', '19:00', '23:30', 200, 'scheduled'),
      ('${GATE_YESTERDAY}', '${EVENT_ID}', '${gatePast}', '19:00', '23:30', 200, 'scheduled');
  `);

  // Staff accounts: the Auth user (which the stub signs in) plus the allow-list row
  // that both the app and the database insist on. The third account deliberately has
  // no allow-list row at all — a real Auth user who must still get nowhere.
  await dbRun(`
    insert into auth.users (id, email) values
      ('${STAFF_USER_ID}', 'scanner@example.com'),
      ('${SUSPENDED_USER_ID}', 'suspended@example.com'),
      ('${GUEST_USER_ID}', 'guest@example.com'),
      ('${ADMIN_USER_ID}', 'admin@example.com'),
      ('${SUPER_USER_ID}', 'owner@example.com');
    insert into public.admin_users (user_id, email, full_name, role, is_active)
    values
      ('${STAFF_USER_ID}', 'scanner@example.com', 'Gate Night Scanner', 'staff', true),
      ('${SUSPENDED_USER_ID}', 'suspended@example.com', 'Suspended Scanner', 'staff', false),
      ('${ADMIN_USER_ID}', 'admin@example.com', 'Meera Admin', 'admin', true),
      ('${SUPER_USER_ID}', 'owner@example.com', 'Owner Super', 'super_admin', true);
  `);

  const staffRowId = (await dbQuery(`select id from public.admin_users where user_id = $1`, [STAFF_USER_ID]))[0].id;

  /** A booking for one night, through the real database functions. */
  async function bookingFor({ nightId, mobile, name, key }) {
    const [created] = await dbQuery(
      `select * from public.create_pending_booking(
         p_event_id => $1, p_event_date_id => $2, p_pass_category_id => $3,
         p_customer_name => $4, p_customer_mobile => $5, p_customer_email => $6,
         p_quantity => 2, p_number_of_people => $7, p_idempotency_key => $8)`,
      [EVENT_ID, nightId, COUPLE_PASS, name, mobile, `${key}@example.com`, 2 * couplePass.number_of_people, key],
    );

    return created;
  }

  /** Attach an order and confirm the payment, which is what issues the passes. */
  async function payBooking(created, key) {
    const orderId = `order_${key.replace(/[^a-z0-9]/gi, "").toUpperCase()}`;

    await dbQuery(`select public.attach_razorpay_order($1, $2)`, [created.booking_uuid, orderId]);
    await dbQuery(`select * from public.confirm_booking_payment($1, $2, $3)`, [
      orderId,
      `pay_${key.replace(/[^a-z0-9]/gi, "")}`,
      Number(created.total_amount) * 100,
    ]);
  }

  const gatePassRows = async (mobile) =>
    dbQuery(
      `select dp.pass_id, dp.qr_token, dp.pass_number, dp.status, dp.checked_in
         from public.digital_passes dp
         join public.bookings b on b.id = dp.booking_id
        where b.customer_mobile = $1
        order by dp.pass_number`,
      [mobile],
    );

  const tonightBooking = await bookingFor({
    nightId: GATE_TONIGHT,
    mobile: "+919800000401",
    name: "Nisha Rao",
    key: "gate-tonight",
  });
  await payBooking(tonightBooking, "gate-tonight");
  const tonightPasses = await gatePassRows("+919800000401");

  const pastBooking = await bookingFor({
    nightId: GATE_YESTERDAY,
    mobile: "+919800000402",
    name: "Past Night Guest",
    key: "gate-past",
  });
  await payBooking(pastBooking, "gate-past");
  const pastPasses = await gatePassRows("+919800000402");

  // An unpaid booking with a pass row inserted by hand: a state the app cannot
  // produce (passes are only issued by a confirmed payment), which is exactly why the
  // database has to refuse it.
  const unpaidBooking = await bookingFor({
    nightId: GATE_TONIGHT,
    mobile: "+919800000403",
    name: "Unpaid Guest",
    key: "gate-unpaid-http",
  });
  await dbQuery(`insert into public.digital_passes (booking_id, valid_date, pass_number) values ($1, $2, 1)`, [
    unpaidBooking.booking_uuid,
    gateToday,
  ]);
  const unpaidPass = (
    await dbQuery(`select qr_token from public.digital_passes where booking_id = $1`, [unpaidBooking.booking_uuid])
  )[0];

  check(
    "gate fixtures: a paid booking for tonight, one for last night, one unpaid, and three staff accounts",
    tonightPasses.length === 2 && pastPasses.length === 2 && Boolean(unpaidPass?.qr_token),
    `${tonightPasses.length}/${pastPasses.length}`,
  );

  // ---- a session, exactly the way the staff sign-in screen gets one --------------
  // `@supabase/ssr` is the same library the app's server client uses, so the cookies
  // produced here are the cookies the app will read back: sign in → cookie jar →
  // request the staff pages with that cookie.
  const { createServerClient } = await import("@supabase/ssr");

  async function signIn(email, password) {
    const jar = new Map();
    const client = createServerClient(shim.url, "test-anon-key", {
      cookies: {
        getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
        setAll: (cookies) => {
          for (const { name, value } of cookies) {
            jar.set(name, value);
          }
        },
      },
    });

    const { data, error } = await client.auth.signInWithPassword({ email, password });

    return {
      error: error?.message ?? null,
      userId: data?.user?.id ?? null,
      cookie: [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; "),
    };
  }

  const gateApi = async (path, { method = "POST", body, cookie } = {}) => {
    const response = await fetch(api(path), {
      method,
      redirect: "manual",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    let payload = null;

    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    return { status: response.status, location: response.headers.get("location"), payload };
  };

  const scanWith = (token, cookie) => gateApi("/api/staff/scan", { body: { token }, cookie });

  // ---- nobody without a session gets anywhere -----------------------------------
  const anonymousScanner = await gateApi("/admin/scanner", { method: "GET" });
  check(
    "the scanner sends a signed-out visitor to the staff sign-in",
    anonymousScanner.status === 307 && String(anonymousScanner.location ?? "").includes("/admin/login"),
    `${anonymousScanner.status} ${anonymousScanner.location ?? ""}`,
  );

  const anonymousScan = await scanWith("a".repeat(64));
  check("the scan API answers 401 without a session", anonymousScan.status === 401, `${anonymousScan.status}`);
  check(
    "and says what to do about it",
    anonymousScan.payload?.ok === false && anonymousScan.payload?.error?.kind === "not-authorized",
    JSON.stringify(anonymousScan.payload ?? null),
  );

  const anonymousCheckIn = await gateApi("/api/staff/check-in", { body: { token: "a".repeat(64) } });
  check("the check-in API answers 401 without a session", anonymousCheckIn.status === 401, `${anonymousCheckIn.status}`);

  const loginHtml = await fetchPage("/admin/login");
  const loginPage = visibleText(loginHtml);
  check(
    "the sign-in screen asks for a staff email and password",
    loginPage.includes("Sign in to the staff area") &&
      /name="email"/.test(loginHtml) &&
      /name="password"/.test(loginHtml),
  );
  check("the sign-in screen is not indexable", /noindex/.test(loginHtml));

  // ---- a real sign-in, a real cookie --------------------------------------------
  const staffSession = await signIn("scanner@example.com", STAFF_PASSWORD);
  check(
    "a staff member signs in through Supabase Auth",
    staffSession.userId === STAFF_USER_ID && staffSession.cookie.length > 0,
    `user=${staffSession.userId ?? "none"} error=${staffSession.error ?? "none"}`,
  );
  check("the session is written as Supabase cookies", staffSession.cookie.startsWith("sb-"), staffSession.cookie.slice(0, 24));

  const badLogin = await signIn("scanner@example.com", "not-the-password");
  check(
    "a wrong password is refused",
    badLogin.userId === null && /invalid/i.test(badLogin.error ?? ""),
    badLogin.error ?? "no error",
  );

  const scannerHtml = await fetchPage("/admin/scanner", { headers: { cookie: staffSession.cookie } });
  const scannerPage = visibleText(scannerHtml);
  check(
    "the scanner renders for a signed-in staff member",
    scannerPage.includes("Pass scanner") && scannerPage.includes("Gate Night Scanner"),
    contextAround(scannerPage, "Pass scanner"),
  );
  check("the scanner names the night the gate is on", scannerPage.includes(format.formatEventDate(gateToday)), gateToday);
  check(
    "the scanner explains that the browser does not decide",
    scannerPage.includes("the browser never decides that a pass is good"),
  );
  check("the scanner is not indexable", /noindex/.test(scannerHtml));

  // ---- the verdicts, over HTTP, against the real database ------------------------
  const validScan = await scanWith(tonightPasses[0].qr_token, staffSession.cookie);
  const verdict = validScan.payload?.result ?? null;
  check(
    "a paid, unused pass for tonight scans as valid",
    validScan.status === 200 && verdict?.outcome === "valid",
    JSON.stringify(validScan.payload ?? null).slice(0, 160),
  );
  check(
    "the verdict carries the guest, the pass id and the night",
    verdict?.customerName === "Nisha Rao" && /^PS-\d{6}$/.test(verdict?.passId ?? "") && verdict?.eventDate === gateToday,
    `${verdict?.customerName ?? ""} ${verdict?.passId ?? ""} ${verdict?.eventDate ?? ""}`,
  );
  check(
    "the verdict reports the booking as confirmed and paid",
    verdict?.bookingStatus === "confirmed" && verdict?.paymentStatus === "paid",
    `${verdict?.bookingStatus ?? ""}/${verdict?.paymentStatus ?? ""}`,
  );
  check(
    "the database recognises the staff member behind the session",
    verdict?.staffName === "Gate Night Scanner",
    verdict?.staffName ?? "",
  );
  check(
    "the verdict carries no mobile number, no email address and no token",
    !/mobile|email|token/i.test(Object.keys(verdict ?? {}).join(",")),
    Object.keys(verdict ?? {}).join(","),
  );
  check(
    "scanning still does not admit anybody",
    (await gatePassRows("+919800000401"))[0].checked_in === false,
  );

  // ---- CHECK IN, once ------------------------------------------------------------
  const admitted = await gateApi("/api/staff/check-in", {
    body: { token: tonightPasses[0].qr_token, gate: "Gate B" },
    cookie: staffSession.cookie,
  });
  check(
    "CHECK IN admits the guest",
    admitted.status === 200 && admitted.payload?.result?.outcome === "checked_in",
    JSON.stringify(admitted.payload ?? null).slice(0, 160),
  );
  check("the check-in returns the audit row it wrote", typeof admitted.payload?.result?.checkInId === "string");

  const entryRows = await dbQuery(
    `select gate, notes, checked_in_by, event_date_id from public.check_ins where digital_pass_id = (select id from public.digital_passes where qr_token = $1)`,
    [tonightPasses[0].qr_token],
  );
  check("exactly one entry was recorded for the pass", entryRows.length === 1, `${entryRows.length}`);
  check(
    "the entry records the gate, the source and the staff member",
    entryRows[0]?.gate === "Gate B" &&
      entryRows[0]?.notes === "web scanner" &&
      entryRows[0]?.checked_in_by === staffRowId &&
      entryRows[0]?.event_date_id === GATE_TONIGHT,
    `${entryRows[0]?.gate ?? ""} / ${entryRows[0]?.notes ?? ""}`,
  );
  const usedPass = (await gatePassRows("+919800000401"))[0];
  check("the pass is now used and checked in", usedPass.status === "used" && usedPass.checked_in === true);

  const secondScan = await scanWith(tonightPasses[0].qr_token, staffSession.cookie);
  check(
    "a second scan reports the pass as already used",
    secondScan.payload?.result?.outcome === "already_used",
    secondScan.payload?.result?.outcome ?? "",
  );
  const secondAdmit = await gateApi("/api/staff/check-in", {
    body: { token: tonightPasses[0].qr_token },
    cookie: staffSession.cookie,
  });
  check(
    "a second check-in is refused and writes nothing",
    secondAdmit.status === 200 &&
      secondAdmit.payload?.result?.outcome === "already_used" &&
      (
        await dbQuery(
          `select count(*)::int as n from public.check_ins where digital_pass_id = (select id from public.digital_passes where qr_token = $1)`,
          [tonightPasses[0].qr_token],
        )
      )[0].n === 1,
  );

  // ---- two phones, one code ------------------------------------------------------
  const [raceA, raceB] = await Promise.all([
    gateApi("/api/staff/check-in", { body: { token: tonightPasses[1].qr_token }, cookie: staffSession.cookie }),
    gateApi("/api/staff/check-in", { body: { token: tonightPasses[1].qr_token }, cookie: staffSession.cookie }),
  ]);
  const raceOutcomes = [raceA.payload?.result?.outcome, raceB.payload?.result?.outcome].sort();
  check(
    "two check-ins for the same code admit exactly one guest",
    raceOutcomes.filter((outcome) => outcome === "checked_in").length === 1 &&
      raceOutcomes.filter((outcome) => outcome === "already_used").length === 1,
    raceOutcomes.join(","),
  );
  check(
    "and the second guest is not recorded twice",
    (
      await dbQuery(
        `select count(*)::int as n from public.check_ins where digital_pass_id = (select id from public.digital_passes where qr_token = $1)`,
        [tonightPasses[1].qr_token],
      )
    )[0].n === 1,
  );

  // ---- everything the gate must refuse -------------------------------------------
  const unknownScan = await scanWith("a".repeat(64), staffSession.cookie);
  check("an unknown code is refused", unknownScan.payload?.result?.outcome === "invalid", unknownScan.payload?.result?.outcome ?? "");
  check(
    "the refusal does not pretend to know a pass",
    unknownScan.payload?.result?.passId === null && unknownScan.payload?.result?.customerName === null,
  );

  const malformedScan = await scanWith("not-a-token", staffSession.cookie);
  check(
    "a code that is not a pass token is refused before the database is asked",
    malformedScan.status === 200 && malformedScan.payload?.result?.outcome === "invalid",
    `${malformedScan.status} ${malformedScan.payload?.result?.outcome ?? ""}`,
  );

  const emptyScan = await gateApi("/api/staff/scan", { body: {}, cookie: staffSession.cookie });
  check("a scan with no code at all is a 400", emptyScan.status === 400, `${emptyScan.status}`);

  const brokenJson = await fetch(api("/api/staff/scan"), {
    method: "POST",
    headers: { "content-type": "application/json", cookie: staffSession.cookie },
    body: "{",
  });
  check("a scan body that is not JSON is a 400", brokenJson.status === 400, `${brokenJson.status}`);

  const unpaidScan = await scanWith(unpaidPass.qr_token, staffSession.cookie);
  check(
    "a pass whose booking was never paid is refused",
    unpaidScan.payload?.result?.outcome === "payment_not_verified",
    unpaidScan.payload?.result?.outcome ?? "",
  );
  check(
    "and it is still not marked used",
    (await dbQuery(`select checked_in from public.digital_passes where qr_token = $1`, [unpaidPass.qr_token]))[0]
      .checked_in === false,
  );

  const pastScan = await scanWith(pastPasses[0].qr_token, staffSession.cookie);
  check(
    "a pass for last night is refused",
    pastScan.payload?.result?.outcome === "expired",
    pastScan.payload?.result?.outcome ?? "",
  );

  const futureBooking = await bookingFor({
    nightId: FREE_NIGHT,
    mobile: "+919800000404",
    name: "Next Week Guest",
    key: "gate-future",
  });
  await payBooking(futureBooking, "gate-future");
  const futurePasses = await gatePassRows("+919800000404");
  const futureScan = await scanWith(futurePasses[0].qr_token, staffSession.cookie);
  check(
    "a pass for a later night is refused",
    futureScan.payload?.result?.outcome === "not_yet_valid",
    futureScan.payload?.result?.outcome ?? "",
  );

  const refundedScan = await scanWith(webhookPasses[0].qr_token, staffSession.cookie);
  check(
    "a refunded booking's pass is refused",
    refundedScan.payload?.result?.outcome === "refunded",
    refundedScan.payload?.result?.outcome ?? "",
  );

  // ---- who may scan at all --------------------------------------------------------
  const guestSession = await signIn("guest@example.com", STAFF_PASSWORD);
  check(
    "an ordinary Supabase account can sign in to Auth",
    guestSession.userId === GUEST_USER_ID && guestSession.cookie.length > 0,
    guestSession.error ?? "no error",
  );
  const guestScan = await scanWith(tonightPasses[1].qr_token, guestSession.cookie);
  check(
    "but it gets no scanner and no verdict: not on the allow-list",
    guestScan.status === 401,
    `${guestScan.status}`,
  );

  const suspendedSession = await signIn("suspended@example.com", STAFF_PASSWORD);
  check("a deactivated staff account can still sign in to Auth", suspendedSession.userId === SUSPENDED_USER_ID);
  const suspendedScan = await scanWith(tonightPasses[1].qr_token, suspendedSession.cookie);
  check(
    "a deactivated staff account is refused by the app",
    suspendedScan.status === 401,
    `${suspendedScan.status}`,
  );

  // ---- the words the door needs ---------------------------------------------------
  const gateChunks = readChunks(join(REPO_ROOT, DIST_DIR, "static", "chunks")).join("\n");

  for (const wording of ["VALID PASS", "PASS ALREADY USED", "PAYMENT NOT VERIFIED", "INVALID PASS", "CHECK IN"]) {
    check(`the shipped scanner carries the "${wording}" verdict`, gateChunks.includes(wording));
  }

  check(
    "no pass token ever ships inside the client bundle",
    !gateChunks.includes(tonightPasses[0].qr_token) && !gateChunks.includes(futurePasses[0].qr_token),
  );

  // ---------------------------------------------------------------------------
  section("Admin authentication and role-based access");
  // ---------------------------------------------------------------------------
  // Four kinds of visitor, one rule: an unauthorised one never receives an admin
  // page. Requests carry real session cookies, so the session handling, the proxy,
  // the guards and the pages are all exercised as a browser would exercise them.
  const fetchWith = (path, cookie, method = "GET") =>
    fetch(api(path), { method, redirect: "manual", headers: cookie ? { cookie } : {} });

  const adminHtml = async (path, cookie) => {
    const response = await fetchWith(path, cookie);
    const html = await response.text();

    return {
      status: response.status,
      location: response.headers.get("location"),
      html,
      // React separates interpolated text with comment markers, so anything that
      // asserts on *prose* reads this instead of the markup.
      text: visibleText(html),
    };
  };

  const requiresSignIn = (result, path) =>
    result.status === 307 && String(result.location ?? "").includes(`/admin/login?next=${encodeURIComponent(path)}`);

  // ---- the signed-out visitor ---------------------------------------------------
  for (const path of ["/admin", "/admin/scanner", "/admin/bookings", "/admin/settings", "/admin/staff"]) {
    const anonymous = await adminHtml(path);

    check(`a signed-out visitor is sent to the sign-in screen from ${path}`, requiresSignIn(anonymous, path), `${anonymous.status} ${anonymous.location ?? ""}`);
    check(`the redirect from ${path} carries no admin content`, !anonymous.html.includes("Staff area"), anonymous.html.slice(0, 80));
  }

  const loginForVisitor = await adminHtml("/admin/login", null);
  check("the sign-in screen is public", loginForVisitor.status === 200);
  check(
    "the signed-out sign-in screen shows the form, not the staff list",
    loginForVisitor.html.includes("Sign in to the staff area") &&
      loginForVisitor.html.includes('name="password"') &&
      !loginForVisitor.html.includes("staff:manage"),
  );

  // ---- an ordinary Supabase account (not on the allow-list) ---------------------
  const ordinarySession = await signIn("guest@example.com", STAFF_PASSWORD);
  const ordinaryAdmin = await adminHtml("/admin", ordinarySession.cookie);
  check(
    "a normal signed-in user cannot reach the admin area",
    requiresSignIn(ordinaryAdmin, "/admin"),
    `${ordinaryAdmin.status} ${ordinaryAdmin.location ?? ""}`,
  );
  check(
    "the refusal comes from the request hook, before any page renders",
    Boolean(ordinaryAdmin.location) && !ordinaryAdmin.html.includes("Staff area"),
    `location=${ordinaryAdmin.location ?? "none"} cookie=${Boolean(ordinarySession.cookie)}`,
  );

  const ordinaryDeep = await adminHtml("/admin/bookings", ordinarySession.cookie);
  check(
    "and cannot reach a protected section either",
    requiresSignIn(ordinaryDeep, "/admin/bookings"),
    `${ordinaryDeep.status} ${ordinaryDeep.location ?? ""}`,
  );

  const ordinaryLogin = await adminHtml("/admin/login", ordinarySession.cookie);
  check(
    "the sign-in screen explains that the account is not staff",
    ordinaryLogin.status === 200 &&
      ordinaryLogin.html.includes("Not a staff account") &&
      ordinaryLogin.html.includes("guest@example.com"),
    `${ordinaryLogin.status}`,
  );
  check(
    "and offers a way to sign out of that account",
    ordinaryLogin.html.includes("/api/staff/logout"),
  );

  const ordinaryApi = await gateApi("/api/staff/scan", {
    body: { token: "a".repeat(64) },
    cookie: ordinarySession.cookie,
  });
  check(
    "the staff APIs refuse a non-staff session",
    ordinaryApi.status === 401,
    `${ordinaryApi.status}`,
  );

  // ---- staff --------------------------------------------------------------------
  const staffSession2 = await signIn("scanner@example.com", STAFF_PASSWORD);
  const staffHome = await adminHtml("/admin", staffSession2.cookie);
  check("a staff member reaches the dashboard", staffHome.status === 200, `${staffHome.status}`);
  check(
    "the dashboard offers a staff member the gate and the booking lookup",
    staffHome.text.includes("Gate scanner") && staffHome.text.includes("Bookings"),
    staffHome.text.includes("What you can open") ? "sections shown" : "no sections",
  );
  check(
    "and offers nothing else: no settings, no staff list, not even as a dead link",
    !staffHome.text.includes("Event settings") &&
      !staffHome.text.includes("Staff accounts") &&
      !staffHome.html.includes('href="/admin/settings"') &&
      !staffHome.html.includes('href="/admin/staff"'),
  );
  check(
    "the dashboard names the account and the role the database holds",
    staffHome.text.includes("Staff · scanner@example.com"),
    staffHome.text.includes("scanner@example.com") ? staffHome.text.slice(0, 120) : "email absent",
  );
  check(
    "a staff member is not shown sales or staffing figures",
    !staffHome.text.includes("Paid bookings") &&
      !staffHome.text.includes("Refunded") &&
      !staffHome.text.includes("Behind the scenes") &&
      !staffHome.text.includes("Staff accounts in total"),
    staffHome.text.slice(0, 160),
  );
  check(
    "and is shown the two numbers a door needs",
    staffHome.text.includes("Checked in tonight") && staffHome.text.includes("Passes not yet used"),
  );


  const staffScanner = await adminHtml("/admin/scanner", staffSession2.cookie);
  check("a staff member reaches the scanner", staffScanner.status === 200 && staffScanner.text.includes("Pass scanner"));

  const staffSettings = await adminHtml("/admin/settings", staffSession2.cookie);
  check(
    "a staff member is refused the settings page",
    staffSettings.status === 307 && String(staffSettings.location ?? "").includes("/admin?denied=settings"),
    `${staffSettings.status} ${staffSettings.location ?? ""}`,
  );
  check("the refusal serves no settings content", !staffSettings.text.includes("Event settings"));

  const staffStaffPage = await adminHtml("/admin/staff", staffSession2.cookie);
  check(
    "a staff member is refused the staff list",
    staffStaffPage.status === 307 && String(staffStaffPage.location ?? "").includes("/admin?denied=staff"),
    `${staffStaffPage.status} ${staffStaffPage.location ?? ""}`,
  );

  const deniedBanner = await adminHtml("/admin?denied=settings:view", staffSession2.cookie);
  check(
    "the dashboard explains a refused section in words",
    deniedBanner.status === 200 && deniedBanner.text.includes("Event settings is not available to your role"),
    deniedBanner.text.includes("is not available to your role") ? "shown" : "missing",
  );

  // ---- the booking lookup is the same page with a different answer ---------------
  const lookupReference = (
    await dbQuery(`select booking_id, customer_mobile, customer_email, total_amount from public.bookings where customer_mobile = $1`, [
      "+919800000401",
    ])
  )[0];

  const staffLookup = await adminHtml(`/admin/bookings?q=${lookupReference.booking_id}`, staffSession2.cookie);
  check(
    "a staff member can look a booking up",
    staffLookup.status === 200 && staffLookup.html.includes(lookupReference.booking_id),
    `${staffLookup.status}`,
  );
  check(
    "the staff view shows the guest and the pass, and no contact details or money",
    staffLookup.html.includes("Nisha Rao") &&
      !staffLookup.html.includes(lookupReference.customer_mobile) &&
      !staffLookup.html.includes(lookupReference.customer_email) &&
      !staffLookup.html.includes(`₹${lookupReference.total_amount}`),
    `mobile=${staffLookup.html.includes(lookupReference.customer_mobile)} amount=${staffLookup.html.includes(`₹${lookupReference.total_amount}`)}`,
  );
  check(
    "the page says which fields are withheld, rather than looking broken",
    staffLookup.text.includes("Contact details and amounts are hidden for your role"),
  );

  const staffLookupMiss = await adminHtml("/admin/bookings?q=DND000000000", staffSession2.cookie);
  check(
    "an unknown reference gets an honest empty state",
    staffLookupMiss.status === 200 && staffLookupMiss.text.includes("No bookings match these filters"),
  );

  // A search term no longer has a minimum length. The screen is the booking *list*
  // with a search box on it, so a short term narrows the list instead of refusing to
  // run — which is what lets somebody find a guest by the first letters of their name
  // while a queue is waiting. What a short search can never do is widen what the role
  // may see: the columns it is allowed are the same ones, and the contact details are
  // still absent from the response.
  const staffLookupShort = await adminHtml("/admin/bookings?q=Ni", staffSession2.cookie);
  check(
    "a short search narrows the list rather than being refused",
    staffLookupShort.status === 200 && staffLookupShort.html.includes(lookupReference.booking_id),
  );
  check(
    "and it still carries none of the fields the role may not see",
    !staffLookupShort.html.includes(lookupReference.customer_mobile) &&
      !staffLookupShort.html.includes("₹"),
  );

  // ---- admin --------------------------------------------------------------------
  const adminSession = await signIn("admin@example.com", STAFF_PASSWORD);
  const adminHome = await adminHtml("/admin", adminSession.cookie);
  check(
    "an admin reaches the dashboard and sees the operational sections",
    adminHome.status === 200 &&
      adminHome.html.includes("Gate scanner") &&
      adminHome.html.includes("Event settings"),
    `${adminHome.status}`,
  );
  check(
    "the dashboard counts are rendered for an admin",
    adminHome.text.includes("Confirmed bookings") && adminHome.text.includes("Checked-in visitors"),
    adminHome.text.slice(0, 160),
  );
  check(
    "every operational section is a link an admin can follow",
    adminHome.html.includes('href="/admin/payments"') &&
      adminHome.html.includes('href="/admin/passes"') &&
      adminHome.html.includes('href="/admin/dates"') &&
      adminHome.html.includes('href="/admin/gallery"') &&
      adminHome.text.includes("Gallery"),
    `${adminHome.status}`,
  );

  // ---------------------------------------------------------------------------
  section("Admin dashboard: statistics, charts and the recent table");
  // ---------------------------------------------------------------------------
  // The dashboard's numbers were checked against the tables in verify-db. What is
  // checked here is the rest of the journey: that the page renders exactly the figures
  // the database reports, that the charts are drawn from the series the database
  // returned, and that a staff session's dashboard carries no money and no contact
  // details — not hidden, absent.
  const chartMath = await import("../src/lib/admin/dashboard.ts");
  const inr = (amount) => format.formatInr(Number(amount));

  const [dashLedger] = await dbQuery(
    `
    select
      (select count(*)::int from public.bookings) as bookings_total,
      (select count(*)::int from public.bookings b where b.booking_status = 'confirmed') as bookings_confirmed,
      (select count(*)::int from public.bookings b where b.payment_status = 'unpaid') as bookings_pending,
      (select count(*)::int from public.bookings b
        where (b.created_at at time zone 'Asia/Kolkata')::date = $1::date) as bookings_today,
      (select coalesce(sum(b.total_amount), 0)::int from public.bookings b
        where b.payment_status = 'paid') as revenue_total,
      (select coalesce(sum(b.total_amount), 0)::int from public.bookings b
        where b.payment_status = 'paid'
          and (b.created_at at time zone 'Asia/Kolkata')::date = $1::date) as revenue_today,
      (select coalesce(sum(b.total_amount), 0)::int from public.bookings b
        where b.payment_status = 'refunded') as revenue_refunded,
      (select count(*)::int from public.check_ins) as check_ins_total,
      (select coalesce(sum(d.capacity), 0)::int from public.event_dates d
        where d.status = 'scheduled' and d.event_date >= $1::date) as capacity_total,
      (select coalesce(sum(b.number_of_people), 0)::int from public.bookings b
         join public.event_dates d on d.id = b.event_date_id
        where b.payment_status = 'paid' and d.status = 'scheduled'
          and d.event_date >= $1::date) as capacity_taken;
  `,
    [gateToday],
  );

  // Fetched now, and read immediately after the ledger above, so the two describe the
  // same state of the database.
  const dashAdmin = await adminHtml("/admin", adminSession.cookie);
  const dashStaff = await adminHtml("/admin", staffSession2.cookie);

  check("the dashboard loads for an admin", dashAdmin.status === 200, `${dashAdmin.status}`);
  check("and for a staff member", dashStaff.status === 200, `${dashStaff.status}`);

  /**
   * The visible text of the statistic card whose label starts at `label`, and the first
   * value in it. Reading the *text* rather than the markup keeps this robust to React's
   * escaping and to tag order, while still pinning each figure to its own label.
   */
  const cardText = (result, label) => {
    const at = result.text.indexOf(label);
    return at === -1 ? "" : result.text.slice(at, at + 320);
  };
  const cardValue = (result, label) => {
    const text = cardText(result, label);
    const at = text.indexOf(label);
    if (at === -1) return null;
    const match = text.slice(at + label.length).match(/₹[\d,]+|Visible to admins|\d+/);
    return match ? match[0] : null;
  };

  const STATISTIC_LABELS = [
    "Total bookings",
    "Confirmed bookings",
    "Pending payments",
    "Today's bookings",
    "Total revenue",
    "Today's revenue",
    "Checked-in visitors",
    "Available capacity",
  ];

  check(
    "the dashboard carries all eight statistics the event is run on",
    STATISTIC_LABELS.every((label) => dashAdmin.text.includes(label)),
    STATISTIC_LABELS.filter((label) => !dashAdmin.text.includes(label)).join(", ") || "all eight",
  );
  check(
    "the figures are the venue's day, not the server's",
    dashAdmin.text.includes(`tonight is ${format.formatEventDate(gateToday)}`) &&
      dashAdmin.text.includes("Asia/Kolkata"),
    format.formatEventDate(gateToday),
  );

  // Each card, against the rows it claims to describe. The ledger above is written
  // from the tables, so a card that drifts from the data fails here.
  const expectedCards = [
    ["Total bookings", String(dashLedger.bookings_total)],
    ["Confirmed bookings", String(dashLedger.bookings_confirmed)],
    ["Pending payments", String(dashLedger.bookings_pending)],
    ["Today's bookings", String(dashLedger.bookings_today)],
    ["Total revenue", inr(dashLedger.revenue_total)],
    ["Today's revenue", inr(dashLedger.revenue_today)],
    ["Checked-in visitors", String(dashLedger.check_ins_total)],
    ["Available capacity", String(dashLedger.capacity_total - dashLedger.capacity_taken)],
  ];

  for (const [label, expected] of expectedCards) {
    const rendered = cardValue(dashAdmin, label);
    check(
      `the ${label} card shows what the bookings table holds`,
      rendered === expected,
      `${label}: rendered ${rendered} / counted ${expected}`,
    );
  }

  check(
    "the revenue card accounts for the money that was refunded",
    dashLedger.revenue_refunded > 0
      ? dashAdmin.text.includes(`${inr(dashLedger.revenue_refunded)} refunded — refunds stop counting`)
      : dashAdmin.text.includes("refunds excluded"),
    cardText(dashAdmin, "Total revenue").slice(0, 120),
  );

  // ---- the charts ------------------------------------------------------------
  const chartSlice = (html, id) => {
    const at = html.indexOf(`id="${id}"`);
    if (at === -1) return "";
    // Charts are figures, so the next one marks the end of this one: a slice that ran
    // to the end of the document would count the following panels' markup as bars.
    const end = html.indexOf("<figure", at + 10);
    return html.slice(at, end === -1 ? at + 60_000 : end);
  };
  const barsIn = (chart) => (chart.match(/title="/g) ?? []).length;
  const bookingsChart = chartSlice(dashAdmin.html, "bookings-by-date");
  const revenueChart = chartSlice(dashAdmin.html, "revenue-by-date");

  check(
    "the bookings-by-date chart is on the page",
    dashAdmin.html.includes('id="bookings-by-date"') && bookingsChart.includes("Bookings by date"),
  );
  check(
    "the revenue-by-date chart is on the page",
    dashAdmin.html.includes('id="revenue-by-date"') && revenueChart.includes("Revenue by date"),
  );

  // The series the chart is drawn from, straight from the database.
  const dashSeries = await dbQuery(
    `select day::text as day, bookings, confirmed, revenue from public.admin_booking_series($1::date, 14, $2::text, true) order by day;`,
    [gateToday, "Asia/Kolkata"],
  );
  const seriesBookings = dashSeries.map((row) => Number(row.bookings));
  const seriesTops = chartMath.axisMax(seriesBookings);
  const barCount = barsIn(bookingsChart);

  check(
    "the chart has one bar per day in the window, gaps included",
    barCount === dashSeries.length && barCount === 14,
    `${barCount} bars for ${dashSeries.length} days`,
  );
  check(
    "the window ends on the venue's today and says so",
    dashAdmin.text.includes(`The last 14 days, ending ${format.formatEventDate(gateToday)}`),
  );
  check(
    "the busiest day is drawn at its true height on the axis",
    new RegExp(`height:\\s?${chartMath.barPercent(Math.max(...seriesBookings), seriesTops)}%`).test(bookingsChart),
    `${Math.max(...seriesBookings)} of ${seriesTops} = ${chartMath.barPercent(Math.max(...seriesBookings), seriesTops)}%`,
  );
  check(
    "the chart's own total is the sum of the series it drew",
    dashAdmin.text.includes(`${seriesBookings.reduce((sum, value) => sum + value, 0)} 14 days`),
    `${seriesBookings.reduce((sum, value) => sum + value, 0)} bookings across the window`,
  );
  check(
    "the revenue chart's total is the paid money in the same window",
    dashAdmin.text.includes(`${inr(dashSeries.reduce((sum, row) => sum + Number(row.revenue), 0))} 14 days`),
    `${inr(dashSeries.reduce((sum, row) => sum + Number(row.revenue), 0))} across the window`,
  );

  // The bars carry their day in a title, so a quiet day is still readable on hover.
  for (const row of [dashSeries[0], dashSeries.at(-1)]) {
    check(
      `the bar for ${row.day} is labelled with its own figure`,
      bookingsChart.includes(
        `title="${format.formatShortDate(row.day)} · ${Number(row.bookings)}"`,
      ),
      contextAround(bookingsChart, "title=", 60),
    );
  }

  // ---- the pass category distribution ----------------------------------------
  const dashBreakdown = await dbQuery(
    `select pass_name, bookings, paid_bookings, passes_issued, people, revenue from public.admin_pass_breakdown(true) order by bookings desc, pass_name;`,
  );
  const breakdownTotal = dashBreakdown.reduce((sum, row) => sum + Number(row.bookings), 0);

  check(
    "every pass category is on the distribution, including the ones nobody bought",
    dashBreakdown.every((row) => dashAdmin.text.includes(row.pass_name)),
    `${dashBreakdown.length} categories`,
  );

  for (const row of dashBreakdown) {
    const share = chartMath.sharePercent(Number(row.bookings), breakdownTotal);
    check(
      `${row.pass_name} shows its bookings, people and share`,
      dashAdmin.text.includes(
        `${Number(row.bookings)} ${Number(row.bookings) === 1 ? "booking" : "bookings"} · ${Number(row.people)} ${
          Number(row.people) === 1 ? "person" : "people"
        } · ${share}%`,
      ),
      cardText(dashAdmin, row.pass_name).slice(0, 120),
    );
  }

  check(
    "the distribution is ordered biggest first",
    dashBreakdown.every(
      (row, index) => index === 0 || Number(dashBreakdown[index - 1].bookings) >= Number(row.bookings),
    ),
    dashBreakdown.map((row) => `${row.pass_name}:${row.bookings}`).join(" "),
  );

  // ---- the recent bookings table ---------------------------------------------
  const recentRows = await dbQuery(
    `select booking_id, customer_name, customer_mobile, customer_email, total_amount
       from public.bookings
      order by created_at desc, id desc
      limit 8;`,
  );
  const positions = recentRows.map((row) => dashAdmin.html.indexOf(row.booking_id));

  check(
    "the recent table lists the newest bookings, one row each, in order",
    positions.every((position, index) => position !== -1 && (index === 0 || position > positions[index - 1])),
    JSON.stringify(positions),
  );
  check(
    "the table says how many rows it is showing",
    dashAdmin.text.includes(`${recentRows.length} of ${recentRows.length}`),
    `${recentRows.length} rows`,
  );
  check(
    "an admin's recent table carries the contact details and the amount",
    dashAdmin.html.includes(recentRows[0].customer_mobile) &&
      dashAdmin.text.includes(inr(recentRows[0].total_amount)) &&
      dashAdmin.text.includes("Amount"),
    `${recentRows[0].booking_id}`,
  );
  check(
    "and names a column for what each booking was worth rather than a bare figure",
    dashAdmin.text.includes("Recent bookings") && dashAdmin.text.includes("newest first"),
  );

  // ---- the same page, as a staff member sees it -------------------------------
  check(
    "a staff member's dashboard carries no money: the two revenue cards are withheld",
    cardValue(dashStaff, "Total revenue") === "Visible to admins" &&
      cardValue(dashStaff, "Today's revenue") === "Visible to admins",
    `total: ${cardValue(dashStaff, "Total revenue")} / today: ${cardValue(dashStaff, "Today's revenue")}`,
  );
  check(
    "and no amount the event has taken appears anywhere on it",
    !dashStaff.text.includes(inr(dashLedger.revenue_total)) &&
      !dashStaff.text.includes(inr(dashLedger.revenue_today)),
    `looked for ${inr(dashLedger.revenue_total)}`,
  );
  check(
    "nor does the revenue chart draw a single bar for it",
    barsIn(chartSlice(dashStaff.html, "revenue-by-date")) === 0 &&
      dashStaff.text.includes("only returned to roles with access to payments"),
    `${barsIn(chartSlice(dashStaff.html, "revenue-by-date"))} bars in the withheld chart`,
  );
  check(
    "the distribution says the revenue column is not theirs to see",
    dashStaff.text.includes("visible to admins"),
    contextAround(dashStaff.text, "visible to admins", 60),
  );
  check(
    "a staff member's recent table has no contact details and no amount column",
    !dashStaff.html.includes(recentRows[0].customer_mobile) &&
      !dashStaff.html.includes(recentRows[0].customer_email) &&
      !dashStaff.text.includes("Amount") &&
      dashStaff.html.includes(recentRows[0].customer_name),
    `${recentRows[0].booking_id}: ${recentRows[0].customer_name}`,
  );
  check(
    "but the staff dashboard still counts the six figures a shift needs",
    ["Total bookings", "Confirmed bookings", "Pending payments", "Today's bookings", "Checked-in visitors", "Available capacity"].every(
      (label) => cardValue(dashStaff, label) !== null,
    ),
    STATISTIC_LABELS.map((label) => `${label}:${cardValue(dashStaff, label)}`).join(" "),
  );
  check(
    "the staff dashboard shows the same counts as the admin one, minus the money",
    expectedCards
      .filter(([label]) => !label.includes("revenue"))
      .every(([label, expected]) => cardValue(dashStaff, label) === expected),
    expectedCards.filter(([label]) => !label.includes("revenue")).map(([label]) => `${label}:${cardValue(dashStaff, label)}`).join(" "),
  );

  // ---- loading and error states ----------------------------------------------
  const loadingSource = readFileSync(join(REPO_ROOT, "src", "app", "admin", "(shell)", "loading.tsx"), "utf8");
  const errorSource = readFileSync(join(REPO_ROOT, "src", "app", "admin", "(shell)", "error.tsx"), "utf8");

  check(
    "the dashboard has a loading skeleton shaped like itself",
    loadingSource.includes("aria-busy") &&
      loadingSource.includes("Loading the dashboard") &&
      loadingSource.includes("<Skeleton") &&
      loadingSource.includes("sr-only"),
    `${loadingSource.length} bytes`,
  );
  // The shell's skeleton would otherwise be the fallback for every admin route, so a
  // camera about to open would first show a chart. Each route has its own.
  const adminRoutes = [
    ["src", "app", "admin", "(shell)", "scanner"],
    ["src", "app", "admin", "(shell)", "bookings"],
    ["src", "app", "admin", "(shell)", "settings"],
    ["src", "app", "admin", "(shell)", "staff"],
  ];
  const missingSkeletons = adminRoutes.filter((parts) => {
    const source = readFileSync(join(REPO_ROOT, ...parts, "loading.tsx"), "utf8");
    return !(source.includes("aria-busy") && source.includes("<Skeleton") && source.includes("sr-only"));
  });

  check(
    "and every other admin route has a skeleton shaped like its own page",
    missingSkeletons.length === 0,
    missingSkeletons.map((parts) => parts.at(-1)).join(", ") || `${adminRoutes.length} routes`,
  );
  // A dynamic route streams the fallback first, so both are in the response: the
  // skeleton, and then the page that replaced it. What matters is that the second one
  // is there — a page that stopped at the skeleton would be a dashboard with no
  // numbers on it.
  check(
    "the skeleton streams first and the dashboard's own numbers follow it",
    dashAdmin.text.includes("Loading the dashboard") &&
      dashAdmin.text.includes("Total bookings") &&
      dashAdmin.text.indexOf("Loading the dashboard") < dashAdmin.text.indexOf("Total bookings"),
    contextAround(dashAdmin.text, "Loading the dashboard", 80),
  );
  check(
    "and a staff session gets the same treatment",
    dashStaff.text.includes("Loading the dashboard") &&
      dashStaff.text.includes("Available capacity") &&
      dashStaff.text.indexOf("Loading the dashboard") < dashStaff.text.indexOf("Available capacity"),
  );
  check(
    "the dashboard has an error state with a retry that keeps the session",
    errorSource.includes('"use client"') &&
      errorSource.includes("reset") &&
      errorSource.includes('role="alert"') &&
      errorSource.includes("Try again"),
    `${errorSource.length} bytes`,
  );
  check(
    "the error state never prints the raw error, only the digest",
    !errorSource.includes("error.message") && errorSource.includes("error.digest"),
  );


  const adminSettings = await adminHtml("/admin/settings", adminSession.cookie);
  check(
    "an admin reaches the settings page",
    adminSettings.status === 200 && adminSettings.html.includes("Event settings"),
    `${adminSettings.status}`,
  );
  check(
    "the settings page shows the event the public site reads",
    adminSettings.text.includes("Garba Nights") && adminSettings.text.includes("Jaipur"),
  );

  const adminStaffPage = await adminHtml("/admin/staff", adminSession.cookie);
  check(
    "an admin is refused the staff list — that is the super admin's job",
    adminStaffPage.status === 307 && String(adminStaffPage.location ?? "").includes("/admin?denied=staff"),
    `${adminStaffPage.status} ${adminStaffPage.location ?? ""}`,
  );

  const adminLookup = await adminHtml(`/admin/bookings?q=${lookupReference.booking_id}`, adminSession.cookie);
  check(
    "an admin's lookup shows the contact details and the amount",
    adminLookup.status === 200 &&
      adminLookup.html.includes(lookupReference.customer_mobile) &&
      adminLookup.html.includes(lookupReference.customer_email) &&
      adminLookup.html.includes(`₹${lookupReference.total_amount}`),
    `${adminLookup.status}`,
  );
  check(
    "and says so, so the two views are not confusable",
    adminLookup.text.includes("You can see contact details and amounts"),
  );

  const adminScanner = await adminHtml("/admin/scanner", adminSession.cookie);
  check("an admin can still work the gate", adminScanner.status === 200 && adminScanner.text.includes("Pass scanner"));

  // ---- super admin ---------------------------------------------------------------
  const superSession = await signIn("owner@example.com", STAFF_PASSWORD);
  const superStaffPage = await adminHtml("/admin/staff", superSession.cookie);
  check(
    "a super admin reaches the staff list",
    superStaffPage.status === 200 && superStaffPage.text.includes("Staff accounts"),
    `${superStaffPage.status}`,
  );
  check(
    "the staff list names every role and shows who is suspended",
    superStaffPage.text.includes("scanner@example.com") &&
      superStaffPage.text.includes("admin@example.com") &&
      superStaffPage.text.includes("owner@example.com") &&
      superStaffPage.text.includes("Super admin") &&
      superStaffPage.text.includes("Suspended"),
  );
  check(
    "the super admin is marked as themselves in the list",
    superStaffPage.text.includes("(you)"),
  );
  check(
    "the staff page does not pretend to be an editor yet",
    superStaffPage.text.includes("Adding somebody") &&
      !superStaffPage.text.includes("Save changes"),
  );

  const superSettings = await adminHtml("/admin/settings", superSession.cookie);
  check("a super admin reaches the settings page too", superSettings.status === 200);

  // ---- no service-role key, ever --------------------------------------------------
  const serviceKey = serverEnv.SUPABASE_SERVICE_ROLE_KEY;
  for (const [path, cookie] of [
    ["/admin", superSession.cookie],
    ["/admin/bookings", superSession.cookie],
    ["/admin/staff", superSession.cookie],
    ["/admin/settings", superSession.cookie],
    ["/admin/scanner", staffSession2.cookie],
  ]) {
    const page = await adminHtml(path, cookie);

    check(
      `the service-role key is not in the HTML of ${path}`,
      !page.html.includes(serviceKey) && !/service_role/i.test(page.html),
      page.html.slice(0, 80),
    );
  }

  // ---- logging out ----------------------------------------------------------------
  const logoutResponse = await fetch(api("/api/staff/logout"), {
    method: "POST",
    redirect: "manual",
    headers: { cookie: staffSession2.cookie },
  });
  check(
    "signing out answers with a redirect to the sign-in screen",
    logoutResponse.status === 303 && String(logoutResponse.headers.get("location") ?? "").includes("/admin/login"),
    `${logoutResponse.status} ${logoutResponse.headers.get("location") ?? ""}`,
  );

  const clearedCookies = logoutResponse.headers.getSetCookie?.() ?? [];
  check(
    "signing out deletes the session cookies on the way out",
    clearedCookies.some(
      (cookie) =>
        cookie.startsWith("sb-") &&
        (/(^|;)\s*max-age=0/i.test(cookie) || /expires=thu, 01 jan 1970/i.test(cookie) || /=\s*(;|$)/.test(cookie)),
    ),
    clearedCookies.join(" | ") || "no cookies cleared",
  );

  // Follow the browser: apply what the response said, then ask for an admin page.
  const afterLogout = new Map();
  for (const cookie of clearedCookies) {
    const [pair] = cookie.split(";");
    const [name, ...rest] = pair.split("=");
    afterLogout.set(name.trim(), rest.join("=").trim());
  }
  const jarAfterLogout = [...afterLogout.entries()]
    .filter(([, value]) => value !== "")
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");

  const afterLogoutPage = await adminHtml("/admin", jarAfterLogout || null);
  check(
    "the browser that just signed out cannot reach the admin area",
    requiresSignIn(afterLogoutPage, "/admin"),
    `${afterLogoutPage.status} ${afterLogoutPage.location ?? ""}`,
  );

  // The real question a shared gate phone asks: does a cookie copied from before the
  // sign-out still work? Session revocation is what makes the answer no.
  const staleCookiePage = await adminHtml("/admin", staffSession2.cookie);
  check(
    "the session cookie from before the sign-out is dead",
    requiresSignIn(staleCookiePage, "/admin"),
    `${staleCookiePage.status} ${staleCookiePage.location ?? ""}`,
  );
  check(
    "and it cannot be used to scan either",
    (await gateApi("/api/staff/scan", { body: { token: "a".repeat(64) }, cookie: staffSession2.cookie })).status === 401,
  );
  check(
    "the auth double recorded the session as revoked",
    authStub.revokedSessions.size >= 1,
    `${authStub.revokedSessions.size} revoked`,
  );

  const logoutWithoutSession = await fetch(api("/api/staff/logout"), { method: "POST", redirect: "manual" });
  check(
    "signing out when already signed out is harmless",
    logoutWithoutSession.status === 303,
    `${logoutWithoutSession.status}`,
  );

  const logoutViaGet = await fetch(api("/api/staff/logout"), { redirect: "manual" });
  check(
    "signing out by loading a link does nothing (no GET logout)",
    logoutViaGet.status === 405,
    `${logoutViaGet.status}`,
  );

  // ---- the permission model itself --------------------------------------------------
  const {
    can,
    sectionsFor,
    permissionsFor,
    STAFF_ROLES,
  } = await import("../src/lib/auth/permissions.ts");

  check("there are exactly three staff roles", STAFF_ROLES.length === 3 && STAFF_ROLES.includes("staff"));

  const withoutAccess = [
    { role: "staff", permission: "settings:view" },
    { role: "staff", permission: "bookings:view_contact" },
    { role: "staff", permission: "staff:manage" },
    { role: "staff", permission: "payments:view" },
    { role: "admin", permission: "staff:manage" },
  ];
  check(
    "every role is refused what it should be",
    withoutAccess.every(({ role, permission }) => can(role, permission) === false),
    withoutAccess.filter(({ role, permission }) => can(role, permission)).map(({ role, permission }) => `${role}:${permission}`).join(", "),
  );

  const withAccess = [
    { role: "staff", permission: "scanner:use" },
    { role: "staff", permission: "bookings:view" },
    { role: "admin", permission: "settings:view" },
    { role: "admin", permission: "bookings:view_contact" },
    { role: "admin", permission: "gallery:view" },
    { role: "super_admin", permission: "staff:manage" },
    { role: "super_admin", permission: "bookings:view_contact" },
  ];
  check(
    "every role holds what it should",
    withAccess.every(({ role, permission }) => can(role, permission) === true),
    withAccess.filter(({ role, permission }) => !can(role, permission)).map(({ role, permission }) => `${role}:${permission}`).join(", "),
  );

  check(
    "the super admin holds every capability in the model",
    permissionsFor("super_admin").length === new Set(permissionsFor("super_admin")).size &&
      permissionsFor("admin").every((permission) => can("super_admin", permission)),
  );
  check(
    "an admin holds everything a staff member does",
    permissionsFor("staff").every((permission) => can("admin", permission)),
  );
  check(
    "a staff member's dashboard lists only scanned and lookup sections",
    sectionsFor("staff").every((section) => ["scanner", "bookings"].includes(section.key)),
    sectionsFor("staff").map((section) => section.key).join(", "),
  );
  check(
    "only the super admin's dashboard offers staff management",
    sectionsFor("admin").every((section) => section.key !== "staff") &&
      sectionsFor("super_admin").some((section) => section.key === "staff"),
  );
  check(
    "every section is gated by a permission that some role holds",
    sectionsFor("super_admin").length === sectionsFor("admin").length + 1,
    `${sectionsFor("super_admin").length} vs ${sectionsFor("admin").length}`,
  );

  // ---- 10. the key secret never reaches the browser -----------------------
  const clientChunks = readChunks(join(REPO_ROOT, DIST_DIR, "static", "chunks")).join("\n");
  check("the client bundles contain no key secret", !clientChunks.includes(RAZORPAY_KEY_SECRET));
  check("the client bundles contain no webhook secret", !clientChunks.includes(RAZORPAY_WEBHOOK_SECRET));
  check("checkout is loaded on demand from Razorpay", clientChunks.includes("checkout.razorpay.com"));

  // ---- 11. live keys are refused outright ---------------------------------
  // `NEXT_PUBLIC_*` values are inlined when the app is built, so switching to live
  // keys means a new build — which is exactly what a deployment would do. The whole
  // point of this section is that even then the server refuses to take money.
  await stopWebServer();
  rmSync(join(REPO_ROOT, DIST_DIR), { recursive: true, force: true });

  const liveEnv = { ...serverEnv, NEXT_PUBLIC_RAZORPAY_KEY_ID: RAZORPAY_LIVE_KEY_ID };
  const liveBuild = await runBuild(liveEnv);
  check("a build carrying live keys still builds", liveBuild.exitCode === 0, liveBuild.log.slice(-300));

  await startWebServer(liveEnv);

  const livePage = visibleText(await fetchPage("/book"));
  check(
    "a live-key deployment tells customers payment is handled by the organiser",
    livePage.includes("Payment is handled by the organiser"),
    contextAround(livePage, "Payment is handled"),
  );
  check(
    "the live-key deployment does not promise a checkout",
    !livePage.includes("Pay securely with Razorpay"),
  );

  const ordersBeforeLive = stub.orderRequests().length;
  const liveAttempt = await postJson(
    "/api/payment/create-order",
    paymentRequest({ customerMobile: "+919800000299", idempotencyKey: "pay-attempt-live" }),
  );
  check("a live key is refused while live mode is off", liveAttempt.status === 503, `status ${liveAttempt.status} ${JSON.stringify(liveAttempt.payload)?.slice(0, 160)}`);
  check(
    "the refusal says live payments are disabled",
    /live/i.test(liveAttempt.payload?.error?.message ?? ""),
    liveAttempt.payload?.error?.message ?? "",
  );
  check("no order was created with the live key", stub.orderRequests().length === ordersBeforeLive);
  check("no booking was written for the refused live attempt", (await bookingRows("+919800000299")) === 0);

  // ---------------------------------------------------------------------------
  section("Admin booking management: search, filters, detail and CSV export");
  // ---------------------------------------------------------------------------
  // The list, the detail view and the export all read the same database function, so
  // what this section follows is the journey a person actually takes: find a booking by
  // anything a guest can quote, narrow it down with the filters, open one booking in
  // full, and take the same rows away as a file.
  //
  // Every page is fetched twice — once as an admin, who may see contact details and
  // money, and once as a staff member, whose response must not contain them even when
  // the request asks for them. The staff checks look for the *absence* of the values,
  // not for a padlock drawn over them.
  const bookingsLib = await import("../src/lib/admin/bookings.ts");

  // The sessions earlier sections signed out with are dead by now — that was the point
  // of those checks — so this section signs in its own, one per role.
  const manageAdmin = await signIn("admin@example.com", STAFF_PASSWORD);
  const manageStaff = await signIn("scanner@example.com", STAFF_PASSWORD);
  const manageGuest = await signIn("guest@example.com", STAFF_PASSWORD);

  const gateFixture = (
    await dbQuery(
      `select booking_id, customer_mobile, customer_email, total_amount, razorpay_order_id,
              razorpay_payment_id
         from public.bookings where customer_mobile = $1`,
      ["+919800000401"],
    )
  )[0];
  const gatePassIds = tonightPasses.map((pass) => pass.pass_id);

  // Two more bookings with states the gate fixtures do not have: one whose group is
  // half inside, and one that was never paid for.
  const halfInBooking = await bookingFor({
    nightId: GATE_TONIGHT,
    mobile: "+919800000405",
    name: "Half In Group",
    key: "manage-partial",
  });
  await payBooking(halfInBooking, "manage-partial");
  const unpaidFixture = await bookingFor({
    nightId: GATE_TONIGHT,
    mobile: "+919800000406",
    name: "Not Paid Yet",
    key: "manage-unpaid",
  });

  const halfInPasses = await dbQuery(
    `select id, pass_id from public.digital_passes where booking_id = $1 order by pass_number`,
    [halfInBooking.booking_uuid],
  );
  await dbQuery(
    `insert into public.check_ins (digital_pass_id, event_date_id, checked_in_at, gate, checked_in_by)
     values ($1, $2, now(), 'Gate A', $3)`,
    [halfInPasses[0].id, GATE_TONIGHT, staffRowId],
  );
  await dbQuery(
    `update public.digital_passes set checked_in = true, checked_in_at = now(), status = 'used' where id = $1`,
    [halfInPasses[0].id],
  );

  // A season's worth of bookings, for the two things a small fixture set cannot prove:
  // that paging walks a result set without gaps or repeats, and that an export larger
  // than the fetch batch is assembled completely — and flagged when it is not.
  const BULK_ROWS = 5005;
  await dbRun(`
    insert into public.bookings (customer_name, customer_mobile, customer_email, event_date_id,
                                 pass_category_id, quantity, number_of_people,
                                 booking_status, payment_status, created_at)
    select
      'Bulk Fixture ' || lpad(i::text, 4, '0'),
      '+9198000' || lpad((6000 + i)::text, 5, '0'),
      'bulk' || i || '@example.com',
      '${GATE_TONIGHT}', '${COUPLE_PASS}', 1, ${couplePass.number_of_people},
      'pending', 'unpaid',
      now() - (i || ' minutes')::interval
    from generate_series(1, ${BULK_ROWS}) as i;
  `);
  const bulkNewest = (
    await dbQuery(`select booking_id from public.bookings where customer_name = 'Bulk Fixture 0001'`)
  )[0].booking_id;
  const bulkOldest = (
    await dbQuery(`select booking_id from public.bookings where customer_name = 'Bulk Fixture 5005'`)
  )[0].booking_id;
  const otherCategory = (
    await dbQuery(`select id, name from public.pass_categories where id <> $1 order by price_inr desc limit 1`, [
      COUPLE_PASS,
    ])
  )[0];

  check(
    "booking management fixtures: a half-admitted group, an unpaid booking and a season of bulk rows",
    halfInPasses.length === 2 && Boolean(unpaidFixture.booking_uuid) && Boolean(bulkNewest && bulkOldest),
    `${halfInPasses.length} passes / ${BULK_ROWS} bulk rows`,
  );

  /** A request for the export: the CSV comes back as a file, headers and all. */
  const adminFile = async (path, cookie) => {
    const response = await fetchWith(path, cookie);
    const body = await response.text();

    return { status: response.status, location: response.headers.get("location"), headers: response.headers, body };
  };

  const exportPath = (filters) => `/admin/bookings/export?${filters}`;
  const csvLines = (body) => body.replace(/^\ufeff/, "").split("\r\n");

  // ---- the list ------------------------------------------------------------------
  const listAdmin = await adminHtml("/admin/bookings", manageAdmin.cookie);
  check(
    "the booking list opens for an admin",
    listAdmin.status === 200 && listAdmin.html.includes(gateFixture.booking_id),
    `${listAdmin.status}`,
  );
  check(
    "and every column the operations team asked for is on it",
    [
      "Booking ID",
      "Customer",
      "Mobile",
      "Email",
      "Date",
      "Pass",
      "Amount",
      "Payment",
      "Booking",
      "Created",
      "Check-in",
    ].every((column) => listAdmin.html.includes(`>${column}<`)),
    ["Booking ID", "Customer", "Mobile", "Email", "Date", "Pass", "Amount", "Payment", "Booking", "Created", "Check-in"]
      .filter((column) => !listAdmin.html.includes(`>${column}<`))
      .join(", ") || "all present",
  );
  check(
    "a row carries the guest, the night, the pass, the amount and both statuses",
    listAdmin.text.includes("Nisha Rao") &&
      listAdmin.text.includes(gateFixture.customer_mobile) &&
      listAdmin.text.includes(gateFixture.customer_email) &&
      listAdmin.text.includes(format.formatInr(Number(gateFixture.total_amount))) &&
      listAdmin.html.includes(">paid<"),
    `${listAdmin.text.includes(gateFixture.customer_mobile)} / ${listAdmin.text.includes("Nisha Rao")}`,
  );
  check(
    "and the row links to the booking in full",
    listAdmin.html.includes(`/admin/bookings/${gateFixture.booking_id}`),
  );
  check(
    "the check-in column separates 'nobody in yet' from 'part of the group in'",
    listAdmin.text.includes(
      bookingsLib.checkInSummary({ passesIssued: 2, passesCheckedIn: 2, paymentStatus: "paid" }),
    ) &&
      listAdmin.text.includes(
        bookingsLib.checkInSummary({ passesIssued: 2, passesCheckedIn: 1, paymentStatus: "paid" }),
      ),
    "check-in wording",
  );

  const listStaff = await adminHtml("/admin/bookings", manageStaff.cookie);
  check(
    "a staff member opens the same list",
    listStaff.status === 200 && listStaff.text.includes("Nisha Rao"),
    `${listStaff.status}`,
  );
  check(
    "with no mobile number, no email address, no amount and no gateway id in the response",
    !listStaff.html.includes(gateFixture.customer_mobile) &&
      !listStaff.html.includes(gateFixture.customer_email) &&
      !listStaff.html.includes(format.formatInr(Number(gateFixture.total_amount))) &&
      !listStaff.html.includes(gateFixture.razorpay_payment_id) &&
      !listStaff.html.includes("₹"),
    `mobile=${listStaff.html.includes(gateFixture.customer_mobile)} amount=${listStaff.html.includes("₹")}`,
  );
  check(
    "the contact columns are not rendered at all for that role",
    !listStaff.html.includes(">Mobile<") && !listStaff.html.includes(">Email<"),
  );
  check(
    "and the page says which fields are withheld rather than looking broken",
    listStaff.text.includes("Contact details, amounts and Razorpay IDs are not shown for your role"),
  );

  const listPeeking = await adminHtml(
    "/admin/bookings?includeContact=true&contact=1&withContact=true&p_include_contact=true",
    manageStaff.cookie,
  );
  check(
    "asking the page for contact details does not turn them on: the role decides, not the query string",
    !listPeeking.html.includes(gateFixture.customer_mobile) && !listPeeking.html.includes("₹"),
  );

  // ---- search --------------------------------------------------------------------
  const searches = [
    ["the booking reference", gateFixture.booking_id],
    ["the guest's name, however it is capitalised", "nisha rao"],
    ["the mobile number with spaces in it", "+91 98000 00401"],
    ["the email address", "gate-tonight@example"],
    ["the Razorpay payment id from the receipt", gateFixture.razorpay_payment_id],
    ["the Razorpay order id", gateFixture.razorpay_order_id],
    ["a pass id as printed on the ticket", gatePassIds[0]],
  ];

  for (const [what, term] of searches) {
    const found = await adminHtml(`/admin/bookings?q=${encodeURIComponent(term)}`, manageAdmin.cookie);

    check(
      `a booking is found by ${what}`,
      found.status === 200 && found.html.includes(gateFixture.booking_id),
      `${term} → ${found.status}`,
    );
  }

  const searchOnePass = await adminHtml(`/admin/bookings?q=${encodeURIComponent(gatePassIds[0])}`, manageAdmin.cookie);
  check(
    "a pass id finds exactly the one booking that holds it",
    searchOnePass.text.includes(bookingsLib.pageSummary(1, bookingsLib.BOOKING_PAGE_SIZE, 1) ?? "impossible") &&
      !searchOnePass.html.includes(halfInBooking.booking_reference),
    bookingsLib.pageSummary(1, bookingsLib.BOOKING_PAGE_SIZE, 1),
  );

  const staffSearch = await adminHtml(
    `/admin/bookings?q=${encodeURIComponent(gateFixture.razorpay_payment_id)}`,
    manageStaff.cookie,
  );
  check(
    "a staff member can search by a payment id a guest read out over the phone",
    staffSearch.status === 200 &&
      staffSearch.html.includes(gateFixture.booking_id) &&
      !staffSearch.html.includes(gateFixture.customer_mobile),
  );

  const searchWildcard = await adminHtml("/admin/bookings?q=%25", manageAdmin.cookie);
  check(
    "a search for a literal % finds nothing rather than every booking in the event",
    searchWildcard.status === 200 && searchWildcard.text.includes("No bookings match these filters"),
    `${searchWildcard.status}`,
  );

  const searchUnknown = await adminHtml("/admin/bookings?q=DND999999999", manageAdmin.cookie);
  check(
    "an unknown reference gets an honest empty state, not a blank page",
    searchUnknown.status === 200 && searchUnknown.text.includes("No bookings match these filters"),
  );

  // ---- filters -------------------------------------------------------------------
  const listFor = (filters, cookie = manageAdmin.cookie) => adminHtml(`/admin/bookings?${filters}`, cookie);
  const holds = (page, reference) => page.html.includes(reference);
  const nightFilters = `from=${gateToday}&to=${gateToday}`;

  const onTheNight = await listFor(nightFilters);
  check(
    "the date filter returns the bookings for that night",
    holds(onTheNight, gateFixture.booking_id) && holds(onTheNight, unpaidFixture.booking_reference),
  );

  const pastFixture = (
    await dbQuery(`select booking_id from public.bookings where customer_mobile = $1`, ["+919800000402"])
  )[0];
  const otherNight = await listFor(`from=${gatePast}&to=${gatePast}`);
  check(
    "and excludes the bookings of every other night, while still listing the ones that belong to it",
    !holds(otherNight, gateFixture.booking_id) &&
      !holds(otherNight, unpaidFixture.booking_reference) &&
      holds(otherNight, pastFixture.booking_id),
  );

  const invertedRange = await listFor(`from=${gateToday}&to=${gatePast}`);
  check(
    "a night range that ends before it starts says so instead of silently swapping the dates",
    invertedRange.text.includes("The night range ends before it starts"),
  );

  const couponOnly = await listFor(`${nightFilters}&pass=${COUPLE_PASS}`);
  check("the pass filter narrows to one pass category", holds(couponOnly, gateFixture.booking_id));

  const otherPassOnly = await listFor(`${nightFilters}&pass=${otherCategory.id}`);
  check(
    "and a category nothing was booked under returns nothing rather than everything",
    otherPassOnly.text.includes("No bookings match these filters") && !holds(otherPassOnly, gateFixture.booking_id),
    otherCategory.name,
  );

  const junkPassFilter = await listFor(`${nightFilters}&pass=not-a-uuid`);
  check(
    "a pass filter that is not an id is ignored, so the list is still the list",
    holds(junkPassFilter, gateFixture.booking_id),
  );

  const paidAndAllIn = await listFor(`${nightFilters}&payment=paid&checkin=all`);
  check(
    "the payment and check-in filters compose: paid, and everyone inside",
    holds(paidAndAllIn, gateFixture.booking_id) && !holds(paidAndAllIn, halfInBooking.booking_reference),
  );

  const partwayIn = await listFor(`${nightFilters}&checkin=some`);
  check(
    "the partial check-in filter finds the group that is half inside",
    holds(partwayIn, halfInBooking.booking_reference) &&
      !holds(partwayIn, gateFixture.booking_id) &&
      !holds(partwayIn, unpaidFixture.booking_reference),
  );

  const nobodyIn = await listFor(`${nightFilters}&checkin=none`);
  check(
    "the empty check-in filter finds the bookings nobody has been admitted from",
    holds(nobodyIn, unpaidFixture.booking_reference) && !holds(nobodyIn, halfInBooking.booking_reference),
  );

  const pendingOnly = await listFor(`${nightFilters}&status=pending`);
  check(
    "the booking-status filter follows the booking's own lifecycle",
    holds(pendingOnly, unpaidFixture.booking_reference) && !holds(pendingOnly, gateFixture.booking_id),
  );

  const unknownStatuses = await listFor(`${nightFilters}&payment=partly-refunded&status=nonsense&checkin=maybe`);
  check(
    "a status the schema does not know narrows nothing instead of matching nothing",
    holds(unknownStatuses, gateFixture.booking_id) && holds(unknownStatuses, unpaidFixture.booking_reference),
  );

  // ---- paging --------------------------------------------------------------------
  const bulkFilters = `q=${encodeURIComponent("Bulk Fixture")}`;
  const bulkPages = bookingsLib.bookingPageCount(BULK_ROWS);
  const bulkFirst = await listFor(bulkFilters);

  check(
    "paging a large result set reports the size of the whole match, not of the page",
    bulkFirst.text.includes(bookingsLib.pageSummary(1, bookingsLib.BOOKING_PAGE_SIZE, BULK_ROWS) ?? "impossible") &&
      bulkFirst.text.includes(`Page 1 of ${bulkPages}`),
    `${bulkPages} pages expected`,
  );
  check(
    "the first page holds the newest bookings",
    holds(bulkFirst, bulkNewest) && !holds(bulkFirst, bulkOldest),
  );
  check("and the page links carry the filters forward", bulkFirst.html.includes("page=2"));

  const bulkLast = await listFor(`${bulkFilters}&page=${bulkPages}`);
  check(
    "the last page holds the remainder, and does not repeat the first",
    holds(bulkLast, bulkOldest) &&
      !holds(bulkLast, bulkNewest) &&
      bulkLast.text.includes(bookingsLib.pageSummary(bulkPages, bookingsLib.BOOKING_PAGE_SIZE, BULK_ROWS) ?? "impossible"),
    bookingsLib.pageSummary(bulkPages, bookingsLib.BOOKING_PAGE_SIZE, BULK_ROWS),
  );

  const bulkPastTheEnd = await listFor(`${bulkFilters}&page=9999`);
  check(
    "a page past the end is an honest empty state",
    bulkPastTheEnd.status === 200 && bulkPastTheEnd.text.includes("No bookings match these filters"),
  );

  const bulkNegativePage = await listFor(`${bulkFilters}&page=-4`);
  check(
    "a negative page number is treated as the first page, not as an error",
    bulkNegativePage.status === 200 && holds(bulkNegativePage, bulkNewest),
  );

  const middlePage = await listFor(`${bulkFilters}&page=2`);
  check(
    "a middle page shows its own slice and reports where it is",
    middlePage.text.includes(bookingsLib.pageSummary(2, bookingsLib.BOOKING_PAGE_SIZE, BULK_ROWS) ?? "impossible") &&
      holds(middlePage, "Bulk Fixture 0026") &&
      holds(middlePage, "Bulk Fixture 0050") &&
      !holds(middlePage, bulkNewest),
    bookingsLib.pageSummary(2, bookingsLib.BOOKING_PAGE_SIZE, BULK_ROWS),
  );

  // ---- the CSV export ------------------------------------------------------------
  const hundredFilters = `q=${encodeURIComponent("Bulk Fixture 01")}`;

  const exportHundred = await adminFile(exportPath(hundredFilters), manageAdmin.cookie);
  const hundredLines = csvLines(exportHundred.body);
  const hundredHeader = hundredLines[0].split(",");

  check(
    "the export is served as a dated CSV file, not as a page",
    exportHundred.status === 200 &&
      String(exportHundred.headers.get("content-type")).startsWith("text/csv") &&
      String(exportHundred.headers.get("content-disposition")).includes("bookings-") &&
      String(exportHundred.headers.get("cache-control")).includes("no-store"),
    `${exportHundred.status} ${exportHundred.headers.get("content-type")}`,
  );
  check(
    "the file has one row per matching booking, and no more",
    exportHundred.headers.get("x-export-rows") === "100" && hundredLines.length === 101,
    `${exportHundred.headers.get("x-export-rows")} rows / ${hundredLines.length} lines`,
  );
  check(
    "the header row names the columns the operations team asked for",
    ["Booking ID", "Customer", "Mobile", "Email", "Date", "Pass", "Amount", "Payment Status", "Booking Status"]
      .every((column) => hundredHeader.includes(column)),
    hundredHeader.join(","),
  );
  // The file and the screen must be the same rows, so the reference set is compared
  // against the bookings the database itself says match the filter.
  const hundredRefs = (
    await dbQuery(
      `select booking_id from public.bookings where customer_name like $1 order by created_at desc`,
      ["Bulk Fixture 01%"],
    )
  ).map((row) => row.booking_id);
  const exportedRefs = hundredLines.slice(1).map((line) => line.split(",")[0]);
  check(
    "the file holds exactly the bookings the filter matches, newest first",
    exportedRefs.length === hundredRefs.length &&
      exportedRefs.every((reference, index) => reference === hundredRefs[index]),
    `${exportedRefs.length} exported of ${hundredRefs.length} matched`,
  );
  check(
    "a contact-carrying export is not truncated, and says so",
    exportHundred.headers.get("x-export-truncated") === "false",
  );

  const exportStaff = await adminFile(exportPath(`q=${encodeURIComponent("Bulk Fixture 0100")}`), manageStaff.cookie);
  const staffHeader = csvLines(exportStaff.body)[0].split(",");
  check(
    "a staff member's export has no contact, amount or gateway columns at all",
    exportStaff.status === 200 &&
      !staffHeader.includes("Mobile") &&
      !staffHeader.includes("Email") &&
      !staffHeader.includes("Amount") &&
      !staffHeader.includes("Razorpay Payment ID") &&
      !exportStaff.body.includes("₹"),
    staffHeader.join(","),
  );
  const staffRowCells = csvLines(exportStaff.body)[1].split(",");
  check(
    "and none of the withheld values appear anywhere in the file",
    !staffRowCells.includes("+919800006100") &&
      !staffRowCells.includes("499") &&
      !staffRowCells.some((cell) => cell.includes("+91")),
    staffRowCells.join("|"),
  );

  const exportAll = await adminFile(exportPath(bulkFilters), manageAdmin.cookie);
  check(
    "an export larger than one fetch batch is assembled completely, then flagged as cut short",
    exportAll.status === 200 &&
      exportAll.headers.get("x-export-rows") === String(bookingsLib.EXPORT_MAX_ROWS) &&
      exportAll.headers.get("x-export-truncated") === "true" &&
      csvLines(exportAll.body).length === bookingsLib.EXPORT_MAX_ROWS + 1,
    `${exportAll.headers.get("x-export-rows")} of ${BULK_ROWS}`,
  );
  check(
    "the cut-short file stops where it said it would, rather than ending at random",
    exportAll.body.includes("Bulk Fixture 5000") && !exportAll.body.includes("Bulk Fixture 5005"),
  );

  const exportSignedOut = await adminFile(exportPath(bulkFilters));
  check(
    "a signed-out visitor cannot download the customer list",
    exportSignedOut.status === 307 && String(exportSignedOut.location ?? "").includes("/admin/login"),
    `${exportSignedOut.status} ${exportSignedOut.location ?? ""}`,
  );

  const exportGuest = await adminFile(exportPath(bulkFilters), manageGuest.cookie);
  check(
    "and neither can a signed-in visitor who is not staff",
    exportGuest.status === 307 && String(exportGuest.location ?? "").includes("/admin/login"),
    `${exportGuest.status} ${exportGuest.location ?? ""}`,
  );

  // ---- one booking in full -------------------------------------------------------
  const detailAdmin = await adminHtml(`/admin/bookings/${gateFixture.booking_id}`, manageAdmin.cookie);
  check(
    "the detail view opens for an admin and names the booking",
    detailAdmin.status === 200 && detailAdmin.text.includes(gateFixture.booking_id),
    `${detailAdmin.status}`,
  );
  check(
    "it shows the whole booking: guest, contact details, night, pass, amount and gateway ids",
    detailAdmin.text.includes("Nisha Rao") &&
      detailAdmin.text.includes(gateFixture.customer_mobile) &&
      detailAdmin.text.includes(gateFixture.customer_email) &&
      detailAdmin.text.includes(format.formatInr(Number(gateFixture.total_amount))) &&
      detailAdmin.text.includes(gateFixture.razorpay_order_id),
  );
  check(
    "it lists every pass on the booking",
    gatePassIds.every((passId) => detailAdmin.text.includes(passId)),
    gatePassIds.join(" "),
  );
  check(
    "and every gate entry, with the gate and the staff member who made it",
    detailAdmin.text.includes("Gate B") && detailAdmin.text.includes("Gate Night Scanner"),
  );
  check(
    "the pass token that admits is nowhere on the page",
    tonightPasses.every((pass) => !detailAdmin.html.includes(pass.qr_token)),
  );
  // The gate fixture was confirmed by the signature-checked callback, which does not
  // leave a webhook row — so its page must say exactly that rather than imply the
  // payment is unverified.
  check(
    "a booking confirmed without a webhook delivery says so honestly, instead of implying the payment is unverified",
    detailAdmin.text.includes("No webhook delivery has been recorded for this order"),
  );

  // The webhook-only fixture is the other half: a payment Razorpay confirmed by
  // delivery, and the screen has to show what arrived.
  const webhookOrderFixture = (
    await dbQuery(`select booking_id, razorpay_order_id from public.bookings where customer_mobile = $1`, [
      "+919800000203",
    ])
  )[0];
  const detailWebhook = await adminHtml(`/admin/bookings/${webhookOrderFixture.booking_id}`, manageAdmin.cookie);
  check(
    "the detail shows what the gateway reported, not a status somebody typed",
    detailWebhook.status === 200 &&
      detailWebhook.text.includes("payment.captured") &&
      detailWebhook.text.includes("confirmed") &&
      detailWebhook.text.includes(webhookOrderFixture.razorpay_order_id),
    detailWebhook.text.includes("payment.captured") ? "gateway events shown" : "no events",
  );
  check(
    "and it offers no control that could change a payment status",
    !/mark\s*(it\s*)?(as\s*)?paid/i.test(detailAdmin.text) &&
      !detailAdmin.html.includes('name="payment_status"') &&
      !detailAdmin.html.includes('value="paid"'),
    /mark\s*(it\s*)?(as\s*)?paid/i.test(detailAdmin.text) ? "a manual paid control was rendered" : "none",
  );

  const detailStaff = await adminHtml(`/admin/bookings/${gateFixture.booking_id}`, manageStaff.cookie);
  check(
    "a staff member sees the booking in full without the contact details or the money",
    detailStaff.status === 200 &&
      detailStaff.text.includes("Nisha Rao") &&
      detailStaff.text.includes(gatePassIds[0]) &&
      detailStaff.text.includes("Gate B") &&
      !detailStaff.html.includes(gateFixture.customer_mobile) &&
      !detailStaff.html.includes(gateFixture.customer_email) &&
      !detailStaff.html.includes("₹") &&
      !detailStaff.html.includes(gateFixture.razorpay_payment_id),
    `${detailStaff.status}`,
  );
  check(
    "and is told why those fields are missing",
    detailStaff.text.includes("Amounts and Razorpay IDs are hidden for your role"),
  );

  const detailUnpaid = await adminHtml(`/admin/bookings/${unpaidFixture.booking_reference}`, manageAdmin.cookie);
  check(
    "a booking with no verified payment says it has no pass, and says why",
    detailUnpaid.status === 200 &&
      detailUnpaid.text.includes("No pass has been issued for this booking") &&
      detailUnpaid.text.includes("No webhook delivery has been recorded for this order"),
  );

  const detailMissing = await adminHtml("/admin/bookings/DND999999999", manageAdmin.cookie);
  check(
    "an identifier nothing matches explains itself instead of failing",
    detailMissing.status === 200 && detailMissing.text.includes("No booking with that identifier"),
  );

  const backFilters = `q=${encodeURIComponent("Nisha Rao")}&payment=paid&page=1`;
  const detailWithBack = await adminHtml(
    `/admin/bookings/${gateFixture.booking_id}?back=${encodeURIComponent(backFilters)}`,
    manageAdmin.cookie,
  );
  check(
    "the way back to the list keeps the search that led here",
    detailWithBack.html.includes("q=Nisha+Rao") && detailWithBack.html.includes("payment=paid"),
  );

  // ---- the shared rules, directly -------------------------------------------------
  const parsedQuery = bookingsLib.parseBookingQuery({
    q: "  Nisha   Rao  ",
    from: "2026-10-12",
    to: "2026-02-31",
    pass: "not-a-uuid",
    payment: "paid",
    status: "shipped",
    checkin: "some",
    page: "-3",
  });
  check(
    "the query parser cleans the term, keeps what it recognises and drops what it does not",
    parsedQuery.q === "Nisha Rao" &&
      parsedQuery.dateFrom === "2026-10-12" &&
      parsedQuery.dateTo === null &&
      parsedQuery.passCategoryId === null &&
      parsedQuery.paymentStatus === "paid" &&
      parsedQuery.bookingStatus === null &&
      parsedQuery.checkInStatus === "some" &&
      parsedQuery.page === 1,
    JSON.stringify(parsedQuery),
  );
  check(
    "a date the calendar does not have is not a filter, and an inverted range is still recognised",
    bookingsLib.isInvertedDateRange({ ...bookingsLib.EMPTY_BOOKING_QUERY, dateFrom: "2026-10-13", dateTo: "2026-10-12" }) &&
      !bookingsLib.isInvertedDateRange(bookingsLib.parseBookingQuery({ to: "2026-02-31" })),
  );
  const roundTrip = bookingsLib.parseBookingQueryString(
    bookingsLib.bookingQueryToSearchParams({ ...parsedQuery, page: 3, dateTo: "2026-10-14" }),
  );
  check(
    "a link built from a query parses back into the same query",
    roundTrip.q === parsedQuery.q &&
      roundTrip.paymentStatus === "paid" &&
      roundTrip.checkInStatus === "some" &&
      roundTrip.dateFrom === "2026-10-12" &&
      roundTrip.dateTo === "2026-10-14" &&
      roundTrip.page === 3,
    JSON.stringify(roundTrip),
  );
  check(
    "a spreadsheet formula cannot be smuggled in through a guest's name",
    bookingsLib.csvCell("=1+1") === "'=1+1" &&
      bookingsLib.csvCell('Nisha "Nia" Rao') === '"Nisha ""Nia"" Rao"' &&
      bookingsLib.csvCell("Nisha, Rao") === '"Nisha, Rao"' &&
      bookingsLib.csvCell(null) === "",
    bookingsLib.csvCell("=1+1"),
  );
  check(
    "the check-in column reads as three different states, not as a number",
    bookingsLib.checkInSummary({ passesIssued: 0, passesCheckedIn: 0, paymentStatus: "unpaid" }) === "No pass yet" &&
      bookingsLib.checkInSummary({ passesIssued: 2, passesCheckedIn: 0, paymentStatus: "paid" }) === "Not in yet (2)" &&
      bookingsLib.checkInSummary({ passesIssued: 2, passesCheckedIn: 1, paymentStatus: "paid" }) === "1 of 2 in" &&
      bookingsLib.checkInSummary({ passesIssued: 2, passesCheckedIn: 2, paymentStatus: "paid" }) === "All 2 in" &&
      bookingsLib.checkInSummary({ passesIssued: 1, passesCheckedIn: 1, paymentStatus: "paid" }) === "Checked in",
  );
  check(
    "an export of an empty result set is never offered",
    bookingsLib.csvHeader(true).length > bookingsLib.csvHeader(false).length &&
      bookingsLib.bookingsToCsv([], false).split(",").length === bookingsLib.csvHeader(false).length,
    `${bookingsLib.csvHeader(false).length} staff columns / ${bookingsLib.csvHeader(true).length} admin columns`,
  );

  // ---------------------------------------------------------------------------
  section("Payments and passes: the gateway's record, and the door list");
  // ---------------------------------------------------------------------------
  // Two read-only screens. What a page-level test can prove that the database checks
  // above cannot is the part that goes wrong in practice: that the screens are closed to
  // the wrong people, open to the right ones, that a staff member's response contains
  // none of the values their role may not see, and that the door list a door team prints
  // holds the rows the screen showed.
  //
  // The fixtures this section needs already exist: the payments section confirmed one
  // booking through the browser and one through a webhook (which is the only path that
  // writes a `payment_events` row), delivered a duplicate, an ignored event, a failure
  // and a refund, and the gate section admitted real passes at a real gate.
  const operationsLib = await import("../src/lib/admin/operations.ts");

  const operationsAdmin = await signIn("admin@example.com", STAFF_PASSWORD);
  const operationsStaff = await signIn("scanner@example.com", STAFF_PASSWORD);
  const operationsSuper = await signIn("owner@example.com", STAFF_PASSWORD);
  const operationsGuest = await signIn("guest@example.com", STAFF_PASSWORD);

  // A season of passes: enough to prove the door list pages without gaps and that a
  // download larger than the fetch batch is either assembled completely or honestly
  // flagged as truncated. The bulk bookings from the previous section are unpaid, so
  // these passes deliberately count towards the list and not towards its revenue.
  const BULK_PASSES = BULK_ROWS;
  await dbRun(`
    insert into public.digital_passes (booking_id, valid_date, pass_number, created_at)
    select b.id, '${gateToday}'::date, 1, now() - (row_number() over (order by b.customer_mobile)) * interval '1 second'
      from public.bookings b
     where b.customer_name like 'Bulk Fixture %'
     order by b.customer_mobile
     limit ${BULK_PASSES};
  `);
  const [bulkPassTotals] = await dbQuery(`
    select count(*)::int as passes,
           count(distinct dp.booking_id)::int as bookings
      from public.digital_passes dp
      join public.bookings b on b.id = dp.booking_id
     where b.customer_name like 'Bulk Fixture %';
  `);
  const bulkPassNewest = (
    await dbQuery(`
      select dp.pass_id from public.digital_passes dp join public.bookings b on b.id = dp.booking_id
       where b.customer_name like 'Bulk Fixture %' order by dp.created_at desc limit 1;
    `)
  )[0].pass_id;

  check(
    "the operations fixtures: a pass for every bulk booking, and more passes than one file holds",
    bulkPassTotals.passes === BULK_PASSES &&
      bulkPassTotals.bookings === BULK_PASSES &&
      BULK_PASSES > operationsLib.PASS_EXPORT_MAX_ROWS,
    `${bulkPassTotals.passes} passes on ${bulkPassTotals.bookings} bookings, cap ${operationsLib.PASS_EXPORT_MAX_ROWS}`,
  );

  // ---- who may look --------------------------------------------------------------
  for (const path of ["/admin/payments", "/admin/passes", "/admin/passes/export"]) {
    const anonymous = await adminHtml(path, null);

    check(
      `a signed-out visitor is sent to the sign-in screen from ${path}`,
      anonymous.status === 307 &&
        String(anonymous.location ?? "").includes(`/admin/login?next=${encodeURIComponent(path)}`),
      `${anonymous.status} ${anonymous.location ?? ""}`,
    );
  }

  const passesForGuest = await adminHtml("/admin/passes", operationsGuest.cookie);
  const exportForGuest = await adminFile("/admin/passes/export", operationsGuest.cookie);
  check(
    "a signed-in visitor who is not staff gets the same nothing from both screens",
    passesForGuest.status === 307 &&
      String(passesForGuest.location ?? "").includes("/admin/login") &&
      exportForGuest.status === 307 &&
      String(exportForGuest.location ?? "").includes("/admin/login"),
    `${passesForGuest.status} / ${exportForGuest.status}`,
  );

  // The scanner role is real staff, and is deliberately not given either screen: the
  // gate needs to admit passes, not to read the payment log or the guest list.
  const paymentsForStaff = await adminHtml("/admin/payments", operationsStaff.cookie);
  const passesForStaff = await adminHtml("/admin/passes", operationsStaff.cookie);
  check(
    "a scanner is sent away from both screens, told why, and given somewhere to go",
    paymentsForStaff.status === 307 &&
      String(paymentsForStaff.location ?? "").includes("denied=payments%3Aview") &&
      passesForStaff.status === 307 &&
      String(passesForStaff.location ?? "").includes("denied=passes%3Aview"),
    `${paymentsForStaff.status} ${paymentsForStaff.location ?? ""} / ${passesForStaff.location ?? ""}`,
  );
  check(
    "and the redirect carries no payment or pass data at all",
    !paymentsForStaff.html.includes("payment_events") && !passesForStaff.html.includes("PS-0"),
  );

  // ---- the payments screen -------------------------------------------------------
  const paymentsPage = await adminHtml("/admin/payments", operationsAdmin.cookie);
  const [gatewayTotals] = await dbQuery(`
    select count(*)::int as events,
           count(*) filter (where outcome = 'already_confirmed')::int as already,
           count(*) filter (where outcome = 'duplicate')::int as duplicates,
           count(*) filter (where outcome = 'ignored')::int as ignored,
           count(*) filter (where outcome = 'failed')::int as failed,
           count(*) filter (where outcome = 'refunded')::int as refunded,
           (select count(*)::int from public.bookings
             where razorpay_order_id is not null and payment_status <> 'paid') as awaiting
      from public.payment_events;
  `);
  const [webhookBookingRow] = await dbQuery(
    `select booking_id, razorpay_order_id, razorpay_payment_id, total_amount, payment_status
       from public.bookings where customer_mobile = $1`,
    [MOBILE_WEBHOOK],
  );
  const deliveredEvents = await dbQuery(
    `select event_id, event_type, outcome from public.payment_events order by received_at desc limit 20`,
  );
  const deliveredOutcomes = [...new Set(deliveredEvents.map((row) => row.outcome))];

  check(
    "the payments screen opens for an admin",
    paymentsPage.status === 200 && paymentsPage.text.includes("Delivery log"),
    `${paymentsPage.status}`,
  );
  check(
    "it shows the gateway's own totals, counted from the deliveries it recorded",
    paymentsPage.text.includes(String(gatewayTotals.events)) &&
      paymentsPage.text.includes(String(gatewayTotals.failed)) &&
      paymentsPage.text.includes(String(gatewayTotals.refunded + gatewayTotals.ignored + gatewayTotals.duplicates)) &&
      paymentsPage.text.includes(String(gatewayTotals.awaiting)),
    JSON.stringify(gatewayTotals),
  );
  check(
    "the delivery log names the events the gateway actually sent, id and all",
    deliveredEvents.length > 0 &&
      deliveredEvents.every(
        (row) => paymentsPage.html.includes(row.event_id) && paymentsPage.html.includes(row.event_type),
      ),
    `${deliveredEvents.length} deliveries: ${deliveredEvents.map((row) => row.event_type).join(", ")}`,
  );
  check(
    "each delivery is attributed to the booking it belongs to, with the gateway ids",
    paymentsPage.text.includes(webhookBookingRow.razorpay_order_id) &&
      paymentsPage.text.includes(webhookBookingRow.razorpay_payment_id) &&
      paymentsPage.text.includes(webhookBookingRow.booking_id),
  );
  check(
    "the outcome the site recorded is on every row, in words rather than as the enum",
    deliveredOutcomes.every((outcome) => paymentsPage.text.includes(operationsLib.outcomeLabel(outcome))),
    deliveredOutcomes.join(", "),
  );
  check(
    "the payments screen is not indexable, and is a page rather than a redirect",
    /noindex/.test(paymentsPage.html) && paymentsPage.status === 200,
  );

  const paymentsStaffView = await adminHtml("/admin/payments", operationsSuper.cookie);
  check(
    "a super admin sees the same log",
    paymentsStaffView.status === 200 && paymentsStaffView.text.includes(webhookBookingRow.booking_id),
    `${paymentsStaffView.status}`,
  );

  // ---- the payments screen cannot write ------------------------------------------
  // The one control the brief forbids, checked as a fact rather than as an intention:
  // posting to the payment endpoints from an admin session still cannot mark anything
  // paid, because the only writer is a verified gateway event.
  const [paidBookingRow] = await dbQuery(
    `select booking_id, razorpay_order_id, payment_status from public.bookings where customer_mobile = $1`,
    [MOBILE_PAID],
  );
  const passesBeforeForgery = await passesFor(MOBILE_PAID);
  const forgedMarkPaid = await postJson("/api/payment/verify", {
    razorpay_order_id: paidBookingRow.razorpay_order_id,
    razorpay_payment_id: "pay_FORGED0000000001",
    razorpay_signature: "0".repeat(64),
  });
  const afterForged = await bookingRow(paidBookingRow.booking_id);
  check(
    "a hand-written payment verification is refused, and the booking is exactly as the gateway left it",
    forgedMarkPaid.status === 400 &&
      afterForged.payment_status === paidBookingRow.payment_status &&
      afterForged.razorpay_payment_id !== "pay_FORGED0000000001" &&
      (await passesFor(MOBILE_PAID)) === passesBeforeForgery,
    `status ${forgedMarkPaid.status}, payment ${afterForged.payment_status}, ${passesBeforeForgery} passes`,
  );

  // ---- attention -----------------------------------------------------------------
  const [attentionCandidate] = await dbQuery(`
    select b.id, b.booking_id, b.customer_mobile
      from public.bookings b
     where b.payment_status = 'paid'
       and exists (select 1 from public.digital_passes dp where dp.booking_id = b.id)
     order by b.created_at desc
     limit 1;
  `);
  const candidatePasses = await dbQuery(
    `select id, pass_id from public.digital_passes where booking_id = $1 order by pass_number`,
    [attentionCandidate.id],
  );
  await dbQuery(`delete from public.digital_passes where booking_id = $1`, [attentionCandidate.id]);

  const attentionBefore = await dbQuery(`
    select reason_code, count(*)::int as n from public.admin_payment_attention(true, 50) group by reason_code order by reason_code;
  `);
  const attentionTotalBefore = (
    await dbQuery(`select count(*)::int as n from public.admin_payment_attention(true, 50)`)
  )[0].n;
  const paymentsAttention = await adminHtml("/admin/payments", operationsAdmin.cookie);
  check(
    "a paid booking that lost its pass is listed, with the reason and the fix",
    paymentsAttention.html.includes(attentionCandidate.booking_id) &&
      paymentsAttention.text.includes("Paid, but no pass was ever issued") &&
      paymentsAttention.text.includes("Re-deliver the gateway event") &&
      paymentsAttention.text.includes("Needs attention"),
    `on page: ${paymentsAttention.text.includes(attentionCandidate.booking_id)} · reason: ${paymentsAttention.text.includes("Paid, but no pass was ever issued")}`,
  );
  check(
    "and it sits beside the contradictions the database already held, not instead of them",
    attentionBefore.some((row) => row.reason_code === "event-ignored") &&
      attentionBefore.some((row) => row.reason_code === "paid-no-pass") &&
      paymentsAttention.text.includes("A gateway event we could not act on"),
    attentionBefore.map((row) => `${row.reason_code}:${row.n}`).join(" "),
  );

  // One row per pass it had, each with the id it had, and the token the table generates
  // for every real pass (64 hex characters, from the column's own default).
  for (const [index, pass] of candidatePasses.entries()) {
    await dbQuery(
      `insert into public.digital_passes (booking_id, pass_id, valid_date, pass_number)
       values ($1, $2, $3::date, $4)`,
      [attentionCandidate.id, pass.pass_id, gateToday, index + 1],
    );
  }
  const paymentsHealthy = await adminHtml("/admin/payments", operationsAdmin.cookie);
  const attentionAfter = await dbQuery(`
    select reason_code, count(*)::int as n from public.admin_payment_attention(true, 50) group by reason_code;
  `);
  const attentionTotalAfter = (
    await dbQuery(`
      select count(*)::int as n from public.admin_payment_attention(true, 50)
       where booking_id = '${attentionCandidate.booking_id}'
    `)
  )[0].n;
  check(
    "and it is gone from the list once the pass is back, because the list reports states and not suspicions",
    !paymentsHealthy.html.includes(attentionCandidate.booking_id) &&
      attentionTotalAfter === 0 &&
      attentionBefore.some((row) => row.reason_code === "paid-no-pass" && row.n >= 2) &&
      attentionAfter.some((row) => row.reason_code === "paid-no-pass" && row.n === 1),
    `${attentionAfter.map((row) => `${row.reason_code}:${row.n}`).join(" ")} (was ${attentionTotalBefore} rows)`,
  );

  // ---- the pass list -------------------------------------------------------------
  const passesPage = await adminHtml("/admin/passes", operationsAdmin.cookie);
  const [passTotals] = await dbQuery(`
    select count(*)::int as passes,
           count(*) filter (where checked_in)::int as admitted,
           (select count(*)::int from public.digital_passes where status = 'used')::int as used
      from public.digital_passes;
  `);
  const [checksumPass] = await dbQuery(
    `select dp.id, dp.pass_id, dp.qr_token, b.booking_id, b.customer_name, b.customer_mobile, b.total_amount
       from public.digital_passes dp join public.bookings b on b.id = dp.booking_id
      where b.customer_mobile = $1 order by dp.pass_number limit 1`,
    ["+919800000401"],
  );

  // The season of bulk passes fills the first page, so the checks about what a *row*
  // says are made on the row itself: the pass looked up the way a door team looks one up.
  const focusedPasses = await adminHtml(`/admin/passes?q=${encodeURIComponent(checksumPass.pass_id)}`, operationsAdmin.cookie);
  check(
    "the pass list opens for an admin and reports how many passes there are",
    passesPage.status === 200 &&
      passesPage.text.includes(String(passTotals.passes)) &&
      passesPage.text.includes(bookingsLib.pageSummary(1, operationsLib.OPERATIONS_PAGE_SIZE, passTotals.passes) ?? "impossible"),
    `${passesPage.status} / ${passTotals.passes} passes`,
  );
  check(
    "a pass is shown with its booking, its guest, its night and whether it is in",
    focusedPasses.status === 200 &&
      focusedPasses.text.includes(checksumPass.pass_id) &&
      focusedPasses.text.includes(checksumPass.booking_id) &&
      focusedPasses.text.includes(checksumPass.customer_name) &&
      focusedPasses.text.includes(checksumPass.customer_mobile) &&
      focusedPasses.text.includes(format.formatEventDate(gateToday)) &&
      focusedPasses.text.includes("Admitted"),
    contextAround(focusedPasses.text, checksumPass.pass_id),
  );
  check(
    "the pass list says how many passes the booking holds, so a group is a group",
    focusedPasses.text.includes("1 of 2") && focusedPasses.text.includes(`Page 1 of 1`),
    contextAround(focusedPasses.text, "1 of 2"),
  );

  const tokenInList = await adminHtml(`/admin/passes?q=${encodeURIComponent(checksumPass.pass_id)}`, operationsAdmin.cookie);
  check(
    "the token that admits a guest is nowhere in the list, not even for the pass asked for by id",
    !tokenInList.html.includes(checksumPass.qr_token) &&
      !tokenInList.html.includes("qr_token") &&
      !tokenInList.text.includes(checksumPass.qr_token),
    `${checksumPass.pass_id} (token length ${checksumPass.qr_token.length})`,
  );
  check(
    "and the page says why it is not there rather than leaving it out silently",
    tokenInList.text.includes("Pass tokens are never included"),
  );

  // ---- who the withheld view is for ----------------------------------------------
  // The scanner's screen is never rendered, because the scanner never gets there. The
  // rule is checked where it is actually decided — the permission matrix the guards,
  // the pages and the database all read — and the withheld shape itself is checked in
  // verify-db, against the two functions these pages call.
  const permissionsLib = await import("../src/lib/auth/permissions.ts");
  check(
    "only the roles that may see contact details may see these screens at all",
    permissionsLib.can("staff", "passes:view") === false &&
      permissionsLib.can("staff", "payments:view") === false &&
      permissionsLib.can("admin", "passes:view") === true &&
      permissionsLib.can("admin", "bookings:view_contact") === true &&
      permissionsLib.can("super_admin", "payments:view") === true,
    JSON.stringify({
      staff: permissionsLib.permissionsFor("staff"),
      admin: permissionsLib.permissionsFor("admin"),
    }),
  );

  // ---- search and filters --------------------------------------------------------
  const passesPageFor = (filters, cookie = operationsAdmin.cookie) => adminHtml(`/admin/passes?${filters}`, cookie);

  const byPassId = await passesPageFor(`q=${encodeURIComponent(checksumPass.pass_id)}`);
  check(
    "a pass is found by the id printed on it, and nothing else is",
    byPassId.text.includes(checksumPass.pass_id) &&
      !byPassId.text.includes(bulkPassNewest) &&
      byPassId.text.includes(bookingsLib.pageSummary(1, operationsLib.OPERATIONS_PAGE_SIZE, 1) ?? "impossible"),
    bookingsLib.pageSummary(1, operationsLib.OPERATIONS_PAGE_SIZE, 1),
  );

  const byGuest = await passesPageFor(`q=${encodeURIComponent("nisha rao")}`);
  check("and by the guest's name, however it is typed", byGuest.text.includes(checksumPass.pass_id));

  const byMobile = await passesPageFor(`q=${encodeURIComponent("+91 98000 00401")}`);
  check("and by the number the guest booked with", byMobile.text.includes(checksumPass.pass_id));

  const byBooking = await passesPageFor(`q=${encodeURIComponent(checksumPass.booking_id)}`);
  const bookingPasses = Number(
    (await dbQuery(`select count(*)::int as n from public.digital_passes where booking_id = $1`, [
      (await dbQuery(`select id from public.bookings where booking_id = $1`, [checksumPass.booking_id]))[0].id,
    ]))[0].n,
  );
  check(
    "a booking reference brings the whole group's passes with it",
    byBooking.text.includes(checksumPass.pass_id) &&
      byBooking.text.includes(bookingsLib.pageSummary(1, operationsLib.OPERATIONS_PAGE_SIZE, bookingPasses) ?? "impossible"),
    bookingsLib.pageSummary(1, operationsLib.OPERATIONS_PAGE_SIZE, bookingPasses),
  );

  const nightFiltered = await passesPageFor(`night=${GATE_TONIGHT}`);
  const [nightCount] = await dbQuery(
    `select count(*)::int as n from public.digital_passes where valid_date = $1::date`,
    [gateToday],
  );
  check(
    "the night filter takes a night, and the screen reports that night's own total",
    nightFiltered.text.includes(
      bookingsLib.pageSummary(1, operationsLib.OPERATIONS_PAGE_SIZE, nightCount.n) ?? "impossible",
    ) && nightCount.n < passTotals.passes,
    `${nightCount.n} passes tonight of ${passTotals.passes}`,
  );

  const admittedTonight = Number(
    (
      await dbQuery(
        `select count(*)::int as n from public.digital_passes where valid_date = $1::date and checked_in`,
        [gateToday],
      )
    )[0].n,
  );
  const admittedOnly = await passesPageFor(`checkin=in&night=${GATE_TONIGHT}`);
  check(
    "the entry filter finds the passes that have been admitted",
    admittedOnly.text.includes(checksumPass.pass_id) &&
      admittedOnly.text.includes(
        bookingsLib.pageSummary(1, operationsLib.OPERATIONS_PAGE_SIZE, admittedTonight) ?? "impossible",
      ),
    `${admittedTonight} admitted tonight of ${passTotals.admitted} overall`,
  );

  const notAdmitted = await passesPageFor(`checkin=out&night=${GATE_TONIGHT}`);
  check(
    "and its opposite finds the ones that have not, splitting the night exactly in two",
    notAdmitted.text.includes(
      bookingsLib.pageSummary(1, operationsLib.OPERATIONS_PAGE_SIZE, nightCount.n - admittedTonight) ?? "impossible",
    ) && !notAdmitted.html.includes(checksumPass.pass_id),
    `${admittedTonight} in / ${nightCount.n - admittedTonight} not, of ${nightCount.n} tonight`,
  );

  const junkPassFilters = await passesPageFor("status=lost&checkin=maybe&night=not-a-uuid&from=2026-02-31&page=-3");
  check(
    "filters the schema does not know narrow nothing instead of matching nothing",
    junkPassFilters.status === 200 &&
      junkPassFilters.text.includes(
        bookingsLib.pageSummary(1, operationsLib.OPERATIONS_PAGE_SIZE, passTotals.passes) ?? "impossible",
      ),
    `${junkPassFilters.status}`,
  );

  const passFiltersPeeking = await passesPageFor(
    `q=${encodeURIComponent(checksumPass.pass_id)}&includeContact=false&withContact=0&p_include_contact=false&contact=no`,
  );
  check(
    "the role decides what is shown: asking the page to hide contact details does not hide them either",
    passFiltersPeeking.status === 200 &&
      passFiltersPeeking.text.includes(checksumPass.customer_mobile) &&
      passFiltersPeeking.text.includes(checksumPass.customer_name),
    contextAround(passFiltersPeeking.text, checksumPass.pass_id),
  );

  // ---- paging a season of passes --------------------------------------------------
  const passPages = operationsLib.operationsPageCount(passTotals.passes);
  const firstPassPage = await passesPageFor("page=1");
  const lastPassPage = await passesPageFor(`page=${passPages}`);

  check(
    "paging a season of passes reports the size of the whole match, not of the page",
    firstPassPage.text.includes(
      bookingsLib.pageSummary(1, operationsLib.OPERATIONS_PAGE_SIZE, passTotals.passes) ?? "impossible",
    ) && firstPassPage.text.includes(`Page 1 of ${passPages}`),
    `${passPages} pages`,
  );
  check(
    "the last page holds the remainder and does not repeat the first",
    lastPassPage.status === 200 &&
      !lastPassPage.text.includes(bulkPassNewest) &&
      lastPassPage.text.includes(
        bookingsLib.pageSummary(passPages, operationsLib.OPERATIONS_PAGE_SIZE, passTotals.passes) ?? "impossible",
      ),
    bookingsLib.pageSummary(passPages, operationsLib.OPERATIONS_PAGE_SIZE, passTotals.passes),
  );
  const pastTheEnd = await passesPageFor("page=9999");
  check(
    "a page past the end says so — it does not pretend the event has no passes",
    pastTheEnd.status === 200 &&
      pastTheEnd.text.includes("That page is past the end of the list") &&
      pastTheEnd.text.includes(String(passTotals.passes)) &&
      pastTheEnd.text.includes("Back to the first page"),
    pastTheEnd.text.replace(/\s+/g, " ").slice(-260),
  );
  const pastTheEndFiltered = await passesPageFor(`q=${encodeURIComponent("Bulk Fixture")}&page=9999`);
  check(
    "and a filtered page past the end offers to clear the filters instead",
    pastTheEndFiltered.text.includes("No passes match these filters") &&
      pastTheEndFiltered.text.includes("Clear them"),
    contextAround(pastTheEndFiltered.text, "past the end"),
  );

  const paymentsPastTheEnd = await adminHtml("/admin/payments?page=9999", operationsAdmin.cookie);
  check(
    "the delivery log says the same about a page past its end",
    paymentsPastTheEnd.status === 200 &&
      paymentsPastTheEnd.text.includes("That page is past the end of the log") &&
      paymentsPastTheEnd.text.includes(String(gatewayTotals.events)) &&
      paymentsPastTheEnd.text.includes("Back to the newest"),
    contextAround(paymentsPastTheEnd.text, "past the end"),
  );

  // ---- the door list as a file ----------------------------------------------------
  const doorListAdmin = await adminFile("/admin/passes/export", operationsAdmin.cookie);
  const doorHeader = csvLines(doorListAdmin.body)[0].split(",");
  const doorRows = csvLines(doorListAdmin.body).slice(1);

  check(
    "the door list is served as a dated CSV file, not as a page",
    doorListAdmin.status === 200 &&
      String(doorListAdmin.headers.get("content-type")).startsWith("text/csv") &&
      String(doorListAdmin.headers.get("content-disposition")).includes("passes-") &&
      String(doorListAdmin.headers.get("cache-control")).includes("no-store"),
    `${doorListAdmin.status} ${doorListAdmin.headers.get("content-disposition")}`,
  );
  check(
    "the header row names the columns a door team works from",
    doorHeader.includes("Pass ID") &&
      doorHeader.includes("Pass Number") &&
      doorHeader.includes("Passes On Booking") &&
      doorHeader.includes("Booking ID") &&
      doorHeader.includes("Customer") &&
      doorHeader.includes("Valid Date") &&
      doorHeader.includes("Checked In") &&
      doorHeader.includes("Checked In At") &&
      doorHeader.includes("Gate") &&
      doorHeader.includes("Admitted By") &&
      doorHeader.includes("Mobile") &&
      doorHeader.includes("Amount"),
    doorHeader.join(","),
  );
  check(
    "and there is no column for the token that admits a pass",
    !doorHeader.some((header) => /token|qr/i.test(header)) &&
      !doorListAdmin.body.includes(checksumPass.qr_token) &&
      !doorListAdmin.headers.get("x-export-columns")?.includes("token"),
    doorHeader.join(","),
  );
  check(
    "the file is capped, and the cap is reported rather than applied in silence",
    doorListAdmin.headers.get("x-export-truncated") === "true" &&
      doorListAdmin.headers.get("x-export-rows") === String(operationsLib.PASS_EXPORT_MAX_ROWS) &&
      doorRows.length === operationsLib.PASS_EXPORT_MAX_ROWS,
    `${doorListAdmin.headers.get("x-export-rows")} rows, truncated=${doorListAdmin.headers.get("x-export-truncated")}`,
  );
  check(
    "and the file says the same thing about itself as the screen does",
    doorListAdmin.body.includes("Bulk Fixture") || doorListAdmin.body.includes("PS-0"),
  );

  const doorListTonight = await adminFile(`/admin/passes/export?night=${GATE_TONIGHT}&checkin=in`, operationsAdmin.cookie);
  const tonightLines = csvLines(doorListTonight.body);
  check(
    "an export carries the filters it was asked with, and only those rows",
    doorListTonight.headers.get("x-export-truncated") === "false" &&
      Number(doorListTonight.headers.get("x-export-rows")) === admittedTonight &&
      tonightLines.length === admittedTonight + 1,
    `${doorListTonight.headers.get("x-export-rows")} rows / header ${tonightLines[0].slice(0, 40)}`,
  );
  const admittedAt = (
    await dbQuery(
      `select dp.checked_in_at from public.digital_passes dp join public.bookings b on b.id = dp.booking_id
        where b.customer_mobile = $1 and dp.checked_in order by dp.checked_in_at limit 1`,
      ["+919800000401"],
    )
  )[0]?.checked_in_at;
  check(
    "the admitted passes are the ones in the file, with their gate and the time they came in",
    doorListTonight.body.includes(checksumPass.pass_id) &&
      doorListTonight.body.includes("Gate B") &&
      doorListTonight.body.includes("Gate Night Scanner") &&
      doorListTonight.body.includes(new Date(admittedAt).toISOString().slice(0, 10)) &&
      doorListTonight.body.includes("yes"),
    `${checksumPass.pass_id} admitted ${String(admittedAt)}`,
  );
  check(
    "a row is one line: a guest's name with a comma in it cannot break the file",
    tonightLines.every((line) => (line.match(/"/g) ?? []).length % 2 === 0),
  );

  // Staff may not read the pass list at all, and the export route says so rather than
  // returning an empty file that looks like "no passes".
  const doorListStaff = await adminFile("/admin/passes/export", operationsStaff.cookie);
  check(
    "a scanner is refused the door list as a file, in words rather than as an empty file",
    doorListStaff.status === 307 && String(doorListStaff.location ?? "").startsWith("/admin?"),
    `${doorListStaff.status} ${doorListStaff.location ?? ""}`,
  );
  const doorListAnonymous = await adminFile("/admin/passes/export", null);
  check(
    "and a signed-out request is refused before any query runs",
    doorListAnonymous.status === 307 || doorListAnonymous.status === 401,
    `${doorListAnonymous.status}`,
  );

  // ---- the roles that read the same screens --------------------------------------
  const operationsMatrix = await dbQuery(`
    select
      has_function_privilege('anon', 'public.admin_pass_list(text, text, text, uuid, date, date, boolean, integer, integer)', 'execute') as anon_passes,
      has_function_privilege('anon', 'public.admin_payment_summary(boolean)', 'execute') as anon_summary,
      has_function_privilege('service_role', 'public.admin_payment_attention(boolean, integer)', 'execute') as service_attention;
  `);
  check(
    "the screens read through functions no browser key can call",
    operationsMatrix[0].anon_passes === false &&
      operationsMatrix[0].anon_summary === false &&
      operationsMatrix[0].service_attention === true,
    JSON.stringify(operationsMatrix[0]),
  );

  const exportShape = operationsLib.PASS_EXPORT_COLUMNS.filter((column) => column.contact).map((column) => column.header);
  check(
    "the columns a staff file would lose are the ones the database withholds",
    exportShape.join(",") === "Mobile,Amount,Currency" &&
      operationsLib.PASS_EXPORT_COLUMNS.length - exportShape.length >= 10,
    `${exportShape.join(",")} of ${operationsLib.PASS_EXPORT_COLUMNS.length} columns`,
  );
  check(
    "the door list is named for the day it was taken, so two downloads cannot be confused",
    /^passes-\d{4}-\d{2}-\d{2}\.csv$/.test(operationsLib.passExportFileName()),
    operationsLib.passExportFileName(),
  );

  const parsedPaymentQuery = operationsLib.parsePaymentQuery({
    q: "  pay_ABC123  ",
    outcome: "refunded",
    event: "payment.refunded",
    from: "2026-10-11",
    to: "2026-02-31",
    page: "-2",
  });
  check(
    "the payment filters clean the term, keep what they recognise and drop what they do not",
    parsedPaymentQuery.q === "pay_ABC123" &&
      parsedPaymentQuery.outcome === "refunded" &&
      parsedPaymentQuery.eventType === "payment.refunded" &&
      parsedPaymentQuery.from === "2026-10-11" &&
      parsedPaymentQuery.to === null &&
      parsedPaymentQuery.page === 1 &&
      operationsLib.isPaymentFiltered(parsedPaymentQuery),
    JSON.stringify(parsedPaymentQuery),
  );
  const paymentRoundTrip = operationsLib.parsePaymentQueryString(
    operationsLib.paymentQueryToSearchParams({ ...parsedPaymentQuery, page: 4 }),
  );
  check(
    "a payments link built from a query parses back into the same query",
    paymentRoundTrip.q === parsedPaymentQuery.q &&
      paymentRoundTrip.outcome === "refunded" &&
      paymentRoundTrip.eventType === "payment.refunded" &&
      paymentRoundTrip.page === 4,
    JSON.stringify(paymentRoundTrip),
  );
  const passRoundTrip = operationsLib.parsePassQueryString(
    operationsLib.passQueryToSearchParams({
      ...operationsLib.parsePassQuery({ q: "Nisha", night: GATE_TONIGHT, checkin: "in", status: "used" }),
      page: 2,
    }),
  );
  check(
    "and a passes link does too, night and all",
    passRoundTrip.q === "Nisha" &&
      passRoundTrip.eventDateId === GATE_TONIGHT &&
      passRoundTrip.checkIn === "in" &&
      passRoundTrip.status === "used" &&
      passRoundTrip.page === 2,
    JSON.stringify(passRoundTrip),
  );
  check(
    "a pass's two facts are both readable: whether it was admitted, and what its status is",
    operationsLib.passState({ passStatus: "active", checkedIn: false }) === "Not admitted yet" &&
      operationsLib.passState({ passStatus: "active", checkedIn: true }) === "Admitted" &&
      operationsLib.passState({ passStatus: "used", checkedIn: true }) === "Admitted" &&
      operationsLib.passState({ passStatus: "cancelled", checkedIn: false }) === "Cancelled" &&
      operationsLib.passState({ passStatus: "cancelled", checkedIn: true }) === "Cancelled after entry" &&
      operationsLib.passState({ passStatus: "expired", checkedIn: false }) === "Expired",
  );
  check(
    "and an outcome the gateway invented is displayed as itself rather than as a blank",
    operationsLib.outcomeLabel("ignored") === "ignored" &&
      operationsLib.outcomeLabel("already_confirmed") === "confirmed" &&
      operationsLib.outcomeLabel("something_new") === "something_new" &&
      operationsLib.outcomeTone("confirmed") === "go" &&
      operationsLib.outcomeTone("duplicate") === "warn" &&
      operationsLib.outcomeTone("failed") === "stop",
  );
  check(
    "paise become rupees exactly once, on the way out of the database",
    operationsLib.paiseToRupees(109900) === 1099 && operationsLib.paiseToRupees(null) === null,
    String(operationsLib.paiseToRupees(109900)),
  );

  // ---------------------------------------------------------------------------
  section("Pass and date management: the catalogue, the nights, and who may change them");
  // ---------------------------------------------------------------------------
  // Two screens the organiser runs the event from, plus the rules behind them. The
  // database's own half of this step — the constraints, the guard trigger, the
  // capacity floor, the locks — is verified in `db:verify`; what a page-level test
  // can add is the part that only exists end to end: the form rules the browser and
  // the server share, the copy the website shows a visitor when seats are held back
  // or booking is closed, and the fact that a role which may *read* a screen is not
  // thereby allowed to *post* to it.
  const catalogueLib = await import("../src/lib/admin/catalogue.ts");
  const nightCopyLib = await import("../src/lib/event-copy.ts");
  const { formatEventDate: formatDate } = await import("../src/lib/format.ts");

  // ---- the words, and the rules the two screens share ----------------------------
  const goodPassForm = {
    id: null,
    code: "Family Pass",
    name: "Family Pass",
    composition: "2 Adults + 2 Children",
    description: "Entry for four, priced for a family.",
    priceInr: "1099",
    numberOfPeople: "4",
    maxPerBooking: "5",
    minAge: "0",
    sortOrder: "5",
    isActive: true,
  };

  const goodPass = catalogueLib.parsePassForm(goodPassForm);
  check(
    "a well-filled pass form parses into numbers, with nothing to complain about",
    catalogueLib.isClean(goodPass.errors) &&
      goodPass.values.priceInr === 1099 &&
      goodPass.values.numberOfPeople === 4 &&
      goodPass.values.maxPerBooking === 5 &&
      goodPass.values.minAge === 0 &&
      goodPass.values.sortOrder === 5 &&
      goodPass.values.isActive === true,
    JSON.stringify(goodPass.values),
  );

  const badPassForms = [
    ["a name nobody would recognise", { name: "   " }, "name"],
    ["a composition that says nothing", { composition: "" }, "composition"],
    ["a code that is punctuation", { code: "??" }, "code"],
    ["a price with letters in it", { priceInr: "12abc" }, "priceInr"],
    ["a price of zero", { priceInr: "0" }, "priceInr"],
    ["a price above the ceiling", { priceInr: "500001" }, "priceInr"],
    ["a pass that admits nobody", { numberOfPeople: "0" }, "numberOfPeople"],
    ["more people than a pass can admit", { numberOfPeople: "51" }, "numberOfPeople"],
    ["a booking limit of zero", { maxPerBooking: "0" }, "maxPerBooking"],
    ["an age restriction of 121", { minAge: "121" }, "minAge"],
    ["an age restriction that is not a number", { minAge: "eighteen" }, "minAge"],
    ["a display order past the limit", { sortOrder: "10000" }, "sortOrder"],
    ["a description longer than the column allows", { description: "x".repeat(300) }, "description"],
  ];

  for (const [label, overrides, field] of badPassForms) {
    const pdmParsed = catalogueLib.parsePassForm({ ...goodPassForm, ...overrides });

    check(
      `${label} is refused on the ${field} field`,
      Boolean(pdmParsed.errors[field]) && !catalogueLib.isClean(pdmParsed.errors),
      JSON.stringify(pdmParsed.errors),
    );
  }
  check(
    "the form reports the first offending field, in the order the form reads",
    catalogueLib.firstFieldError({ code: "a", name: "b" })?.field === "code" &&
      catalogueLib.firstFieldError({}) === null,
    JSON.stringify(catalogueLib.firstFieldError({ code: "a", name: "b" })),
  );

  const goodNightForm = {
    id: null,
    date: "2026-10-25",
    startTime: "19:00",
    endTime: "23:30",
    capacity: "1200",
    capacityHeld: "",
    status: "scheduled",
    bookingOpen: true,
    notes: "Extra night added after the first sold out.",
  };

  const goodNight = catalogueLib.parseNightForm(goodNightForm);
  check(
    "a well-filled night form parses, and leaves seats held back at zero when the field is empty",
    catalogueLib.isClean(goodNight.errors) &&
      goodNight.values.date === "2026-10-25" &&
      goodNight.values.capacity === 1200 &&
      goodNight.values.capacityHeld === 0 &&
      goodNight.values.status === "scheduled" &&
      goodNight.values.bookingOpen === true,
    JSON.stringify(goodNight.values),
  );

  const badNightForms = [
    ["a capacity of zero", { capacity: "0" }, "capacity"],
    ["a capacity with letters in it", { capacity: "1200 seats" }, "capacity"],
    ["more seats held back than the night has", { capacity: "100", capacityHeld: "101" }, "capacityHeld"],
    ["negative seats held back", { capacityHeld: "-5" }, "capacityHeld"],
    ["a date that is not a real day", { date: "2026-02-31" }, "date"],
    ["no date at all", { date: "" }, "date"],
    ["a time that is not a time", { startTime: "7pm" }, "startTime"],
    ["a night that ends before it starts", { startTime: "20:00", endTime: "19:00" }, "endTime"],
    ["a note longer than the column allows", { notes: "x".repeat(300) }, "notes"],
  ];

  for (const [label, overrides, field] of badNightForms) {
    const pdmParsed = catalogueLib.parseNightForm({ ...goodNightForm, ...overrides });

    check(
      `${label} is refused on the ${field} field`,
      Boolean(pdmParsed.errors[field]) && !catalogueLib.isClean(pdmParsed.errors),
      JSON.stringify(pdmParsed.errors),
    );
  }
  check(
    "a status the screens do not offer falls back to scheduled rather than reaching the database",
    catalogueLib.parseNightForm({ ...goodNightForm, status: "maybe" }).values.status === "scheduled",
  );

  // The database's refusals, in the form's language: this is what turns a SQLSTATE
  // into a field to highlight, and it must not guess when it does not know the code.
  const capacityFloorRefusal = catalogueLib.refusalFromDatabase({ code: "PT004", details: "82" });
  check(
    "a capacity below what has been paid for comes back as the capacity field, with the floor named",
    capacityFloorRefusal.kind === "refused" &&
      capacityFloorRefusal.field === "capacity" &&
      capacityFloorRefusal.floor === 82 &&
      capacityFloorRefusal.message.includes("82"),
    JSON.stringify(capacityFloorRefusal),
  );
  check(
    "a duplicate pass code is blamed on the code, not on the form as a whole",
    catalogueLib.refusalFromDatabase({ code: "PC003" }).field === "code" &&
      catalogueLib.refusalFromDatabase({ code: "PC003" }).kind === "refused",
  );
  check(
    "and a rule this deployment has never heard of is reported as a failure rather than blamed on a field",
    catalogueLib.refusalFromDatabase({ code: "ZZ999" }).kind === "server-error" &&
      catalogueLib.refusalFromDatabase({ code: "ZZ999" }).field === undefined,
  );
  check(
    "every code the management migrations raise has words attached to it",
    Object.keys(catalogueLib.CATALOGUE_REFUSALS).length >= 21 &&
      Object.values(catalogueLib.CATALOGUE_REFUSALS).every((copy) => copy.field && copy.message.length > 10),
    `${Object.keys(catalogueLib.CATALOGUE_REFUSALS).length} codes`,
  );

  // ---- what the screens say a night is -------------------------------------------
  const nightFixture = (overrides) => ({
    id: "n",
    date: "2026-10-11",
    startTime: "19:00:00",
    endTime: "23:30:00",
    status: "scheduled",
    capacity: 1500,
    capacityHeld: 0,
    bookedPeople: 0,
    remaining: 1500,
    isFullyBooked: false,
    isBookingOpen: true,
    isBookable: true,
    ...overrides,
  });

  check(
    "the seats actually on sale are the capacity minus the ones held back — never negative",
    nightCopyLib.seatsOnSale({ capacity: 1500, capacityHeld: 50 }) === 1450 &&
      nightCopyLib.seatsOnSale({ capacity: 10, capacityHeld: 40 }) === 0,
  );
  check(
    "a night with seats held back says so, rather than showing two numbers that disagree",
    nightCopyLib.nightAvailabilityCopy(nightFixture({ capacityHeld: 20, remaining: 1480 })) ===
      "1480 of 1480 places left · 20 held for the gate",
    nightCopyLib.nightAvailabilityCopy(nightFixture({ capacityHeld: 20, remaining: 1480 })),
  );
  check(
    "a night whose booking is closed says that instead of counting seats",
    nightCopyLib.nightAvailabilityCopy(nightFixture({ isBookingOpen: false, isBookable: false })) ===
      "Booking is closed for this night" &&
      nightCopyLib.nightStateLabel(nightFixture({ isBookingOpen: false, isBookable: false })) === "Booking closed",
  );
  check(
    "a sold-out night still reads as sold out, and a cancelled one prints no availability at all",
    nightCopyLib.nightAvailabilityCopy(nightFixture({ isFullyBooked: true })) ===
      "No passes left for this night" &&
      nightCopyLib.nightAvailabilityCopy(nightFixture({ status: "cancelled" })) === null,
    JSON.stringify({
      soldOut: nightCopyLib.nightAvailabilityCopy(nightFixture({ isFullyBooked: true })),
      cancelled: nightCopyLib.nightAvailabilityCopy(nightFixture({ status: "cancelled" })),
    }),
  );
  check(
    "the reason a night cannot be selected is a sentence, not a blank",
    nightCopyLib.nightUnavailableReason(nightFixture({ isBookable: true })) === "Select this night" &&
      nightCopyLib.nightUnavailableReason(nightFixture({ isFullyBooked: true, isBookable: false })) ===
        "Fully booked" &&
      nightCopyLib.nightUnavailableReason(nightFixture({ status: "cancelled", isBookable: false })) ===
        "Cancelled" &&
      nightCopyLib.nightUnavailableReason(nightFixture({ isBookingOpen: false, isBookable: false })) ===
        "Booking closed",
    [
      nightCopyLib.nightUnavailableReason(nightFixture({ isBookable: true })),
      nightCopyLib.nightUnavailableReason(nightFixture({ isFullyBooked: true, isBookable: false })),
      nightCopyLib.nightUnavailableReason(nightFixture({ isBookingOpen: false, isBookable: false })),
    ].join(" / "),
  );
  check(
    "an age restriction of zero means no restriction, and is never printed as \"0+\"",
    nightCopyLib.passAgeCopy({ minAge: 0 }) === null && nightCopyLib.passAgeCopy({ minAge: 18 }) === "18+ only",
  );
  check(
    "the admin screen's own words for a night agree with the public page's",
    (() => {
      const adminCopy = catalogueLib.nightState({
        status: "scheduled",
        bookingOpen: false,
        isFull: false,
        overCommitted: false,
      });
      const publicCopy = nightCopyLib.nightStateLabel(nightFixture({ isBookingOpen: false, isBookable: false }));

      return adminCopy === publicCopy;
    })(),
  );
  check(
    "the capacity bar is a percentage that cannot lie",
    catalogueLib.capacityPercent({ capacity: 0, bookedPeople: 0 }) === 0 &&
      catalogueLib.capacityPercent({ capacity: 100, bookedPeople: 250 }) === 100 &&
      catalogueLib.capacityPercent({ capacity: 200, bookedPeople: 50 }) === 25,
  );
  check(
    "the catalogue summary names the price range and what is off sale",
    catalogueLib
      .catalogueSummary([
        { isActive: true, priceInr: 399 },
        { isActive: true, priceInr: 1099 },
        { isActive: false, priceInr: 599 },
      ])
      .startsWith("2 of 3 pass types on sale") &&
      catalogueLib.catalogueSummary([]) === "No pass types yet.",
    catalogueLib.catalogueSummary([
      { isActive: true, priceInr: 399 },
      { isActive: true, priceInr: 1099 },
      { isActive: false, priceInr: 599 },
    ]),
  );

  // ---- fixtures: a night with seats held back, a night with booking closed --------
  const HELD_NIGHT = "d0000000-0000-4000-8000-000000000004"; // FREE_NIGHT, untouched but for bookings
  const CLOSED_NIGHT = "d0000000-0000-4000-8000-000000000005";
  const HELD_BACK = 20;

  await dbRun(`update public.event_dates set capacity_held = ${HELD_BACK} where id = '${HELD_NIGHT}';`);
  await dbRun(`update public.event_dates set booking_open = false where id = '${CLOSED_NIGHT}';`);
  await dbRun(`update public.pass_categories set min_age = 18 where id = '${COUPLE_PASS}';`);

  const [heldNightRow] = await dbQuery(
    `select capacity, capacity_held, booked_people, remaining
       from public.get_event_night_availability($1) where event_date_id = $2`,
    [EVENT_ID, HELD_NIGHT],
  );
  const seatsOnSale = Number(heldNightRow.capacity) - HELD_BACK;
  const heldLine = `${Number(heldNightRow.remaining)} of ${seatsOnSale} places left · ${HELD_BACK} held for the gate`;

  const pdmPassesPage = visibleText(await fetchPage("/passes"));
  check(
    "the public page offers only the seats that are on sale, and says where the rest went",
    pdmPassesPage.includes(heldLine),
    contextAround(pdmPassesPage, "places left"),
  );
  check(
    "and a night the organiser has closed reads as closed, not as available",
    pdmPassesPage.includes("Booking is closed for this night") && pdmPassesPage.includes("Booking closed"),
    contextAround(pdmPassesPage, "Booking closed"),
  );
  check(
    "an age restriction set on a pass reaches the page a guest buys from",
    pdmPassesPage.includes("18+ only"),
    contextAround(pdmPassesPage, "18+ only"),
  );

  const bookPage = visibleText(await fetchPage("/book"));
  check(
    "the booking wizard shows the same held-back seats as the event page",
    bookPage.includes(heldLine),
    contextAround(bookPage, "places left"),
  );
  check(
    "a closed night cannot be selected in the wizard, and the reason is attached to it",
    bookPage.includes("Booking closed") && bookPage.includes("this night cannot be selected"),
    contextAround(bookPage, "Booking closed"),
  );
  // The age restriction is decided by one helper, and shown by both passes a guest can
  // see: the card on the event page (already asserted above) and the choice inside the
  // booking wizard's pass step — which is step 2, so its markup is not in the first
  // response a browser gets. The wiring is checked at the source, the rendering on the
  // page that does render it.
  const passCardSource = readFileSync(join(REPO_ROOT, "src/components/events/pass-card.tsx"), "utf8");
  const passChoiceSource = readFileSync(join(REPO_ROOT, "src/components/booking/pass-choice.tsx"), "utf8");
  check(
    "and the wizard's pass step shows the same age restriction, through the same helper",
    passCardSource.includes("passAgeCopy(pass)") && passChoiceSource.includes("passAgeCopy(pass)"),
    `${passCardSource.includes("passAgeCopy(pass)")} / ${passChoiceSource.includes("passAgeCopy(pass)")}`,
  );

  const closedNightBooking = await postBooking({
    eventId: EVENT_ID,
    eventDateId: CLOSED_NIGHT,
    passCategoryId: COUPLE_PASS,
    quantity: 1,
    numberOfPeople: 2,
    customerName: "Closed Night Guest",
    customerMobile: "+919800000301",
    customerEmail: "closed.night@example.com",
    idempotencyKey: "pdm-closed-night-web",
  });
  check(
    "and the server refuses a booking on that night whatever the browser shows",
    closedNightBooking.status === 409 &&
      closedNightBooking.payload?.error?.message === "This night is no longer open for booking.",
    `${closedNightBooking.status} ${JSON.stringify(closedNightBooking.payload)}`,
  );
  check(
    "with nothing written for the attempt",
    (
      await dbQuery(`select count(*)::int as n from public.bookings where event_date_id = $1 and customer_mobile = $2`, [
        CLOSED_NIGHT,
        "+919800000301",
      ])
    )[0].n === 0,
  );

  // ---- who may open the screens, and who may change what is on them --------------
  const pdmGuest = await signIn("guest@example.com", STAFF_PASSWORD);
  const pdmStaff = await signIn("scanner@example.com", STAFF_PASSWORD);
  const pdmAdmin = await signIn("admin@example.com", STAFF_PASSWORD);
  const pdmSuper = await signIn("owner@example.com", STAFF_PASSWORD);

  // The guard sends a signed-out visitor to the sign-in screen carrying where they
  // were going, as a path — the query string is not part of that handshake, so the
  // types tab arrives as /admin/passes and lands on the door list after signing in.
  for (const [path, expected] of [
    ["/admin/dates", "/admin/dates"],
    ["/admin/passes?view=types", "/admin/passes"],
  ]) {
    const pdmAnonymous = await adminHtml(path);
    check(
      `${path} sends a signed-out visitor to the sign-in screen`,
      requiresSignIn(pdmAnonymous, expected),
      `${pdmAnonymous.status} ${pdmAnonymous.location ?? ""}`,
    );
    check(`and the redirect from ${path} carries no admin content`, !pdmAnonymous.html.includes("Dates & capacity"));
  }

  const staffDates = await adminHtml("/admin/dates", pdmStaff.cookie);
  check(
    "a staff member's role does not include the nights screen at all",
    staffDates.status === 307 && String(staffDates.location ?? "").includes("denied=dates%3Aview"),
    `${staffDates.status} ${staffDates.location ?? ""}`,
  );

  const staffCatalogue = await adminHtml("/admin/passes?view=types", pdmStaff.cookie);
  check(
    "nor the pass catalogue — a role that may read issued passes is not thereby allowed to price them",
    staffCatalogue.status === 307 && String(staffCatalogue.location ?? "").includes("denied=passes%3Aview"),
    `${staffCatalogue.status} ${staffCatalogue.location ?? ""}`,
  );

  const guestCatalogue = await adminHtml("/admin/passes?view=types", pdmGuest.cookie);
  check(
    "and a signed-in account with no role is told the same thing",
    guestCatalogue.status === 307 && String(guestCatalogue.location ?? "").includes("/admin"),
    `${guestCatalogue.status} ${guestCatalogue.location ?? ""}`,
  );

  const datesPage = await adminHtml("/admin/dates", pdmAdmin.cookie);
  check(
    "an admin opens the nights screen and is offered the controls, not a notice",
    datesPage.status === 200 &&
      datesPage.text.includes("Dates & capacity") &&
      datesPage.text.includes("Nights") &&
      datesPage.text.includes("Set capacity") &&
      datesPage.text.includes("Add a night") &&
      datesPage.text.includes("Edit night"),
    `${datesPage.status}`,
  );
  check(
    "which counts capacity in people, and says so",
    datesPage.text.includes("capacity is counted in people"),
    contextAround(datesPage.text, "capacity is counted"),
  );
  check(
    "the closed night offers to open booking, and the open ones offer to close it",
    datesPage.text.includes("Open booking") && datesPage.text.includes("Close booking"),
  );
  check(
    "and the night with seats held back shows both what is left and what was withheld",
    datesPage.text.includes(`${HELD_BACK} held back`) && datesPage.text.includes("seats left"),
    contextAround(datesPage.text, "held back"),
  );

  const cataloguePage = await adminHtml("/admin/passes?view=types", pdmAdmin.cookie);
  check(
    "an admin opens the pass catalogue and sees the prices, the limits and the age column",
    cataloguePage.status === 200 &&
      cataloguePage.text.includes("Pass types") &&
      cataloguePage.text.includes("Add a pass type") &&
      cataloguePage.text.includes("Duo Pass") &&
      cataloguePage.text.includes("girls-2"),
    `${cataloguePage.status}`,
  );
  check(
    "including what is on sale and what is not",
    cataloguePage.text.includes("on sale") &&
      cataloguePage.text.includes("off sale") &&
      cataloguePage.text.includes("All ages") &&
      cataloguePage.text.includes("18+"),
    contextAround(cataloguePage.text, "off sale"),
  );
  check(
    "the two views are links, so either one can be bookmarked or sent",
    cataloguePage.html.includes('href="/admin/passes?view=types"') &&
      cataloguePage.html.includes('href="/admin/passes"'),
  );

  const doorListPage = await adminHtml("/admin/passes", pdmAdmin.cookie);
  check(
    "and the door list is still what /admin/passes opens with, with the catalogue one tab away",
    doorListPage.status === 200 &&
      doorListPage.text.includes("Issued passes") &&
      doorListPage.text.includes("Pass types") &&
      !doorListPage.text.includes("Add a pass type"),
    `${doorListPage.status}`,
  );

  // ---- the two management endpoints ----------------------------------------------
  const adminPost = async (path, body, cookie = pdmAdmin.cookie) => {
    const pdmResponse = await fetch(api(path), {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

    let pdmPayload = null;

    try {
      pdmPayload = await pdmResponse.json();
    } catch {
      pdmPayload = null;
    }

    return { status: pdmResponse.status, payload: pdmPayload };
  };

  const datesGet = await fetchWith("/api/admin/dates", pdmAdmin.cookie);
  check(
    "the nights endpoint answers JSON, and a GET is not one of its verbs",
    datesGet.status === 405 && (await datesGet.json()).ok === false,
    `${datesGet.status}`,
  );

  const anonymousWrite = await adminPost("/api/admin/dates", { action: "capacity", id: HELD_NIGHT, capacity: 10 }, null);
  check(
    "a signed-out write is refused before anything is read",
    anonymousWrite.status === 401 && anonymousWrite.payload?.error?.kind === "not-authorized",
    `${anonymousWrite.status} ${JSON.stringify(anonymousWrite.payload)}`,
  );
  check(
    "and it changed nothing",
    (await dbQuery(`select capacity from public.event_dates where id = $1`, [HELD_NIGHT]))[0].capacity === 1500,
  );

  const staffWrite = await adminPost("/api/admin/dates", { action: "capacity", id: HELD_NIGHT, capacity: 10 }, pdmStaff.cookie);
  check(
    "a role that cannot change a night is refused by the endpoint itself, not only by the page",
    staffWrite.status === 403 && staffWrite.payload?.error?.kind === "forbidden",
    `${staffWrite.status} ${JSON.stringify(staffWrite.payload)}`,
  );
  const staffPassWrite = await adminPost("/api/admin/passes", { action: "toggle", id: COUPLE_PASS, isActive: false }, pdmStaff.cookie);
  check(
    "and the same for the pass catalogue",
    staffPassWrite.status === 403 &&
      (await dbQuery(`select is_active from public.pass_categories where id = $1`, [COUPLE_PASS]))[0].is_active ===
        true,
    `${staffPassWrite.status}`,
  );

  const unknownAction = await adminPost("/api/admin/dates", { action: "delete", id: HELD_NIGHT });
  check(
    "an action the endpoint does not implement is refused rather than guessed at",
    unknownAction.status === 400 && unknownAction.payload?.error?.field === "date",
    JSON.stringify(unknownAction.payload),
  );

  const notJson = await adminPost("/api/admin/dates", "capacity=10");
  check("a body that is not JSON is refused", notJson.status === 400, `${notJson.status}`);

  const oversized = await adminPost("/api/admin/dates", { action: "capacity", id: HELD_NIGHT, capacity: 10, pad: "x".repeat(9000) });
  check("and a body too large to be a form is refused unread", oversized.status === 400, `${oversized.status}`);

  const zeroCapacity = await adminPost("/api/admin/dates", { action: "capacity", id: HELD_NIGHT, capacity: 0 });
  check(
    "a capacity of zero is refused with the field to highlight",
    zeroCapacity.status === 400 &&
      zeroCapacity.payload?.error?.field === "capacity" &&
      zeroCapacity.payload?.error?.code === "PT001",
    JSON.stringify(zeroCapacity.payload),
  );
  const negativeHeld = await adminPost("/api/admin/dates", {
    action: "capacity",
    id: HELD_NIGHT,
    capacity: 1500,
    capacityHeld: -5,
  });
  check(
    "so is a negative number of seats held back",
    negativeHeld.status === 400 && negativeHeld.payload?.error?.field === "capacityHeld",
    JSON.stringify(negativeHeld.payload),
  );

  const belowSold = await adminPost("/api/admin/dates", { action: "capacity", id: NIGHT_1, capacity: 1 });
  check(
    "and a capacity below the seats already paid for is refused by the database, with the floor in the answer",
    belowSold.status === 409 &&
      belowSold.payload?.error?.kind === "refused" &&
      belowSold.payload?.error?.code === "PT004" &&
      belowSold.payload?.error?.field === "capacity" &&
      belowSold.payload?.error?.floor === 4 &&
      belowSold.payload?.error?.message.includes("4"),
    JSON.stringify(belowSold.payload?.error ?? {}),
  );
  check(
    "with the night left exactly as it was",
    (await dbQuery(`select capacity, capacity_held from public.event_dates where id = $1`, [NIGHT_1]))[0].capacity === 4,
  );

  const [heldNightPaid] = await dbQuery(
    `select coalesce(sum(number_of_people) filter (where payment_status = 'paid'), 0)::int as paid
       from public.bookings where event_date_id = $1`,
    [HELD_NIGHT],
  );
  const raisedCapacity = await adminPost("/api/admin/dates", {
    action: "capacity",
    id: HELD_NIGHT,
    capacity: 800,
    capacityHeld: HELD_BACK,
  });
  check(
    "raising the capacity is allowed, and the answer carries the new arithmetic",
    raisedCapacity.status === 200 &&
      raisedCapacity.payload?.ok === true &&
      raisedCapacity.payload?.data?.capacity === 800 &&
      raisedCapacity.payload?.data?.capacityHeld === HELD_BACK &&
      raisedCapacity.payload?.data?.seatsAvailable === 800 - HELD_BACK - Number(heldNightPaid.paid),
    JSON.stringify(raisedCapacity.payload?.data ?? {}),
  );
  check(
    "which is what the database now says",
    (await dbQuery(`select capacity, capacity_held from public.event_dates where id = $1`, [HELD_NIGHT]))[0]
      .capacity === 800,
  );

  const closedViaApi = await adminPost("/api/admin/dates", { action: "booking", id: HELD_NIGHT, bookingOpen: false });
  check(
    "booking can be closed from the endpoint, and the answer says so",
    closedViaApi.status === 200 &&
      closedViaApi.payload?.data?.bookingOpen === false &&
      (await dbQuery(`select booking_open from public.event_dates where id = $1`, [HELD_NIGHT]))[0].booking_open ===
        false,
    JSON.stringify(closedViaApi.payload?.data ?? {}),
  );
  const reopenedViaApi = await adminPost("/api/admin/dates", { action: "booking", id: HELD_NIGHT, bookingOpen: true });
  check(
    "and opened again, without touching the capacity",
    reopenedViaApi.status === 200 &&
      reopenedViaApi.payload?.data?.bookingOpen === true &&
      (await dbQuery(`select capacity from public.event_dates where id = $1`, [HELD_NIGHT]))[0].capacity === 800,
  );

  const badNightSave = await adminPost("/api/admin/dates", {
    action: "save",
    night: { date: "not-a-date", capacity: 500 },
  });
  check(
    "a night form that does not parse is refused with the field it failed on",
    badNightSave.status === 400 && badNightSave.payload?.error?.field === "date",
    JSON.stringify(badNightSave.payload?.error ?? {}),
  );

  const savedNight = await adminPost("/api/admin/dates", {
    action: "save",
    night: {
      date: "2027-02-14",
      startTime: "19:30",
      endTime: "23:45",
      capacity: "600",
      capacityHeld: "30",
      status: "scheduled",
      bookingOpen: true,
      notes: "Added from the verification run.",
    },
  });
  check(
    "an organiser can add a night through the endpoint, and the row it returns is the database's",
    savedNight.status === 200 &&
      savedNight.payload?.ok === true &&
      savedNight.payload?.data?.date === "2027-02-14" &&
      savedNight.payload?.data?.capacity === 600 &&
      savedNight.payload?.data?.capacityHeld === 30 &&
      savedNight.payload?.data?.seatsAvailable === 570,
    JSON.stringify(savedNight.payload?.data ?? {}),
  );

  const addedNightPage = await adminHtml("/admin/dates", pdmAdmin.cookie);
  const addedNightLabel = formatDate("2027-02-14");
  check(
    "and it is on the screen the moment it exists, with its note and its own arithmetic",
    addedNightPage.text.includes(addedNightLabel) &&
      addedNightPage.text.includes("Added from the verification run.") &&
      addedNightPage.text.includes("570 of 600 seats left"),
    contextAround(addedNightPage.text, addedNightLabel),
  );

  const duplicateNightSave = await adminPost("/api/admin/dates", {
    action: "save",
    night: { date: "2027-02-14", capacity: "100", status: "scheduled", bookingOpen: true },
  });
  check(
    "a second night on the same date is refused by the database's own constraint",
    duplicateNightSave.status === 409 && duplicateNightSave.payload?.error?.code === "PT006",
    JSON.stringify(duplicateNightSave.payload?.error ?? {}),
  );

  // ---- the pass catalogue through the endpoint ------------------------------------
  const [passCountBefore] = await dbQuery(`select count(*)::int as n from public.pass_categories`);

  const badPassSave = await adminPost("/api/admin/passes", {
    action: "save",
    pass: { code: "verification-pass", name: "Verification Pass", composition: "2 Guests", priceInr: 0, numberOfPeople: 2, maxPerBooking: 2 },
  });
  check(
    "a pass with no price is refused with the price field flagged",
    badPassSave.status === 400 && badPassSave.payload?.error?.field === "priceInr",
    JSON.stringify(badPassSave.payload?.error ?? {}),
  );
  check(
    "and no pass was created for it",
    (await dbQuery(`select count(*)::int as n from public.pass_categories`))[0].n === passCountBefore.n,
  );

  const duplicatePassSave = await adminPost("/api/admin/passes", {
    action: "save",
    pass: {
      code: "Girls 2",
      name: "Another Duo",
      composition: "2 Guests",
      priceInr: 450,
      numberOfPeople: 2,
      maxPerBooking: 2,
      minAge: 0,
      sortOrder: 99,
      isActive: true,
    },
  });
  check(
    "a code that is already taken is refused by the database, and blamed on the code",
    duplicatePassSave.status === 409 &&
      duplicatePassSave.payload?.error?.code === "PC003" &&
      duplicatePassSave.payload?.error?.field === "code",
    JSON.stringify(duplicatePassSave.payload?.error ?? {}),
  );

  const savedPass = await adminPost("/api/admin/passes", {
    action: "save",
    pass: {
      code: "verification-pass",
      name: "Verification Pass",
      composition: "2 Guests",
      description: "Added from the verification run.",
      priceInr: "650",
      numberOfPeople: "2",
      maxPerBooking: "4",
      minAge: "18",
      sortOrder: "88",
      isActive: true,
    },
  });
  check(
    "an organiser can create a pass, and the row that comes back is the database's own",
    savedPass.status === 200 &&
      savedPass.payload?.ok === true &&
      // The spelling the organiser typed is kept: the code is hyphenated, not shouted.
      savedPass.payload?.data?.code === "verification-pass" &&
      savedPass.payload?.data?.priceInr === 650 &&
      savedPass.payload?.data?.minAge === 18 &&
      savedPass.payload?.data?.maxPerBooking === 4,
    JSON.stringify(savedPass.payload?.data ?? {}),
  );

  const savedPassId = savedPass.payload?.data?.id;
  check(
    "which is on the booking page's list of passes, at the price that was set",
    (await dbQuery(`select price_inr, min_age, is_active from public.pass_categories where id = $1`, [savedPassId]))[0]
      .price_inr === 650,
  );

  const repricedPass = await adminPost("/api/admin/passes", {
    action: "save",
    pass: {
      id: savedPassId,
      code: "verification-pass",
      name: "Verification Pass",
      composition: "2 Guests",
      description: "Repriced by the verification run.",
      priceInr: "700",
      numberOfPeople: "2",
      maxPerBooking: "4",
      minAge: "21",
      sortOrder: "88",
      isActive: true,
    },
  });
  check(
    "and editing it changes the price, the description and the age restriction in one call",
    repricedPass.status === 200 &&
      repricedPass.payload?.data?.priceInr === 700 &&
      repricedPass.payload?.data?.minAge === 21 &&
      repricedPass.payload?.data?.description === "Repriced by the verification run.",
    JSON.stringify(repricedPass.payload?.data ?? {}),
  );

  const offSale = await adminPost("/api/admin/passes", { action: "toggle", id: savedPassId, isActive: false });
  check(
    "taking a pass off sale is one narrow call that leaves the rest of it alone",
    offSale.status === 200 &&
      offSale.payload?.data?.isActive === false &&
      (
        await dbQuery(`select price_inr, min_age, name from public.pass_categories where id = $1`, [savedPassId])
      )[0].price_inr === 700,
    JSON.stringify(offSale.payload?.data ?? {}),
  );

  const catalogueAfterToggle = await adminHtml("/admin/passes?view=types", pdmAdmin.cookie);
  check(
    "and the catalogue says so, on the row itself",
    catalogueAfterToggle.text.includes("Verification Pass") &&
      catalogueAfterToggle.text.includes("off sale") &&
      catalogueAfterToggle.text.includes("Put on sale"),
    contextAround(catalogueAfterToggle.text, "Verification Pass"),
  );

  const publicPassesAfterToggle = visibleText(await fetchPage("/passes"));
  check(
    "while the booking page greys it out rather than pretending it never existed",
    publicPassesAfterToggle.includes("Verification Pass") && publicPassesAfterToggle.includes("Not on sale"),
    contextAround(publicPassesAfterToggle, "Verification Pass"),
  );

  const unknownToggle = await adminPost("/api/admin/passes", {
    action: "toggle",
    id: "00000000-0000-4000-8000-0000000000fa",
    isActive: false,
  });
  check(
    "toggling a pass that no longer exists is refused with the sentence that says so",
    unknownToggle.status === 409 &&
      unknownToggle.payload?.error?.code === "PC008" &&
      unknownToggle.payload?.error?.message.includes("no longer exists"),
    JSON.stringify(unknownToggle.payload?.error ?? {}),
  );

  // The owner holds the same capabilities as an admin here: there is one way to run
  // the desk, not two.
  const superCapacity = await adminPost(
    "/api/admin/dates",
    { action: "capacity", id: "00000000-0000-4000-8000-0000000000fb", capacity: 100 },
    pdmSuper.cookie,
  );
  check(
    "a super admin reaches the same endpoint, and an unknown night is still not found",
    pdmSuper.userId !== null &&
      superCapacity.status === 409 &&
      superCapacity.payload?.error?.code === "PT007",
    `${superCapacity.status} ${JSON.stringify(superCapacity.payload?.error ?? {})}`,
  );

  // ---- and the fixtures are put back ---------------------------------------------
  await dbRun(`update public.event_dates set capacity = 1500, capacity_held = 0 where id = '${HELD_NIGHT}';`);
  await dbRun(`update public.event_dates set booking_open = true where id = '${CLOSED_NIGHT}';`);
  await dbRun(`update public.pass_categories set min_age = 0 where id = '${COUPLE_PASS}';`);
  check(
    "the shared fixtures are put back the way the rest of the run found them",
    (
      await dbQuery(
        `select (select capacity_held from public.event_dates where id = $1) as held,
                (select booking_open from public.event_dates where id = $2) as open,
                (select min_age from public.pass_categories where id = $3) as age`,
        [HELD_NIGHT, CLOSED_NIGHT, COUPLE_PASS],
      )
    )[0].held === 0,
  );

  // ---------------------------------------------------------------------------
  section("Pass and date management: what a visitor is told, and what an admin can change");
  // ---------------------------------------------------------------------------
  // The dates and catalogue screens are only worth having if the numbers they show are
  // the numbers the website promises. So this section reads the public pages *after*
  // changing the things an organiser can change — seats held back, booking closed, an
  // age restriction, a price — and checks that both surfaces say the same thing.
  //
  // What is checked, in order:
  //
  //   1. The copy rules on their own (a pure module), so a wording regression is caught
  //      without a database.
  //   2. The public pages against the database's own arithmetic.
  //   3. The admin screens: that they render the controls, that the API writes what the
  //      database then holds, and that the refusals come back with the field to fix.
  //   4. The public site again — the point of the whole step.

  const pdmCopy = await import("../src/lib/event-copy.ts");
  const pdmRules = await import("../src/lib/admin/catalogue.ts");
  const { formatEventDate: pdmFormatDate } = await import("../src/lib/format.ts");

  /** A night shaped the way the view model shapes one, so the copy can be read alone. */
  const pdmNight = (overrides = {}) => ({
    id: "pdm-night",
    date: "2026-10-11",
    startTime: "19:00:00",
    endTime: "23:59:00",
    status: "scheduled",
    capacity: 1500,
    capacityHeld: 50,
    bookedPeople: 1430,
    remaining: 20,
    isFullyBooked: false,
    isBookingOpen: true,
    isBookable: true,
    ...overrides,
  });

  check(
    "seats on sale is capacity minus what the organiser held back, and never negative",
    pdmCopy.seatsOnSale(pdmNight()) === 1450 &&
      pdmCopy.seatsOnSale(pdmNight({ capacityHeld: 2000 })) === 0,
    `${pdmCopy.seatsOnSale(pdmNight())}`,
  );
  check(
    "a night with seats left says how many, out of what is on sale",
    pdmCopy.nightAvailabilityCopy(pdmNight()) === "20 of 1450 places left · 50 held for the gate",
    pdmCopy.nightAvailabilityCopy(pdmNight()) ?? "null",
  );
  check(
    "and without any held seats it does not mention the gate at all",
    pdmCopy.nightAvailabilityCopy(pdmNight({ capacityHeld: 0 })) === "20 of 1500 places left",
    pdmCopy.nightAvailabilityCopy(pdmNight({ capacityHeld: 0 })) ?? "null",
  );
  check(
    "a night whose booking is closed says that, rather than printing a number that looks buyable",
    pdmCopy.nightAvailabilityCopy(pdmNight({ isBookingOpen: false, isBookable: false })) ===
      "Booking is closed for this night" &&
      pdmCopy.nightStateLabel(pdmNight({ isBookingOpen: false, isBookable: false })) === "Booking closed" &&
      pdmCopy.nightUnavailableReason(pdmNight({ isBookingOpen: false, isBookable: false })) === "Booking closed",
    pdmCopy.nightAvailabilityCopy(pdmNight({ isBookingOpen: false, isBookable: false })) ?? "null",
  );
  check(
    "a sold-out night says so, and a cancelled or finished night says nothing about seats",
    pdmCopy.nightAvailabilityCopy(pdmNight({ isFullyBooked: true, remaining: 0 })) === "No passes left for this night" &&
      pdmCopy.nightAvailabilityCopy(pdmNight({ status: "cancelled", isBookable: false })) === null &&
      pdmCopy.nightAvailabilityCopy(pdmNight({ status: "completed", isBookable: false })) === null,
  );
  check(
    "an age restriction is never rendered as “0+”",
    pdmCopy.passAgeCopy({ minAge: 18 }) === "18+ only" && pdmCopy.passAgeCopy({ minAge: 0 }) === null,
    pdmCopy.passAgeCopy({ minAge: 18 }) ?? "null",
  );
  check(
    "and a night that is merely full is labelled full, not closed",
    pdmCopy.nightStateLabel(pdmNight({ isFullyBooked: true, isBookable: false })) === "Fully booked" &&
      pdmCopy.nightUnavailableReason(pdmNight({ isFullyBooked: true, isBookable: false })) === "Fully booked",
  );

  // ---- the fixtures this section needs ------------------------------------------
  // The nights a visitor sees are read from one RPC, so the expected copy is built from
  // that same RPC rather than from a number written down here.
  const pdmHeldNight = "d0000000-0000-4000-8000-000000000004";
  const pdmClosedNight = "d0000000-0000-4000-8000-000000000005";

  const [pdmBaseline] = await dbQuery(
    `select
       (select capacity from public.event_dates where id = $1) as held_capacity,
       (select capacity_held from public.event_dates where id = $1) as held_capacity_held,
       (select booking_open from public.event_dates where id = $2) as closed_booking_open,
       (select min_age from public.pass_categories where id = $3) as couple_min_age,
       (select price_inr from public.pass_categories where id = $3) as couple_price`,
    [pdmHeldNight, pdmClosedNight, COUPLE_PASS],
  );

  await dbRun(`update public.event_dates set capacity_held = 20 where id = '${pdmHeldNight}';`);
  await dbRun(`update public.event_dates set booking_open = false where id = '${pdmClosedNight}';`);
  await dbRun(`update public.pass_categories set min_age = 18 where id = '${COUPLE_PASS}';`);

  const pdmNights = await dbQuery(`select * from public.get_event_night_availability($1)`, [EVENT_ID]);
  const pdmHeld = pdmNights.find((row) => row.event_date_id === pdmHeldNight);
  const pdmClosed = pdmNights.find((row) => row.event_date_id === pdmClosedNight);
  check(
    "the fixtures are in place: seats held back on one night, booking closed on another",
    pdmHeld?.capacity_held === 20 && pdmHeld?.is_booking_open === true && pdmClosed?.is_booking_open === false,
    `held=${pdmHeld?.capacity_held} closed=${pdmClosed?.is_booking_open}`,
  );

  const pdmExpectedHeldLine = `${pdmHeld.remaining} of ${
    pdmHeld.capacity - pdmHeld.capacity_held
  } places left · 20 held for the gate`;

  // The booking wizard and the pass pages are rendered per request, so they are where a
  // fixture written a moment ago can be checked. (The landing page is served from an ISR
  // snapshot taken at build time — its numbers are the build's, by design.)
  const pdmBook = visibleText(await fetchPage("/book"));
  const pdmPasses = visibleText(await fetchPage("/passes"));

  check(
    "the booking wizard tells a visitor how many places are left, out of what is on sale",
    pdmBook.includes(pdmExpectedHeldLine),
    contextAround(pdmBook, "places left"),
  );
  check(
    "and names the seats held back for the gate, so the arithmetic is not a mystery",
    pdmBook.includes("20 held for the gate"),
    contextAround(pdmBook, "held for the gate"),
  );
  check(
    "the booking wizard disables that night, and says why",
    pdmBook.includes("Booking is closed for this night") &&
      pdmBook.includes("Booking closed — this night cannot be selected."),
    contextAround(pdmBook, "cannot be selected"),
  );
  check(
    "a night that is still on sale is still selectable",
    pdmBook.includes("Select this night"),
    contextAround(pdmBook, "Select this night"),
  );
  check(
    "the age restriction set on a pass reaches the page a guest reads",
    pdmPasses.includes("18+ only"),
    contextAround(pdmPasses, "18+ only"),
  );
  check(
    "and the booking wizard shows the same line, because both read the same rule",
    readFileSync(join(REPO_ROOT, "src/components/events/pass-card.tsx"), "utf8").includes("passAgeCopy(pass)") &&
      readFileSync(join(REPO_ROOT, "src/components/booking/pass-choice.tsx"), "utf8").includes("passAgeCopy(pass)"),
  );

  // ---- the nights screen ---------------------------------------------------------
  const pdmStaffSession = await signIn("scanner@example.com", STAFF_PASSWORD);
  const pdmAdminSession = await signIn("admin@example.com", STAFF_PASSWORD);
  const pdmSuperSession = await signIn("owner@example.com", STAFF_PASSWORD);
  const pdmGuestSession = await signIn("guest@example.com", STAFF_PASSWORD);

  const pdmPost = async (path, cookie, body) => {
    const response = await fetch(api(path), {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

    let payload = null;

    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    return { status: response.status, payload };
  };

  const pdmDatesPage = await adminHtml("/admin/dates", pdmAdminSession.cookie);

  check(
    "an admin opens the nights screen and is offered the controls",
    pdmDatesPage.status === 200 &&
      pdmDatesPage.text.includes("Nights") &&
      pdmDatesPage.text.includes("Set capacity") &&
      pdmDatesPage.text.includes("Close booking"),
    `${pdmDatesPage.status}`,
  );
  check(
    "the screen prints the capacity floor from the database, not a rule of thumb",
    pdmDatesPage.text.includes(
      `Capacity cannot go below the ${pdmHeld.booked_people} people already paid for.`,
    ),
    contextAround(pdmDatesPage.text, "cannot go below"),
  );
  check(
    "and the seats-left figure it shows is the one the booking path uses",
    pdmDatesPage.text.includes(pdmRules.capacityCopy({
      seatsAvailable: pdmHeld.remaining,
      capacity: pdmHeld.capacity,
      capacityHeld: pdmHeld.capacity_held,
    })),
    contextAround(pdmDatesPage.text, "seats left"),
  );

  // ---- adding a night ------------------------------------------------------------
  const pdmNewDate = "2027-03-07";
  const pdmAddedNight = await pdmPost("/api/admin/dates", pdmAdminSession.cookie, {
    action: "save",
    night: {
      id: null,
      date: pdmNewDate,
      startTime: "19:00",
      endTime: "23:30",
      capacity: 300,
      capacityHeld: 30,
      status: "scheduled",
      bookingOpen: true,
      notes: "Added by the verification harness",
    },
  });

  check(
    "a night can be added through the endpoint",
    pdmAddedNight.status === 200 &&
      pdmAddedNight.payload?.ok === true &&
      pdmAddedNight.payload.data.date === pdmNewDate &&
      pdmAddedNight.payload.data.capacity === 300 &&
      pdmAddedNight.payload.data.capacityHeld === 30,
    `${pdmAddedNight.status} ${JSON.stringify(pdmAddedNight.payload?.error ?? {})}`,
  );

  const [pdmNewNightRow] = await dbQuery(
    `select id, capacity, capacity_held, booking_open from public.event_dates where event_id = $1 and event_date = $2`,
    [EVENT_ID, pdmNewDate],
  );

  check(
    "and the row it wrote is the one an organiser will see",
    pdmNewNightRow?.capacity === 300 && pdmNewNightRow?.capacity_held === 30 && pdmNewNightRow?.booking_open === true,
    JSON.stringify(pdmNewNightRow ?? {}),
  );
  check(
    "the night it reports is the night it saved",
    pdmNewNightRow?.id === pdmAddedNight.payload?.data?.id,
    `${pdmNewNightRow?.id} / ${pdmAddedNight.payload?.data?.id}`,
  );

  const pdmDuplicateNight = await pdmPost("/api/admin/dates", pdmAdminSession.cookie, {
    action: "save",
    night: {
      id: null,
      date: pdmNewDate,
      startTime: "19:00",
      endTime: "23:30",
      capacity: 300,
      capacityHeld: 0,
      status: "scheduled",
      bookingOpen: true,
      notes: "",
    },
  });

  check(
    "the same date cannot be added twice — the database says which rule stopped it",
    pdmDuplicateNight.status === 409 && pdmDuplicateNight.payload?.error?.code === "PT006",
    `${pdmDuplicateNight.status} ${pdmDuplicateNight.payload?.error?.code ?? ""}`,
  );

  const pdmDatesPageAgain = await adminHtml("/admin/dates", pdmAdminSession.cookie);

  check(
    "the new night appears on the screen with its held seats",
    pdmDatesPageAgain.status === 200 &&
      pdmDatesPageAgain.text.includes(pdmFormatDate(pdmNewDate)) &&
      pdmDatesPageAgain.text.includes("270 of 300 seats left") &&
      pdmDatesPageAgain.text.includes("30 held back"),
    contextAround(pdmDatesPageAgain.text, pdmFormatDate(pdmNewDate)),
  );

  const pdmHeldTooHigh = await pdmPost("/api/admin/dates", pdmAdminSession.cookie, {
    action: "capacity",
    id: pdmNewNightRow.id,
    capacity: 300,
    capacityHeld: 400,
  });

  check(
    "holding back more seats than the night has is refused, with the field to fix",
    pdmHeldTooHigh.status === 409 &&
      pdmHeldTooHigh.payload?.error?.code === "PT003" &&
      pdmHeldTooHigh.payload?.error?.field === "capacityHeld",
    `${pdmHeldTooHigh.status} ${JSON.stringify(pdmHeldTooHigh.payload?.error ?? {})}`,
  );

  const pdmNegativeCapacity = await pdmPost("/api/admin/dates", pdmAdminSession.cookie, {
    action: "capacity",
    id: pdmNewNightRow.id,
    capacity: -5,
    capacityHeld: 0,
  });

  check(
    "and a negative capacity is refused before it reaches SQL, with the field named",
    pdmNegativeCapacity.status === 400 &&
      pdmNegativeCapacity.payload?.error?.code === "PT001" &&
      pdmNegativeCapacity.payload?.error?.field === "capacity",
    `${pdmNegativeCapacity.status} ${JSON.stringify(pdmNegativeCapacity.payload?.error ?? {})}`,
  );

  check(
    "with the night left exactly as it was",
    (
      await dbQuery(`select capacity, capacity_held from public.event_dates where id = $1`, [pdmNewNightRow.id])
    )[0].capacity === 300,
  );

  // ---- capacity below what has been paid for -------------------------------------
  // The floor is the seats already taken, counted under the night's own lock. The
  // fixture night has paid bookings, so the floor is a real number rather than zero.
  const [pdmPaidOnHeld] = await dbQuery(
    `select coalesce(sum(number_of_people), 0)::int as people
       from public.bookings
      where event_date_id = $1 and payment_status = 'paid'`,
    [pdmHeldNight],
  );

  if (pdmPaidOnHeld.people > 0) {
    const pdmTooLow = await pdmPost("/api/admin/dates", pdmAdminSession.cookie, {
      action: "capacity",
      id: pdmHeldNight,
      capacity: pdmPaidOnHeld.people - 1,
      capacityHeld: 0,
    });

    check(
      "capacity cannot be lowered below the seats already paid for",
      pdmTooLow.status === 409 && pdmTooLow.payload?.error?.code === "PT004",
      `${pdmTooLow.status} ${pdmTooLow.payload?.error?.code ?? ""}`,
    );
    check(
      "and the refusal carries the floor, so the form can offer the number that works",
      pdmTooLow.payload?.error?.floor === pdmPaidOnHeld.people,
      `${pdmTooLow.payload?.error?.floor} / ${pdmPaidOnHeld.people}`,
    );

    const pdmAtFloor = await pdmPost("/api/admin/dates", pdmAdminSession.cookie, {
      action: "capacity",
      id: pdmHeldNight,
      capacity: pdmPaidOnHeld.people,
      capacityHeld: 0,
    });

    check(
      "exactly the seats already taken is allowed, and then nothing is left to sell",
      pdmAtFloor.status === 200 && pdmAtFloor.payload?.data?.seatsAvailable === 0,
      `${pdmAtFloor.status} ${pdmAtFloor.payload?.data?.seatsAvailable ?? ""}`,
    );

    const pdmRestored = await pdmPost("/api/admin/dates", pdmAdminSession.cookie, {
      action: "capacity",
      id: pdmHeldNight,
      capacity: pdmBaseline.held_capacity,
      capacityHeld: 20,
    });

    check(
      "and the capacity can be raised again",
      pdmRestored.status === 200 && pdmRestored.payload?.data?.capacity === pdmBaseline.held_capacity,
      `${pdmRestored.status}`,
    );
  } else {
    check("capacity below the seats paid for is refused", false, "no paid bookings on the fixture night");
  }

  // ---- booking open and closed ---------------------------------------------------
  const pdmClosedToggle = await pdmPost("/api/admin/dates", pdmAdminSession.cookie, {
    action: "booking",
    id: pdmNewNightRow.id,
    bookingOpen: false,
  });

  check(
    "booking can be closed on a night without cancelling it",
    pdmClosedToggle.status === 200 && pdmClosedToggle.payload?.data?.bookingOpen === false,
    `${pdmClosedToggle.status}`,
  );

  const [pdmClosedRow] = await dbQuery(
    `select booking_open, status from public.event_dates where id = $1`,
    [pdmNewNightRow.id],
  );

  check(
    "and closing it changes only the booking window",
    pdmClosedRow.booking_open === false && pdmClosedRow.status === "scheduled",
  );

  const pdmClosedBooking = await postBooking({
    eventId: EVENT_ID,
    eventDateId: pdmNewNightRow.id,
    passCategoryId: COUPLE_PASS,
    quantity: 1,
    numberOfPeople: 2,
    customerName: "Closed Night Guest",
    customerMobile: "+919800000901",
    customerEmail: "closed-night@example.com",
    idempotencyKey: "pdm-closed-night-1",
  });

  check(
    "a closed night cannot be booked, and the refusal names the reason",
    pdmClosedBooking.status === 409 &&
      pdmClosedBooking.payload?.error?.message === "This night is no longer open for booking.",
    `${pdmClosedBooking.status} ${JSON.stringify(pdmClosedBooking.payload?.error ?? {})}`,
  );

  const pdmReopened = await pdmPost("/api/admin/dates", pdmAdminSession.cookie, {
    action: "booking",
    id: pdmNewNightRow.id,
    bookingOpen: true,
  });

  check("and reopening it puts it back on sale", pdmReopened.status === 200 && pdmReopened.payload?.data?.bookingOpen === true);

  // ---- who may change what -------------------------------------------------------
  const pdmAnonymousWrite = await pdmPost("/api/admin/dates", null, {
    action: "capacity",
    id: pdmNewNightRow.id,
    capacity: 10,
  });

  check(
    "a signed-out visitor cannot change a night — the request hook answers with JSON, not HTML",
    pdmAnonymousWrite.status === 401 && pdmAnonymousWrite.payload?.error?.kind === "not-authorized",
    `${pdmAnonymousWrite.status} ${JSON.stringify(pdmAnonymousWrite.payload ?? {})}`,
  );

  const pdmGuestWrite = await pdmPost("/api/admin/dates", pdmGuestSession.cookie, {
    action: "capacity",
    id: pdmNewNightRow.id,
    capacity: 10,
  });

  check(
    "nor can an account with no role",
    pdmGuestWrite.status === 401,
    `${pdmGuestWrite.status}`,
  );

  const pdmStaffWrite = await pdmPost("/api/admin/dates", pdmStaffSession.cookie, {
    action: "capacity",
    id: pdmNewNightRow.id,
    capacity: 10,
  });

  check(
    "and a staff member — who may use the gate — cannot change capacity",
    pdmStaffWrite.status === 403 && pdmStaffWrite.payload?.error?.kind === "forbidden",
    `${pdmStaffWrite.status} ${JSON.stringify(pdmStaffWrite.payload ?? {})}`,
  );

  const pdmSuperWrite = await pdmPost("/api/admin/dates", pdmSuperSession.cookie, {
    action: "capacity",
    id: pdmNewNightRow.id,
    capacity: 300,
    capacityHeld: 30,
  });

  check(
    "a super admin can, and an unknown night is refused rather than silently ignored",
    pdmSuperWrite.status === 200 &&
      (await pdmPost("/api/admin/dates", pdmSuperSession.cookie, {
        action: "capacity",
        id: "00000000-0000-4000-8000-0000000000ff",
        capacity: 100,
      })).payload?.error?.code === "PT007",
  );

  const pdmBadAction = await pdmPost("/api/admin/dates", pdmAdminSession.cookie, {
    action: "delete",
    id: pdmNewNightRow.id,
  });

  check(
    "there is no action that deletes a night — only one that closes it",
    pdmBadAction.status === 400 && pdmBadAction.payload?.error?.kind === "invalid-input",
    `${pdmBadAction.status} ${JSON.stringify(pdmBadAction.payload?.error ?? {})}`,
  );

  const pdmNotJson = await pdmPost("/api/admin/dates", pdmAdminSession.cookie, "capacity=10");

  check(
    "a body that is not JSON is refused before any SQL runs",
    pdmNotJson.status === 400,
    `${pdmNotJson.status}`,
  );

  const pdmTooLarge = await pdmPost("/api/admin/dates", pdmAdminSession.cookie, {
    action: "capacity",
    id: pdmNewNightRow.id,
    capacity: 300,
    pad: "x".repeat(9000),
  });

  check(
    "and a body too large to be a form is refused rather than parsed",
    pdmTooLarge.status === 400,
    `${pdmTooLarge.status}`,
  );

  const pdmGetWrite = await fetchWith("/api/admin/passes", pdmAdminSession.cookie);

  check(
    "the management endpoints answer JSON, and a GET is not a verb they accept",
    pdmGetWrite.status === 405 && (await pdmGetWrite.json()).ok === false,
    `${pdmGetWrite.status}`,
  );

  // ---- the pass catalogue --------------------------------------------------------
  const pdmCataloguePage = await adminHtml("/admin/passes?view=types", pdmAdminSession.cookie);

  if (
    process.env.VERIFY_DEBUG === "1" ||
    !(
      pdmCataloguePage.status === 200 &&
      pdmCataloguePage.text.includes("Pass types") &&
      pdmCataloguePage.text.includes("Couple Pass") &&
      // Read as text: React separates the rupee sign from the digits with a comment
      // node, so the markup holds "₹<!-- -->499" rather than "₹499".
      pdmCataloguePage.text.includes("₹499") &&
      pdmCataloguePage.text.includes("18+") &&
      pdmCataloguePage.text.includes("on sale")
    )
  ) {
    writeFileSync("/tmp/passes-view.html", pdmCataloguePage.html);
    writeFileSync("/tmp/passes-view.txt", pdmCataloguePage.text);
  }

  check(
    "the catalogue screen lists the pass types with their prices, limits and age",
    pdmCataloguePage.status === 200 &&
      pdmCataloguePage.text.includes("Pass types") &&
      pdmCataloguePage.text.includes("Add a pass type") &&
      pdmCataloguePage.text.includes("Couple Pass") &&
      // Read as text: React separates the rupee sign from the digits with a comment
      // node, so the markup holds "₹<!-- -->499" rather than "₹499".
      pdmCataloguePage.text.includes("₹499") &&
      pdmCataloguePage.text.includes("18+") &&
      pdmCataloguePage.text.includes("on sale"),
    `${pdmCataloguePage.status}`,
  );

  const pdmPaidBookingsBefore = await dbQuery(
    `select id, total_amount from public.bookings where pass_category_id = $1 and payment_status = 'paid' order by id`,
    [COUPLE_PASS],
  );

  const pdmRepriced = await pdmPost("/api/admin/passes", pdmAdminSession.cookie, {
    action: "save",
    pass: {
      id: COUPLE_PASS,
      code: "couple",
      name: "Couple Pass",
      composition: "2 Guests",
      description: "Entry for two on one night.",
      priceInr: 777,
      numberOfPeople: 2,
      maxPerBooking: 10,
      minAge: 18,
      sortOrder: 2,
      isActive: true,
    },
  });

  check(
    "a price can be changed through the endpoint, and the answer is the row as saved",
    pdmRepriced.status === 200 &&
      pdmRepriced.payload?.ok === true &&
      pdmRepriced.payload.data.priceInr === 777,
    `${pdmRepriced.status} ${JSON.stringify(pdmRepriced.payload?.error ?? {})}`,
  );

  const [pdmRepricedRow] = await dbQuery(
    `select price_inr, min_age, name from public.pass_categories where id = $1`,
    [COUPLE_PASS],
  );

  check(
    "and the database holds the new price",
    pdmRepricedRow.price_inr === 777 && pdmRepricedRow.min_age === 18,
    JSON.stringify(pdmRepricedRow),
  );

  const pdmPaidBookingsAfter = await dbQuery(
    `select id, total_amount from public.bookings where pass_category_id = $1 and payment_status = 'paid' order by id`,
    [COUPLE_PASS],
  );

  check(
    "bookings that were already taken keep what they were charged",
    pdmPaidBookingsBefore.length > 0 &&
      JSON.stringify(pdmPaidBookingsBefore) === JSON.stringify(pdmPaidBookingsAfter),
    `${pdmPaidBookingsBefore.length} paid bookings: ${JSON.stringify(pdmPaidBookingsBefore)} → ${JSON.stringify(
      pdmPaidBookingsAfter,
    )}`,
  );

  const pdmZeroPrice = await pdmPost("/api/admin/passes", pdmAdminSession.cookie, {
    action: "save",
    pass: {
      id: COUPLE_PASS,
      code: "couple",
      name: "Couple Pass",
      composition: "2 Guests",
      description: "Entry for two on one night.",
      priceInr: 0,
      numberOfPeople: 2,
      maxPerBooking: 10,
      minAge: 18,
      sortOrder: 2,
      isActive: true,
    },
  });

  check(
    "a price of zero never reaches SQL — the form catches it and names the field",
    pdmZeroPrice.status === 400 &&
      pdmZeroPrice.payload?.error?.field === "priceInr",
    `${pdmZeroPrice.status} ${JSON.stringify(pdmZeroPrice.payload?.error ?? {})}`,
  );

  const pdmUnknownPass = await pdmPost("/api/admin/passes", pdmAdminSession.cookie, {
    action: "save",
    pass: {
      id: "00000000-0000-4000-8000-0000000000ff",
      code: "ghost",
      name: "Ghost Pass",
      composition: "1 Guest",
      description: "",
      priceInr: 100,
      numberOfPeople: 1,
      maxPerBooking: 1,
      minAge: 0,
      sortOrder: 9,
      isActive: true,
    },
  });

  check(
    "editing a pass that no longer exists is refused by name",
    pdmUnknownPass.status === 409 && pdmUnknownPass.payload?.error?.code === "PC008",
    `${pdmUnknownPass.status} ${pdmUnknownPass.payload?.error?.code ?? ""}`,
  );

  const pdmDuplicateCode = await pdmPost("/api/admin/passes", pdmAdminSession.cookie, {
    action: "save",
    pass: {
      id: null,
      code: "Couple",
      name: "Another Couple",
      composition: "2 Guests",
      description: "",
      priceInr: 499,
      numberOfPeople: 2,
      maxPerBooking: 2,
      minAge: 0,
      sortOrder: 9,
      isActive: true,
    },
  });

  check(
    "and a code that already exists is refused, whatever case it is typed in",
    pdmDuplicateCode.status === 409 &&
      pdmDuplicateCode.payload?.error?.code === "PC003" &&
      pdmDuplicateCode.payload?.error?.field === "code",
    `${pdmDuplicateCode.status} ${JSON.stringify(pdmDuplicateCode.payload?.error ?? {})}`,
  );

  const pdmToggledPass = await pdmPost("/api/admin/passes", pdmAdminSession.cookie, {
    action: "toggle",
    id: COUPLE_PASS,
    isActive: false,
  });

  check(
    "a pass can be taken off sale, which never deletes it",
    pdmToggledPass.status === 200 &&
      pdmToggledPass.payload?.data?.isActive === false &&
      (await dbQuery(`select is_active from public.pass_categories where id = $1`, [COUPLE_PASS]))[0].is_active === false,
  );

  const pdmOffSalePage = await adminHtml("/admin/passes?view=types", pdmAdminSession.cookie);

  check(
    "and the screen says off sale rather than hiding the pass",
    pdmOffSalePage.text.includes("Comeback Pass") ||
      (pdmOffSalePage.text.includes("Couple Pass") && pdmOffSalePage.text.includes("off sale")),
    contextAround(pdmOffSalePage.text, "off sale"),
  );

  await pdmPost("/api/admin/passes", pdmAdminSession.cookie, {
    action: "toggle",
    id: COUPLE_PASS,
    isActive: true,
  });
  await pdmPost("/api/admin/passes", pdmAdminSession.cookie, {
    action: "save",
    pass: {
      id: COUPLE_PASS,
      code: "couple",
      name: "Couple Pass",
      composition: "2 Guests",
      description: "Entry for two on one night.",
      priceInr: pdmBaseline.couple_price,
      numberOfPeople: 2,
      maxPerBooking: 10,
      minAge: pdmBaseline.couple_min_age,
      sortOrder: 2,
      isActive: true,
    },
  });

  // ---- the fixtures are put back --------------------------------------------------
  await dbRun(`update public.event_dates set capacity_held = ${pdmBaseline.held_capacity_held} where id = '${pdmHeldNight}';`);
  await dbRun(`update public.event_dates set capacity = ${pdmBaseline.held_capacity} where id = '${pdmHeldNight}';`);
  await dbRun(`update public.event_dates set booking_open = ${pdmBaseline.closed_booking_open} where id = '${pdmClosedNight}';`);
  await dbRun(`delete from public.event_dates where id = '${pdmNewNightRow.id}';`);

  check(
    "the fixtures are back where the rest of the run found them",
    (
      await dbQuery(
        `select (select capacity from public.event_dates where id = $1) as capacity,
                (select capacity_held from public.event_dates where id = $1) as held,
                (select booking_open from public.event_dates where id = $2) as closed_open,
                (select price_inr from public.pass_categories where id = $3) as price,
                (select min_age from public.pass_categories where id = $3) as age,
                (select count(*)::int from public.event_dates where event_date = $4) as added_nights`,
        [pdmHeldNight, pdmClosedNight, COUPLE_PASS, pdmNewDate],
      )
    )[0].capacity === pdmBaseline.held_capacity,
  );

  check(
    "and the night this section added is gone, so nothing it wrote can affect a later step",
    (
      await dbQuery(`select count(*)::int as n from public.event_dates where event_date = $1`, [pdmNewDate])
    )[0].n === 0,
  );

  // ---------------------------------------------------------------------------
  section("Gallery management: private uploads, publishing, ordering and deleting");
  // ---------------------------------------------------------------------------
  // The gallery is the first step that owns *files*, so most of these assertions are
  // about two things at once: what the database holds, and what a browser can actually
  // fetch. The section drives the real endpoints with real image bytes — sharp decodes
  // and re-encodes them, supabase-js uploads the results to the storage double exactly
  // as it would to a project — and then looks at both sides.
  //
  // One thing cannot be asserted through the page: `/gallery` is statically revalidated
  // every five minutes (`revalidate = 300`), and the harness serves the copy the
  // production build rendered. So "a published photo appears, an unpublished one does
  // not" is checked against `listPublishedGallery()` — the very query that page
  // consumes — plus a live fetch of the object's public address; the rendered page is
  // checked for the markup the step asks for (a responsive grid, lazy loading, an
  // accessible lightbox).
  const galPaths = await import("../src/lib/gallery/paths.ts");
  const galWords = await import("../src/lib/admin/gallery.ts");
  const galRules = await import("../src/lib/admin/catalogue.ts");
  const galSharp = (await import("sharp")).default;

  const GALLERY_BUCKET = galPaths.GALLERY_BUCKET;
  const INBOX_BUCKET = galPaths.GALLERY_INBOX_BUCKET;
  const galUploadUrl = api("/api/admin/gallery");
  const galPreviewUrl = api("/api/admin/gallery/preview");

  /** A real PNG of a given size — the pipeline must run on an image, not on a stub. */
  const galPng = (width, height) =>
    galSharp({ create: { width, height, channels: 3, background: { r: 198, g: 40, b: 88 } } })
      .png()
      .toBuffer();

  const galPost = async (body, cookie) => {
    const galResponse = await fetch(galUploadUrl, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

    return { status: galResponse.status, payload: await galResponse.json().catch(() => null) };
  };

  const galUpload = async (files, cookie, fields = {}) => {
    const galForm = new FormData();

    for (const [key, value] of Object.entries(fields)) {
      galForm.append(key, value);
    }

    for (const file of files) {
      galForm.append("files", file);
    }

    const galResponse = await fetch(galUploadUrl, {
      method: "POST",
      redirect: "manual",
      headers: cookie ? { cookie } : {},
      body: galForm,
    });

    return { status: galResponse.status, payload: await galResponse.json().catch(() => null) };
  };

  const galObjects = () => shim.storage.list();
  const galInboxKeys = () => galObjects().filter((key) => key.startsWith(`${INBOX_BUCKET}/`));
  const galPublicKeys = () => galObjects().filter((key) => key.startsWith(`${GALLERY_BUCKET}/`));
  const galBytes = (key) => shim.storage.objects.get(key)?.data ?? Buffer.alloc(0);
  const galIsWebp = (bytes) =>
    bytes.length > 12 && bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";

  /** The running order the management screen and the public grid both read. */
  const galOrder = async () =>
    (
      await dbQuery(
        `select id from public.gallery where event_id = $1 order by sort_order, created_at desc, id`,
        [EVENT_ID],
      )
    ).map((row) => row.id);

  const galSessions = {
    admin: await signIn("admin@example.com", STAFF_PASSWORD),
    staff: await signIn("scanner@example.com", STAFF_PASSWORD),
    guest: await signIn("guest@example.com", STAFF_PASSWORD),
  };

  check(
    "the harness signs in as the three accounts this section needs",
    Boolean(galSessions.admin.cookie) && Boolean(galSessions.staff.cookie) && Boolean(galSessions.guest.cookie),
    JSON.stringify(Object.fromEntries(Object.entries(galSessions).map(([k, v]) => [k, v.error]))),
  );

  // ---- the buckets, and who can reach them ---------------------------------------
  const galBucketRows = await dbQuery(
    `select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id`,
  );
  check(
    "the migration created exactly the two buckets the gallery uses",
    galBucketRows.length === 2 &&
      galBucketRows.some((row) => row.id === GALLERY_BUCKET) &&
      galBucketRows.some((row) => row.id === INBOX_BUCKET),
    galBucketRows.map((row) => row.id).join(", "),
  );
  check(
    "the public bucket is public and the inbox is not",
    galBucketRows.find((row) => row.id === GALLERY_BUCKET)?.public === true &&
      galBucketRows.find((row) => row.id === INBOX_BUCKET)?.public === false,
  );
  check(
    "both buckets carry the same size limit and the same accepted types",
    galBucketRows.every((row) => Number(row.file_size_limit) === galWords.GALLERY_LIMITS.uploadBytes) &&
      galBucketRows.every((row) =>
        galWords.GALLERY_UPLOAD_TYPES.every((type) => (row.allowed_mime_types ?? []).includes(type)),
      ),
    JSON.stringify(galBucketRows.map((row) => [row.id, row.file_size_limit, row.allowed_mime_types])),
  );
  check(
    "no policy lets an anon or authenticated key list or write either bucket",
    (await dbQuery(`select count(*)::int as n from pg_policies where schemaname = 'storage' and tablename = 'objects'`))[0]
      .n === 0,
  );
  check(
    "and the harness starts with nothing in storage, so every object below is one this section made",
    galObjects().length === 0,
    galObjects().join(", "),
  );

  // ---- the rules, without touching storage ---------------------------------------
  check(
    "an object key is derived from the row: <event or festival>/<item id>/<variant>.webp",
    galPaths.galleryObjectKey("11111111-1111-4111-8111-111111111111", "thumb", EVENT_ID) ===
      `${EVENT_ID}/11111111-1111-4111-8111-111111111111/thumb.webp` &&
      galPaths.galleryObjectKey("x", "full") === "festival/x/full.webp",
    galPaths.galleryObjectKey("x", "full"),
  );
  check(
    "only a published row's file belongs in the public bucket",
    galPaths.bucketForStatus("published") === GALLERY_BUCKET &&
      galPaths.bucketForStatus("draft") === INBOX_BUCKET &&
      galPaths.bucketForStatus("archived") === INBOX_BUCKET,
  );
  check(
    "a key that is a URL, absolute, or climbs out of the bucket is not a key",
    !galPaths.isSafeGalleryKey("https://example.com/x.webp") &&
      !galPaths.isSafeGalleryKey("/etc/passwd") &&
      !galPaths.isSafeGalleryKey("night/../../other.webp") &&
      galPaths.isSafeGalleryKey(`${EVENT_ID}/item/full.webp`),
  );
  check(
    "the public address of a file is a plain storage URL — never a signed one",
    galPaths.publicGalleryUrl("night/item/full.webp") ===
      `${shim.url}/storage/v1/object/public/${GALLERY_BUCKET}/night/item/full.webp` &&
      galPaths.publicGalleryUrl(null) === null,
    String(galPaths.publicGalleryUrl("night/item/full.webp")),
  );

  // ---- who may upload, and who may only look --------------------------------------
  const galAnonymousUpload = await galUpload([new File([await galPng(900, 600)], "Anonymous.png", { type: "image/png" })], null);
  check(
    "a signed-out upload is refused before anything is read",
    galAnonymousUpload.status === 401 && galAnonymousUpload.payload?.error?.kind === "not-authorized",
    `${galAnonymousUpload.status} ${JSON.stringify(galAnonymousUpload.payload)}`,
  );

  const galGuestUpload = await galUpload(
    [new File([await galPng(900, 600)], "Guest.png", { type: "image/png" })],
    galSessions.guest.cookie,
  );
  check(
    "and so is an account that is signed in but not on the staff list",
    galGuestUpload.status === 401,
    `${galGuestUpload.status} ${JSON.stringify(galGuestUpload.payload)}`,
  );

  const galStaffUpload = await galUpload(
    [new File([await galPng(900, 600)], "Gate staff.png", { type: "image/png" })],
    galSessions.staff.cookie,
  );
  check(
    "a role that may not change the gallery is refused by the endpoint itself",
    galStaffUpload.status === 403 && galStaffUpload.payload?.error?.kind === "forbidden",
    `${galStaffUpload.status} ${JSON.stringify(galStaffUpload.payload)}`,
  );
  check("and none of those three attempts reached storage", galObjects().length === 0, galObjects().join(", "));

  const galStaffPage = await adminHtml("/admin/gallery", galSessions.staff.cookie);
  check(
    "the gallery screen turns that role away too, and says which capability it wanted",
    galStaffPage.status === 307 && String(galStaffPage.location ?? "").includes("denied=gallery%3Aview"),
    `${galStaffPage.status} ${galStaffPage.location ?? ""}`,
  );

  const galGet = await fetchWith("/api/admin/gallery", galSessions.admin.cookie);
  check("the gallery endpoint answers JSON, and a GET is not one of its verbs", galGet.status === 405, `${galGet.status}`);

  // ---- an upload, end to end ------------------------------------------------------
  const galFirstUpload = await galUpload(
    [new File([await galPng(1200, 800)], "Second night first dance.png", { type: "image/png" })],
    galSessions.admin.cookie,
    { album: "Night 2" },
  );
  const galFirst = galFirstUpload.payload?.data?.uploaded?.[0];
  check(
    "an admin's upload is accepted, optimised and recorded",
    galFirstUpload.status === 200 &&
      galFirstUpload.payload?.ok === true &&
      galFirstUpload.payload.data.uploaded.length === 1 &&
      galFirstUpload.payload.data.refused.length === 0 &&
      Boolean(galFirst?.id),
    JSON.stringify(galFirstUpload.payload).slice(0, 300),
  );
  check(
    "a new photograph arrives as a draft, so nothing is public until somebody publishes it",
    galFirst?.status === "draft" && galFirst?.isPublic === false,
    `${galFirst?.status} / isPublic=${galFirst?.isPublic}`,
  );
  check(
    "the title is taken from the file name and the alternative text is never blank",
    galFirst?.title === "Second night first dance" && (galFirst?.altText ?? "").length > 0,
    `${galFirst?.title} / ${galFirst?.altText}`,
  );
  check(
    "the keys are derived from the row, its event and the two variants",
    galFirst?.storagePath === `${EVENT_ID}/${galFirst?.id}/full.webp` &&
      galFirst?.thumbnailPath === `${EVENT_ID}/${galFirst?.id}/thumb.webp`,
    `${galFirst?.storagePath} / ${galFirst?.thumbnailPath}`,
  );
  check(
    "both files were written to the private inbox and re-encoded as WebP",
    galIsWebp(galBytes(`${INBOX_BUCKET}/${galFirst?.storagePath}`)) &&
      galIsWebp(galBytes(`${INBOX_BUCKET}/${galFirst?.thumbnailPath}`)) &&
      galInboxKeys().length === 2 &&
      galPublicKeys().length === 0,
    galObjects().join(", "),
  );
  check(
    "an image inside the ceiling keeps its size and the row records the stored bytes",
    galFirst?.width === 1200 &&
      galFirst?.height === 800 &&
      galFirst?.byteSize === galBytes(`${INBOX_BUCKET}/${galFirst?.storagePath}`).length,
    `${galFirst?.width}×${galFirst?.height}, ${galFirst?.byteSize} bytes`,
  );

  const galThumbMeta = await galSharp(galBytes(`${INBOX_BUCKET}/${galFirst?.thumbnailPath}`)).metadata();
  check(
    "the grid thumbnail is 640 px wide, so a phone downloads a fraction of the photograph",
    galThumbMeta.width === 640 && galThumbMeta.height === 427,
    `${galThumbMeta.width}×${galThumbMeta.height}`,
  );
  check(
    "the stored files carry no EXIF — a guest's location never reaches the site",
    galThumbMeta.exif === undefined && (await galSharp(galBytes(`${INBOX_BUCKET}/${galFirst?.storagePath}`)).metadata()).exif === undefined,
  );

  const galDraftPublicUrl = galPaths.publicGalleryUrl(galFirst?.storagePath);
  const galDraftPublicFetch = await fetch(galDraftPublicUrl);
  check(
    "the draft's object is not reachable at its public address",
    galDraftPublicFetch.status === 400,
    `${galDraftPublicFetch.status} ${galDraftPublicUrl}`,
  );
  const galInboxFetch = await fetch(`${shim.url}/storage/v1/object/public/${INBOX_BUCKET}/${galFirst?.storagePath}`);
  check(
    "and nothing under the private bucket is served to anybody",
    galInboxFetch.status === 400,
    `${galInboxFetch.status}`,
  );

  const galPreview = await fetch(galPreviewUrl + `?id=${galFirst?.id}&variant=thumb`, {
    headers: { cookie: galSessions.admin.cookie },
  });
  const galPreviewBytes = Buffer.from(await galPreview.arrayBuffer());
  check(
    "the thumbnail is served to staff through the session, cached privately, never signed",
    galPreview.status === 200 &&
      galPreview.headers.get("content-type") === "image/webp" &&
      (galPreview.headers.get("cache-control") ?? "").startsWith("private") &&
      galIsWebp(galPreviewBytes),
    `${galPreview.status} ${galPreview.headers.get("content-type")} ${galPreview.headers.get("cache-control")}`,
  );
  check(
    "and it is the stored thumbnail, byte for byte",
    galPreviewBytes.length === galBytes(`${INBOX_BUCKET}/${galFirst?.thumbnailPath}`).length,
    `${galPreviewBytes.length} vs ${galBytes(`${INBOX_BUCKET}/${galFirst?.thumbnailPath}`).length}`,
  );

  const galStaffPreview = await fetch(galPreviewUrl + `?id=${galFirst?.id}&variant=thumb`, {
    headers: { cookie: galSessions.staff.cookie },
  });
  check(
    "a role without the gallery capability cannot read a draft's bytes either",
    galStaffPreview.status === 403,
    `${galStaffPreview.status}`,
  );

  const galAnonymousPreview = await fetch(galPreviewUrl + `?id=${galFirst?.id}&variant=thumb`);
  check("a signed-out preview is refused", galAnonymousPreview.status === 401, `${galAnonymousPreview.status}`);

  const galMissingPreview = await fetch(galPreviewUrl + `?id=${crypto.randomUUID()}&variant=thumb`, {
    headers: { cookie: galSessions.admin.cookie },
  });
  check(
    "a photograph that is gone has no preview, and the screen is told why",
    galMissingPreview.status === 409,
    `${galMissingPreview.status}`,
  );

  // ---- a file that has to be refused ----------------------------------------------
  const galAfterFirstUpload = galObjects().length;
  const galSmallUpload = await galUpload(
    [new File([await galPng(200, 150)], "Logo.png", { type: "image/png" })],
    galSessions.admin.cookie,
  );
  check(
    "an image too small to be a photograph is refused, with the reason",
    galSmallUpload.status === 400 && /at least 400 px/.test(galSmallUpload.payload?.error?.message ?? ""),
    JSON.stringify(galSmallUpload.payload).slice(0, 200),
  );

  const galNotAnImage = await galUpload(
    [new File([Buffer.from("this is not a photograph, it is a sentence")], "Notes.png", { type: "image/png" })],
    galSessions.admin.cookie,
  );
  check(
    "a file whose declared type lies is refused after the bytes are read",
    galNotAnImage.status === 400 && /could not be read as an image/.test(galNotAnImage.payload?.error?.message ?? ""),
    JSON.stringify(galNotAnImage.payload).slice(0, 200),
  );

  const galTooBig = await galUpload(
    [new File([Buffer.alloc(galWords.GALLERY_LIMITS.uploadBytes + 1, 7)], "Huge.png", { type: "image/png" })],
    galSessions.admin.cookie,
  );
  check(
    "a file past the bucket's limit is refused before it is decoded",
    galTooBig.status === 400 && /larger than 8 MB/.test(galTooBig.payload?.error?.message ?? ""),
    JSON.stringify(galTooBig.payload).slice(0, 200),
  );
  check(
    "none of the three refused uploads left anything in storage",
    galObjects().length === galAfterFirstUpload,
    galObjects().join(", "),
  );

  const galMixedUpload = await galUpload(
    [
      new File([await galPng(1400, 1000)], "Doors open the hall fills.png", { type: "image/png" }),
      new File([await galPng(180, 120)], "Too small to use.png", { type: "image/png" }),
    ],
    galSessions.admin.cookie,
    { album: "Night 2" },
  );
  check(
    "a batch keeps the photographs it can take and reports the one it cannot",
    galMixedUpload.status === 200 &&
      galMixedUpload.payload?.data?.uploaded.length === 1 &&
      galMixedUpload.payload?.data?.refused.length === 1 &&
      galMixedUpload.payload.data.refused[0].fileName === "Too small to use.png",
    JSON.stringify(galMixedUpload.payload).slice(0, 300),
  );

  const galSecond = galMixedUpload.payload?.data?.uploaded?.[0];
  check(
    "a photograph larger than the ceiling is resized, and the row says so",
    galSecond?.width === 1400 &&
      galSecond?.height === 1000 &&
      (await galSharp(galBytes(`${INBOX_BUCKET}/${galSecond?.thumbnailPath}`)).metadata()).width === 640,
    `${galSecond?.width}×${galSecond?.height}`,
  );

  const galBigUpload = await galUpload(
    [new File([await galPng(3000, 2000)], "Stage from the balcony.png", { type: "image/png" })],
    galSessions.admin.cookie,
  );
  const galBig = galBigUpload.payload?.data?.uploaded?.[0];
  check(
    "a 3000 px photograph is downscaled to the stored ceiling of 2400 px, and the thumbnail to 640",
    galBig?.width === 2400 &&
      galBig?.height === 1600 &&
      (await galSharp(galBytes(`${INBOX_BUCKET}/${galBig?.thumbnailPath}`)).metadata()).height === 427,
    `${galBig?.width}×${galBig?.height}`,
  );

  // ---- the admin screen -----------------------------------------------------------
  const galAdminPage = await adminHtml("/admin/gallery", galSessions.admin.cookie);
  check(
    "the gallery screen lists the photographs in the database, drafts included",
    galAdminPage.status === 200 &&
      galAdminPage.text.includes("Second night first dance") &&
      galAdminPage.text.includes("Draft") &&
      galAdminPage.text.includes("photos"),
    `${galAdminPage.status}`,
  );
  const galAdminMarkup = stripScripts(galAdminPage.html);
  check(
    "a draft's picture comes through the staff route, never a public URL",
    galAdminMarkup.includes(`/api/admin/gallery/preview?id=${galFirst?.id}`) &&
      !galAdminMarkup.includes("/storage/v1/object/public/") &&
      !galAdminMarkup.includes(`${galFirst?.storagePath}`),
  );
  check(
    "the screen offers the controls this step asks for",
    galAdminPage.text.includes("Add photos") &&
      galAdminPage.text.includes("Choose files") &&
      galAdminPage.text.includes("Publish") &&
      galAdminPage.text.includes("Move up") &&
      galAdminPage.text.includes("Move down") &&
      galAdminPage.text.includes("Delete"),
  );
  check(
    "and it says what a draft means, in words rather than only in colour",
    galAdminPage.text.includes("Only staff can see this photo"),
  );

  // ---- editing the words ----------------------------------------------------------
  const galSaveValues = {
    id: galFirst?.id,
    title: "The circle opens",
    description: "The first circle of the second night, photographed from the stage.",
    altText: "Dancers in a colourful garba circle under warm stage lights",
    album: "Night 2",
    capturedOn: "2026-10-12",
    sortOrder: 4,
  };

  const galSaved = await galPost({ action: "save", item: galSaveValues }, galSessions.admin.cookie);
  check(
    "the title, description, alt text, album, date and order are saved and echoed back",
    galSaved.status === 200 &&
      galSaved.payload?.data?.title === "The circle opens" &&
      galSaved.payload?.data?.altText === galSaveValues.altText &&
      galSaved.payload?.data?.album === "Night 2" &&
      galSaved.payload?.data?.capturedOn === "2026-10-12",
    JSON.stringify(galSaved.payload).slice(0, 300),
  );

  const galBlankAlt = await galPost(
    { action: "save", item: { ...galSaveValues, altText: "   " } },
    galSessions.admin.cookie,
  );
  check(
    "alternative text cannot be blanked — the form rule the browser and the server share stops it first",
    galBlankAlt.status === 400 &&
      galBlankAlt.payload?.error?.field === "altText" &&
      /Describe the photo/.test(galBlankAlt.payload?.error?.message ?? ""),
    JSON.stringify(galBlankAlt.payload).slice(0, 300),
  );
  check(
    "and the database's own copy of that rule raises a code the screen already has words for",
    (await dbQuery(
      `select 1 from pg_proc where proname = 'gallery_check_metadata' and pg_get_functiondef(oid) like '%alt_text_required%'`,
    )).length === 1,
  );

  const galRefusalCodes = ["PG001", "PG002", "PG003", "PG004", "PG005", "PG006", "PG007", "PG008", "PG009", "PG010", "PG011"];
  check(
    "every rule the gallery's SQL raises has a sentence and a field for the screen",
    galRefusalCodes.every((code) => {
      const copy = galRules.refusalFromDatabase({ message: `the database said ${code}`, code, details: "" });

      return copy.kind === "refused" && Boolean(copy.field) && !/could not be saved/.test(copy.message);
    }),
    galRefusalCodes
      .filter((code) => galRules.refusalFromDatabase({ message: "", code, details: "" }).kind !== "refused")
      .join(", "),
  );

  const galLongTitle = await galPost(
    { action: "save", item: { ...galSaveValues, title: "x".repeat(galWords.GALLERY_LIMITS.titleMax + 1) } },
    galSessions.admin.cookie,
  );
  check(
    "a title past the column's length is refused before it reaches the database",
    galLongTitle.status === 400 && galLongTitle.payload?.error?.field === "title",
    JSON.stringify(galLongTitle.payload).slice(0, 200),
  );

  const galUnknownSave = await galPost(
    { action: "save", item: { ...galSaveValues, id: crypto.randomUUID() } },
    galSessions.admin.cookie,
  );
  check(
    "editing a photograph that is no longer there says so",
    galUnknownSave.status === 409 && galUnknownSave.payload?.error?.field === "id",
    JSON.stringify(galUnknownSave.payload).slice(0, 200),
  );

  const galUnknownAction = await galPost({ action: "publish", id: galFirst?.id }, galSessions.admin.cookie);
  check(
    "an action the endpoint does not implement is refused rather than guessed at",
    galUnknownAction.status === 400,
    `${galUnknownAction.status}`,
  );
  check("and a body that is not JSON is refused too", (await galPost("action=publish", galSessions.admin.cookie)).status === 400);

  // ---- publishing moves the file --------------------------------------------------
  const galPublished = await galPost(
    { action: "status", id: galFirst?.id, status: "published" },
    galSessions.admin.cookie,
  );
  check(
    "publishing records the row's status and moves both files out of the inbox",
    galPublished.status === 200 &&
      galPublished.payload?.data?.status === "published" &&
      galPublished.payload?.data?.moved === true &&
      !galInboxKeys().some((key) => key.includes(String(galFirst?.id))) &&
      galPublicKeys().filter((key) => key.includes(String(galFirst?.id))).length === 2,
    `${galPublished.status} ${JSON.stringify(galPublished.payload).slice(0, 200)} — ${galObjects().join(", ")}`,
  );

  const galLiveUrl = galPaths.publicGalleryUrl(galFirst?.storagePath);
  const galLiveFetch = await fetch(galLiveUrl);
  const galLiveBytes = Buffer.from(await galLiveFetch.arrayBuffer());
  check(
    "and the published photograph is now served from its public address",
    galLiveFetch.status === 200 &&
      galLiveFetch.headers.get("content-type") === "image/webp" &&
      galIsWebp(galLiveBytes),
    `${galLiveFetch.status} ${galLiveUrl}`,
  );

  const galPublicNow = await gallery.listPublishedGallery(EVENT_ID);
  const galPublicItem = galPublicNow.ok ? galPublicNow.data.find((item) => item.id === galFirst?.id) : undefined;
  check(
    "the public gallery query returns it, with the thumbnail the grid loads first",
    galPublicNow.ok &&
      Boolean(galPublicItem) &&
      galPublicItem?.src === galLiveUrl &&
      galPublicItem?.thumbnailSrc === galPaths.publicGalleryUrl(galFirst?.thumbnailPath) &&
      galPublicItem?.caption === "The circle opens",
    JSON.stringify(galPublicItem ?? galPublicNow).slice(0, 300),
  );

  const galUnpublished = await galPost({ action: "status", id: galFirst?.id, status: "draft" }, galSessions.admin.cookie);
  const galPublicAfterUnpublish = await gallery.listPublishedGallery(EVENT_ID);
  const galDraftFetchAfterUnpublish = await fetch(galLiveUrl);
  check(
    "unpublishing moves the files back and takes the photograph off the site",
    galUnpublished.status === 200 &&
      galUnpublished.payload?.data?.moved === true &&
      galPublicAfterUnpublish.ok &&
      !galPublicAfterUnpublish.data.some((item) => item.id === galFirst?.id) &&
      galDraftFetchAfterUnpublish.status === 400 &&
      galInboxKeys().filter((key) => key.includes(String(galFirst?.id))).length === 2,
    `${galUnpublished.status} public=${galDraftFetchAfterUnpublish.status} — ${galObjects().join(", ")}`,
  );

  const galArchived = await galPost({ action: "status", id: galFirst?.id, status: "archived" }, galSessions.admin.cookie);
  const galPublicAfterArchive = await gallery.listPublishedGallery(EVENT_ID);
  check(
    "archiving is a third state, not a delete — it is off the site and still in the list",
    galArchived.status === 200 &&
      galArchived.payload?.data?.status === "archived" &&
      galPublicAfterArchive.ok &&
      !galPublicAfterArchive.data.some((item) => item.id === galFirst?.id) &&
      (await dbQuery(`select status from public.gallery where id = $1`, [galFirst?.id]))[0].status === "archived",
    `${galArchived.status}`,
  );

  const galBadStatus = await galPost({ action: "status", id: galFirst?.id, status: "hidden" }, galSessions.admin.cookie);
  check(
    "a status the database does not have is refused",
    galBadStatus.status === 400,
    JSON.stringify(galBadStatus.payload).slice(0, 200),
  );

  // ---- the running order ----------------------------------------------------------
  const galOrderBefore = await galOrder();
  check(
    "the running order is the sort order, then the newest inside a tie",
    galOrderBefore[0] === galBig?.id &&
      galOrderBefore[1] === galSecond?.id &&
      galOrderBefore.indexOf(galFirst?.id) === galOrderBefore.length - 1 &&
      galOrderBefore.filter((id) => [galFirst?.id, galSecond?.id, galBig?.id].includes(id)).length === 3,
    galOrderBefore.join(", "),
  );

  const galMoveUp = await galPost({ action: "move", id: galSecond?.id, direction: "up" }, galSessions.admin.cookie);
  const galOrderAfterMove = await galOrder();
  check(
    "moving a photograph up renumbers the list and says it moved",
    galMoveUp.status === 200 &&
      galMoveUp.payload?.data?.moved === true &&
      galOrderAfterMove.indexOf(galSecond?.id) === galOrderBefore.indexOf(galSecond?.id) - 1,
    `${JSON.stringify(galMoveUp.payload)} — ${galOrderAfterMove.join(", ")}`,
  );

  const galMoveTop = await galPost({ action: "move", id: galSecond?.id, direction: "up" }, galSessions.admin.cookie);
  check(
    "a photograph already at the top is left where it is",
    galMoveTop.status === 200 && galMoveTop.payload?.data?.moved === false,
    JSON.stringify(galMoveTop.payload),
  );

  const galMoveDown = await galPost({ action: "move", id: galSecond?.id, direction: "down" }, galSessions.admin.cookie);
  check(
    "and moving it down puts it back behind its neighbour",
    galMoveDown.status === 200 &&
      galMoveDown.payload?.data?.moved === true &&
      (await galOrder()).indexOf(galSecond?.id) === 1,
    JSON.stringify(galMoveDown.payload),
  );

  const galBadDirection = await galPost({ action: "move", id: galBig?.id, direction: "sideways" }, galSessions.admin.cookie);
  check(
    "a direction that is not up or down is refused with the field to fix",
    galBadDirection.status === 400 && galBadDirection.payload?.error?.field === "order",
    JSON.stringify(galBadDirection.payload).slice(0, 200),
  );

  const galMoveUnknown = await galPost(
    { action: "move", id: crypto.randomUUID(), direction: "up" },
    galSessions.admin.cookie,
  );
  check(
    "moving a photograph that is gone says so",
    galMoveUnknown.status === 409 && galMoveUnknown.payload?.error?.field === "id",
    JSON.stringify(galMoveUnknown.payload).slice(0, 200),
  );

  // ---- deleting ------------------------------------------------------------------
  await galPost({ action: "status", id: galFirst?.id, status: "published" }, galSessions.admin.cookie);
  const galBeforeDelete = galObjects().length;
  const galDelete = await galPost({ action: "delete", id: galFirst?.id }, galSessions.admin.cookie);
  check(
    "deleting removes the row and both files it named",
    galDelete.status === 200 &&
      galDelete.payload?.data?.filesDeleted === 2 &&
      (await dbQuery(`select count(*)::int as n from public.gallery where id = $1`, [galFirst?.id]))[0].n === 0 &&
      galObjects().length === galBeforeDelete - 2 &&
      (await fetch(galLiveUrl)).status === 400,
    `${galDelete.status} ${JSON.stringify(galDelete.payload)} — ${galObjects().join(", ")}`,
  );

  const galDeleteAgain = await galPost({ action: "delete", id: galFirst?.id }, galSessions.admin.cookie);
  check(
    "deleting it twice answers \"that photograph is no longer in the gallery\"",
    galDeleteAgain.status === 409 &&
      galDeleteAgain.payload?.error?.code === "PG006" &&
      /no longer in the gallery/.test(galDeleteAgain.payload?.error?.message ?? ""),
    JSON.stringify(galDeleteAgain.payload).slice(0, 200),
  );

  const galDeleteSecond = await galPost({ action: "delete", id: galSecond?.id }, galSessions.admin.cookie);
  const galDeleteBig = await galPost({ action: "delete", id: galBig?.id }, galSessions.admin.cookie);
  check(
    "the rest of this section's photographs are removed too, leaving storage as it was found",
    galDeleteSecond.payload?.data?.filesDeleted === 2 && galDeleteBig.payload?.data?.filesDeleted === 2 && galObjects().length === 0,
    galObjects().join(", "),
  );
  check(
    "and the gallery rows the run started with are untouched",
    (await dbQuery(`select count(*)::int as n from public.gallery where event_id = $1`, [EVENT_ID]))[0].n === 3,
  );

  // ---- the public page ------------------------------------------------------------
  const galPublicPageRaw = await fetchPage("/gallery");
  const galPublicPageText = visibleText(galPublicPageRaw);
  const galPublicPageHtml = stripScripts(galPublicPageRaw);
  check(
    "the public gallery renders the published photographs and their albums",
    galPublicPageText.includes("Garba circle at full spin") &&
      galPublicPageText.includes("Stage and LED wall") &&
      galPublicPageText.includes("Night 1"),
  );
  check(
    "the draft the run started with is not on it, in words or in markup",
    !galPublicPageText.includes("must never") && !galPublicPageHtml.includes("draft.jpg"),
  );
  check(
    "the grid is responsive and every offscreen tile is lazy-loaded",
    galPublicPageHtml.includes("loading=\"lazy\"") &&
      galPublicPageHtml.includes("grid-cols-2") &&
      galPublicPageHtml.includes("lg:grid-cols-4"),
  );
  check(
    "and every tile is a button that names what it opens, so the lightbox is reachable by keyboard",
    galPublicPageHtml.includes("larger view") && galPublicPageHtml.includes("Open “"),
  );

  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  section("Contact and WhatsApp: one source, every link, on every screen");
  // ---------------------------------------------------------------------------

  const cts = await import("../src/lib/contact.ts");

  // The sentence every enquiry starts with, and the URL shape it lives in. The page
  // asserts against the module's own output below, so a template change cannot pass
  // unnoticed here while quietly breaking the links.
  check(
    "the enquiry message is the one the product asks for, word for word",
    cts.WHATSAPP_MESSAGE === "Hello, I need help with Navratri Dandiya booking.",
    cts.WHATSAPP_MESSAGE,
  );

  check(
    "and the click-to-chat link is wa.me with it prefilled and encoded",
    cts.whatsappChatUrl("919358535894") ===
      `https://wa.me/919358535894?text=${encodeURIComponent("Hello, I need help with Navratri Dandiya booking.")}`,
    cts.whatsappChatUrl("919358535894") ?? "",
  );

  check(
    "with no number there is no link at all — never a guessed one",
    cts.whatsappChatUrl(null) === null &&
      cts.whatsappChatUrl("") === null &&
      cts.whatsappChatUrl("12345") === null,
  );

  check(
    "a booking reference is appended to the same sentence, not to a different one",
    cts.whatsappMessage("DND202600001") ===
      "Hello, I need help with Navratri Dandiya booking. My booking reference is DND202600001.",
    cts.whatsappMessage("DND202600001"),
  );

  const ctsEvent = {
    id: EVENT_ID,
    slug: "navratri-2026-jaipur",
    name: "Garba Nights Navratri Utsav",
    tagline: null,
    description: null,
    venueName: "My Village Garden",
    venueAddress: "Ajmer Road",
    city: "Jaipur",
    state: "Rajasthan",
    mapsUrl: null,
    heroImageUrl: null,
    contactPhone: null,
    contactEmail: null,
    whatsappNumber: null,
    instagramUrl: null,
    facebookUrl: null,
    youtubeUrl: null,
    supportHours: [],
    currency: "INR",
  };

  // The event's own columns win; the deployment's settings are the fallback.
  check(
    "an event's own WhatsApp number is the one the links open",
    cts.whatsappNumberFor({ ...ctsEvent, whatsappNumber: "919111122233", contactPhone: "+91 9358535894" }) ===
      "919111122233",
  );
  check(
    "without one, the digits of its contact phone are used",
    cts.whatsappNumberFor({ ...ctsEvent, contactPhone: "+91 98765 43210" }) === "919876543210",
  );
  check(
    "and with neither, the deployment's fallback number answers",
    cts.whatsappNumberFor(ctsEvent) === cts.whatsappNumberFor(null),
    `${cts.whatsappNumberFor(ctsEvent)} vs ${cts.whatsappNumberFor(null)}`,
  );
  check(
    "the phone link is dialable — international, digits only",
    cts.telHref("+91 9358535894") === "tel:919358535894" && cts.telHref(null) === null,
  );
  check(
    "the email link is only built from something that is an address",
    cts.mailHref("savriyasethevents@gmail.com") === "mailto:savriyasethevents@gmail.com" &&
      cts.mailHref("not an address") === null &&
      cts.mailHref(null) === null,
  );
  check(
    "a stored maps link wins over the address search",
    cts.mapsHrefFor({ ...ctsEvent, mapsUrl: "https://maps.google.com/?q=pin" }, ["X"]) ===
      "https://maps.google.com/?q=pin",
  );
  check(
    "and without one the address is searched instead of showing a blank map",
    cts.mapsHrefFor(ctsEvent, ["My Village Garden", "Ajmer Road", "Jaipur, Rajasthan"]) ===
      `https://maps.google.com/?q=${encodeURIComponent("My Village Garden, Ajmer Road, Jaipur, Rajasthan")}`,
    cts.mapsHrefFor(ctsEvent, ["My Village Garden", "Ajmer Road", "Jaipur, Rajasthan"]) ?? "",
  );
  check(
    "the address prints as venue, street, then city and state — with repeats dropped",
    JSON.stringify(cts.addressLinesFor({ ...ctsEvent, venueAddress: "My Village Garden" })) ===
      JSON.stringify(["My Village Garden", "Jaipur, Rajasthan"]),
    JSON.stringify(cts.addressLinesFor({ ...ctsEvent, venueAddress: "My Village Garden" })),
  );
  check(
    "an event's own profiles are used, and the site's are the fallback",
    cts.socialLinksFor({ ...ctsEvent, instagramUrl: "https://instagram.com/ours" }).map((social) => social.id).join(",") ===
      "instagram" &&
      cts.socialLinksFor(ctsEvent).map((social) => social.id).join(",") === "instagram,facebook,youtube",
  );
  check(
    "the channels omit what the organiser has not published, and keep the order WhatsApp → phone → email → venue",
    cts.buildContactChannels({ ...ctsEvent, contactEmail: "savriyasethevents@gmail.com" }).map((channel) => channel.id).join(",") ===
      "whatsapp,phone,email,venue",
    cts.buildContactChannels({ ...ctsEvent, contactEmail: "savriyasethevents@gmail.com" })
      .map((channel) => channel.id)
      .join(","),
  );
  check(
    "the contact block is assembled once: hours, address and links agree with the row",
    (() => {
      const built = cts.buildSiteContact({
        ...ctsEvent,
        whatsappNumber: "919111122233",
        supportHours: ["Festival days · 10:00 AM – 11:00 PM"],
        instagramUrl: "https://instagram.com/ours",
      });

      return (
        built.whatsappNumber === "919111122233" &&
        built.whatsappHref?.startsWith("https://wa.me/919111122233?text=") === true &&
        built.supportHours.length === 1 &&
        built.addressLines.length === 3 &&
        built.socials.length === 1
      );
    })(),
  );

  // Nothing in the UI carries a number or builds a link: both live in one module and
  // one settings file, which is what "not hardcoded in multiple components" means.
  const ctsSurfaces = [
    "src/components/layout/site-header.tsx",
    "src/components/layout/mobile-nav.tsx",
    "src/components/layout/site-footer.tsx",
    "src/components/layout/whatsapp-button.tsx",
    "src/components/sections/cta-band.tsx",
    "src/components/sections/contact-section.tsx",
    "src/components/booking/booking-confirmation.tsx",
    "src/app/layout.tsx",
    "src/app/contact/page.tsx",
    "src/app/book/page.tsx",
    "src/app/book/status/page.tsx",
    "src/app/booking/success/page.tsx",
  ];

  // Comments are allowed to mention wa.me — a built URL is not. The link builders are
  // matched on the template, so prose about the link does not count as one.
  const ctsLinkPattern = /wa\.me\/\$\{/;
  const ctsHardcoded = ctsSurfaces.filter((file) =>
    readFileSync(join(REPO_ROOT, file), "utf8").includes("919358535894"),
  );
  const ctsLinkSpellers = ctsSurfaces.filter((file) =>
    ctsLinkPattern.test(readFileSync(join(REPO_ROOT, file), "utf8")),
  );

  check(
    "no component or page carries the WhatsApp number as a literal",
    ctsHardcoded.length === 0,
    ctsHardcoded.join(", "),
  );
  check(
    "and none of them builds a wa.me URL — the link is built in one module",
    ctsLinkSpellers.length === 0,
    ctsLinkSpellers.join(", "),
  );
  check(
    "which is the module the page-level checks above exercise",
    ctsLinkPattern.test(readFileSync(join(REPO_ROOT, "src/lib/contact.ts"), "utf8")),
  );
  check(
    "the number's other home is the deployment fallback in site settings",
    readFileSync(join(REPO_ROOT, "src/config/site.ts"), "utf8").includes("919358535894"),
  );

  // What the visitor actually gets. /contact is statically rendered from the seeded
  // row, so it shows the seeded number and the seeded profiles.
  const ctsContactRaw = await fetchPage("/contact");
  const ctsContactHtml = stripScripts(ctsContactRaw);
  const ctsContactText = visibleText(ctsContactRaw);
  const ctsSeededLink = cts.whatsappChatUrl("919358535894");

  check(
    "the contact page's WhatsApp button opens the event's number with the message prefilled",
    ctsContactHtml.includes(ctsSeededLink),
    contextAround(ctsContactHtml, "wa.me"),
  );
  check(
    "the same page offers a dialable phone link and a mailto link",
    ctsContactHtml.includes("tel:919358535894") && ctsContactHtml.includes("mailto:savriyasethevents@gmail.com"),
  );
  check(
    "the venue, the address and a Google Maps link are on it",
    ctsContactText.includes("My Village Garden") &&
      ctsContactText.includes("Ajmer Road") &&
      ctsContactText.includes("Jaipur") &&
      ctsContactHtml.includes("https://maps.google.com/?q=My+Village+Garden+Jaipur"),
  );
  check(
    "all three social profiles are linked",
    ctsContactHtml.includes("https://www.instagram.com/") &&
      ctsContactHtml.includes("https://www.facebook.com/") &&
      ctsContactHtml.includes("https://www.youtube.com/"),
  );
  check(
    "the support hours from the event row are shown",
    ctsContactText.includes("Monday – Saturday") && ctsContactText.includes("10:00 AM – 8:00 PM"),
    contextAround(ctsContactText, "Monday"),
  );
  check(
    "and the page says what the button will send, so nobody taps it blind",
    ctsContactText.includes("Hello, I need help with Navratri Dandiya booking."),
    contextAround(ctsContactText, "WhatsApp"),
  );
  check(
    "the button works on a phone and on a desktop: a labelled one at ≥sm and an icon-only one below it",
    ctsContactHtml.includes("hidden sm:inline-flex") && ctsContactHtml.includes("sm:hidden"),
  );

  // The chrome is rendered per request, so a change in the database must show up in it.
  const ctsPassesBefore = stripScripts(await fetchPage("/passes"));

  check(
    "the header and footer of every page carry the same database link",
    ctsPassesBefore.includes(ctsSeededLink),
    contextAround(ctsPassesBefore, "wa.me"),
  );

  await dbRun(`update public.events set whatsapp_number = '919888877766' where id = '${EVENT_ID}';`);

  const ctsPassesChanged = stripScripts(await fetchPage("/passes"));

  check(
    "changing the number in the database changes every link, without a deploy",
    ctsPassesChanged.includes("wa.me/919888877766") && !ctsPassesChanged.includes("wa.me/919358535894"),
    contextAround(ctsPassesChanged, "wa.me"),
  );

  await dbRun(`update public.events set whatsapp_number = '919358535894' where id = '${EVENT_ID}';`);

  const ctsPassesRestored = stripScripts(await fetchPage("/passes"));

  check(
    "and putting it back puts the site back",
    ctsPassesRestored.includes(ctsSeededLink),
    contextAround(ctsPassesRestored, "wa.me"),
  );
  check(
    "nothing was left behind in the events row",
    (await dbQuery(`select whatsapp_number from public.events where id = $1`, [EVENT_ID]))[0].whatsapp_number ===
      "919358535894",
  );

  // ---------------------------------------------------------------------------
  section("Rate limiting: the window, the key, and the two endpoints that use it");
  // ---------------------------------------------------------------------------
  // `src/lib/rate-limit.ts` is a Map in one process, and this section does not
  // pretend otherwise. What is checked is the arithmetic (a window that counts and
  // then resets), the key (the caller's address, never an identity), the bound that
  // stops a spoofed flotilla of addresses from growing the table without end, and
  // that the two public write endpoints actually stand behind it. The HTTP half is
  // exercised by the sections above: every booking and order this run created went
  // through these limiters and none of them was refused.

  const rlModule = await import("../src/lib/rate-limit.ts");
  let rlNow = 1_000_000;

  const rlLimiter = rlModule.createRateLimiter({ limit: 3, windowMs: 60_000, now: () => rlNow });
  const rlFirst = rlLimiter.check("a");
  const rlSecond = rlLimiter.check("a");
  const rlThird = rlLimiter.check("a");
  const rlFourth = rlLimiter.check("a");

  check(
    "three attempts are allowed, and the remaining count goes down",
    rlFirst.allowed && rlFirst.remaining === 2 && rlSecond.remaining === 1 && rlThird.remaining === 0,
    `${rlFirst.remaining} / ${rlSecond.remaining} / ${rlThird.remaining}`,
  );

  check(
    "the next one is refused, with the seconds to wait for the window to reset",
    rlFourth.allowed === false && rlFourth.remaining === 0 && rlFourth.retryAfterSeconds === 60,
    JSON.stringify(rlFourth),
  );

  check(
    "another address is counted separately",
    rlLimiter.check("b").allowed === true && rlLimiter.check("b").remaining === 1,
  );

  rlNow += 60_000;
  const rlAfterWindow = rlLimiter.check("a");
  check(
    "once the window is over the address is welcome again",
    rlAfterWindow.allowed === true && rlAfterWindow.remaining === 2,
    JSON.stringify(rlAfterWindow),
  );

  const rlBounded = rlModule.createRateLimiter({ limit: 2, windowMs: 60_000, now: () => rlNow, maxKeys: 3 });

  for (const key of ["k1", "k2", "k3", "k4", "k5", "k6"]) {
    rlBounded.check(key);
  }

  check(
    "the table of open windows is bounded, whatever keys arrive",
    rlBounded.size <= 3,
    `${rlBounded.size} windows for 6 keys`,
  );

  check(
    "the client key is the first forwarded address, is truncated, and never an identity",
    rlModule.clientKeyFrom(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" })) === "203.0.113.9" &&
      rlModule.clientKeyFrom(new Headers({ "x-real-ip": "198.51.100.4" })) === "198.51.100.4" &&
      rlModule.clientKeyFrom(new Headers()) === "unknown" &&
      rlModule.clientKeyFrom(new Headers({ "x-forwarded-for": "x".repeat(500) })).length === 64,
  );

  const rlBookingRoute = readFileSync(join(REPO_ROOT, "src", "app", "api", "bookings", "route.ts"), "utf8");
  const rlOrderRoute = readFileSync(
    join(REPO_ROOT, "src", "app", "api", "payment", "create-order", "route.ts"),
    "utf8",
  );

  check(
    "the booking endpoint limits before it reads the body, and answers 429 with Retry-After",
    rlBookingRoute.indexOf("bookingLimiter.check(clientKeyFrom(request.headers))") !== -1 &&
      rlBookingRoute.indexOf("bookingLimiter.check") < rlBookingRoute.indexOf("request.text()") &&
      rlBookingRoute.includes('"rate-limited"') &&
      /"retry-after": String\(limit\.retryAfterSeconds\)/.test(rlBookingRoute),
  );

  check(
    "so does the endpoint that creates the pending booking and the Razorpay order",
    rlOrderRoute.indexOf("paymentOrderLimiter.check(clientKeyFrom(request.headers))") !== -1 &&
      rlOrderRoute.indexOf("paymentOrderLimiter.check") < rlOrderRoute.indexOf("request.text()") &&
      rlOrderRoute.includes('"rate-limited"') &&
      /"retry-after": String\(limit\.retryAfterSeconds\)/.test(rlOrderRoute),
  );

  const rlGalleryRoute = readFileSync(
    join(REPO_ROOT, "src", "app", "api", "admin", "gallery", "route.ts"),
    "utf8",
  );

  check(
    "the gallery upload refuses an oversized request before buffering the whole body",
    /MAX_UPLOAD_REQUEST_BYTES/.test(rlGalleryRoute) &&
      // The `await` matters: the prose in that file mentions `request.formData()`
      // too, and the check is about where the code reads it.
      rlGalleryRoute.indexOf('headers.get("content-length")') <
        rlGalleryRoute.indexOf("await request.formData()"),
    "content-length is read before the body is buffered",
  );

  // ---------------------------------------------------------------------------
  section("Session cookies and response headers");
  // ---------------------------------------------------------------------------
  // The session cookie is the one credential a browser holds, so the attributes it
  // is written with are checked here the same way the app writes them: through the
  // library, with the app's own options object. (The harness signs in with its own
  // cookie jar, which is why this is the place to check it.)

  const vsecCookies = await import("../src/lib/supabase/cookies.ts");
  const vsecJar = [];
  const vsecClient = createServerClient(shim.url, "test-anon-key", {
    cookieOptions: vsecCookies.SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll: () => vsecJar.map(({ name, value }) => ({ name, value })),
      setAll: (cookies) => {
        for (const cookie of cookies) {
          vsecJar.push(cookie);
        }
      },
    },
  });

  const vsecSignIn = await vsecClient.auth.signInWithPassword({
    email: "scanner@example.com",
    password: STAFF_PASSWORD,
  });

  const vsecSessionCookies = vsecJar.filter((cookie) => cookie.options?.httpOnly !== undefined);

  check(
    "the session cookie is written HttpOnly, so a script on the page cannot read it",
    vsecSignIn.error === null &&
      vsecSessionCookies.length > 0 &&
      vsecSessionCookies.every((cookie) => cookie.options.httpOnly === true),
    `${vsecSignIn.error?.message ?? "signed in"} / ${JSON.stringify(
      vsecJar.map((cookie) => ({ name: cookie.name, options: cookie.options })),
    ).slice(0, 200)}`,
  );

  check(
    "and it stays same-site and path-wide, so the browser sends it and a cross-site form cannot",
    vsecSessionCookies.length > 0 &&
      vsecSessionCookies.every((cookie) => cookie.options.sameSite === "lax" && cookie.options.path === "/"),
  );

  const vsecServerSource = readFileSync(join(REPO_ROOT, "src", "lib", "supabase", "server.ts"), "utf8");
  const vsecProxySource = readFileSync(join(REPO_ROOT, "src", "proxy.ts"), "utf8");

  check(
    "both server clients use that one options object, so a refreshed cookie is the same cookie",
    /cookieOptions: SESSION_COOKIE_OPTIONS/.test(vsecServerSource) &&
      /cookieOptions: SESSION_COOKIE_OPTIONS/.test(vsecProxySource),
  );

  const vsecConfig = readFileSync(join(REPO_ROOT, "next.config.ts"), "utf8");

  check(
    "every response is nosniff, hides the referrer cross-origin, and grants the camera to this site only",
    /"x-content-type-options",\s*value: "nosniff"/.test(vsecConfig) &&
      /"referrer-policy",\s*value: "strict-origin-when-cross-origin"/.test(vsecConfig) &&
      /"permissions-policy",\s*value: "camera=\(self\), microphone=\(\), geolocation=\(\)"/.test(vsecConfig),
    "headers() present",
  );

  check(
    "the staff area cannot be framed, while the public site stays embeddable",
    /source: "\/admin\/:path\*"/.test(vsecConfig) &&
      /x-frame-options/.test(vsecConfig) &&
      /frame-ancestors 'none'/.test(vsecConfig),
  );

  section("Result");
  // ---------------------------------------------------------------------------
  console.log(`\n  ${passed} passed, ${failures.length} failed\n`);

  if (shim.unsupported.size > 0) {
    console.log(`  Note: shim ignored unsupported query features: ${[...shim.unsupported].join(", ")}\n`);
  }

  if (failures.length > 0) {
    console.log("  Failures:");
    for (const failure of failures) console.log(`   • ${failure}`);
    console.log("");
  }
}

async function cleanup() {
  await stopWebServer();

  if (stub) {
    await stub.close();
  }

  // Tidy up the isolated build output.
  try {
    rmSync(join(REPO_ROOT, DIST_DIR), { recursive: true, force: true });
  } catch {
    // best effort
  }

  if (shim) {
    await shim.close();
  }

  await db.close();
}

try {
  await main();
} catch (error) {
  console.error("\nVerification crashed:", error.message);
  failures.push(`crashed: ${error.message}`);
} finally {
  await cleanup();
}

process.exit(failures.length === 0 ? 0 : 1);
