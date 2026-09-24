import assert from "node:assert/strict";
import { register } from "node:module";

register("./ts-alias-loader.mjs", import.meta.url);

const { validateBookingRequest, validateReferredBy } = await import("../../src/lib/booking/validation.ts");
const { startPostgres } = await import("./postgres-server.mjs");

let passed = 0;
function check(label, assertion) {
  assertion();
  passed += 1;
  console.log(`  ✓ ${label}`);
}

check("validation accepts valid booking without referredBy", () => {
  const result = validateBookingRequest({
    eventId: "00000000-0000-0000-0000-000000000001",
    eventDateId: "00000000-0000-0000-0000-000000000002",
    passCategoryId: "00000000-0000-0000-0000-000000000003",
    customerName: "Asha Patel",
    customerMobile: "9876543210",
    quantity: 1,
    numberOfPeople: 2,
    idempotencyKey: "test-key-1",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.referredBy, null);
  }
});

check("validation accepts valid booking with referredBy", () => {
  const result = validateBookingRequest({
    eventId: "00000000-0000-0000-0000-000000000001",
    eventDateId: "00000000-0000-0000-0000-000000000002",
    passCategoryId: "00000000-0000-0000-0000-000000000003",
    customerName: "Asha Patel",
    customerMobile: "9876543210",
    quantity: 1,
    numberOfPeople: 2,
    idempotencyKey: "test-key-2",
    referredBy: "  Rahul Sharma  ",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.referredBy, "Rahul Sharma");
  }
});

check("validation refuses referredBy longer than 80 characters", () => {
  const tooLong = "A".repeat(81);
  const error = validateReferredBy(tooLong);
  assert.ok(error && error.includes("80 characters"));

  const result = validateBookingRequest({
    eventId: "00000000-0000-0000-0000-000000000001",
    eventDateId: "00000000-0000-0000-0000-000000000002",
    passCategoryId: "00000000-0000-0000-0000-000000000003",
    customerName: "Asha Patel",
    customerMobile: "9876543210",
    quantity: 1,
    numberOfPeople: 2,
    idempotencyKey: "test-key-3",
    referredBy: tooLong,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.fieldErrors.referredBy);
  }
});

// Database integration check
const pg = await startPostgres();
try {
  const seedNight = await pg.db.query(
    "select d.event_id, d.id as night_id, p.id as pass_id, p.number_of_people from event_dates d join pass_categories p on p.event_id = d.event_id where d.booking_open = true limit 1"
  );
  assert.ok(seedNight.rows.length > 0);
  const row = seedNight.rows[0];

  // Call create_pending_booking with referral
  const bookingRes = await pg.db.query(
    `select * from public.create_pending_booking(
      $1::uuid, $2::uuid, $3::uuid,
      'Test Customer', '9876543210', 1, $4::int, 'ref-test-idem', 'Partner Promoter'
    )`,
    [row.event_id, row.night_id, row.pass_id, row.number_of_people]
  );
  assert.equal(bookingRes.rows.length, 1);
  assert.equal(bookingRes.rows[0].referred_by, "Partner Promoter");

  // Attach razorpay order and confirm booking payment to generate digital pass
  await pg.db.query("select public.attach_razorpay_order($1, 'order_test_referral')", [bookingRes.rows[0].booking_uuid]);
  const confirmRes = await pg.db.query(
    `select * from public.confirm_booking_payment('order_test_referral', 'pay_test_referral', $1)`,
    [bookingRes.rows[0].total_amount * 100]
  );
  assert.equal(confirmRes.rows.length, 1);

  // Look up pass by token
  const passRes = await pg.db.query(
    `select dp.qr_token from public.digital_passes dp where dp.booking_id = $1 limit 1`,
    [bookingRes.rows[0].booking_uuid]
  );
  assert.ok(passRes.rows.length > 0);
  const qrToken = passRes.rows[0].qr_token;

  const passTicketRes = await pg.db.query(
    `select * from public.get_pass_by_token($1)`,
    [qrToken]
  );
  assert.equal(passTicketRes.rows.length, 1);
  assert.equal(passTicketRes.rows[0].referred_by, "Partner Promoter");

  // Admin booking detail
  const detailRes = await pg.db.query(
    `select * from public.admin_booking_detail($1, true)`,
    [bookingRes.rows[0].booking_reference]
  );
  assert.equal(detailRes.rows.length, 1);
  assert.equal(detailRes.rows[0].referred_by, "Partner Promoter");

  passed += 1;
  console.log(`  ✓ database functions store and return referred_by end-to-end`);
} finally {
  await pg.close();
}

console.log(`\n${passed} passed, 0 failed`);
