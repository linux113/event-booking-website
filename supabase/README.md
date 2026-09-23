# Database (Supabase)

PostgreSQL schema for the event booking system. Everything the application reads
about events, passes and bookings lives here — nothing is hard-coded in the UI.

```
supabase/
├── migrations/
│   ├── 20260922090000_init_schema.sql            # tables, constraints, indexes, triggers, grants
│   ├── 20260922090100_rls_policies.sql           # Row Level Security + role helper functions
│   ├── 20260922090200_public_data_api.sql        # per-night availability RPC, highlights, features
│   ├── 20260922090300_pass_catalogue_visibility.sql  # disabled passes stay visible to the site
│   ├── 20260922090400_booking_flow.sql           # DND reference, idempotency key, atomic booking RPC
│   ├── 20260922090500_payments.sql               # public token, payment events, confirm/refund, webhook
│   ├── 20260922090700_check_in.sql               # gate verdict + atomic check-in (scan_pass, check_in_pass)
│   └── 20260922090800_admin_roles.sql            # three-role model, RLS helpers, admin lookup + stats
└── seed.sql                                      # event, 9 nights, 5 passes, features, highlights
```

## Tables

| Table | Purpose | Public read? |
| ----- | ------- | ------------ |
| `events` | One festival (venue, city, status) | ✅ published only |
| `event_dates` | One night per row, with capacity, `capacity_held` (seats withheld from online sale) and `booking_open` | ✅ nights of a published event (status tells the UI it is cancelled or finished) |
| `pass_categories` | Pass types + prices + `min_age` (per event) | ✅ every row of a published event — `is_active` decides whether it can be bought, not whether it is shown |
| `event_highlights` | "What to expect" bullets per event | ✅ rows of a published event |
| `event_features` | Production inclusions (anchor, DJ, drone…) | ✅ rows of a published event |
| `bookings` | One booking = one pass category on one night | ❌ staff only |
| `payment_events` | One row per Razorpay webhook delivery (the duplicate guard) | ❌ staff only |
| `digital_passes` | One row per purchased pass: readable `pass_id` (`PS-000123`), secret 64-character `qr_token`, state and check-in | ❌ staff only — read through `service_role` functions only |
| `check_ins` | Gate scan log (one row per pass, ever) | ❌ staff only |
| `gallery` | Photo/video metadata (files in Storage) | ✅ published only |
| `admin_users` | Auth users allow-listed as staff (`super_admin` / `admin` / `staff`) | ❌ super admins only |

### What the public API exposes

The website never reads a booking. Two things exist so it can say "Fully booked"
without seeing anybody's data:

- **`get_event_night_availability(p_event_id uuid)`** — `SECURITY DEFINER`, returns one
  row per night with `booked_people`, `capacity`, `remaining`, `is_fully_booked` and
  `is_bookable`. It counts people from bookings that are `confirmed` + `paid` only, so
  an abandoned checkout never holds capacity. `execute` is granted to `anon`,
  `authenticated` and `service_role`.
- **Pass visibility.** `pass_categories` rows are readable for a published event even
  when `is_active = false`, because a pass that is deliberately off sale must still be
  visible to visitors as "Not on sale". `is_active` is enforced where it matters — the
  booking step, which runs with the service role.

Booking creation never happens through a table. The only write path is
`create_pending_booking(...)`, a `SECURITY DEFINER` function whose `execute` privilege
belongs to `service_role` alone (`anon` and `authenticated` are explicitly revoked, and
so is `PUBLIC`). It locks the night row, re-reads occupancy from paid bookings,
multiplies `pass_categories.price_inr` by the quantity itself — it has no parameter for a
price, subtotal or total, so a tampered request cannot change what a booking costs — and
always writes `booking_status = 'pending'` with `payment_status = 'unpaid'`.

`bookings.idempotency_key` carries a per-attempt key with a unique index: a double click,
a retry or a page reload returns the booking that already exists instead of creating a
second one. The customer-facing reference comes from `generate_booking_id()`
(`DND<year><5 digits>`, e.g. `DND202600001`).

| SQLSTATE | Meaning | `detail` |
| -------- | ------- | -------- |
| `PB001` | Not enough capacity left | places remaining |
| `PB002` | Night is cancelled, sold out or not open | — |
| `PB003` | Pass category is off sale or from another event | — |
| `PB004` | Quantity outside `max_per_booking` | the limit |
| `PB005` | Head count contradicts the pass composition | the required head count |
| `PB006` | Night not found / belongs to another event | — |

Passes are **not** readable by `anon` at all — not even a customer's own. Reading one
means proving you have its secret:

- **`get_booking_passes(p_public_token uuid)`** returns the passes of one booking, for the
  confirmation page. The token is the booking's random uuid, handed out in the
  confirmation link.
- **`get_pass_by_token(p_qr_token text)`** returns one pass from the 64-character token
  inside its QR code, for the ticket page and the gate view.

Both return the pass, its night and the event, and **no** mobile number or email address,
so a ticket is safe to show at a gate or screenshot into a group chat. Both are
`service_role` only: a leaked anon key cannot enumerate passes, guess a token from a
sequential pass id, or read the check-in log.

Everything else public (events, nights, features, highlights, gallery) is a plain RLS
read on tables that hold no personal data.

### Payments

Money is only ever moved by server code, and only the database decides that a booking is
paid. Five functions back that, all `SECURITY DEFINER` and all `service_role`-only:

| Function | What it does |
| -------- | ------------ |
| `attach_razorpay_order(booking, order_id)` | Stores the Razorpay order id on the pending booking once (a replay returns the stored one). `PC004` when the booking does not exist. |
| `confirm_booking_payment(order_id, payment_id, amount_paise)` | The only way `payment_status` becomes `paid`: checks the amount against `total_amount × 100` (`PC002`) and that the payment is not already used by another booking (`PC003`), then sets `paid` + `confirmed` and inserts **exactly `quantity`** `digital_passes` rows. Idempotent: a replay returns `already_confirmed` and writes nothing. |
| `fail_booking_payment(order_id, payment_id)` | Marks a still-unpaid booking `failed`. A paid booking is never downgraded (`already_paid`). |
| `refund_booking_payment(payment_id)` | Marks the booking refunded and cancels its passes; idempotent (`already_refunded`). |
| `apply_razorpay_event(event_id, type, order, payment, amount)` | The webhook dispatcher. Claims the delivery by its unique `event_id` in `payment_events`, then routes `payment.captured` / `order.paid` (confirm), `payment.failed` (fail) and `refund.processed` / `payment.refunded` (refund). Outcomes: `confirmed`, `already_confirmed`, `failed`, `refunded`, `ignored`, `duplicate`. |

| SQLSTATE | Meaning |
| -------- | ------- |
| `PC001` | No booking carries that order id |
| `PC002` | The amount paid does not match `total_amount × 100` |
| `PC003` | That payment id is already stored on another booking |
| `PC004` | Unknown booking when attaching an order |
| `PC005` | A confirmation arrived without a payment id (an `order.paid` delivery on its own is recorded and ignored) |

`get_booking_status(p_public_token uuid)` is the one payment-related function a customer
indirectly reaches: it returns a single booking by the random `bookings.public_token`
handed out with the order, and deliberately contains no name, mobile or email. The
parameter is a `uuid` and the token is never in a URL that also carries
`bookings.booking_id`.

### Only the gateway may move a payment status

`bookings.payment_status` is not an ordinary column: the trigger
`bookings_guard_payment_status` refuses any `UPDATE` that changes it unless
`current_setting('app.payment_proof', true) = 'razorpay-verified'`. The three functions
that legitimately move it — `confirm_booking_payment`, `fail_booking_payment`,
`refund_booking_payment` — each set that value transaction-locally as their first
statement, and everything else fails with:

| SQLSTATE | Meaning |
| -------- | ------- |
| `PB007` | `payment_status may only change through a verified Razorpay event` — with the hint to re-deliver the gateway's own event (Razorpay → Webhooks → resend) instead of writing the status by hand |

The practical consequence is that there is no manual "mark as paid" path to build a
button for, and none to add by accident either: a booking whose payment the gateway
captured but the site missed is repaired by re-delivering the signature-verified event,
which is the only thing the column is willing to listen to. An ad-hoc `update` in the
SQL editor is refused in the same way a script would be.

`bookings.public_token` (uuid, unique) exists so a customer can refresh their confirmation
page; `booking_id` (`DND…`) stays the human-quoted reference. `payment_events.event_id` is
unique, and `payment_events` has RLS enabled with no policies and no grants to `anon` or
`authenticated`, so the table is invisible to the browser.

### Digital passes

A pass is issued by the same transaction that confirms the payment, and by nothing else:

- `confirm_booking_payment()` inserts one row per purchased pass, numbered `1..quantity`,
  in the same transaction that sets `payment_status = 'paid'`. A booking is therefore
  confirmed with all of its passes or with none of them.
- The unique index on `(booking_id, pass_number)` means a booking can never hold two
  "pass 1"s, and the insert is written as `on conflict (booking_id, pass_number) do
  nothing` — a replayed confirmation or a retried webhook adds no pass. A duplicate
  callback is also caught earlier, by the `payment_status = 'paid'` re-read.
- `pass_id` (`PS-000123`) is the number printed on the pass. It is a sequence value, so it
  is treated as a label, never as a credential.
- `qr_token` is 64 hex characters of `gen_random_uuid()` output, unique across the table,
  and is what the QR code contains (as `<site>/verify/<token>`). Tokens never appear in a
  rendered page: only inside the links and the QR itself.
- `refund_booking_payment()` cancels every pass of the booking in the same statement that
  marks the booking refunded, so a refunded pass cannot be scanned.
- `digital_passes.checked_in` / `checked_in_at` are constrained to move together, and
  `check_ins.digital_pass_id` is unique: one entry per pass, ever. The public gate view
  (`/verify/<token>`) only *reads* that state; the only thing that writes it is
  `check_in_pass()`, described below.

### Gate entry

A scanned code becomes an admitted guest through exactly one path. `pass_entry()` is the
shared body; the two functions below are the only entry points, and both run it as the
definer:

| Function | What it does |
| -------- | ------------ |
| `scan_pass(qr_token, gate_date, staff_user_id)` | Returns the verdict for a scanned token and writes **nothing**. This is what the scanner shows before anybody presses a button. |
| `check_in_pass(qr_token, gate_date, staff_user_id, gate)` | The same verdict, and on success the admission: `checked_in = true`, `status = 'used'`, `checked_in_at = now()` and one `check_ins` row. |

Both take the **night** the gate is open as a parameter, and the server computes it from
the venue's timezone (`src/lib/gate/night.ts`) — never from the phone that is scanning.
Both are `service_role`-only (`execute` revoked from `PUBLIC`, `anon` and `authenticated`;
`pass_entry` itself is revoked from every role, including `service_role`), and both
re-read the caller's `admin_users` row inside the database: an active row with role
`super_admin`, `admin` or `staff`, or the answer is `not_authorised`.

One transaction, one row read under lock:

| Step | Detail |
| ---- | ------ |
| Shape | `^[0-9a-f]{64}$`, checked *before* any lookup, so a 1 MB "token" never reaches a query |
| One inner join | `digital_passes` → `bookings` → `event_dates` → `events` → `pass_categories`, with `for update of digital_passes` — a pass with no booking cannot be half-valid, and a second scanner waits here |
| The eight checks | token exists · pass exists · booking exists · booking `confirmed` · payment `paid` · pass `active` · the night is not cancelled and the event is published · the pass's night **is** the gate night and the pass is unused |
| The write | a compare-and-swap: `update … where checked_in = false and status = 'active'`. Zero rows updated means another scanner won the race, and the answer is `already_used` |
| The audit row | one `check_ins` row (unique `digital_pass_id`), carrying the night, the gate label, `checked_in_by` = the `admin_users` row and `notes = 'web scanner'` |

Outcomes, in the order they are decided: `not_authorised`, `invalid`, `refunded`,
`payment_not_verified`, `already_used`, `expired`, `not_yet_valid`, then `valid` (preview)
or `checked_in` (committed). A refusal always carries a `reason` sentence the scanner can
show, and never carries a mobile number or an email address — the door needs a name and a
pass, not a customer's contact details.

Two properties are enforced by the database rather than by the application:

- **One pass, one entry, ever.** The lock makes the compare-and-swap safe, and the unique
  constraint on `check_ins.digital_pass_id` is the backstop underneath it. Two phones
  scanning the same QR code at the same moment produce exactly one admitted guest; the
  other is told the pass is already used.
- **A check-in cannot exist without an admission.** The `check_ins` row is only written on
  the `checked_in` outcome, and `digital_passes.checked_in`/`checked_in_at` move together
  (a CHECK constraint).

### Roles and authorisation

The allow-list carries exactly three roles, and the database — not the app — is the last
word on what they mean:

| Role | `is_staff()` | `is_admin()` | `is_super_admin()` | What it may do |
| ---- | ------------ | ------------ | ------------------ | -------------- |
| `super_admin` | ✅ | ✅ | ✅ | Everything, including writing `admin_users` |
| `admin` | ✅ | ✅ | ❌ | Events, bookings, passes, gallery, scanner, settings |
| `staff` | ✅ | ❌ | ❌ | The scanner, check-ins, a limited booking lookup |

- **`is_staff(p_user_id)`** — any active role. `is_admin` — `super_admin` or `admin`.
  **`is_super_admin`** — the full-access role. All three are `SECURITY DEFINER` so a
  check against `admin_users` does not recurse through that table's own policies, and
  all three ship with `execute` granted to `anon`, `authenticated` and `service_role`.
- **Only a super admin may write `admin_users`** (`admin_users_super_admin_manage`).
  There is no policy that lets an admin change their own row, which is what makes
  "an admin cannot promote themselves" a database fact rather than a UI convention.
- **`current_staff_role()`** returns the caller's own role — one word, never a row, and
  null for `anon`. `src/proxy.ts` uses it to refuse a request *before* a page renders,
  because a redirect thrown while a response is streaming cannot change its status code.
- **Deactivating is `is_active = false`.** All three helpers require it, so a suspended
  account holds no role at all, everywhere, immediately.
- A role value that is not one of the three is rejected by a CHECK constraint. The old
  `owner` / `manager` / `scanner` values were migrated in the step-8 migration
  (`owner → super_admin`, `manager → admin`, `scanner → staff`), and `is_owner()` was
  dropped rather than kept as a second name for one question.

### Admin reads

A growing set of `service_role`-only functions backs the admin area, so that the app never
counts or filters rows by pulling a table into Node:

| Function | What it does |
| -------- | ------------ |
| `admin_search_bookings(p_query, p_event_date_from, p_event_date_to, p_pass_category_id, p_payment_status, p_booking_status, p_check_in_status, p_include_contact, p_limit, p_offset)` | The `/admin/bookings` list: the search box, the five filters, the ordering (`created_at desc`), the page slice and `total_count` — the size of the *whole* result set, not of the page. A term matches the booking reference, guest name, email, pass ID, Razorpay payment ID or order ID; its digits match the mobile column only when the term is a number (no letters, at least four digits), and LIKE wildcards are escaped, so `%` finds nothing rather than everything. A filter value outside the schema's vocabulary **narrows nothing** instead of returning an empty list that reads as "no such booking". `p_limit` clamps to 1–100, `p_offset` to ≥ 0. **Contact, amount and gateway columns come back `null` when `p_include_contact` is false**, which is the limited view a `staff` role gets — the withholding happens in the query, not in the UI |
| `admin_booking_detail(p_lookup, p_include_contact)` | One booking in full, found by booking reference, pass ID (case-insensitive), Razorpay payment ID or order ID: the event, venue and night, the pass, the money, plus `passes`, `check_ins` (with the staff member's name) and `payment_events` as JSON. Amounts, contact details and gateway IDs are `null` without `p_include_contact`, and `payment_events` is withheld too. **`qr_token` is never returned** — the credential that admits a guest does not belong on a screen |
| `admin_dashboard_stats(p_today, p_tz, p_include_revenue)` | One row of 28 live counts: bookings by status and payment state, today's bookings, total/today's/refunded revenue, check-ins, passes issued/active/used, people on paid bookings, capacity total/taken/available over the scheduled nights still to come, tonight's own capacity figures, nights, gallery state and staff accounts |
| `admin_booking_series(p_today, p_days, p_tz, p_include_revenue)` | One row per day over the last `p_days` (1–90, default 14), **including the days with nothing in them** — a chart with gaps in it tells a different story than the data does. Per day: bookings, confirmed bookings, and paid revenue |
| `admin_pass_breakdown(p_include_revenue)` | Every pass category — including the ones nobody bought — with its bookings, paid bookings, passes issued, people and takings, ordered biggest first |
| `admin_recent_bookings(p_limit, p_include_contact)` | The newest bookings (1–50, default 8), joined to their night and pass. **The mobile number, email address and amount are `null` when `p_include_contact` is false** |
| `admin_search_pattern(p_term)` | The one place the search rules live: trims, caps at 64 characters and escapes `%`, `_` and `\` so a term is a term. `admin_search_bookings`, `admin_payment_events` and `admin_pass_list` all call it, which is why a search for `%` finds nothing on every screen rather than the whole event on one | 
| `admin_search_digits(p_term)` | The digits of a term **only when the term is a number** (no letters, at least four digits), otherwise `''`. Used to decide whether to match the mobile column, so a search for "Suite 101" does not answer with everybody whose phone number contains `101` |
| `admin_payment_events(p_query, p_outcome, p_event_type, p_from, p_to, p_include_contact, p_limit, p_offset)` | `/admin/payments`: the delivery log, newest first, joined to the booking each delivery belongs to where one can be identified — by Razorpay order/payment ID, by booking reference, or by anything about the booking (name, mobile, email, pass ID). **A delivery that matches no booking is still listed**, with every booking column `null`; hiding it would hide the one row an operator is looking for. `p_outcome` and `p_event_type` outside the schema's vocabulary narrow nothing; `p_from`/`p_to` are inclusive against the day the delivery was **received**; `p_limit` clamps to 1–100. `amount_paise`, the booking's amount and the contact details come back `null` without `p_include_contact` |
| `admin_payment_attention(p_include_contact, p_limit)` | The rows whose payment state contradicts the rest of the row, each as `reason_code` + `reason` + `action`: `paid-no-pass`, `paid-not-confirmed`, `refunded-with-active-pass`, `failed-with-pass`, `event-ignored`. The reason and the action are sentences decided here, beside the rule they describe, and **nothing on the screen can fix them** — a payment status is only ever moved by a verified gateway event (`PB007`), so the fix is re-delivering the event or cancelling the pass |
| `admin_payment_summary(p_include_contact)` | The counts above the log: deliveries by outcome (`confirmed`, `already_confirmed`, `failed`, `refunded`, `ignored`, `duplicate`), the bookings still awaiting a verified payment, when the last delivery arrived and was processed, and `captured_paise`/`refunded_paise` summed from **the gateway's own payload amounts** — deliberately not from the amounts stored on our bookings, which is what makes the two comparable. Both sums are `null` without `p_include_contact` |
| `admin_pass_list(p_query, p_status, p_check_in, p_event_date_id, p_from, p_to, p_include_contact, p_limit, p_offset)` | `/admin/passes`: the door list — one row per issued pass, with its pass number, how many passes the booking holds, the booking, the guest, the night, the pass category, the booking's own statuses, and the entry record (checked in, when, gate, and the staff member who admitted it). Ordering is `created_at desc, booking_id desc, pass_number desc`, so a booking's passes stay together and in order, and every row carries `total_count` for the whole match. Search covers pass ID, booking reference, guest name and mobile. A status or entry value outside the schema's vocabulary narrows nothing. `p_limit` clamps to 1–100. **`qr_token` is never selected** — the credential that admits a guest is not on the list, in the CSV, or in any parameter | 
| `admin_pass_catalogue(p_event_id)` | `/admin/passes?view=types`: every pass type of the event — on sale or not — with its name, composition, description, price, people per pass, booking limit, `min_age`, sort order, and what has been sold on it: bookings, paid bookings, passes issued, people sold and revenue taken, all counted in SQL. Defaults to the event `admin_default_event_id()` picks (the published one, else the oldest) |
| `admin_save_pass_category(p_id, p_event_id, p_code, p_name, p_composition, p_description, p_price_inr, p_number_of_people, p_max_per_booking, p_min_age, p_sort_order, p_is_active)` | Creates (`p_id` null) or edits one pass type and returns the row as it now stands. Spaces and underscores in the code become dashes; the spelling the organiser typed is kept, and a case-folded unique index stops "Family-Pass" and "family-pass" becoming two rows at two prices (`PC003`). Price 1–500 000 (`PC004`), people 1–50 (`PC005`), at most 100 per booking (`PC006`), age 0–120 (`PC007`), and the event is not reassignable — a pass that sold belongs to the event it sold for |
| `admin_set_pass_category_active(p_id, p_is_active)` | Takes one pass on or off sale and touches nothing else — deliberately narrow, so the switch cannot rewrite a price on its way past. Nothing is ever deleted: a pass with bookings on it is the record of what was sold |
| `admin_event_dates(p_event_id)` | `/admin/dates`: every night of the event with `capacity`, `capacity_held`, `booking_open`, paid people, paid bookings, passes issued, `seats_on_sale`, `seats_available`, `over_committed` and `is_full` — aggregated in SQL so the screen counts nothing |
| `admin_save_event_date(p_id, p_event_id, p_event_date, p_start_time, p_end_time, p_capacity, p_capacity_held, p_status, p_booking_open, p_notes)` | Creates or edits one night. Locks the night row before counting, refuses a capacity below the seats paid for plus the seats held back (`PT004`, with the floor in `detail`), an impossible held figure (`PT002`/`PT003`), a duplicate date (`PT006`) or a night that ends before it starts (`PT008`) |
| `admin_set_event_date_capacity(p_id, p_capacity, p_capacity_held)` | `capacity_held` defaults to the value already stored, so a capacity can be corrected without disturbing what is held back. Locks the night, then refuses `paid + held > capacity` with `PT004` — the number the control needs to offer instead |
| `admin_set_event_date_booking(p_id, p_booking_open)` | Opens or closes booking on one night without cancelling it, so the night stays on the site with its reason instead of disappearing |
| `admin_default_event_id()` | The event the management screens operate on: the published one, else the oldest |
| `admin_pass_summary(p_tz, p_include_contact)` | The counts above the door list: passes by status, checked-in totals, **checked in today in the venue's timezone** (`p_tz`, not the server's), how many gates are in use, the last entry, and the money behind the passes counted **once per booking** rather than once per pass — a group of four passes does not pay four times. `passes_revenue` is `null` without `p_include_contact` |

Three conventions run through the dashboard functions:

- **Days are the venue's days.** Every date calculation takes `p_tz` (the app passes
  `siteConfig.timezone`) rather than assuming UTC, so a booking taken at 1am in Jaipur is
  counted on the night it was taken. `p_today` is the venue's date, so "tonight" means
  the venue's tonight.
- **Money is withheld, never zeroed.** When `p_include_revenue` is false the revenue
  columns return `NULL`, so a role without `payments:view` receives no figure to render —
  the app cannot accidentally show a number it was not given, and "no revenue" stays
  distinguishable from "not your business".
- **Revenue means paid.** `payment_status = 'paid'` is the only definition used; a
  refunded booking stops counting the moment it is refunded, which is why the tests can
  refund one and watch the total move.

`admin_dashboard_stats` replaced the one-argument version from the step-8 migration
rather than sitting beside it: two functions answering the same question is how a
dashboard ends up disagreeing with itself.

All of them are revoked from `PUBLIC`, `anon` and `authenticated` and granted only to
`service_role`: a leaked anon key cannot enumerate bookings, read the day's takings, list
passes or read the gateway's delivery log.

**The two operations screens are read-only by construction.** There is no function that
marks a booking paid, cancels a pass or edits a delivery: `admin_pass_list` does not even
select `qr_token`, and the attention list names the problem and the fix in words rather
than offering a button that could write a payment status the trigger would refuse. The
only writers for money and passes remain the ones described above — a verified Razorpay
event, and a scanned token at the gate.

### Integrity rules worth knowing

- **Prices cannot be tampered with.** `bookings.subtotal` and `number_of_people`
  are recomputed by the `set_booking_amounts()` trigger from `pass_categories`, and
  `total_amount` may not exceed the computed subtotal. A client that posts a fake
  price gets corrected (or rejected), not trusted.
- **One check-in per pass, ever.** `check_ins.digital_pass_id` is unique, so
  double entry is impossible at the database level.
- **Consistent check-in state.** `digital_passes.checked_in` can only be true when
  `checked_in_at` is set.
- **`updated_at` is server-owned** via the `set_updated_at()` trigger.
- **Money is stored in whole rupees** (`integer`). Razorpay amounts are derived as
  `price_inr * 100` paise at order-creation time.
- **A pending booking does not hold capacity.** Capacity counts `payment_status = 'paid'`
  rows only, so an abandoned checkout never blocks a place — the same rule the public
  availability function uses.
- **No digital pass is issued before payment.** Passes are created after a verified
  payment, so nothing in the booking flow can produce a scannable pass.
- **One pass per slot, per booking.** `(booking_id, pass_number)` is unique, so passes
  are numbered exactly `1..quantity` however many times a confirmation is replayed.
- **A confirmed payment cannot be lost.** If the night fills up while the customer is
  paying, the booking is still confirmed and an organiser note is recorded —
  `capacity exceeded when payment was confirmed — needs organiser review` — instead of
  dropping a booking that has already been paid for.
- **A night cannot be made impossible.** `event_dates` carries `capacity >= 1`,
  `capacity_held >= 0` and `capacity_held <= capacity` as constraints, and a trigger
  (`event_dates_guard_capacity`) refuses any write — the admin function, a migration, the
  SQL editor — that would take seats away from people who have already paid
  (`PT004 capacity_below_taken`, with the lowest allowed capacity in `detail`) or move a
  night whose issued passes have its date printed on them (`PT005 night_date_locked`).
  Raising a capacity, cancelling a night, fixing a time or a note is always allowed; a
  night that has sold out can therefore still be edited.
- **Availability can never go negative, and the website and the booking path agree.**
  `capacity - capacity_held - paid people` is computed the same way by
  `get_event_night_availability()` (what the site offers) and `create_pending_booking()`
  (what the site will honour), with `greatest(…, 0)` on the way out.
- **Two writers counting the same night cannot interleave.** The booking path and all
  three admin writers take the night row `for update` before counting seats, so an
  organiser lowering a capacity and a guest paying for the last seat are serialised
  rather than raced.
- **Webhook deliveries are exactly-once.** `payment_events.event_id` is unique, and the
  claim happens in the same transaction as the side effect, so a retried delivery is
  recorded and reported as `duplicate` without touching the booking again.
- **A payment status cannot be typed in.** The `bookings_guard_payment_status` trigger
  (`PB007`) refuses any change to `bookings.payment_status` that is not made by one of the
  three payment functions inside a transaction they have marked as
  `app.payment_proof = 'razorpay-verified'` — see
  [Only the gateway may move a payment status](#only-the-gateway-may-move-a-payment-status).

## Applying the schema

### Local (Supabase CLI)

```bash
npx supabase init          # only once, creates config.toml
npx supabase start         # local Postgres + Studio in Docker
npx supabase db reset      # applies migrations, then seed.sql
```

### Hosted project

Either link the project and push,

```bash
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

or paste `migrations/*.sql` (in filename order) and then `seed.sql` into the
Supabase **SQL editor**.

## Roles and access

| Role | What it can do |
| ---- | -------------- |
| `anon` | Read published events, their nights, their pass categories (active or not), features, highlights and published gallery rows, plus per-night availability counts through `get_event_night_availability()`. Nothing else — no read or write access to bookings, passes, check-ins or admin users. |
| `authenticated` | Same public reads. Gains admin powers only when present in `admin_users` with an active role: `is_admin()` for the management roles (super admin, admin), `is_staff()` to include gate staff, `is_super_admin()` for the bare `admin_users` access. |
| `service_role` | Bypasses RLS. Server-only: booking creation (`create_pending_booking`), the payment functions above, the pass reads (`get_booking_passes`, `get_pass_by_token`), the gate functions (`scan_pass`, `check_in_pass`), the admin reads (`admin_search_bookings`, `admin_booking_detail`, `admin_dashboard_stats`, `admin_booking_series`, `admin_pass_breakdown`, `admin_recent_bookings`, `admin_payment_events`, `admin_payment_attention`, `admin_payment_summary`, `admin_pass_list`, `admin_pass_summary`, `admin_pass_catalogue`, `admin_event_dates`) and the pass/date writes (`admin_save_pass_category`, `admin_set_pass_category_active`, `admin_save_event_date`, `admin_set_event_date_capacity`, `admin_set_event_date_booking`) and Razorpay webhooks. Never sent to the browser — see `src/lib/supabase/admin.ts`, which imports `server-only`. |

There is deliberately **no INSERT policy on `bookings`**: bookings are created by
server code after recalculating the amount from `pass_categories`, so the browser
can never fabricate a booking or a price.

## Creating the first admin

1. Create the user in **Authentication → Users** (or let them sign up).
2. Insert the allow-list row:

```sql
insert into public.admin_users (user_id, email, full_name, role)
values ('<auth-user-uuid>', 'owner@example.com', 'Owner Name', 'super_admin');
```

A gate volunteer gets the least access that does the job:

```sql
insert into public.admin_users (user_id, email, full_name, role)
values ('<auth-user-uuid>', 'gate1@example.com', 'Gate Volunteer', 'staff');
```

Only the uuid of an existing `auth.users` row is accepted (`user_id` is a foreign key),
and `email` is unique across the allow-list. Suspending somebody is
`update public.admin_users set is_active = false where user_id = '<uuid>';` — they keep
the account and lose the access, on the very next request.

Only `super_admin` can manage `admin_users` rows; `staff` can only check passes in and
look a booking up. An `admin` runs the event but cannot touch the staff list, which is
what stops an admin from promoting themselves.

A staff member signs in with **Supabase Auth** (email + password, `supabase.auth` — no
custom passwords are stored anywhere in this schema). The `admin_users` row is the
allow-list: an account with no row, or with `is_active = false`, can sign in to Supabase
and still gets no scanner, no verdict and no check-in — `scan_pass`/`check_in_pass`
refuse the user id, and the app's staff lookup refuses the session before that.

Passwords are created in the Supabase dashboard (**Authentication → Users → Add user**,
"Auto confirm user") or by the user's own sign-up. `admin_users.user_id` must then be
pointed at that auth user's uuid.

## Regenerating TypeScript types

Types are hand-written in `src/types/database.ts` to match these migrations. Once
the project is linked, regenerate them from the live schema so they can never
drift:

```bash
npx supabase gen types typescript --project-id <your-project-ref> --schema public \
  > src/types/database.ts
```

The file mirrors the output shape (`Database["public"]["Tables"][...]["Row"]`), so
regeneration is a drop-in replacement.
