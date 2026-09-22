/**
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
    staffLookupMiss.status === 200 && staffLookupMiss.text.includes("No booking found"),
  );

  const staffLookupShort = await adminHtml("/admin/bookings?q=Ni", staffSession2.cookie);
  check(
    "a two-letter search asks for more input instead of returning the whole event",
    staffLookupShort.status === 200 && staffLookupShort.text.includes("Keep typing"),
  );

  // The short search must not have queried the database at all: a staff member's
  // query for "Ni" cannot return other guests' bookings.
  check(
    "and returns none of the event's bookings",
    !staffLookupShort.html.includes(lookupReference.booking_id),
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
    adminHome.text.includes("Paid bookings") && adminHome.text.includes("Passes not yet used"),
  );
  check(
    "the sections that are not built yet say so instead of linking nowhere",
    adminHome.text.includes("Not built yet") &&
      adminHome.text.includes("Payments") &&
      !adminHome.html.includes('href="/admin/payments"') &&
      !adminHome.html.includes('href="/admin/gallery"'),
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
