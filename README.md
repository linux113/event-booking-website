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
| 5 | Auth and attendee accounts | ⏳ next |
| 6 | Razorpay order creation, signature verification, webhook, payment record | ⏳ |
| 7 | Admin dashboard (publish events, capacity, check-in) | ⏳ |
| 8 | Hardening — rate limiting, analytics, perf budget | ⏳ |

Step 3 is two halves of one job — the Supabase schema/RLS layer, then replacing every
hard-coded value in the UI with database reads. Both are done and verified against real
PostgreSQL (`npm run db:verify`, `npm run verify:web`). Until a Supabase project URL and
anon key are added to `.env.local`, every route renders a "Database not connected" state
rather than failing.

**There is no payment code and no mock API.** The database layer is real (Supabase
schema + RLS, read through `src/lib/services`), but checkout is deliberately not
implemented: `/book` collects nothing, and every route that cannot reach the database
renders an explicit empty or error state rather than invented content.

## Pages

| Route | Purpose |
| ----- | ------- |
| `/` | Hero (event, dates, venue, CTAs), feature strip, about, pass preview, gallery preview, contact preview, CTA band — all read from the database |
| `/about` | Festival overview, what to expect (`event_highlights`), production list (`event_features`), organiser profiles |
| `/passes` | Every pass category with its database price, inclusions, pass policy notes, per-night availability |
| `/book` | Four-step checkout: night, pass, details, review. Creates a `pending` / `unpaid` booking and shows the reference. **Takes no payment — Razorpay is the next step** |
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
| `npm run verify:web` | End-to-end check against a real database: boots PostgreSQL, serves it over a PostgREST-compatible shim, calls the real services, then builds and serves the real pages and exercises `POST /api/bookings` — validation, capacity, pricing, duplicate submission and the stored row |
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

`POST /api/bookings` validates the payload (name, Indian mobile, email, quantity, head
count), then calls the `create_pending_booking()` database function with the service
role. Bookings are created `booking_status = 'pending'` and `payment_status = 'unpaid'`
— **nothing marks a booking as paid**, and no digital pass is issued until a payment is
verified (Razorpay arrives in step 6). The endpoint only accepts POST; there is no way
to read bookings back out, and RLS keeps booking rows staff-only.

Loading, error and success states are part of the wizard: a submitting state on the
confirm button, per-field validation messages, availability errors returned by the
server, and a confirmation panel that shows the booking reference and states plainly
that no payment has been taken.

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
│   ├── api/bookings/route.ts   # POST only: create a pending booking
│   ├── layout.tsx              # Root shell: fonts, metadata, header/footer, skip link
│   ├── page.tsx                # Home page composition
│   ├── not-found.tsx           # 404
│   └── globals.css             # Tailwind entry + @theme design tokens
├── assets/images/              # Original generated artwork (no stock, no faces)
├── components/
│   ├── booking/                # checkout wizard: steps, pass choice, summary, success panel
│   ├── brand/logo.tsx          # Inline brand mark (no image request)
│   ├── contact/contact-card.tsx
│   ├── events/                 # pass-card, night-list, gallery-tile
│   ├── icons/index.tsx         # Original inline icon set (stroke-based, 24×24)
│   ├── layout/                 # header, footer, mobile nav, page hero, WhatsApp button
│   ├── sections/               # hero, feature strip, about, passes/gallery preview, CTA
│   └── ui/                     # Button, Card, Badge, Container, Section, EmptyState, Skeleton, ErrorState
├── config/                     # env.ts (only reader of process.env), site.ts, contact.ts
├── lib/
│   ├── booking/                # shared validation, idempotency keys (browser + server)
│   ├── services/               # events.ts, gallery.ts, bookings.ts, mappers.ts, result.ts
│   ├── supabase/               # browser / server / admin clients + public.ts (memoised anon client)
│   ├── payments/               # (empty) Razorpay helpers arrive in step 6
│   ├── format.ts               # INR, dates, times — UTC-anchored, composed from Intl parts
│   └── utils.ts                # cn(): clsx + tailwind-merge
└── types/
    ├── index.ts                # View models the UI renders
    ├── booking.ts              # Checkout payload, field errors, created booking
    └── database.ts             # Generated-shape Supabase types for every table

supabase/
├── migrations/                 # 1) schema  2) RLS  3) public data API  4) pass visibility
├── seed.sql                    # event, 9 nights, 5 pass categories, features, highlights
└── README.md                   # how to apply, roles, what is/isn't seeded

scripts/
├── verify-db.mjs               # npm run db:verify — schema, constraints, RLS
├── verify-web.mjs              # npm run verify:web — real pages against a real database
└── test/                       # PostgREST shim + TypeScript path-alias loader for the harness
```

### Conventions

- **Data flow:** pages/components call functions in `src/lib/services`, which wrap
  Supabase. No component talks to Supabase or Razorpay directly.
- **Secrets:** only `NEXT_PUBLIC_*` variables may be imported into client components.
- **Styling:** design tokens live in `globals.css` under `@theme`; components compose
  Tailwind utilities and merge classes with `cn()`.
- **Components:** primitives in `components/ui` are presentational; composition lives in
  `components/sections` and route files.
- **Server/client:** only the mobile menu and the checkout wizard (selection, form
  state, submission) are client components — the pages they sit on render on the
  server, and the wizard's data arrives as props from the page.

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
| `bookings` | One booking = pass category × night | ❌ staff only |
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
| `NEXT_PUBLIC_SITE_URL`          | client + server | yes       | Canonical/OG URLs, absolute links        |
| `NEXT_PUBLIC_SUPABASE_URL`      | client + server | yes       | Supabase project URL (public reads)      |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server | yes       | Supabase anon key (RLS-protected)        |
| `SUPABASE_SERVICE_ROLE_KEY`     | **server only** | yes — booking creation | Bypasses RLS. Guarded by `server-only` — a client import fails the build |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID`   | client + server | no        | Opens Razorpay Checkout                  |
| `RAZORPAY_KEY_SECRET`           | server only     | no        | Creates orders, verifies signatures      |
| `RAZORPAY_WEBHOOK_SECRET`       | server only     | no        | Verifies webhook signatures              |

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
- Create the first admin: insert a row in `admin_users` for an existing Auth user with
  `role = 'owner'` (see supabase/README.md).
