# Garba Nights — Navratri & Dandiya event booking

A production-oriented booking platform for Navratri / Dandiya events: browse nights,
reserve passes and pay online. Built with **Next.js (App Router) + React + TypeScript +
Tailwind CSS**, backed by **Supabase** (Postgres, Auth, Storage), **Razorpay** for
payments, deployed on **Vercel**, versioned on **GitHub**. Chosen so the whole stack
fits within free tiers for development and small-scale launch.

## Documentation

| Guide | What it covers |
| ----- | -------------- |
| [`docs/connect-free-supabase.md`](./docs/connect-free-supabase.md) | Creating the database on Supabase's free tier: the 16 migrations in order (SQL editor or CLI), which key goes in which variable after the 2026 rename, the first admin account, replacing the seed data with your real event, free-tier limits and the 7-day pause |
| [`docs/deploy-vercel.md`](./docs/deploy-vercel.md) | Deploying: importing the repo, the Production Branch trap, the environment variables, the Razorpay webhook, Hobby-plan reality, and the five checks that prove the deployment is real |
| [`docs/how-it-works.md`](./docs/how-it-works.md) | The whole flow — customer, organiser, gate — how the pieces fit, every URL that must be configured and what breaks if it is wrong, and the one URL needed to have a deployment verified |
| [`docs/neon-setup.md`](./docs/neon-setup.md) | Running the schema on Neon (or any bare PostgreSQL): creating the project, `npm run db:setup`, and an honest account of what still depends on Supabase — sign-in, file storage, and the HTTP data API |
| [`supabase/README.md`](./supabase/README.md) | The database reference: tables, roles, RLS rules, storage buckets, every `SECURITY DEFINER` function |

## Status

| Step | Scope | State |
| ---- | ----- | ----- |
| 1 | Project setup — Next.js, TypeScript, Tailwind, structure, tooling | ✅ done |
| 2 | Public UI — all seven public routes, responsive, accessible | ✅ done |
| 3 | Database + connecting the public site to it (schema, RLS, seed, service layer) | ✅ done |
| 4 | Booking system — four-step checkout, server-side pricing, capacity, duplicate protection | ✅ done |
| 5 | Payments — Razorpay test mode: order creation, server-side signature verification, webhook, duplicate protection, refresh-safe status page | ✅ done |
| 6 | Digital pass + QR code — issued only after a verified payment, printable ticket, gate view | ✅ done |
| 7 | QR verification and entry — staff sign-in, mobile camera scanner, server-side check-in | ✅ done |
| 8 | Admin authentication — staff sign-in, three roles, protected routes, logout, booking lookup | ✅ done |
| 9 | Admin dashboard — eight live statistics, charts, recent bookings, loading skeletons and error states | ✅ done |
| 10 | Booking management — searchable, filterable list, one booking in full, CSV export, payment statuses that only the gateway can move | ✅ done |
| 11 | Payments and passes — the gateway's own record, the rows that contradict themselves, and the door list with a CSV export | ✅ done |
| 12 | Pass and date management — create and edit passes, prices, limits and age; add nights, set capacity, hold seats back, open and close booking | ✅ done |
| 13 | Gallery management — upload to private storage, describe, order, publish into the public bucket, delete the files with the row | ✅ done |
| 14 | Contact and WhatsApp — the event's contact details in the database, every link built in one module, a complete contact page and a footer that reads it | ✅ done |
| 15 | Operations screens — publishing events, event settings | ⏳ next |
| 16 | Hardening — rate limiting, analytics, perf budget | ⏳ |

Step 3 is two halves of one job — the Supabase schema/RLS layer, then replacing every
hard-coded value in the UI with database reads. Both are done and verified against real
PostgreSQL (`npm run db:verify`, `npm run verify:web`). Until a Supabase project URL and
anon key are added to `.env.local`, every route renders a "Database not connected" state
rather than failing.

**Nothing is mocked.** Prices, nights, gallery, bookings, payments and gate entries all
come from the database, through `src/lib/services`; no component invents a price, a
booking or a verdict. Payments run in Razorpay test mode (the flow is exercised
end-to-end by `npm run verify:web` against a local stub gateway, because real test keys
are yours to create), and a booking is only ever marked paid by a server-verified
signature — never by the browser saying so.

## Pages

| Route | Purpose |
| ----- | ------- |
| `/` | Hero (event, dates, venue, CTAs), feature strip, about, pass preview, gallery preview, contact preview, CTA band — all read from the database |
| `/about` | Festival overview, what to expect (`event_highlights`), production list (`event_features`), organiser profiles |
| `/passes` | Every pass category with its database price, inclusions, pass policy notes, per-night availability |
| `/book` | Four-step checkout: night, pass, details, review. Creates a `pending` / `unpaid` booking and opens Razorpay Checkout for the amount the server calculated |
| `/book/status` | Server-rendered confirmation and live booking status, reached with the random token in the customer's confirmation link (noindex, no personal details) |
| `/booking/success` | Where the browser lands after a verified payment: booking id, event date, pass category, every issued pass id and a button into each digital pass (noindex, read-only) |
| `/pass/[passId]` | The digital pass itself — mobile-first, ticket-shaped, printable and downloadable. Needs the pass's own 64-character token in `?t=…` (noindex) |
| `/pass/[passId]/download` | The pass as a standalone SVG ticket, or just the QR code as a PNG (`?format=png`). Token-guarded and never cached |
| `/verify/[token]` | What the QR code opens — the gate view: `VALID`, `ALREADY CHECKED IN`, `CANCELLED`, `EXPIRED` or `NOT A VALID PASS`. Read-only |
| `/admin/login` | Staff sign-in: Supabase Auth email + password, then the `admin_users` allow-list. A valid account that is not staff is signed back out with an explanation |
| `/admin` | The dashboard: eight statistics (bookings, revenue, check-ins, capacity), bookings and revenue by date, the pass-category distribution, the newest bookings, plus exactly the sections the signed-in role may open |
| `/admin/scanner` | The gate: camera QR scanner, the verdict for the pass that was scanned, and the CHECK IN button that burns it. Every role; the page itself never writes |
| `/admin/bookings` | Booking management: one search box (reference, name, mobile, email, pass ID, Razorpay payment or order ID), five filters (night range, pass, payment status, booking status, check-in status), paged results and a CSV export of whatever the filters select. One page, two views: an admin sees contact details, amounts and gateway IDs, a staff member sees the guest, the night, the pass and the check-in state |
| `/admin/bookings/[reference]` | One booking in full: guest and contact details, night, pass, amounts, every issued pass, every gate entry with the staff member who made it, and the Razorpay events received for its order. No control anywhere on the page can change a payment status |
| `/admin/bookings/export` | The current filters as a CSV file. Contact, amount and gateway columns are omitted entirely for a role without `bookings:view_contact` |
| `/admin/payments` | What the gateway sent and what the site did with it: the deliveries received (`payment.captured`, `payment.failed`, `payment.refunded`, the ones deliberately ignored, the duplicates), the amounts Razorpay itself reported as captured and refunded, the bookings still waiting on a verified payment, the deliveries that belong to no booking we hold, and a list of the rows whose payment state contradicts the rest of the row — each with the reason and what to do about it. Read-only by construction: a payment status moves only when a verified gateway event says so |
| `/admin/passes` | The door list: every issued pass with its pass number, state, booking, guest, night, pass category and entry record (when, at which gate, by whom). Search by pass ID, booking reference, guest name or mobile; filter by night, pass status, entry and validity date; paged, with a CSV of the same rows. The QR token is not on the page and cannot be asked for |
| `/admin/passes/export` | The door list as a CSV file, with the same filters as the screen and up to 5,000 rows in one download. Token-free: a pass is admitted by scanning it, not by reading it out |
| `/admin/settings` | The event, venue and deployment values the public site reads. Admin and super admin |
| `/admin/staff` | Who may sign in and with which role, plus how to add somebody. Super admin only |
| `/admin/gallery` | Gallery management: upload photographs (resized to WebP on the server), write the caption and the alternative text, reorder them, publish/unpublish/archive, and delete one along with its stored files. Guarded by `gallery:view`; only `gallery:edit` roles are offered the controls |
| `/gallery` | Published photos and videos from the `gallery` table, in a responsive grid with a keyboard-driven lightbox. Thumbnails lazy-load, drafts are not reachable at all |
| `/contact` | Everything needed to reach the organiser, read from the `events` row: WhatsApp with the enquiry message prefilled, phone, email, venue, address, a Google Maps link, the three social profiles and support hours, plus the FAQ and the closing band |
| `/events` | Published events from the database, each with its nights and passes |

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in as features are added
npm run dev                  # http://localhost:3000
```

Without `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` the site still
runs — each route renders a "Database not connected" state instead of event data.

## Scripts

| Script              | What it does                                                       |
| ------------------- | ------------------------------------------------------------------ |
| `npm run dev`       | Start the dev server (http://localhost:3000)                       |
| `npm run build`     | Production build (type-checks the app as part of the build)        |
| `npm run start`     | Serve the production build                                         |
| `npm run lint`      | ESLint (Next core-web-vitals + TypeScript rules)                   |
| `npm run typecheck` | `next typegen && tsc --noEmit` (route types must exist first)      |
| `npm run db:verify` | Run the migrations + seed against PostgreSQL (WASM) and assert schema, constraints and RLS — including what each role may change, and what a gate scanner's session cannot |
| `npm run verify:web` | End-to-end check against a real database: boots PostgreSQL, serves it over a PostgREST-compatible shim, calls the real services, then builds and serves the real pages and exercises the whole booking, **payment** and **gate** flow — validation, capacity, pricing, duplicate submissions, order creation, signature verification, webhooks, refunds, refresh-safe status and the live-key guard, then signs in as staff, an admin and a super admin, proves each role reaches exactly what it should and nothing else, scans a pass, admits it once, races two check-ins against the same code and refuses every kind of bad pass, searches and filters the booking list, the delivery log and the door list, opens one booking in full and downloads each of two CSV exports, checks the rate limiter, the session-cookie attributes and the response headers, and uploads/orders/publishes/deletes gallery files against a local storage double — payments run against a local stub gateway and staff sign-in against a local Auth double, so no credentials are needed |
| `npm run check`     | typecheck → lint → build, in one command                           |
| `npm run db:setup`  | Apply the schema to a **hosted** PostgreSQL (Neon, or any Postgres): `DATABASE_URL='…' npm run db:setup -- --seed`. Applies `supabase/prelude.sql` first — the `auth.users` + `auth.uid()` shim a bare server lacks — then every migration in filename order, each committing in its own transaction **together with its record** in `setup.applied_migrations`, stopping at the first failure. Safe to re-run: applied files are skipped, a part-applied database resumes where it stopped, and an edited file is reported rather than replayed (migrations are forward-only). `--verify-only` checks without changing anything; `--mark-all-applied` records a database that predates the bookkeeping. The connection string comes from the environment only, and the password in it is masked in every message |
| `npm run db:setup:test` | Prove the setup tooling against a throwaway PostgreSQL: fresh run, re-run, resume from part-applied, edited file, the no-record warning, and the one-shot paste — 20 checks, no hosted database involved |
| [`docs/one-shot-schema.sql`](./docs/one-shot-schema.sql) | The whole schema as one 309 KB statement batch in a single transaction, for a provider's SQL editor — the same result as `db:setup`, generated by `node scripts/build-one-shot-schema.mjs --seed`, and it records the same bookkeeping so a later `db:setup` skips it |
## Booking flow

`/book` is a four-step wizard (`src/components/booking/`): **night → pass → details →
review**. Availability, pass limits and prices are read from the database at every
step; nights that are full, cancelled or finished are disabled inputs, and a pass the
organiser has taken off sale cannot be selected.

The browser sends **identifiers and contact details only** — never an amount:

| Concern | Where it is decided |
| ------- | ------------------- |
| Price, subtotal, total | `pass_categories.price_inr` × quantity, computed by the `set_booking_amounts()` trigger inside `create_pending_booking()` |
| People admitted | `quantity × pass_categories.number_of_people`, computed by the same trigger |
| Quantity limits | `pass_categories.max_per_booking`, enforced by the trigger and the function |
| Capacity | Re-read from paid bookings inside the booking function, with the night row locked, so concurrent requests cannot oversell |
| Reference | `DND<year><5 digits>`, e.g. `DND202600001`, generated by `generate_booking_id()` |
| Duplicate submissions | An idempotency key per attempt (unique index) plus a 15-minute identical-content window; a retry returns the original booking |

`POST /api/payment/create-order` validates the payload (name, Indian mobile, email,
quantity, head count), then calls the `create_pending_booking()` database function with
the service role and creates the Razorpay order for the amount that came back. Bookings
are created `booking_status = 'pending'` and `payment_status = 'unpaid'`; **nothing in the
booking step marks a booking as paid**, and no digital pass exists until a payment has
been verified — see [Payment flow](#payment-flow-razorpay-test-mode) below. `POST
/api/bookings` still exists as the create-only fallback used when the deployment has no
Razorpay keys. Both endpoints only accept POST; there is no way to read bookings back
out, and RLS keeps booking rows staff-only.

Loading, error and success states are part of the wizard: a submitting state on the
confirm button, per-field validation messages, availability errors returned by the
server, and a confirmation page that shows the booking reference and the real
`payment_status` of the booking.

## Payment flow (Razorpay, test mode)

Payment is a two-call dance in which the browser is never trusted:

1. **`POST /api/payment/create-order`** — the wizard sends the booking payload. The
   server validates it, creates (or reuses) the pending booking, reads the amount from the
   booking row, checks that the gateway keys are usable, creates the Razorpay order for
   exactly `total_amount × 100` paise and stores the order id on the booking
   (`attach_razorpay_order`). The browser receives only the order id, the amount, the
   public key id, the prefill values and the booking's random `public_token`.
2. **Razorpay Checkout** opens with that order id. The script is loaded on demand from
   `checkout.razorpay.com` — card and UPI details are entered inside Razorpay's window and
   never touch this site.
3. **`POST /api/payment/verify`** — the browser reports the result. The server verifies
   `HMAC_SHA256("<order_id>|<payment_id>", RAZORPAY_KEY_SECRET)` with a constant-time
   compare, reads the payment back **from Razorpay** to check that it belongs to that
   order, was captured and matches the amount, and only then calls
   `confirm_booking_payment()`, which sets `payment_status = 'paid'` /
   `booking_status = 'confirmed'` and issues exactly one digital pass per purchased pass.
   A forged or missing signature is rejected and the booking stays pending.
4. **`POST /api/payment/webhook`** is the safety net for a customer who closes the
   browser mid-payment. The signature over the **raw** body is verified with
   `RAZORPAY_WEBHOOK_SECRET`, and each delivery is claimed once in `payment_events`
   (unique `event_id`), so Razorpay's retries can never confirm a booking twice, issue a
   second set of passes, or mark a paid booking failed.
5. **`/book/status?token=<public_token>`** is the confirmation page: server-rendered from
   the database, so refreshing it — or opening the link later on a phone — shows the same
   live status. The token is a random uuid and the lookup returns no name, mobile or
   email.

| Guarantee | How it is enforced |
| --------- | ------------------ |
| The browser cannot set a price | the amount is read from `bookings.total_amount`; there is no amount parameter anywhere in the payment API |
| The browser cannot confirm a payment | only `confirm_booking_payment()` may write `payment_status`, and it is `service_role`-only |
| A ₹1 payment cannot confirm a ₹998 booking | the captured amount is compared with `total_amount × 100` (`PC002`) and with what Razorpay reports |
| One payment cannot pay for two bookings | `PC003` refuses a payment id already stored on another booking |
| A retry cannot double-book or double-issue passes | idempotent confirmation (`already_confirmed`), a `not exists` guard before the pass insert, and the unique webhook `event_id` |
| A paid booking is never dropped or downgraded | a capacity overflow at confirmation records an organiser note; a late `payment.failed` leaves a paid row alone |
| Live payments cannot be switched on by accident | `rzp_live_…` keys are refused unless `RAZORPAY_ALLOW_LIVE=true`; the site then falls back to the organiser-handled copy and writes nothing |

Payments are still **test mode**: the flow is exercised end to end by
`npm run verify:web` against a stub gateway (`scripts/test/razorpay-stub.mjs`) that
speaks the same two endpoints and signs with the same HMACs, because real test keys are
yours to create. Swapping in your `rzp_test_…` keys needs no code change.

## Digital passes and QR codes

A pass is the scannable half of a booking. It is created by the same call that confirms
the payment — never by a page being opened:

1. **Passes are issued by the database.** `confirm_booking_payment()` inserts one row per
   purchased pass into `digital_passes`, numbered `1..quantity`. A unique index on
   `(booking_id, pass_number)` means a booking can never end up with two "pass 1"s, and
   the insert is guarded by `on conflict do nothing`, so a replayed confirmation or a
   retried webhook adds nothing.
2. **Two identifiers, one of them secret.** `pass_id` (`PS-000123`) is the readable number
   printed on the pass and quoted at the gate — it is not a secret. `qr_token` is 64
   random hex characters and *is* the secret; it is unique across every pass.
3. **The QR contains nothing but a link.** It encodes
   `<NEXT_PUBLIC_SITE_URL>/verify/<qr_token>` and nothing else — no name, no mobile
   number, no email, no booking reference. A scanned code (or a photo of one) therefore
   reveals nothing that is not already printed on the ticket, and one guest's screenshot
   can never be turned into another guest's pass.
4. **The QR is generated on the server**, from the pass's own row, when the page renders
   (`src/lib/pass/qr.ts`, the `qrcode` package). No third-party QR service, no image
   bucket, and no stale copy that can outlive the pass it points at.
5. **The ticket** at `/pass/<pass id>?t=<qr token>` is drawn like a paper ticket, in a
   light palette that survives being printed on white paper. The path segment is a label;
   the token is the credential, and the page re-reads the pass from the database on every
   request, so a scanned, cancelled or out-of-date pass is never shown as valid.
6. **Download and print.** "Download pass" saves the whole ticket as a self-contained SVG
   (vector: sharp at A6, no fonts or network needed), "Save just the QR" saves the code as
   a 1024 px PNG, and the print stylesheet in `globals.css` hides the site chrome so
   printing produces the ticket and nothing else.
7. **The gate view is read-only.** `/verify/<token>` reports the state, names the guest and
   the night and says what to do — but it cannot mark a pass as used. Burning a pass is an
   authenticated organiser action (the admin dashboard step); an unauthenticated check-in
   button would let anyone exhaust a stranger's pass.
8. **Refreshing cannot mint a pass.** The success page, the ticket page and the gate view
   only ever read. `npm run verify:web` loads all three three times over and asserts the
   pass ids, the pass count and the booking count are unchanged.

| Pass state | Shown as | Where it comes from |
| ---------- | -------- | ------------------- |
| Paid, unused, night still to come | `VALID` | `status = 'active'`, `checked_in = false` |
| Scanned at the gate | `CHECKED IN` | `checked_in = true` (the database sets `status = 'used'`) |
| Booking refunded | `CANCELLED` | `status = 'cancelled'` — the refund path cancels every pass |
| Night already over | `EXPIRED` | derived from `valid_date` (no cron job required) |
| Unknown or malformed token | `NOT A VALID PASS` | the token matched no row |

## Admin authentication and roles

There is one way into the staff area, and it is a real Supabase Auth session: no
shared staff code, no environment-variable password, no “admin” query string. Signing
in is only half of it — the account must also be on the `admin_users` allow-list, with
an active role.

| Role | May open |
| ---- | -------- |
| `super_admin` | Everything, including the staff list and managing roles |
| `admin` | Bookings, payments, passes, dates, gallery, scanner, settings |
| `staff` | The scanner, check-ins, and a limited booking lookup |

The permission model lives in `src/lib/auth/permissions.ts` as a single table of
capabilities (`scanner:use`, `bookings:view`, `bookings:view_contact`, `staff:manage`,
…). Pages are guarded by `requirePermission()`, the request hook guards URLs from the
same table, and the dashboard navigation is *generated* from it — so a section cannot
be added to the menu without its URL being guarded by the same permission.

**Two independent "no"s, and neither one leaks a page:**

| Visitor | What happens |
| ------- | ------------ |
| Signed out | `307` to `/admin/login?next=<where they were going>`. Real HTTP redirect, issued by `src/proxy.ts` before any page renders |
| Signed in, not on the allow-list | The same redirect. A Supabase account is not a staff account, and the sign-in screen says so and offers a way out |
| Signed in as staff, wrong role | `307` to `/admin?denied=<permission>`, and the dashboard explains it in words. Sending them to the sign-in screen would loop — they are already signed in |
| Staff API without a session | `401` JSON, never an HTML redirect |
| Staff API with a role that cannot scan | `403` JSON |

The layering is deliberate, and each layer assumes the one above it might be wrong:
the **request hook** decides before the response starts streaming (a redirect thrown
mid-stream cannot change the status code, so the boundary has to be here); the **page
guard** asks again for the capability it actually needs; and the **database** checks
the staff id on every check-in, because a bug in the app alone must never admit a
guest.

**The service-role key never reaches the browser.** Every admin read goes through
`src/lib/services/admin.ts`, which imports `server-only`; pages are server components
that render HTML, the staff APIs answer with plain JSON, and `npm run verify:web`
asserts that no rendered admin page contains the key or a `service_role` claim.

**The staff view is a different answer, not the same answer with fields hidden.** A
staff member's booking list calls `admin_search_bookings(p_include_contact => false)`,
so the mobile number, the email address, the amount and the gateway IDs are never
returned to the process at all — there is nothing to remember to hide. The CSV export
follows the same rule in a stronger form: its *header row* omits those columns, so the
file is not full of empty columns hinting at what a staff member may not have.

**Signing out** is a `POST` to `/api/staff/logout` (a form, so it works with
JavaScript disabled), which ends the Supabase session — revoking the refresh token,
not just clearing a cookie — and deletes the session cookies on the way out. A cookie
copied from a gate phone before the shift ends no longer works afterwards; the harness
tests exactly that.

## The dashboard (`/admin`)

The dashboard answers one question — *how is the event doing right now?* — and it is
built so that the answer can be trusted at 9pm on a Saturday.

| Statistic | Comes from |
| --------- | ---------- |
| Total bookings, confirmed, awaiting payment, today's bookings | `bookings` + `booking_status` / `payment_status`, `created_at` in the venue's timezone |
| Total revenue, today's revenue | `sum(total_amount)` where `payment_status = 'paid'` — **a refunded booking stops counting the moment it is refunded** |
| Checked-in visitors | `check_ins` (all time), with tonight's entries beside it |
| Available capacity | `sum(event_dates.capacity) − sum(paid bookings' people)` over the nights still to come, floored at zero |
| Bookings by date, revenue by date | `admin_booking_series()` — one row per day in the window, quiet days included as zeros |
| Pass category distribution | `admin_pass_breakdown()` — bookings, people, passes and takings per pass category, biggest first |
| Recent bookings | `admin_recent_bookings()` — newest first, with the night and pass each one holds |

**Every number is counted in Postgres.** Four `service_role`-only functions do the
aggregating (see `supabase/README.md`), and `src/lib/services/admin.ts` fetches them in
one parallel round trip. Nothing is summed in the browser, and nothing is summed in
Node either: the page receives figures, not rows it must add up. That is also why the
charts need no data-fetching client component — they are drawn from what the server
already knows.

**Days are the venue's days.** `p_tz` is `siteConfig.timezone`, so a booking taken at
1am in Jaipur lands on the night it was actually taken, not on yesterday in UTC.

**Money and contact details are withheld by returning `NULL`, not by hiding them.**
The page passes the signed-in role's capabilities down as `p_include_revenue` and
`p_include_contact`; a staff session's dashboard therefore arrives with no amounts and
no guest mobile numbers in it at all, and says so in words where the figures would be:
*"Visible to admins"*. The database is the thing saying no.

**Capacity is summed over nights, not over bookings.** Summing `capacity` across a
booking join multiplies a busy night's capacity once per booking — the sort of wrong
number that looks plausible on a dashboard — so the nights and the people are aggregated
separately and subtracted. Only *paid* people take capacity.

**The charts are drawn with elements, not a charting library.** Fourteen bars of
percentages, an axis rounded up to a readable maximum, and the same series rendered
again as a visually hidden table so the chart is readable by a screen reader and by
`curl`. Adding 40kB of JavaScript to draw fourteen bars would have made the dashboard
slower than the thing it describes.

**Every state is honest.** `loading.tsx` streams a skeleton shaped like the finished
page; `error.tsx` catches anything the page's own error branch misses and offers a
retry that keeps the session; and a failure is never rendered as a zero. The dashboard
holds no cached summary and no placeholder figures — if the database is unreachable, the
page says so.

## Booking management (`/admin/bookings`)

The screen for the question a guest asks on the phone: *"I booked for Friday, can you
find me?"* Everything about it — the search, the filters, the paging, the count and the
CSV export — is one database function, `admin_search_bookings()`, so the list on screen,
the next page and the downloaded file are the same rows by construction rather than by
three implementations agreeing.

**One search box, six things it can be.** A booking reference (`DND202600001`), a guest's
name, a mobile number typed however the caller remembered it (`+91 98123 45678`), an
email address, a pass ID (`PS-000123`), or a Razorpay payment/order ID from a receipt.
The digits of a search are matched against the mobile column only when the term actually
*is* a number — otherwise a search for "Suite 101" would answer with everybody whose
phone number contains `101`. LIKE's own wildcards are escaped, so a search for `%` finds
nothing rather than the whole event.

**Five filters, one meaning each.** Night range (from/to), pass category, payment status,
booking status, and check-in status — `nobody in yet`, `part of the group in`,
`everyone in`. A filter value the schema does not recognise is dropped rather than
forwarded: an empty list that looks like "no such booking" is a worse answer than
ignoring a typo. Filters compose (`paid` + `part of the group in` + one night), the
result set is counted in SQL (`Showing 26–50 of 5,012`), and the paging links carry the
filters with them, so any search is a URL an operator can bookmark or hand to a
colleague.

**The export is the filters, as a file.** `/admin/bookings/export` takes the same URL
parameters, reads the same function, and answers with `text/csv` and a
`Content-Disposition` filename dated for the day it was made. Cells that begin with
`=`, `+`, `-` or `@` are prefixed with an apostrophe, because a guest named `=1+1`
should be a guest and not a spreadsheet formula. A download is capped at 5,000 rows —
the file's `x-export-truncated` header says whether it was — and the screen says so
before the click. For a role without `bookings:view_contact`, the contact, amount and
Razorpay columns are absent from the header row itself: not blank columns, no columns.

**One booking in full** is a page, not a modal: `/admin/bookings/[reference]` is a URL
that can be sent, reloaded and returned to, and it resolves the four identifiers a
support thread might contain (reference, pass ID, payment ID, order ID —
`admin_booking_detail()`). It shows the guest, the night and pass, the amounts, every
issued pass with its own state, every gate entry with the gate and the staff member who
made it, and the Razorpay events received for that order. It never shows `qr_token`, and
the harness asserts that: the credential that admits a guest is not a screen's business.

**A payment status cannot be typed in.** Step 10 added the trigger
`bookings_guard_payment_status`: any `UPDATE` that changes `bookings.payment_status`
without proof that a verified gateway event is behind it raises `PB007`. The three
functions that legitimately move the column — `confirm_booking_payment`,
`fail_booking_payment`, `refund_booking_payment` — mark their own transaction with
`app.payment_proof = 'razorpay-verified'` as their first statement. There is therefore no
manual "mark as paid" path to build a button for, in the UI or in the SQL editor: a
payment the gateway captured but the site missed is fixed by re-delivering Razorpay's
own event (Dashboard → Webhooks → resend), which lands in the same signature-verified
path as the original. The detail page shows that evidence instead — event type, outcome,
amount, when it was received and when it was processed.

## Payments and passes (`/admin/payments`, `/admin/passes`)

Two read-only screens for the two questions the booking list cannot answer: *did the money
actually arrive?* and *who is at the door tonight?*

**Payments is evidence, not controls.** The page shows the delivery log — every event the
gateway sent, newest first, with the event type, the outcome the site recorded, the amount
Razorpay reported, when it arrived, when it was processed, and the booking it belongs to
where one can be identified. A signed delivery that matches no booking is *shown*, with
every booking column null: "a payment arrived that we cannot place" is exactly the thing
somebody has to see. Nothing on the page can move a payment status — that is the trigger
from step 10 speaking, so the screen could not offer the button even if it wanted to. What
it offers instead is the reason and the fix, per row: `admin_payment_attention()` lists the
bookings whose payment state contradicts the rest of the row (paid with no pass issued,
refunded with a pass still active, failed and holding a pass, a delivery nothing could be
done with), each with a sentence and an action — re-deliver the gateway event, cancel the
pass, look at the delivery. The reason and the action are decided in SQL, next to the rule
they describe, rather than paraphrased in a component.

**The captured and refunded figures are the gateway's own.** They are summed from the
amounts in Razorpay's payloads — not from the amounts stored on our bookings — which is
precisely why they are worth comparing against the bookings list when something looks
wrong. The page says so in as many words.

**Passes is the door list.** One row per issued pass, with its pass number and how many
passes the booking holds, the guest and booking it belongs to, the night, the pass
category, and the entry record: whether it has been admitted, when, at which gate, and by
which staff account. The search takes anything a guest can read out — pass ID, booking
reference, name, mobile — and the night filter offers the event's own nights rather than a
date field, because "which night" is the only question anybody asks at a table. A season's
worth of passes pages normally; a page past the end says so rather than pretending the
event has no passes.

**The token is not in the list.** `admin_pass_list()` does not select `qr_token`, there is
no column for it in the CSV, and no parameter that would add one: a list of live
credentials sitting behind a shared tablet is the opposite of what a token is for. A pass
is admitted by scanning it, not by reading it out. The same reasoning keeps any
cancel/re-admit control off the page — admitting is a scan, and cancelling happens when a
refund does.

**The door list is a file, because the gate has no wifi.** `/admin/passes/export` reads
the same function with the same filters, so the file and the screen cannot disagree about
which passes it holds. Unlike the booking export it deliberately covers the whole match
rather than the current page — up to 5,000 rows, fetched in batches of 100 — because a
door team prints it. The cap is reported in the `x-export-truncated` header rather than
applied in silence, and for a role without `bookings:view_contact` the Mobile, Amount and
Currency columns are absent from the header row itself.

**Who may look.** Both screens need `payments:view` and `passes:view`: admin and super
admin. A scanner — the role that exists for the gate — is sent to the dashboard with the
permission it was missing named in the URL, and can only read the bookings list it has
always been able to read. The export route repeats the check on the server before it
queries anything, so a signed-out request is refused before a row is read.

## Pass and date management (`/admin/passes`, `/admin/dates`)

Everything up to step 11 could *report* on the event. This step is the organiser changing
it: what is on sale, at what price, for how many people, from what age — and how many
seats each night has, how many are held back from the website, and whether booking is
open at all.

**Both screens are one idea: the organiser owns the decision, the database owns what it
means.** Nothing on either page writes a table. Each control calls a narrow
`service_role` function — `admin_save_pass_category`, `admin_set_pass_category_active`,
`admin_save_event_date`, `admin_set_event_date_capacity`, `admin_set_event_date_booking`
— which re-checks what it was given, takes the row lock it needs, and returns the row as
the database now holds it. A capacity change cannot quietly rewrite a date, a price
cannot arrive attached to a whole form, and taking a pass off sale cannot alter its
composition on the way past.

**Rules that cannot be broken by hand either.** `capacity >= 1`,
`capacity_held >= 0`, `capacity_held <= capacity` and `min_age` in range are table
constraints; a trigger on `event_dates` refuses any write — this file, a migration, the
SQL editor — that would take seats away from people who have already paid
(`capacity_below_taken`, carrying the lowest capacity the night may now have) or move a
night whose passes have its date printed on them. Capacity can therefore never go
negative, and a night that has sold out can still be edited: raising the capacity,
cancelling it, fixing a time or a note is always allowed.

**Bookings cannot overshoot either.** `create_pending_booking` and the public
`get_event_night_availability` were both restated in the same migration, so the number
the website offers and the number the booking path enforces are the same arithmetic:
`capacity − seats held back − people who have paid`. Held-back seats are not online
seats; a night whose booking is closed is `not_bookable` on the site and refused with
`night_not_bookable` by the database, whatever the browser shows.

**Concurrency is row locks, not hope.** Every writer that counts a night's seats locks
the night row `for update` first — the booking path, the capacity setter, the night
saver, the open/close toggle — so an organiser lowering a capacity and a guest paying for
the last seat cannot interleave: one waits for the other. `npm run db:verify` asserts the
lock is in all four, because "the rule held in this run" and "the rule is enforced for
whoever calls it" are different claims.

**`/admin/passes` answers two questions on one route.** *Pass types* (`?view=types`) is
the catalogue: name, composition, price, people per pass, the booking limit, the age
restriction, how many have been sold and how much they have taken — with a form to create
one, a form to edit one inline, and a switch to take one off sale. *Issued passes* is the
door list from step 11, and it is still what the route opens with. A pass is never
deleted: off sale is a state, not an erasure, because a pass with bookings on it is the
record of what was sold.

**A price change is for the next guest.** Repricing a pass leaves every booking already
taken exactly as it was charged — the amount lives on the booking, computed by a trigger
when the booking was made — which is asserted rather than assumed, because the opposite
would silently rewrite what people already paid.

**`/admin/dates` is the nights.** Each night shows its date and times, capacity, seats
held back, seats on sale and seats left, a progress bar, and its state in words
(`On sale`, `Booking closed`, `Full · booking closed`, `Over-committed`, `Cancelled`).
The two controls an organiser reaches for mid-event are separate one-field actions: *set
capacity* (with the seats-held-back field beside it, so the website's pool can be
corrected without touching the night's size) and *open/close booking*. A refusal comes
back as the field it belongs to and the number it needs — "at least 82 seats, counting
the ones already paid for" — so the control can offer the right figure instead of a
generic error.

**Who may change what.** `passes:edit` and `dates:edit` are held by admin and super
admin; the pages themselves need `passes:view` / `dates:view`, and a role without them is
sent to the dashboard with the missing permission named in the URL. The endpoints
(`POST /api/admin/passes`, `POST /api/admin/dates`) are matched by the same permission
map at the edge, so a signed-out request is refused before a body is read, and a role
that may read a screen is not thereby allowed to post to it. Bodies are capped at 8 KB,
a `GET` is answered with 405, and the database's refusals arrive as `409` with the field
and the sentence rather than as a 500.

**The website says what the organiser decided.** The public night list and the booking
wizard print `seats left` against the seats actually on sale ("1480 of 1480 places left ·
20 held for the gate"), show `Booking closed` on a night that has been closed, and show
an age restriction as `18+ only` on the pass card and in the wizard's pass step. A
closed night cannot be selected in the wizard, and the API refuses a booking on it with
`this night is no longer open for booking` — the browser is never the thing that decides.

## Gallery management (`/admin/gallery`, `/gallery`)

The first step that owns *files* rather than rows. `/admin/gallery` uploads photographs,
edits their words, orders them, publishes and unpublishes them, and deletes them;
`/gallery` is what a visitor sees of it.

**Two buckets, and the row's status decides which one holds the file.** An upload lands
in `gallery-inbox`, which is private: no policy grants `anon` or `authenticated` any
access to `storage.objects`, so an unpublished photograph is not merely unlisted — there
is no address that serves it, and a URL that leaked would still return nothing.
Publishing flips the row to `published` and *then* moves the object into `gallery`, the
public bucket; unpublishing or archiving moves it back. The object key never changes —
`<event id>/<item id>/full.webp` and `…/thumb.webp` are derived from the row — so a
caption can be edited, a photo republished and a delete aimed without anything storing a
URL that could drift from the file it points at. Nothing but the service-role key touches
either bucket: the browser never holds a key that could put a file anywhere.

**The database still owns the rules.** Nothing writes the `gallery` table directly. Every
change goes through a `service_role` function — `admin_gallery_items`,
`admin_add_gallery_item`, `admin_update_gallery_item`, `admin_move_gallery_item`,
`admin_set_gallery_status`, `admin_delete_gallery_item` — which re-checks what it was
given and raises `PG001`–`PG011` with the field in `detail`: alt text required, title /
description / album inside their column limits, a storage key that is a relative path
rather than a URL or a `..`, a status that exists, dimensions and byte size in range,
and one row per object (partial unique indexes on both path columns, so a retried upload
cannot become a second row for the same file). `src/lib/admin/catalogue.ts` carries a
sentence and a field for every one of those codes, so a refusal arrives as "this field,
here is what to do" instead of as a server error.

**Uploads are optimised once, on the server.** sharp reads the real format from the bytes
(the declared content type is not trusted), applies the EXIF orientation and drops the
metadata — a guest's GPS coordinates never reach the public site — then writes two WebP
files: the full image at most 2400 px on its long edge (quality 82) and a 640 px
thumbnail (quality 74). Objects are cached for a year, because a key contains the item's
id and a replaced file gets a new key rather than new bytes behind an old address.
Anything smaller than 400 px on its short edge, larger than 8 MB, or not an image at all
is refused per file with the reason, and in a batch the photographs that can be taken
still land.

**Order is renumbered, not dragged.** `admin_move_gallery_item(p_id, p_direction)` moves
one photograph one place up or down and renumbers the whole event list inside one
transaction, having locked the rows first, so two organisers moving photos at the same
moment cannot leave two items claiming the same position. At either end it answers
`moved = false` rather than shuffling the list for nothing.

**Deleting takes the row first, then the files it named.** `admin_delete_gallery_item`
returns `removed_paths`, and the service removes exactly those objects from the bucket the
row's status pointed at. A file that cannot be deleted is logged, not raised: the public
page is already correct and an orphaned object is a cleaning job, not a guest-facing
problem.

**The management screen never hands the browser a draft's address.** Thumbnails come
through `GET /api/admin/gallery/preview?id=…&variant=thumb`, guarded by `gallery:view`,
which reads the object with the service-role key; a signed URL would put a working address
for an unpublished photograph into the page source. The *public* page loads published
thumbnails straight from the `gallery` bucket — they are public, cacheable and
CDN-friendly — into a responsive grid (two columns on a phone, four on a desktop) where
every tile is a button with an `aria-label`, off-screen images are `loading="lazy"` with a
`sizes` hint, and the lightbox takes focus, closes on `Escape`, steps with `←`/`→` and
gives focus back to the tile that opened it. `/gallery` revalidates every five minutes, so
publishing the night's photographs does not need a deploy.

## Contact and WhatsApp (`/contact`)

The site's contact block is **data, not configuration**. The `events` row carries
`contact_phone`, `contact_email`, `whatsapp_number`, the venue columns, `maps_url`,
`instagram_url`, `facebook_url`, `youtube_url` and `support_hours`; `src/lib/contact.ts`
turns that row into every link the site shows, and `src/lib/services/contact.ts` reads it
for the chrome.

| Question | Answer |
| -------- | ------ |
| Where does the number come from? | `events.whatsapp_number` (international format, digits only). Empty? The digits of `events.contact_phone` are used. Empty too? The deployment fallback in `src/config/site.ts`. |
| What does the button open? | `https://wa.me/<number>?text=…`, with the message prefilled from one constant — `Hello, I need help with Navratri Dandiya booking.` (`WHATSAPP_MESSAGE`). On a phone WhatsApp takes the link over; on a desktop WhatsApp Web opens with the same text. |
| Why `wa.me` and not an app scheme? | One href works on both platforms, needs no SDK, and still works when JavaScript does not. |
| What does the header show on a phone? | An icon-only button below `sm` and a labelled one at `sm` and up; the mobile menu carries a full-width one that closes the menu when it is tapped. |
| Where else is the number used? | The header, the mobile menu, the footer, the closing band on every public page, `/book`, `/booking/success` and the booking-status panel. None of them carries a number or builds a link — they render a `SiteContact` (or an href) made by the one module. A booking's own message appends its reference to the same sentence. |
| How is a channel hidden? | `buildContactChannels()` omits a channel whose value the organiser has not published, so no page shows a link that goes nowhere. |
| What does `/contact` show? | The channel cards (WhatsApp → phone → email → venue), the venue and address with an *Open in Google Maps* link (the stored `maps_url`, else a search built from the address), support hours, the three social profiles, the FAQ, and the exact sentence the WhatsApp button will send. |
| Where does the organiser see it? | `/admin/settings` lists these columns and says that is what the public site reads. |
| How is it verified? | `npm run verify:web` renders the page against the real database, asserts the link carries the exact prefilled message, changes the number in the database and re-renders to prove nothing is hard-coded, and asserts that no component builds a `wa.me` URL or holds the number as a literal. The format rules — digits only, one platform per URL, `https`, at most six lines of support hours — are checked by `npm run db:verify`. |

## Gate check-in (`/admin/scanner`)

The scanner is the only part of the site that *changes* a pass, so it is built around one
rule: **the door is decided by the database, never by the browser.**

1. **Sign in as staff.** `/admin/login` is Supabase Auth email + password, and the
   account must also be on the `admin_users` allow-list with an active `super_admin`,
   `admin` or `staff` role — checked against the database on every request
   (`src/lib/auth/staff.ts`). See [Admin authentication and roles](#admin-authentication-and-roles).
2. **Scan with the phone.** `/admin/scanner` opens the rear camera (`getUserMedia`,
   `facingMode: environment`), decodes frames with `jsqr` and keeps only codes that are
   **our own** verification URLs — a code pointing at another site, or at plain text, is
   refused without a request leaving the page. Manual entry sits under the camera for a
   cracked lens, a dead battery or a desktop webcam.
3. **The token is the only thing sent.** The browser POSTs the 64-character token to
   `/api/staff/scan`. It never sends a date, a pass id, a name or a verdict: the server
   works out which night the gate is on itself (`src/lib/gate/night.ts`, the venue's
   `Asia/Kolkata` clock) and the pass is checked inside one transaction by `scan_pass()`.
4. **Every check happens in the database.** The token must belong to a real pass, behind a
   real booking, with `booking_status = 'confirmed'`, `payment_status = 'paid'`, a pass
   that is `active` and not already checked in, on a night that is not cancelled, for the
   event that owns it, and on the night the gate is actually open — and the person
   scanning must still be active staff. Anything else is a refusal, with the reason.
5. **CHECK IN burns the pass.** The button calls `/api/staff/check-in`, which runs
   `check_in_pass()`: the pass row is locked (`for update`), the state is re-checked, and
   the write is a compare-and-swap (`where checked_in = false and status = 'active'`)
   followed by one `check_ins` row carrying the gate, the night and the staff id. Two
   phones scanning the same code in the same second therefore admit the guest **once** —
   the slower one is told the pass is already used. A unique constraint on
   `check_ins.digital_pass_id` is the backstop if anything ever races past the lock.
6. **A refusal is a sentence, not a stack trace.** The scanner shows the verdict and what
   to do about it, and never reveals more than the ticket already does: the responses
   carry no mobile number, no email address and no token.

| Scanner shows | What happened | What the staff member does |
| ------------- | ------------- | -------------------------- |
| **✓ VALID PASS** | Everything above checked out for tonight | Confirm the name, then press CHECK IN |
| **✓ CHECKED IN** | The button just succeeded — the entry is stored | Let the guest in |
| **⚠ PASS ALREADY USED** | This code has already been through the gate (the time is shown) | Admit only with a supervisor's approval |
| **✕ PAYMENT NOT VERIFIED** | The booking is not (or is no longer) paid | Send the guest to the ticket desk |
| **✕ INVALID PASS** | Unknown, cancelled, refunded, or for another night — with the reason underneath | Do not admit |
| **✕ NOT AUTHORISED** | The signed-in account is not active staff any more | Sign in again, or fetch a supervisor |
| **403 FORBIDDEN** | Signed in, but this role may not work the gate | Ask an admin to change the role |

`/api/staff/scan` and `/api/staff/check-in` answer `401` to anybody without a staff
session, so the endpoint is not a public check-in API; `check_ins` and
`digital_passes.status` are written by `service_role` functions only. The session cookie
itself is refreshed by `src/proxy.ts` (Next's request hook), which is what keeps a
scanner alive across a long shift.

## Where the data comes from

Every public page reads live data through `src/lib/services`. There is no demo data
left in the codebase — the old `src/config/{event,passes,features,gallery,promos}.ts`
files and the `DemoBadge` component have been deleted, and no component talks to
Supabase directly.

| Page element | Source |
| ------------ | ------ |
| Event name, tagline, venue, city | `events` (published row) |
| Phone, email, WhatsApp number, map link, social profiles and support hours | `events` (published row) — the columns are the data, and every `wa.me` / `tel:` / `mailto:` / Maps link on the site is derived from them by `src/lib/contact.ts` |
| Dates, times, capacity and per-night availability | `event_dates` + `get_event_night_availability()` |
| Pass names, compositions, prices, `is_active` | `pass_categories` |
| Production inclusions ("Girl Anchor", "Drone Camera"…) | `event_features` |
| "What to expect" highlights | `event_highlights` |
| Gallery images and videos | `gallery` (published rows; `alt_text`/`caption` supply the copy) |
| A booking's own status (confirmation page) | `bookings` through `get_booking_status(public_token)` — statuses, amount and issued pass count only, never customer details |
| A booking's passes and their QR codes | `digital_passes` through `get_booking_passes(public_token)` (booking page) and `get_pass_by_token(qr_token)` (ticket and gate view) — pass id, state, night and event, never a mobile number or an email address |
| The gate verdict for a scanned token | `scan_pass()` — one transaction, `service_role` only, and the caller must present a staff user id |
| A check-in record | `check_in_pass()` — the same verdict plus a compare-and-swap on the pass row and one `check_ins` row |
| The booking list, its search, its filters and its paging | `admin_search_bookings()` — searching, filtering, ordering, the page slice and the count of the whole result set all happen in SQL; the contact, amount and gateway columns come back null for a role without `bookings:view_contact` |
| One booking in full | `admin_booking_detail()` — found by booking reference, pass ID, payment ID or order ID, and returns the passes, the gate entries and the Razorpay events as JSON. It never returns `qr_token`: the credential that admits a guest is not a screen's business |
| Whether a payment really happened | `payment_events` (received from a signature-verified webhook) plus `bookings.payment_status`, which only the payment functions may change — a trigger refuses any other write |
| The gateway's record, delivery by delivery | `admin_payment_events()` — every event the gateway sent, newest first, each with the outcome the site recorded and the booking it belongs to where one can be identified. A delivery that matches no booking is listed with nulls rather than hidden, and the amount and contact columns come back null for a role without `bookings:view_contact` |
| The amounts Razorpay itself reported | `admin_payment_summary()` — deliveries counted by outcome, bookings still awaiting a verified payment, and the captured/refunded totals summed from the gateway's own payloads (paise, not the site's rupees) |
| The rows that need attention | `admin_payment_attention()` — one rule per broken invariant (paid with no pass issued, paid but not confirmed, refunded with an active pass, failed with a pass, a delivery we could not act on), each carrying its reason code, a sentence and the action that fixes it |
| The door list, its search, its filters and its paging | `admin_pass_list()` — the search runs over pass ID, booking reference, guest name and mobile; ordering and the page slice happen in SQL and the count of the whole match comes back with every row. It never selects `qr_token` |
| The pass counts above the door list | `admin_pass_summary()` — passes by status, admitted today in the venue's timezone, gates in use, and the money behind the passes counted **once per booking** rather than once per pass |
| What is on sale, at what price, and how many people a pass admits | `admin_pass_catalogue()` — every pass type of the event, on sale or not, with the bookings, the paid bookings, the passes issued and the money taken, counted in SQL |
| The nights, their capacity and their state | `admin_event_dates()` — capacity, seats held back, paid people, seats on sale, seats left, and whether the night is full or over-committed |
| A pass being created, repriced, re-limited or taken off sale | `admin_save_pass_category()` / `admin_set_pass_category_active()` — `service_role` only, one row returned as the database now holds it |
| A night being added, edited, resized or opened and closed | `admin_save_event_date()` / `admin_set_event_date_capacity()` / `admin_set_event_date_booking()` — each one narrow, each locking the night before it counts |
| The dashboard numbers | `admin_dashboard_stats()` — counted in the database, for the venue's today |
| The dashboard's charts | `admin_booking_series()` (a row per day, quiet days included) and `admin_pass_breakdown()` (per pass category) — both aggregated in SQL |
| The signed-in role, at the edge | `current_staff_role()` — the caller's own role and nothing else, so the request hook can refuse before a page renders |

Availability is never computed in the browser: `get_event_night_availability()` is a
`SECURITY DEFINER` function returning counts per night, so a visitor can see that a
night is full without ever being able to read a booking row.

The contact block follows the same rule. The header, the mobile menu, the footer,
`/contact`, `/book`, the confirmation pages and the closing band on every page all read
one `SiteContact` built from the event row — no component holds a phone number, and none
of them spells a `wa.me` URL, so they cannot disagree about either.

Loading, empty and error states are part of the design: routes render skeletons while a
read is in flight, a "not connected" state when credentials are missing, and an error
state with a retry link when a query fails. A missing or unreachable database never
produces a 500 — verified by `npm run verify:web`.

## Folder structure

```
src/
├── app/                        # App Router routes (routing + composition only)
│   ├── about/ book/ contact/ events/ gallery/ passes/   # page.tsx (+ loading.tsx skeleton)
│   ├── admin/(auth)/login/     # staff sign-in — no admin chrome, no session needed
│   ├── admin/(shell)/          # dashboard, scanner, bookings, payments, passes, dates, settings, staff (session + role required)
│   ├── api/admin/              # pass and date writes: POST only, session + capability checked, refusals as JSON
│   ├── api/bookings/route.ts   # POST only: create a pending booking (no-key fallback)
│   ├── api/payment/            # create-order, verify, webhook, status — all POST/GET server routes
│   ├── api/staff/              # scan + check-in: staff session required, gate night decided server-side
│   ├── proxy.ts                # session refresh for /admin and /api/staff (Next request hook)
│   ├── book/status/            # server-rendered confirmation / live status page
│   ├── layout.tsx              # Root shell: fonts, metadata, header/footer, skip link
│   ├── page.tsx                # Home page composition
│   ├── not-found.tsx           # 404
│   └── globals.css             # Tailwind entry + @theme design tokens
├── assets/images/              # Original generated artwork (no stock, no faces)
├── components/
│   ├── admin/                  # admin header/nav, scanner panel, filters, tables, the pass/date forms + panels, and the gallery uploader/cards
│   ├── booking/                # checkout wizard: steps, pass choice, summary, confirmation panel
│   ├── brand/logo.tsx          # Inline brand mark (no image request)
│   ├── contact/contact-card.tsx
│   ├── events/                 # pass-card, night-list, gallery-tile
│   ├── gallery/                # gallery-grid.tsx: the public grid + keyboard lightbox
│   ├── icons/index.tsx         # Original inline icon set (stroke-based, 24×24)
│   ├── layout/                 # header, footer, mobile nav, page hero, WhatsApp button
│   ├── sections/               # hero, feature strip, about, passes/gallery preview, CTA
│   └── ui/                     # Button, Card, Badge, Container, Section, EmptyState, Skeleton, ErrorState
├── config/                     # env.ts (the only reader of process.env) and site.ts (branding, navigation, fallback contact settings)
├── lib/
│   ├── admin/                  # verdict.ts, bookings.ts, operations.ts, catalogue.ts and gallery.ts (list filters, paging, CSV vocabulary, form rules, refusal wording)
│   ├── auth/                   # permissions.ts (roles + capabilities), guard.ts, staff.ts
│   ├── booking/                # shared validation, idempotency keys (browser + server)
│   ├── gate/                   # night.ts: which night the gate is working, in the venue's timezone
│   ├── pass/                   # links, status, QR rendering (server) and QR decoding (browser)
│   ├── gallery/                # paths.ts (buckets, object keys, public URLs), images.ts (sharp: resize, re-encode, strip EXIF)
│   ├── services/               # events.ts, contact.ts, gallery.ts, gallery-admin.ts, bookings.ts, payments.ts, passes.ts, check-in.ts, admin.ts, admin-operations.ts, admin-catalogue.ts, result.ts
│   ├── event-copy.ts           # what the site says about a night or a pass (seats on sale, booking closed, age)
│   ├── contact.ts              # the one place a wa.me / tel: / mailto: / Maps link is built, from the event row
│   ├── supabase/               # browser / server / admin clients + public.ts (memoised anon client)
│   ├── payments/               # razorpay.ts (orders + signatures), mode.ts (test/live guard), checkout.ts (browser loader)
│   ├── format.ts               # INR, dates, times — UTC-anchored, composed from Intl parts
│   └── utils.ts                # cn(): clsx + tailwind-merge
└── types/
    ├── index.ts                # View models the UI renders
    ├── admin.ts                # Staff session, gate verdict and scan-response types
    ├── booking.ts              # Checkout payload, field errors, order + confirmation views
    ├── pass.ts                 # Digital pass view models
    └── database.ts             # Generated-shape Supabase types for every table

supabase/
├── migrations/                 # schema → RLS → public data API → pass visibility → booking → payments → check-in → roles → dashboard → booking management → payments and passes → pass and date management
├── seed.sql                    # event, 9 nights, 5 pass categories, features, highlights
└── README.md                   # how to apply, roles, what is/isn't seeded

scripts/
├── verify-db.mjs               # npm run db:verify — schema, constraints, RLS
├── verify-web.mjs              # npm run verify:web — real pages against a real database
└── test/                       # PostgREST shim, Supabase Auth stub, Razorpay stub, path-alias loader
```

### Conventions

- **Data flow:** pages/components call functions in `src/lib/services`, which wrap
  Supabase. No component talks to Supabase or Razorpay directly.
- **Secrets:** only `NEXT_PUBLIC_*` variables may be imported into client components.
- **Styling:** design tokens live in `globals.css` under `@theme`; components compose
  Tailwind utilities and merge classes with `cn()`.
- **Components:** primitives in `components/ui` are presentational; composition lives in
  `components/sections` and route files.
- **Server/client:** the mobile menu, the checkout wizard and the camera scanner are the
  client components — the pages they sit on render on the server, and the wizard's data
  arrives as props from the page. The scanner is a client component because it owns a
  camera; everything it *does* goes through a route handler that checks the session and
  calls the database.
- **Trust:** a client component never decides anything that matters. It draws, it
  collects, it posts. Prices, verdicts, check-ins and pass states are all decided in
  Postgres.

## Accessibility & performance

- Skip-to-content link, one `<h1>` per page, ordered headings, `aria-label`s on icon-only
  controls, `aria-expanded`/`aria-controls` on the mobile menu, `Escape` closes it.
- Every informative image has descriptive `alt`; decorative art and gradients are
  `aria-hidden`; empty states carry real copy rather than lorem text.
- Visible focus ring on all interactive elements (gold, 2px, offset).
- Animations are limited to two ambient CSS keyframes and are wrapped in `motion-safe:`;
  `prefers-reduced-motion` also disables smooth scrolling.
- Fonts self-hosted (no third-party requests), images optimised through `next/image`,
  production CSS ≈ 8 KB gzipped; `/`, `/about`, `/contact` and `/gallery` are
  prerendered with a five-minute revalidate, while `/passes`, `/book` and `/events`
  render per request so availability is never stale.

## Database (Supabase)

The authoritative schema lives in `supabase/` — see **[supabase/README.md](./supabase/README.md)**
for the full table reference, roles and setup steps.

| Table | Purpose | Public read? |
| ----- | ------- | ------------ |
| `events` | One festival (venue, city, status) | ✅ published only |
| `event_dates` | One night per row, with capacity, seats held back from online sale, whether booking is open, and status | ✅ published event (status marks cancelled / sold-out nights) |
| `pass_categories` | Pass types + prices + age restriction, per event | ✅ every row of a published event — `is_active` gates the sale, not the visibility |
| `event_highlights` | "What to expect" bullets per event | ✅ rows of a published event |
| `event_features` | Production inclusions (anchor, DJ, drone…) | ✅ rows of a published event |
| `bookings` | One booking = pass category × night, plus its Razorpay ids and a random `public_token` | ❌ admin only (a `staff` session gets a limited lookup through a service-role function) |
| `payment_events` | One row per Razorpay webhook delivery — the duplicate guard | ❌ service role only (no grant to any session role) |
| `digital_passes` | QR passes issued after payment | ❌ admin only (the row carries the `qr_token` that admits its holder) |
| `check_ins` | Gate scan log (one row per pass, ever) | ❌ `staff` may read the night's log; writing one is admin-gated and the gate writes it as the service role |
| `gallery` | Photo/video metadata (files in Storage) | ✅ published only |
| `admin_users` | Auth users allow-listed as staff: `super_admin` / `admin` / `staff` | ❌ super admins only |

Seeded: one published Jaipur event (My Village Garden), nine nights
11–19 October 2026, and five pass categories (₹399 / ₹499 / ₹599 / ₹799 / ₹1099).

Bookings are written by `create_pending_booking(...)`, a `SECURITY DEFINER` function
whose `execute` privilege is granted to `service_role` alone: `anon` and
`authenticated` cannot call it, and no role can insert a booking through the API.
Each row also carries a unique `idempotency_key`, so a retried request returns the
booking that already exists instead of creating a second one.

Authorization is a database question too, not only an app question. `is_staff()`,
`is_admin()` and `is_super_admin()` are the RLS helpers the policies use, `admin_users`
is readable only by a super admin (a regular admin cannot promote themselves), and
`current_staff_role()` returns the caller's own role so the request hook can answer
before a page renders.

Gate entry is the same shape: `scan_pass(qr_token, gate_date, staff_user_id)` returns a
verdict without writing, `check_in_pass(...)` returns the same verdict and admits the
guest, and both are `service_role`-only with `execute` revoked from `anon` and
`authenticated`. They refuse a caller who is not active staff — checked inside the
database, so an API bug alone cannot admit anybody. The verdicts are `valid`, `checked_in`,
`already_used`, `payment_not_verified`, `refunded`, `expired`, `not_yet_valid`, `invalid`
and `not_authorised`.

Per-night availability comes from `get_event_night_availability(uuid)`: visitors get
remaining counts, never booking rows — and the same `capacity − held back − paid`
arithmetic the booking path enforces. A guard trigger on `event_dates` makes the
impossible rows unrepresentable (`capacity_below_one`, `capacity_held_negative`,
`capacity_held_above_capacity`, `capacity_below_taken`, `night_date_locked`), so an
organiser cannot cut a night below what has already been paid for, by any route. A pass the organiser has disabled stays visible
and is labelled "Not on sale"; the booking step — which runs with the service role — is
what actually refuses to sell it.

**Price tampering is impossible from the client.** `bookings.subtotal`,
`number_of_people` and `total_amount` are computed by a database trigger from
`pass_categories`, so a forged payload cannot change what a booking costs.

**There is no INSERT policy on `bookings`.** Bookings are created by server code
using the service role after the amount is recalculated, so a browser session can
neither fabricate a booking nor read anyone else's.

```bash
npm run db:verify   # applies migrations + seed to PostgreSQL and asserts all of the above
```

## Security

Nobody has to be trusted for the site to be safe: there are four layers, and each one
assumes the layer above may be wrong.

| Layer | Where | What it settles |
| ----- | ----- | --------------- |
| Request | `src/proxy.ts` | An admin page or admin API is answered with a real `307`/`403` *before* the response starts, using the caller's role from `current_staff_role()` — a redirect issued mid-stream cannot change a status code, so the decision is made here |
| Page / route | `src/lib/auth/guard.ts`, every `src/app/api/**/route.ts` | Each page re-checks the permission it needs; each route re-checks `getStaffMember()` and `can(role, capability)` before it reads a body |
| Row | `supabase/migrations/*rls_policies*.sql`, `…_security_hardening.sql` | What a session may read or change, per role: `anon` sees published rows only, a `staff` session reads the check-in log, and `bookings`/`digital_passes` belong to `admin`/`super_admin` |
| Data | `SECURITY DEFINER` functions | Prices, capacity, pass state, admission and payment confirmation are decided inside Postgres, in one transaction under a row lock — never in the browser, never in Node |

**Secrets.** `SUPABASE_SERVICE_ROLE_KEY`, `RAZORPAY_KEY_SECRET` and
`RAZORPAY_WEBHOOK_SECRET` are read only in `server-only` modules
(`src/lib/supabase/admin.ts`, `src/lib/payments/razorpay.ts`): importing one from a client
component fails the build. No `NEXT_PUBLIC_` variable holds a secret — the two public ones
are the anon key (RLS-protected by definition) and the Razorpay key **id**, which Checkout
needs in the browser anyway. `src/config/env.ts` is the only module that reads
`process.env`, `.env*` is git-ignored apart from `.env.example`, and `.env.example` ships
empty placeholders — never a credential.

**Money.** A payment is confirmed in exactly one place: `confirm_booking_payment()`, called
by `/api/payment/verify` after an HMAC check of the Checkout signature, or by
`/api/payment/webhook` after an HMAC check of the raw body (time-constant comparison, before
any parsing). The amount comes from the booking row, so a client cannot send one. Each
webhook delivery is deduplicated on `event_id` (`payment_events`), each booking on
`idempotency_key`, and each pass has a unique id and a 64-hex-character QR token that is
never rendered into an admin list. Live keys are refused unless `RAZORPAY_ALLOW_LIVE=true`.

**Uploads.** A gallery file is decoded, resized and re-encoded with `sharp` before anything
is written — a file that is not an image is refused, and EXIF/ICC metadata never reaches
Storage. Object keys are built from ids the server generates, drafts live in a private
bucket, and the public bucket holds published objects only. The request is refused on its
`content-length` before the body is buffered, and each file is capped at 8 MB.

**Abuse.** The two public write endpoints (`/api/bookings`, `/api/payment/create-order`) sit
behind a small fixed-window limiter (`src/lib/rate-limit.ts`). It is deliberately modest:
one process, one address at a time, best-effort. What actually protects the database is
that capacity counts **paid** bookings, that a repeated submission collapses onto one row,
and that a payment is only believed when a signature verifies. Supabase Auth rate-limits
sign-in attempts.

**Browser.** The session cookie is `HttpOnly` + `SameSite=Lax`
(`src/lib/supabase/cookies.ts`). Every response carries `X-Content-Type-Options: nosniff`
and a referrer policy that keeps a pass URL out of another site's logs, and the staff area
cannot be framed (`X-Frame-Options: DENY` + `frame-ancestors 'none'`) while the public site
stays embeddable. There is no `dangerouslySetInnerHTML` in the app, and the one place that
builds markup by hand — the downloadable pass SVG — escapes every value it interpolates.

The database half of this is spelled out in
[supabase/README.md](./supabase/README.md#roles-and-authorisation).

## Environment variables

See [`.env.example`](./.env.example). Copy it to `.env.local`; the values are git-ignored.
The same variables must be added in Vercel → Settings → Environment Variables for
production. `src/config/env.ts` is the only module that reads `process.env`.

| Variable                        | Scope          | Used now? | Purpose                                  |
| ------------------------------- | -------------- | --------- | ---------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`          | client + server | yes       | Canonical/OG URLs, absolute links, and the base of the URL inside every pass QR code (set it before printing passes) |
| `NEXT_PUBLIC_SUPABASE_URL`      | client + server | yes       | Supabase project URL (public reads)      |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server | yes       | Supabase anon key (RLS-protected)        |
| `SUPABASE_SERVICE_ROLE_KEY`     | **server only** | yes — bookings, passes, gate check-in | Bypasses RLS. Guarded by `server-only` — a client import fails the build |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID`   | client + server | yes — inlined at build time | Opens Razorpay Checkout. Changing keys means a new deployment |
| `RAZORPAY_KEY_SECRET`           | **server only** | yes       | Creates orders, verifies the Checkout signature |
| `RAZORPAY_WEBHOOK_SECRET`       | **server only** | yes       | Verifies webhook signatures              |
| `RAZORPAY_ALLOW_LIVE`           | **server only** | optional — unset by default | Without it, `rzp_live_…` keys are refused and the site falls back to the organiser-handled copy |

## Deploying (Vercel)

`vercel.json` sets one thing: the function region is **Mumbai (`bom1`)**, so the
server-rendered pages and the ISR revalidation run next to a Supabase project created in
`ap-south-1`. Hobby allows a single region, so keep that list to one entry — and keep the
Supabase project in the same region, or every render pays a round trip to another
continent. The build runs on **Node 22** (`engines` in `package.json`), the major version
the checks in `scripts/` are run against.

### 1. Import

1. Vercel → **Add New → Project → Import Git Repository** → `linux113/event-booking-website`.
2. The framework preset is detected as **Next.js**; leave the root directory, build command
   (`npm run build`) and install command at their defaults.
3. **Production Branch** defaults to `main`. The work lives on the branch and PR #1 is
   deliberately unmerged, so pick one:
   - *point Vercel at the branch* — Settings → Git → Production Branch → the branch you want
     live (what the open PR needs), or
   - merge the PR first and let `main` deploy.

   Left as-is, the deployment serves the initial scaffold rather than the site.
4. Add the environment variables **before the first production build**: `NEXT_PUBLIC_*`
   values are inlined at build time, so adding them afterwards changes nothing until the
   project is redeployed (Deployments → ⋯ → Redeploy).

### 2. Environment variables

Vercel → Settings → Environment Variables. The same names as `.env.example`, set for
Production **and** Preview so branch previews work too:

| Variable | Value | Notes |
| -------- | ----- | ----- |
| `NEXT_PUBLIC_SITE_URL` | `https://your-domain.com` | **The base of every pass QR code.** Set it before printing passes — changing it later invalidates passes already in guests' hands. Unset, it falls back to `VERCEL_URL` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_…` (or a legacy anon key) | public by design; RLS decides what it can read |
| `SUPABASE_SERVICE_ROLE_KEY` | `sb_secret_…` (or a legacy service_role key) | **server-only**; bypasses RLS |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | `rzp_test_…` | inlined at build |
| `RAZORPAY_KEY_SECRET` | test key secret | server-only |
| `RAZORPAY_WEBHOOK_SECRET` | from the Razorpay webhook you create below | server-only |
| `RAZORPAY_ALLOW_LIVE` | *(leave unset)* | only with live keys and completed KYC |

Until the three Supabase values are present the site serves its shell with a
"database is not connected" panel and a setup checklist — that is the app reporting the
truth, not a failed build.

### 3. Razorpay webhook

Razorpay dashboard → Settings → Webhooks → add
`https://your-domain.com/api/payment/webhook`, subscribed to `payment.captured`,
`payment.failed` and `refund.processed` (`order.paid` optional), then put its secret in
`RAZORPAY_WEBHOOK_SECRET` and redeploy. A booking is only ever marked paid by a signature
verified against that secret, or against the Checkout signature on `/api/payment/verify`.

### 4. On the free (Hobby) plan

- **Non-commercial projects only.** Selling passes is commercial use, and Vercel's terms
  expect **Pro** (~$20/month) for that; Hobby is the right place for the demo and for a
  free event.
- Preview deployments sit behind **Deployment Protection** (Vercel Authentication) by
  default — a shared branch preview asks the viewer to sign in to Vercel. Settings →
  Deployment Protection if you want a link you can hand out.
- Functions get **300 s** with Fluid Compute (the default for new projects), which covers a
  40-photo gallery upload. If an upload times out, check Settings → Functions.
- The Supabase project is the part that sleeps: free projects pause after **7 days without
  database activity**. A daily ping (a GitHub Actions cron hitting `/passes`) keeps it awake.

### 5. After the first deploy

- `/` shows your event, `/passes` your prices, `/book` your nights, `/contact` your numbers.
- Sign in at `/admin/login` with an account created per
  [supabase/README.md](./supabase/README.md#creating-the-first-admin).
- Take one booking through Razorpay **test** mode: it appears in `/admin/bookings`, and
  `/booking/success` issues a pass whose QR encodes `NEXT_PUBLIC_SITE_URL`.
- Scan that pass at `/admin/scanner` on a phone (the camera needs HTTPS, so `localhost` or a
  real domain — not a LAN IP): **✓ VALID PASS**, then **⚠ PASS ALREADY USED**.

## Before launch

- Replace the placeholder brand name in `src/config/site.ts`.
- Fill in the event's contact block in the database: `contact_phone`, `contact_email`,
  `whatsapp_number` (international format, digits only — no `+`, no spaces), the venue
  columns, `maps_url`, the three social URLs and `support_hours`. Every link on the site
  is built from those columns; `src/config/site.ts` holds only the placeholder fallback
  used where a column is empty.
- Swap the placeholder artwork in `src/assets/images/` for real event photography
  (gallery media already comes from Supabase Storage, in the `gallery` and
  `gallery-inbox` buckets — see `supabase/README.md` if your deployment could not let
  the migration create them).
- Update the event, nights and prices in the database (or `supabase/seed.sql`) rather
  than in the frontend — the DB is now the source of truth.
- Add `SUPABASE_SERVICE_ROLE_KEY` to the deployment environment: booking creation
  returns 503 without it (reads still work with the anon key).
- Add the Razorpay variables and register the webhook
  (`https://<your-domain>/api/payment/webhook`, events `payment.captured`,
  `payment.failed`, `refund.processed`) — until the keys are present the wizard says
  payment is handled by the organiser instead of opening a checkout nobody can pay.
- Going live is two deliberate changes: swap `rzp_test_…` for `rzp_live_…` and set
  `RAZORPAY_ALLOW_LIVE=true`, then rebuild (the key id is inlined at build time). Test
  mode is one more `npm run verify:web` away, so keep it until a real payment has been
  made end to end.
- Create the first admin: insert a row in `admin_users` for an existing Auth user with
  `role = 'super_admin'` (see supabase/README.md).
- Create one staff account per person working the gate (a Supabase Auth user plus an
  `admin_users` row with `role = 'staff'`), and test the scanner **on the phones that
  will actually be used**, over HTTPS — browsers only hand a camera to a secure origin,
  so `http://` on a laptop's LAN address will not open one.
- Give at least one person `super_admin` — the staff list and any future role changes
  are behind that role, and it is the only one that can restore somebody's access.
- Check `/admin` on the night the first real booking lands: the dashboard's figures are
  live queries, so what it shows is what the tables hold — but "available capacity" only
  means something once `event_dates.capacity` has been set to the venue's real ceiling
  rather than the seed value.
