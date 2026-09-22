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
│   └── 20260922090500_payments.sql               # public token, payment events, confirm/refund, webhook
└── seed.sql                                      # event, 9 nights, 5 passes, features, highlights
```

## Tables

| Table | Purpose | Public read? |
| ----- | ------- | ------------ |
| `events` | One festival (venue, city, status) | ✅ published only |
| `event_dates` | One night per row, with capacity and status | ✅ nights of a published event (status tells the UI it is cancelled or finished) |
| `pass_categories` | Pass types + prices (per event) | ✅ every row of a published event — `is_active` decides whether it can be bought, not whether it is shown |
| `event_highlights` | "What to expect" bullets per event | ✅ rows of a published event |
| `event_features` | Production inclusions (anchor, DJ, drone…) | ✅ rows of a published event |
| `bookings` | One booking = one pass category on one night | ❌ staff only |
| `payment_events` | One row per Razorpay webhook delivery (the duplicate guard) | ❌ staff only |
| `digital_passes` | Scannable QR passes issued after payment | ❌ staff only |
| `check_ins` | Gate scan log (one row per pass, ever) | ❌ staff only |
| `gallery` | Photo/video metadata (files in Storage) | ✅ published only |
| `admin_users` | Auth users allow-listed as staff | ❌ admins only |

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

`bookings.public_token` (uuid, unique) exists so a customer can refresh their confirmation
page; `booking_id` (`DND…`) stays the human-quoted reference. `payment_events.event_id` is
unique, and `payment_events` has RLS enabled with no policies and no grants to `anon` or
`authenticated`, so the table is invisible to the browser.

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
- **A confirmed payment cannot be lost.** If the night fills up while the customer is
  paying, the booking is still confirmed and an organiser note is recorded —
  `capacity exceeded when payment was confirmed — needs organiser review` — instead of
  dropping a booking that has already been paid for.
- **Webhook deliveries are exactly-once.** `payment_events.event_id` is unique, and the
  claim happens in the same transaction as the side effect, so a retried delivery is
  recorded and reported as `duplicate` without touching the booking again.

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
| `authenticated` | Same public reads. Gains admin powers only when present in `admin_users` with an active role (`is_admin()` for owner/admin/manager, `is_staff()` to also include scanners). |
| `service_role` | Bypasses RLS. Server-only: booking creation (`create_pending_booking`), the payment functions above, and Razorpay webhooks. Never sent to the browser — see `src/lib/supabase/admin.ts`, which imports `server-only`. |

There is deliberately **no INSERT policy on `bookings`**: bookings are created by
server code after recalculating the amount from `pass_categories`, so the browser
can never fabricate a booking or a price.

## Creating the first admin

1. Create the user in **Authentication → Users** (or let them sign up).
2. Insert the allow-list row:

```sql
insert into public.admin_users (user_id, email, full_name, role)
values ('<auth-user-uuid>', 'owner@example.com', 'Owner Name', 'owner');
```

Only `owner` can manage `admin_users` rows; `scanner` can only check passes in.

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
