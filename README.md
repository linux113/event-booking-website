# Garba Nights — Navratri & Dandiya event booking

A production-oriented booking platform for Navratri / Dandiya events: browse nights,
reserve passes and pay online. Built with **Next.js (App Router) + React + TypeScript +
Tailwind CSS**, backed by **Supabase** (Postgres, Auth, Storage), **Razorpay** for
payments, deployed on **Vercel**, versioned on **GitHub**. Chosen so the whole stack
fits within free tiers for development and small-scale launch.

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
| 8 | Admin dashboard — publish events, capacity, the rest of the staff surfaces | ⏳ next |
| 9 | Hardening — rate limiting, analytics, perf budget | ⏳ |

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
| `/admin/login` | Staff sign-in: Supabase Auth email + password, then the `admin_users` allow-list. Sends a valid non-staff account back with an explanation |
| `/admin/scanner` | The gate: camera QR scanner, the verdict for the pass that was scanned, and the CHECK IN button that burns it. Staff session required; the page itself never writes |
| `/gallery` | Published photos and videos from the `gallery` table, grouped by album |
| `/contact` | Contact channels derived from the event row (WhatsApp, phone, email, map), venue block, support hours, FAQ |
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
| `npm run db:verify` | Run the migrations + seed against PostgreSQL (WASM) and assert schema, constraints and RLS |
| `npm run verify:web` | End-to-end check against a real database: boots PostgreSQL, serves it over a PostgREST-compatible shim, calls the real services, then builds and serves the real pages and exercises the whole booking, **payment** and **gate** flow — validation, capacity, pricing, duplicate submissions, order creation, signature verification, webhooks, refunds, refresh-safe status and the live-key guard, then signs in as staff, scans a pass, admits it once, races two check-ins against the same code and refuses every kind of bad pass — payments run against a local stub gateway and staff sign-in against a local Auth double, so no credentials are needed |
| `npm run check`     | typecheck → lint → build, in one command                           |

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

## Gate check-in (`/admin/scanner`)

The scanner is the only part of the site that *changes* a pass, so it is built around one
rule: **the door is decided by the database, never by the browser.**

1. **Sign in as staff.** `/admin/login` is Supabase Auth email + password. Signing in is
   not enough on its own: the account must also be on the `admin_users` allow-list with an
   active `owner` / `admin` / `manager` / `scanner` role, and that check is made against
   the database on every request (`src/lib/auth/staff.ts`). A perfectly valid Supabase
   account that is not staff is signed out again with an explanation instead of being
   handed a scanner.
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
| Event name, tagline, venue, city, contact details | `events` (published row) |
| Dates, times, capacity and per-night availability | `event_dates` + `get_event_night_availability()` |
| Pass names, compositions, prices, `is_active` | `pass_categories` |
| Production inclusions ("Girl Anchor", "Drone Camera"…) | `event_features` |
| "What to expect" highlights | `event_highlights` |
| Gallery images and videos | `gallery` (published rows; `alt_text`/`caption` supply the copy) |
| A booking's own status (confirmation page) | `bookings` through `get_booking_status(public_token)` — statuses, amount and issued pass count only, never customer details |
| A booking's passes and their QR codes | `digital_passes` through `get_booking_passes(public_token)` (booking page) and `get_pass_by_token(qr_token)` (ticket and gate view) — pass id, state, night and event, never a mobile number or an email address |
| The gate verdict for a scanned token | `scan_pass()` — one transaction, `service_role` only, and the caller must present a staff user id |
| A check-in record | `check_in_pass()` — the same verdict plus a compare-and-swap on the pass row and one `check_ins` row |

Availability is never computed in the browser: `get_event_night_availability()` is a
`SECURITY DEFINER` function returning counts per night, so a visitor can see that a
night is full without ever being able to read a booking row.

Loading, empty and error states are part of the design: routes render skeletons while a
read is in flight, a "not connected" state when credentials are missing, and an error
state with a retry link when a query fails. A missing or unreachable database never
produces a 500 — verified by `npm run verify:web`.

## Folder structure

```
src/
├── app/                        # App Router routes (routing + composition only)
│   ├── about/ book/ contact/ events/ gallery/ passes/   # page.tsx (+ loading.tsx skeleton)
│   ├── admin/                  # login + scanner (staff only: session checked server-side)
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
│   ├── admin/                  # scanner panel (camera + jsQR) and the scan verdict card
│   ├── booking/                # checkout wizard: steps, pass choice, summary, confirmation panel
│   ├── brand/logo.tsx          # Inline brand mark (no image request)
│   ├── contact/contact-card.tsx
│   ├── events/                 # pass-card, night-list, gallery-tile
│   ├── icons/index.tsx         # Original inline icon set (stroke-based, 24×24)
│   ├── layout/                 # header, footer, mobile nav, page hero, WhatsApp button
│   ├── sections/               # hero, feature strip, about, passes/gallery preview, CTA
│   └── ui/                     # Button, Card, Badge, Container, Section, EmptyState, Skeleton, ErrorState
├── config/                     # env.ts (only reader of process.env), site.ts, contact.ts
├── lib/
│   ├── admin/                  # verdict.ts: the outcome → what the scanner says
│   ├── auth/                   # staff.ts: Supabase session + admin_users allow-list
│   ├── booking/                # shared validation, idempotency keys (browser + server)
│   ├── gate/                   # night.ts: which night the gate is working, in the venue's timezone
│   ├── pass/                   # links, status, QR rendering (server) and QR decoding (browser)
│   ├── services/               # events.ts, gallery.ts, bookings.ts, payments.ts, passes.ts, check-in.ts, result.ts
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
├── migrations/                 # 1) schema  2) RLS  3) public data API  4) pass visibility  5) booking  6) payments  7) check-in
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
| `event_dates` | One night per row, with capacity and status | ✅ published event (status marks cancelled / sold-out nights) |
| `pass_categories` | Pass types + prices, per event | ✅ every row of a published event — `is_active` gates the sale, not the visibility |
| `event_highlights` | "What to expect" bullets per event | ✅ rows of a published event |
| `event_features` | Production inclusions (anchor, DJ, drone…) | ✅ rows of a published event |
| `bookings` | One booking = pass category × night, plus its Razorpay ids and a random `public_token` | ❌ staff only |
| `payment_events` | One row per Razorpay webhook delivery — the duplicate guard | ❌ staff only |
| `digital_passes` | QR passes issued after payment | ❌ staff only |
| `check_ins` | Gate scan log (one row per pass, ever) | ❌ staff only |
| `gallery` | Photo/video metadata (files in Storage) | ✅ published only |
| `admin_users` | Auth users allow-listed as staff | ❌ admins only |

Seeded: one published Jaipur event (My Village Garden), nine nights
11–19 October 2026, and five pass categories (₹399 / ₹499 / ₹599 / ₹799 / ₹1099).

Bookings are written by `create_pending_booking(...)`, a `SECURITY DEFINER` function
whose `execute` privilege is granted to `service_role` alone: `anon` and
`authenticated` cannot call it, and no role can insert a booking through the API.
Each row also carries a unique `idempotency_key`, so a retried request returns the
booking that already exists instead of creating a second one.

Gate entry is the same shape: `scan_pass(qr_token, gate_date, staff_user_id)` returns a
verdict without writing, `check_in_pass(...)` returns the same verdict and admits the
guest, and both are `service_role`-only with `execute` revoked from `anon` and
`authenticated`. They refuse a caller who is not active staff — checked inside the
database, so an API bug alone cannot admit anybody. The verdicts are `valid`, `checked_in`,
`already_used`, `payment_not_verified`, `refunded`, `expired`, `not_yet_valid`, `invalid`
and `not_authorised`.

Per-night availability comes from `get_event_night_availability(uuid)`: visitors get
remaining counts, never booking rows. A pass the organiser has disabled stays visible
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

1. Push the branch to GitHub.
2. In Vercel, **New Project → Import** this repository (framework auto-detected).
3. Add the environment variables from the table above (Production + Preview).
4. Deploy. `NEXT_PUBLIC_SITE_URL` should be the production domain; `VERCEL_URL` is used
   automatically for preview deployments.

## Before launch

- Replace the placeholder brand name in `src/config/site.ts`.
- Replace demo contact numbers, email, address and the WhatsApp number
  (`siteConfig.contact.whatsappNumber`, international format, digits only).
- Swap the placeholder artwork in `src/assets/images/` for real event photography
  (gallery media already comes from Supabase Storage).
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
  `role = 'owner'` (see supabase/README.md).
- Create one staff account per person working the gate (a Supabase Auth user plus an
  `admin_users` row with `role = 'scanner'`), and test the scanner **on the phones that
  will actually be used**, over HTTPS — browsers only hand a camera to a secure origin,
  so `http://` on a laptop's LAN address will not open one.
