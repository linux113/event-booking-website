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

async function fetchPage(path) {
  const response = await fetch(`http://127.0.0.1:${WEB_PORT}${path}`);

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
  shim = await startShim({ db });

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

  // ---- 9. the key secret never reaches the browser ------------------------
  const clientChunks = readChunks(join(REPO_ROOT, DIST_DIR, "static", "chunks")).join("\n");
  check("the client bundles contain no key secret", !clientChunks.includes(RAZORPAY_KEY_SECRET));
  check("the client bundles contain no webhook secret", !clientChunks.includes(RAZORPAY_WEBHOOK_SECRET));
  check("checkout is loaded on demand from Razorpay", clientChunks.includes("checkout.razorpay.com"));

  // ---- 10. live keys are refused outright ---------------------------------
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
