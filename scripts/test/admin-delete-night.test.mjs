// Removing a night: the rule, and the answer the screen is given.
//
//   node scripts/test/admin-delete-night.test.mjs
//
// Two halves that used to disagree, and are the whole point of this file:
//
//   1. `admin_delete_event_date` refuses to delete a night that has anything
//      attached to it — a booking in any state, a digital pass or a check-in.
//   2. `admin_event_dates` tells the screen whether a night can be removed, from
//      those same three counts. When the read only knew about *paid* bookings the
//      "Remove night" control was offered for a night whose only history was an
//      abandoned checkout, and pressing it produced a refusal nobody could act
//      on. These checks pin the two together.
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");

const { createVerificationDb } = await import(join(REPO, "scripts/test/pglite.mjs"));
const { applySchema } = await import(join(REPO, "scripts/lib/apply-schema.mjs"));

const pg = await createVerificationDb();
const db = {
  unsafe: (text) => pg.exec(text),
  query: async (text, params) => (await pg.query(text, params ?? [])).rows,
  begin: async (fn) => {
    await pg.exec("begin");
    try {
      const value = await fn({
        unsafe: (text) => pg.exec(text),
        query: async (text, params) => (await pg.query(text, params ?? [])).rows,
      });
      await pg.exec("commit");
      return value;
    } catch (error) {
      await pg.exec("rollback");
      throw error;
    }
  },
};

await applySchema({ db, root: REPO, seed: true });

const results = [];
const check = (label, ok, detail = "") => {
  results.push({ label, ok });
  console.log(`  ${ok ? "\u001b[32m✓\u001b[0m" : "\u001b[31m✗\u001b[0m"} ${label}${ok || !detail ? "" : `\n      ${detail}`}`);
};

const nightsBefore = await db.query("select id, event_date from public.event_dates order by event_date asc");
assert.equal(nightsBefore.length, 9);
const emptyNight = nightsBefore[nightsBefore.length - 1]; // last night (e.g. 19 Oct)

/** The row the screen reads for one night. */
async function listedNight(id) {
  const rows = await db.query(
    "select * from public.admin_event_dates() where date_uuid = $1",
    [id],
  );
  return rows[0] ?? null;
}

// 1. An empty night says it can be removed, and can be
const empty = await listedNight(emptyNight.id);
check("an empty night is listed as removable", empty?.removable === true, `removable=${empty?.removable}`);
check(
  "an empty night reports nothing attached",
  empty?.attached_bookings === 0 && empty?.attached_passes === 0 && empty?.attached_check_ins === 0,
  `bookings=${empty?.attached_bookings} passes=${empty?.attached_passes} check-ins=${empty?.attached_check_ins}`,
);

const deletedRows = await db.query("select * from public.admin_delete_event_date($1)", [emptyNight.id]);
check("deleting an empty night works", deletedRows.length === 1 && deletedRows[0].date_uuid === emptyNight.id);

const nightsAfterEmptyDelete = await db.query("select id from public.event_dates where id = $1", [emptyNight.id]);
check("the empty night row is gone", nightsAfterEmptyDelete.length === 0);

const countAfterFirstDelete = (await db.query("select count(*)::int as n from public.event_dates"))[0].n;
assert.equal(countAfterFirstDelete, 8);

// 2. A night with an unpaid booking: the case that used to lie to the screen
const [event] = await db.query("select id from public.events limit 1");
const [passCategory] = await db.query("select id from public.pass_categories limit 1");

const [pendingNight] = await db.query(
  "select id from public.event_dates order by event_date asc limit 1",
);
const [pendingBooking] = await db.query(
  `select * from public.create_pending_booking(
     $1, $2, $3, 'Riya Sharma', '9876543210', 1, 2, 'night-del-test-pending'
   )`,
  [event.id, pendingNight.id, passCategory.id],
);
assert.equal(pendingBooking.payment_status, "unpaid");

const pending = await listedNight(pendingNight.id);
check(
  "a night with only an unpaid booking is listed as NOT removable",
  pending?.removable === false,
  `removable=${pending?.removable}`,
);
check(
  "its paid figures stay at zero, so the screen cannot answer from them",
  pending?.booked_people === 0 && pending?.booked_bookings === 0 && pending?.passes_issued === 0,
  `booked_people=${pending?.booked_people} booked_bookings=${pending?.booked_bookings}`,
);
check(
  "it reports the one booking that blocks the removal",
  pending?.attached_bookings === 1 && pending?.attached_passes === 0 && pending?.attached_check_ins === 0,
  `bookings=${pending?.attached_bookings} passes=${pending?.attached_passes} check-ins=${pending?.attached_check_ins}`,
);

let pendingError = null;
try {
  await db.query("select * from public.admin_delete_event_date($1)", [pendingNight.id]);
} catch (error) {
  pendingError = error;
}
check(
  "deleting it is refused, exactly as the listing promised",
  pendingError !== null && pendingError.code === "PT012",
  `code=${pendingError?.code}`,
);

// 3. A night with a paid booking, a pass and a check-in
const [paidNight] = await db.query(
  "select id from public.event_dates where id <> $1 order by event_date asc limit 1",
  [pendingNight.id],
);
const [booking] = await db.query(
  `select * from public.create_pending_booking(
     $1, $2, $3, 'Riya Sharma', '9876543210', 1, 2, 'night-del-test-1'
   )`,
  [event.id, paidNight.id, passCategory.id],
);
await db.query("select public.attach_razorpay_order($1, 'order_del_test_1')", [booking.booking_uuid]);
await db.query(
  "select * from public.confirm_booking_payment('order_del_test_1', 'pay_del_test_1', $1)",
  [booking.total_amount * 100],
);

const paid = await listedNight(paidNight.id);
check("a night with a paid booking is listed as NOT removable", paid?.removable === false);
check(
  "it reports the booking and the pass issued against it",
  paid?.attached_bookings === 1 && paid?.attached_passes === 1 && paid?.booked_people === 2,
  `bookings=${paid?.attached_bookings} passes=${paid?.attached_passes} booked_people=${paid?.booked_people}`,
);

let caughtError = null;
try {
  await db.query("select * from public.admin_delete_event_date($1)", [paidNight.id]);
} catch (error) {
  caughtError = error;
}

check(
  "deleting a night with a paid booking fails with the refusal",
  caughtError !== null &&
    caughtError.code === "PT012" &&
    caughtError.message.includes("cannot be removed"),
  `code=${caughtError?.code}, msg=${caughtError?.message}`,
);

// 4. A check-in recorded against a night counts as attached too
const [checkInNight] = await db.query(
  "select id from public.event_dates where id not in ($1, $2) order by event_date asc limit 1",
  [pendingNight.id, paidNight.id],
);
const [gateBooking] = await db.query(
  `select * from public.create_pending_booking(
     $1, $2, $3, 'Meera Joshi', '9876543211', 1, 2, 'night-del-test-gate'
   )`,
  [event.id, checkInNight.id, passCategory.id],
);
await db.query("select public.attach_razorpay_order($1, 'order_del_test_gate')", [gateBooking.booking_uuid]);
await db.query(
  "select * from public.confirm_booking_payment('order_del_test_gate', 'pay_del_test_gate', $1)",
  [gateBooking.total_amount * 100],
);
const [gatePass] = await db.query(
  "select qr_token from public.digital_passes where booking_id = $1 limit 1",
  [gateBooking.booking_uuid],
);
await db.query("select * from public.check_in_pass($1, $2::date, 'Main gate')", [
  gatePass.qr_token,
  gateBooking.event_date,
]);

const gated = await listedNight(checkInNight.id);
check(
  "a night with a check-in is listed as NOT removable, with the check-in counted",
  gated?.removable === false && gated?.attached_check_ins === 1,
  `removable=${gated?.removable} check-ins=${gated?.attached_check_ins}`,
);

// 5. Row count is unchanged after every refusal
const countAfterRefusal = (await db.query("select count(*)::int as n from public.event_dates"))[0].n;
check("the row count is unchanged after the refusals", countAfterRefusal === countAfterFirstDelete);

// 6. Deleting a night that is not there says so
let missingError = null;
try {
  await db.query("select * from public.admin_delete_event_date($1)", [emptyNight.id]);
} catch (error) {
  missingError = error;
}
check(
  "deleting an already-removed night reports night_not_found (PT007)",
  missingError !== null && missingError.code === "PT007",
  `code=${missingError?.code}`,
);

await pg.close();

const failed = results.filter((r) => !r.ok).length;
console.log(
  failed === 0
    ? `\n\u001b[32m${results.length} passed, 0 failed\u001b[0m\n`
    : `\n\u001b[31m${results.length - failed} passed, ${failed} failed\u001b[0m\n`,
);
process.exit(failed === 0 ? 0 : 1);
