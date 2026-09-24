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

// 1. Deleting an empty night works
const nightsBefore = await db.query("select id, event_date from public.event_dates order by event_date asc");
assert.equal(nightsBefore.length, 9);
const emptyNight = nightsBefore[nightsBefore.length - 1]; // last night (e.g. 19 Oct)

const deletedRows = await db.query("select * from public.admin_delete_event_date($1)", [emptyNight.id]);
check("deleting an empty night works", deletedRows.length === 1 && deletedRows[0].date_uuid === emptyNight.id);

const nightsAfterEmptyDelete = await db.query("select id from public.event_dates where id = $1", [emptyNight.id]);
check("the empty night row is gone", nightsAfterEmptyDelete.length === 0);

const countAfterFirstDelete = (await db.query("select count(*)::int as n from public.event_dates"))[0].n;
assert.equal(countAfterFirstDelete, 8);

// 2. Night with a paid booking
const [event] = await db.query("select id from public.events limit 1");
const [nightWithBooking] = await db.query("select id from public.event_dates order by event_date asc limit 1");
const [passCategory] = await db.query("select id from public.pass_categories limit 1");

const [booking] = await db.query(
  `select * from public.create_pending_booking(
     $1, $2, $3, 'Riya Sharma', '9876543210', 1, 2, 'night-del-test-1'
   )`,
  [event.id, nightWithBooking.id, passCategory.id]
);
await db.query("select public.attach_razorpay_order($1, 'order_del_test_1')", [booking.booking_uuid]);
await db.query(
  "select * from public.confirm_booking_payment('order_del_test_1', 'pay_del_test_1', $1)",
  [booking.total_amount * 100]
);

let caughtError = null;
try {
  await db.query("select * from public.admin_delete_event_date($1)", [nightWithBooking.id]);
} catch (error) {
  caughtError = error;
}

check(
  "deleting a night with a paid booking fails with the refusal",
  caughtError !== null &&
    caughtError.code === "PT012" &&
    caughtError.message.includes("This night has bookings and cannot be removed — close booking instead."),
  `code=${caughtError?.code}, msg=${caughtError?.message}`
);

// 3. Row count is unchanged after the refusal
const countAfterRefusal = (await db.query("select count(*)::int as n from public.event_dates"))[0].n;
check("the row count is unchanged after the refusal", countAfterRefusal === countAfterFirstDelete);

await pg.close();

const failed = results.filter((r) => !r.ok).length;
console.log(
  failed === 0
    ? `\n\u001b[32m${results.length} passed, 0 failed\u001b[0m\n`
    : `\n\u001b[31m${results.length - failed} passed, ${failed} failed\u001b[0m\n`
);
process.exit(failed === 0 ? 0 : 1);
