// Does the database layer hand the app the string dates its types promise?
//
//   node scripts/test/db-normalise.test.mjs
//
// Prisma 7 turns `date` / `time` / `timestamptz` columns into JS `Date`
// objects; every row interface in the app is typed against the plain strings
// the old PostgREST client returned. `src/lib/db/normalise.ts` (applied by
// `sql()`) bridges the two. This test proves, over a real Postgres wire
// connection, that:
//   1. the raw driver values really are Dates (the premise of the fix),
//   2. normaliseRows restores `2026-10-11` / `19:00:00` / ISO strings,
//   3. the seeded nights flow through toEventNight → formatDateRange /
//      formatEventDate / formatTimeOfDay as strings — the exact chain that
//      crashed the Vercel build on /about with
//      "a.value.localeCompare is not a function",
//   4. format.ts alone no longer throws even if raw Dates slip through.
//
// Timezone: pinned to UTC before anything else runs. Neon sessions and Vercel
// runtimes are UTC — that is the environment this app deploys into — and
// PGlite renders `timestamptz` in the *process's* local offset while Prisma's
// adapter assumes that text is already UTC, so a non-UTC shell would corrupt
// the instant before the code under test ever sees it.
process.env.TZ = "UTC";

import { register } from "node:module";
import { PrismaPg } from "@prisma/adapter-pg";
import { startPostgres } from "./postgres-server.mjs";

register("./ts-alias-loader.mjs", import.meta.url);
const { normaliseRows } = await import("../../src/lib/db/normalise.ts");
const { toEventNight } = await import("../../src/lib/services/mappers.ts");
const { formatDateRange, formatEventDate, formatTimeOfDay, formatTimestamp } = await import(
  "../../src/lib/format.ts"
);

const pg = await startPostgres({ seed: true });
const prisma = new (await import("../../src/generated/prisma/client.ts")).PrismaClient({
  adapter: new PrismaPg({ connectionString: pg.connectionString, max: 1 }),
});

let pass = 0;
let fail = 0;
const check = (label, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${label}${detail ? " — " + detail : ""}`);
};

// 1 · the premise: Prisma hands temporal columns back as Date objects
const [raw] = await prisma.$queryRaw`
  select
    date '2026-10-11'                    as d,
    time '19:00:00'                      as t,
    time '19:30:00.5'                    as t_frac,
    time '00:00:00'                      as t_midnight,
    timestamptz '2026-10-11 18:04:00+00' as ts,
    null::date                           as d_null
`;
check("raw date column arrives as a Date", raw.d instanceof Date, String(raw.d));
check("raw time column arrives as a Date", raw.t instanceof Date, String(raw.t));
check("raw timestamptz column arrives as a Date", raw.ts instanceof Date, String(raw.ts));
check("raw null date stays null", raw.d_null === null);

// 2 · normaliseRows restores the string contract
const row = normaliseRows([raw])[0];
check("date → YYYY-MM-DD", row.d === "2026-10-11", row.d);
check("time → HH:MM:SS", row.t === "19:00:00", row.t);
check("time with millis → HH:MM:SS.mmm", row.t_frac === "19:30:00.500", row.t_frac);
check("00:00:00 stays a time, not 1970-01-01", row.t_midnight === "00:00:00", row.t_midnight);
check("timestamptz → ISO instant", row.ts === "2026-10-11T18:04:00.000Z", row.ts);
check("null date stays null", row.d_null === null);
check("normaliseRows leaves non-temporal values alone", normaliseRows([{ n: 42, s: "x", b: true }])[0].n === 42);

// 3 · the seeded nights through the real RPC → mapper → formatter chain
const [event] = await prisma.$queryRaw`select id from public.events where status = 'published' limit 1`;
const rawNights = await prisma.$queryRaw`select * from public.get_event_night_availability(${event.id}::uuid)`;
check("availability RPC returns Date nights (raw)", rawNights.length === 9 && rawNights[0].event_date instanceof Date);

const nights = normaliseRows(rawNights).map(toEventNight);
check("nights normalise to string dates", nights.every((n) => typeof n.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(n.date)), nights[0]?.date);
check("nights normalise to string times", nights.every((n) => typeof n.startTime === "string" && n.startTime.startsWith("19:00")), nights[0]?.startTime);

const range = formatDateRange(nights.map((n) => n.date));
check("formatDateRange (the /about crash site)", range === "11 – 19 October 2026", range);
check("formatEventDate", formatEventDate(nights[0].date) === "Sun, 11 Oct 2026", formatEventDate(nights[0].date));
check("formatTimeOfDay", formatTimeOfDay(nights[0].startTime) === "7:00 PM", formatTimeOfDay(nights[0].startTime));

// 4 · defence in depth: format.ts must not throw on raw Dates either
try {
  const bypass = formatDateRange(rawNights.map((n) => n.event_date));
  check("formatDateRange survives raw Date input", typeof bypass === "string" && bypass.includes("11"), bypass);
} catch (error) {
  check("formatDateRange survives raw Date input", false, error.message);
}
check("formatEventDate never returns a Date object", typeof formatEventDate(raw.d) === "string", String(formatEventDate(raw.d)));
check("formatTimeOfDay handles a raw epoch-day Date", formatTimeOfDay(raw.t) === "7:00 PM", String(formatTimeOfDay(raw.t)));

// timestamps: the same instant, rendered the same before and after normalising
const iso = "2026-10-11T18:04:00.000Z";
check("formatTimestamp on normalised ISO", formatTimestamp(row.ts) === formatTimestamp(iso), formatTimestamp(row.ts));

await prisma.$disconnect();
await pg.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
