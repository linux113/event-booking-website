/**
 * The gate, end to end and in SQL: is this pass good, on this night, exactly once?
 *
 * The scan must never be wrong in the "lets someone in who should not be" direction,
 * and the date rule is the part that changes with the calendar rather than with the
 * code — so it is asserted against the real `scan_pass()` / `check_in_pass()` the
 * scanner calls, not against a copy of the rules.
 *
 *   npm run test:gate
 *
 * Where the numbers come from: the seed's first night (2026-10-11). Every pass this
 * test issues is a real booking — create → attach order → confirm payment — so the
 * pass under test is exactly the pass a guest holds.
 */
import assert from "node:assert/strict";
import { register } from "node:module";

register("./ts-alias-loader.mjs", import.meta.url);

const { startPostgres } = await import("./postgres-server.mjs");
const { gateNight } = await import("../../src/lib/gate/night.ts");
const { isQrToken } = await import("../../src/lib/pass/links.ts");

let passed = 0;
let failed = 0;

async function check(label, assertion) {
  try {
    await assertion();
    passed += 1;
    console.log(`  \u001b[32m✓\u001b[0m ${label}`);
  } catch (error) {
    failed += 1;
    console.log(`  \u001b[31m✗\u001b[0m ${label}`);
    console.log(`      ${error.message.split("\n")[0]}`);
  }
}

/** `date` columns come back as JS Date objects; the gate speaks `YYYY-MM-DD`. */
const isoDate = (value) =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);

/** A pass is a booking that was paid for: the same path the guest walks. */
let orderSeq = 0;
async function issuePass(pg, { nightIndex = 0, name = "Gate Tester" } = {}) {
  const night = (
    await pg.db.query(
      `with night as (
         select id, event_id, event_date
           from public.event_dates
          where booking_open = true
          order by event_date
          offset $1 limit 1
       )
       select n.id as night_id, n.event_id, n.event_date, p.id as pass_category_id, p.number_of_people
         from night n
         join public.pass_categories p on p.event_id = n.event_id
        order by p.sort_order nulls last, p.name
        limit 1`,
      [nightIndex],
    )
  ).rows[0];
  assert.ok(night, `seed night #${nightIndex} exists`);

  const booking = (
    await pg.db.query(
      `select * from public.create_pending_booking(
         $1::uuid, $2::uuid, $3::uuid, $4, '9876543210', 1, $5::int, $6, 'Gate Test'
       )`,
      [night.event_id, night.night_id, night.pass_category_id, name, night.number_of_people, `gate-idem-${++orderSeq}`],
    )
  ).rows[0];

  const order = `order_gate_${orderSeq}`;
  await pg.db.query(`select public.attach_razorpay_order($1, $2)`, [booking.booking_uuid, order]);
  await pg.db.query(`select * from public.confirm_booking_payment($1, $2, $3)`, [
    order,
    `pay_gate_${orderSeq}`,
    booking.total_amount * 100,
  ]);

  const pass = (
    await pg.db.query(
      `select id, pass_id, qr_token, valid_date from public.digital_passes where booking_id = $1`,
      [booking.booking_uuid],
    )
  ).rows[0];
  assert.ok(pass, "a paid booking has a pass");

  return {
    token: pass.qr_token,
    passUuid: pass.id,
    passId: pass.pass_id,
    validDate: isoDate(pass.valid_date),
    nightDate: isoDate(night.event_date),
    nightId: night.night_id,
    bookingUuid: booking.booking_uuid,
  };
}

const scan = async (pg, token, gateDate) =>
  (await pg.db.query(`select * from public.scan_pass($1, $2::date)`, [token, gateDate])).rows[0];

const checkIn = async (pg, token, gateDate, gate = null) =>
  (await pg.db.query(`select * from public.check_in_pass($1, $2::date, $3)`, [token, gateDate, gate])).rows[0];

const entryRows = async (pg, passUuid) =>
  Number((await pg.db.query(`select count(*)::int as n from public.check_ins where digital_pass_id = $1`, [passUuid])).rows[0].n);

const passState = async (pg, passUuid) =>
  (await pg.db.query(`select status, checked_in, checked_in_at from public.digital_passes where id = $1`, [passUuid])).rows[0];

const dayOffset = (date, days) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// ---------------------------------------------------------------------------
console.log("\n1 · the gate's clock (server side, venue timezone)");

await check("midnight in Jaipur decides the night, not midnight in UTC", () => {
  // 23:59:59 IST on the 11th is still the night of the 11th…
  assert.equal(gateNight(new Date("2026-10-11T18:29:59Z")), "2026-10-11");
  // …and one second later it is the 12th. 18:30 UTC === 00:00 IST.
  assert.equal(gateNight(new Date("2026-10-11T18:30:00Z")), "2026-10-12");
});

await check("doors-open time (19:00 IST) is still the same night", () => {
  assert.equal(gateNight(new Date("2026-10-11T13:30:00Z")), "2026-10-11");
  assert.match(gateNight(), /^\d{4}-\d{2}-\d{2}$/);
});

// ---------------------------------------------------------------------------
console.log("\n2 · token shape (before the database is asked anything)");

await check("a 64-character hex token is a pass; anything else is refused", () => {
  assert.equal(isQrToken("a".repeat(64)), true);
  assert.equal(isQrToken("A".repeat(64)), false);
  assert.equal(isQrToken("a".repeat(63)), false);
  assert.equal(isQrToken("a".repeat(65)), false);
  assert.equal(isQrToken("z".repeat(64)), false);
  assert.equal(isQrToken(null), false);
});

// ---------------------------------------------------------------------------
const pg = await startPostgres({ seed: true });
try {
  console.log("\n3 · a pass that was actually issued");

  const primary = await issuePass(pg, { name: "Riya Sharma" });
  await check("the pass carries the night it was bought for", () => {
    assert.equal(primary.validDate, primary.nightDate);
    assert.equal(isQrToken(primary.token), true);
  });

  console.log("\n4 · the date decides the verdict (scan_pass — writes nothing)");

  await check("on its own night the pass is valid, and the scan changes nothing", async () => {
    const row = await scan(pg, primary.token, primary.nightDate);
    assert.equal(row.outcome, "valid");
    assert.equal(row.pass_status, "active");
    assert.equal(row.checked_in, false);
    assert.equal(await entryRows(pg, primary.passUuid), 0, "scan_pass must not write a check-in");
    assert.equal((await passState(pg, primary.passUuid)).checked_in, false);
  });

  await check("one day early: not_yet_valid", async () => {
    const row = await scan(pg, primary.token, dayOffset(primary.validDate, -1));
    assert.equal(row.outcome, "not_yet_valid");
    assert.equal(row.reason, "This pass is for a later night.");
  });

  await check("one day late: expired", async () => {
    const row = await scan(pg, primary.token, dayOffset(primary.validDate, 1));
    assert.equal(row.outcome, "expired");
    assert.equal(row.reason, "This pass was for an earlier night.");
  });

  await check("after midnight on the same night: expired (there is no grace window)", async () => {
    // The gate takes its date from the venue's clock, so a 00:30 arrival for a
    // night dated the 11th is scanned against the 12th and refused.
    assert.equal(gateNight(new Date("2026-10-11T19:00:00Z")), "2026-10-12");
    const row = await scan(pg, primary.token, gateNight(new Date("2026-10-11T19:00:00Z")));
    assert.equal(row.outcome, "expired");
  });

  await check("another night's pass is refused on this night", async () => {
    const later = await issuePass(pg, { nightIndex: 1, name: "Later Night" });
    assert.notEqual(later.validDate, primary.validDate);
    assert.equal((await scan(pg, later.token, primary.nightDate)).outcome, "not_yet_valid");
    assert.equal((await scan(pg, later.token, later.validDate)).outcome, "valid");
  });

  console.log("\n5 · admission (check_in_pass — the write)");

  await check("a wrong night cannot be let in, and writes nothing", async () => {
    const row = await checkIn(pg, primary.token, dayOffset(primary.validDate, 1), "Gate A");
    assert.equal(row.outcome, "expired");
    assert.equal(await entryRows(pg, primary.passUuid), 0, "a refused pass must not be admitted");
    assert.equal((await passState(pg, primary.passUuid)).status, "active");
  });

  await check("on the right night the guest is admitted, once", async () => {
    const row = await checkIn(pg, primary.token, primary.nightDate, "Gate A");
    assert.equal(row.outcome, "checked_in");
    assert.equal(row.pass_status, "used");
    assert.equal(row.checked_in, true);
    assert.ok(row.checked_in_at, "an admission is stamped with its time");

    const state = await passState(pg, primary.passUuid);
    assert.equal(state.status, "used");
    assert.equal(state.checked_in, true);

    assert.equal(await entryRows(pg, primary.passUuid), 1);
    const gate = (await pg.db.query(`select gate from public.check_ins where digital_pass_id = $1`, [primary.passUuid])).rows[0].gate;
    assert.equal(gate, "Gate A", "the gate label is recorded");
  });

  await check("the same pass cannot go through twice", async () => {
    assert.equal((await scan(pg, primary.token, primary.nightDate)).outcome, "already_used");
    assert.equal((await checkIn(pg, primary.token, primary.nightDate, "Gate B")).outcome, "already_used");
    assert.equal(await entryRows(pg, primary.passUuid), 1, "still exactly one check-in row");
  });

  console.log("\n6 · refusals the gate must never get wrong");

  await check("an unknown but well-formed token is invalid", async () => {
    const row = await scan(pg, "f".repeat(64), primary.nightDate);
    assert.equal(row.outcome, "invalid");
    assert.equal(row.reason, "That code does not match any pass for this event.");
  });

  await check("a malformed token never reaches the database", async () => {
    const row = await scan(pg, "not-a-token", primary.nightDate);
    assert.equal(row.outcome, "invalid");
    assert.equal(row.reason, "That code is not a pass for this event.");
  });

  await check("a cancelled night refuses every pass on it", async () => {
    const cancelled = await issuePass(pg, { nightIndex: 2, name: "Cancelled Night" });
    await pg.db.query(`update public.event_dates set status = 'cancelled' where id = $1`, [cancelled.nightId]);
    try {
      const row = await scan(pg, cancelled.token, cancelled.validDate);
      assert.equal(row.outcome, "invalid");
      assert.equal(row.reason, "That night is not taking place.");
      assert.equal((await checkIn(pg, cancelled.token, cancelled.validDate)).outcome, "invalid");
      assert.equal(await entryRows(pg, cancelled.passUuid), 0);
    } finally {
      await pg.db.query(`update public.event_dates set status = 'scheduled' where id = $1`, [cancelled.nightId]);
    }
  });

  console.log("\n7 · what the scanner shows for each verdict");

  await check("every verdict carries the pass details the panel renders", async () => {
    const fresh = await issuePass(pg, { name: "Display Check" });
    const row = await scan(pg, fresh.token, fresh.validDate);
    assert.equal(row.outcome, "valid");
    assert.equal(row.customer_name, "Display Check");
    assert.equal(row.booking_reference?.length > 0, true);
    assert.equal(row.event_name, "Garba Night");
    assert.equal(row.gate_date === null ? null : isoDate(row.gate_date), fresh.validDate);
    assert.ok(row.pass_name, "the pass type is shown");
    assert.equal(row.pass_number, 1);
    assert.equal(row.pass_total, 1);
  });
} finally {
  await pg.close();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
