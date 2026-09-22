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
import { startShim } from "./test/postgrest-shim.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");
const SEED_FILE = join(REPO_ROOT, "supabase", "seed.sql");
const WEB_PORT = 3210;
const DIST_DIR = ".next-verify";

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
  section("Next.js pages render database data");
  // ---------------------------------------------------------------------------
  // Build and serve into an isolated output directory: that renders exactly what
  // production renders, and leaves any running dev server (and its .next) alone.
  const serverEnv = {
    ...process.env,
    NEXT_DIST_DIR: DIST_DIR,
    NEXT_PUBLIC_SUPABASE_URL: shim.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
    NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${WEB_PORT}`,
  };

  const build = spawn("npm", ["run", "build"], { cwd: REPO_ROOT, env: serverEnv, stdio: ["ignore", "pipe", "pipe"] });
  let buildLog = "";
  build.stdout.on("data", (chunk) => {
    buildLog += chunk.toString();
  });
  build.stderr.on("data", (chunk) => {
    buildLog += chunk.toString();
  });

  const buildExit = await new Promise((resolve) => build.on("exit", resolve));
  check("production build succeeds with the database configured", buildExit === 0, buildExit === 0 ? "" : buildLog.slice(-500));

  if (await isPortInUse(WEB_PORT)) {
    throw new Error(`port ${WEB_PORT} is already serving something — stop that server first`);
  }

  // `detached` gives the server its own process group: `next start` ignores
  // SIGTERM and would otherwise survive as an orphan holding the port.
  server = spawn(
    "npm",
    ["run", "start", "--", "--hostname", "127.0.0.1", "--port", String(WEB_PORT)],
    { cwd: REPO_ROOT, env: serverEnv, stdio: ["ignore", "pipe", "pipe"], detached: true },
  );

  let serverLog = "";
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
  check("book page still refuses to take payment", book.includes("Checkout is not open yet"));

  check("gallery page renders published items", galleryPage.includes("Garba circle at full spin"));
  check("gallery page excludes draft rows", !galleryPage.includes("must never"));

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
  if (server?.pid) {
    try {
      process.kill(-server.pid, "SIGKILL");
    } catch {
      server.kill("SIGKILL");
    }
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
