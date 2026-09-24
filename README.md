# Savriya Seth Events — Navratri & Dandiya event booking

A production-oriented booking platform for Navratri / Dandiya events: browse nights,
reserve passes and pay online. Built with **Next.js (App Router) + React + TypeScript +
Tailwind CSS**, backed by **Neon PostgreSQL** through **Prisma** (single client,
`@prisma/adapter-neon`, serverless-safe), **Razorpay** for payments, **Vercel Blob** for
gallery files, deployed on **Vercel**, versioned on **GitHub**.

There is **no Supabase** in the runtime: no `@supabase/*` packages, no
`NEXT_PUBLIC_SUPABASE_*` / `SUPABASE_SERVICE_ROLE_KEY`, no Supabase Auth session, and no
Supabase Storage. There is **one administrator** (no roles, no staff directory) and
**no customer email** anywhere — bookings collect Full Name, Mobile, Event Date, Pass
and Quantity only.

## Documentation

| Guide | What it covers |
| ----- | -------------- |
| [`docs/neon-setup.md`](./docs/neon-setup.md) | Create a Neon project, apply the schema with `npm run db:setup` (or paste `docs/one-shot-schema.sql`), seed data, and set `DATABASE_URL` |
| [`docs/deploy-vercel.md`](./docs/deploy-vercel.md) | Deploying to Vercel: environment variables, Razorpay webhook, Blob storage, admin credentials, post-deploy checks |
| [`docs/gallery-upload-troubleshooting.md`](./docs/gallery-upload-troubleshooting.md) | Blob setup, upload size limits, draft publishing and preview failures |
| [`docs/how-it-works.md`](./docs/how-it-works.md) | The whole flow — customer, organiser, gate — and the URLs that must be configured |
| [`docs/connect-free-supabase.md`](./docs/connect-free-supabase.md) | **Historical only** (pre-migration Supabase guide). Do not follow for new setups |
| [`supabase/README.md`](./supabase/README.md) | **Historical only** (roles, RLS and storage from the Supabase era). The SQL under `supabase/migrations/` is still how `db:setup` applies the schema to Neon as plain PostgreSQL |

## Stack

| Layer | Choice |
| ----- | ------ |
| App | Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4 |
| Database | Neon PostgreSQL (pooled connection at runtime) |
| Data access | Prisma 7 + `@prisma/adapter-neon` (`src/lib/db/client.ts`) — `sql` tagged templates and `rpc`/`rpcScalar` for SQL functions |
| Schema DDL | `prisma/schema.prisma` for the typed client; `npm run db:setup` applies `supabase/migrations/*.sql` + `supabase/prelude.sql` as standard PostgreSQL (no `prisma migrate`) |
| Payments | Razorpay test mode — existing `/api/payment/*` order create, signature verify, webhook verify and idempotency unchanged |
| Gallery files | Vercel Blob — keys stored in `gallery.storage_path` / `thumbnail_path`; **no binaries in Neon** |
| Admin auth | `ADMIN_EMAIL` + `ADMIN_PASSWORD_HASH` (scrypt) + `AUTH_SECRET`-signed HTTP-only `gn_admin` cookie |
| Hosting | Vercel (`vercel.json` → region `bom1`) |

## Status

| Step | Scope | State |
| ---- | ----- | ----- |
| 1–14 | Public UI, booking wizard, Razorpay, passes/QR, scanner, admin, gallery, contact | ✅ done (from prior work) |
| M | Migration: Neon + Prisma, no Supabase runtime, single admin, no customer email | ✅ done |
| 15 | Event settings — edit public contact, venue address, maps/social links and support hours | ✅ done |
| 16 | Hardening — rate limiting, analytics, perf budget | ⏳ |

**Nothing is mocked.** Prices, nights, gallery, bookings, payments and gate entries all
come from PostgreSQL through `src/lib/services`. Payments run in Razorpay test mode; a
booking is only marked paid after a server-verified signature — never by the browser.

## Pages

| Route | Purpose |
| ----- | ------- |
| `/` | Hero, features, about, pass preview, gallery, contact — all read from the database |
| `/about` | Festival overview, highlights, production list |
| `/passes` | Pass categories with database prices and availability |
| `/book` | Four-step checkout: night → pass → details (Full Name, Mobile) → review. Server-computed price, then Razorpay Checkout |
| `/book/status` | Server-rendered confirmation via the booking's public token (noindex) |
| `/booking/success` | Post-payment landing: booking id, issued passes, links to digital passes |
| `/pass/[passId]` | Digital pass + QR (token-guarded, printable) |
| `/verify/[token]` | Gate view: VALID / ALREADY CHECKED IN / CANCELLED / EXPIRED / NOT A VALID PASS |
| `/admin/login` | Single admin sign-in (email + password). No staff allow-list |
| `/admin` | Dashboard: statistics, charts, recent bookings — full access for the one admin |
| `/admin/bookings` | Search, filter, page, CSV export of bookings (name, mobile, amounts) |
| `/admin/bookings/[reference]` | One booking in full with passes, check-ins, payment events |
| `/admin/payments` | Razorpay deliveries, waiting bookings, contradictory rows |
| `/admin/passes` | Door list + CSV export (no QR tokens in lists) |
| `/admin/dates` | Nights, capacity, hold seats, open/close booking |
| `/admin/gallery` | Upload (WebP via Blob), caption/alt, reorder, publish/unpublish, delete |
| `/admin/settings` | Event, venue and deployment values |
| `/admin/scanner` | Camera QR scanner + CHECK IN (server-side compare-and-swap) |
| `/events`, `/gallery`, `/contact` | Public catalogue, published gallery, organiser contact |

There is **no** `/admin/staff` route and no role matrix. `src/lib/auth/permissions.ts`
keeps thin compatibility helpers (`can()` always returns true for the single admin).

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in Neon, Razorpay, admin, AUTH_SECRET, Blob
npm run db:generate          # prisma generate (no DB connection required)
npm run db:setup             # DATABASE_URL=… npm run db:setup -- --seed   (direct URL)
npm run dev                  # http://localhost:3000
```

Without `DATABASE_URL` the site still runs — each route renders a "Database not
connected" state instead of event data.

### Admin credentials (first time)

```bash
# Password hash (never put the plain password in env or the repo):
node -e "const c=require('crypto');const s=c.randomBytes(16).toString('hex');const h=c.scryptSync(process.argv[1],Buffer.from(s,'hex'),64).toString('hex');console.log('scrypt$'+s+'$'+h)" 'your-strong-password'

# AUTH_SECRET (≥32 random bytes):
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Set `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `AUTH_SECRET` in `.env.local` (and later in
Vercel). Sign in at `/admin/login`.

## Scripts

| Script | What it does |
| ------ | ------------ |
| `npm run dev` | Dev server (http://localhost:3000) |
| `npm run build` | `prisma generate && next build` |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `prisma generate && next typegen && tsc --noEmit` |
| `npm run check` | typecheck → lint → build |
| `npm run db:generate` | Generate the Prisma Client into `src/generated/prisma` |
| `npm run db:setup` | Apply `supabase/prelude.sql` + every migration (then optional `--seed`) to a **hosted** PostgreSQL. Uses the **direct** connection string; safe to re-run (bookkeeping in `setup.applied_migrations`). `--verify-only` checks without changing anything; `--mark-all-applied` records a pre-existing database |
| `npm run db:setup:test` | Prove the setup tooling against a throwaway PostgreSQL: fresh run, re-run, resume, edited file, one-shot paste — **20/20 passed** |
| `npm run test:prisma` | Exercise the generated Prisma client, gallery draft/publish/delete lifecycle and key SQL functions against throwaway PostgreSQL |
| `npm run test:settings` | Validate public event contact settings and URL rules |
| `npm run test:gallery-upload` | Verify gallery batches stay within request and file-count budgets |
| `npm run db:verify` / `npm run verify:web` | **Historical** Supabase-era harnesses (RLS/role/storage doubles). Not part of the post-migration acceptance path |
| [`docs/one-shot-schema.sql`](./docs/one-shot-schema.sql) | Whole schema as one transactional batch for a provider SQL editor; regenerated with `node scripts/build-one-shot-schema.mjs --seed` |

> **Prisma engine downloads:** if `binaries.prisma.sh` is blocked in your environment,
> set `PRISMA_SCHEMA_ENGINE_BINARY` to a stub executable for `generate` / `typecheck` /
> `build`. Normal machines do not need this.

## Booking flow

`/book` is a four-step wizard (`src/components/booking/`): **night → pass → details →
review**. Details are Full Name + Mobile only (no email). The server:

1. creates a `pending` / `unpaid` booking via `create_pending_booking` (capacity,
   idempotency_key, server-computed subtotal/total);
2. opens Razorpay Checkout for the **server** amount;
3. verifies the signature on `/api/payment/verify` and/or the webhook;
4. issues digital passes only after a verified payment.

Capacity counts **paid** bookings; a repeated submission with the same
`idempotency_key` collapses onto one row.

## Payment flow (Razorpay, test mode — kept as-is)

- `/api/payment/create-order` — amount from the booking row (never from the browser)
- `/api/payment/verify` — Checkout signature `HMAC_SHA256(order_id|payment_id, secret)`
- `/api/payment/webhook` — raw-body signature against `RAZORPAY_WEBHOOK_SECRET`;
  unique `payment_events.event_id` makes replays no-ops
- Live keys are refused unless `RAZORPAY_ALLOW_LIVE=true`

## Digital passes and QR codes

- Pass issued only after verified payment; QR payload is a 64-hex `qr_token` only
  (no name, mobile, or booking reference in the code)
- Ticket + SVG/PNG download token-guarded; admin lists never include `qr_token`
- Gate: `/verify/[token]` (read-only) and `/admin/scanner` → `scan_pass` /
  `check_in_pass` with compare-and-swap so a pass can only be admitted once

## Admin authentication (single account)

| Topic | Behaviour |
| ----- | --------- |
| Credential | `ADMIN_EMAIL` + `ADMIN_PASSWORD_HASH` (scrypt `$ salt $ hash`) compared with `timingSafeEqual` |
| Session | HTTP-only cookie `gn_admin` = `<unix-exp>.<hex-hmac>` (HMAC-SHA256 under `AUTH_SECRET`), 12 hours, `sameSite=lax`, `secure` in production |
| Guards | `src/proxy.ts` redirects HTML under `/admin/*` without a session; `/api/admin/*` and `/api/staff/*` return JSON 401 |
| Roles / staff table | **Removed.** No `SUPER_ADMIN`/`ADMIN`/`STAFF`, no `/admin/staff` route, no `admin_users` allow-list |
| Sign-out | `POST /api/staff/logout` clears `gn_admin` |

## Dashboard (`/admin`)

Eight live statistics, bookings/revenue by date, pass-category breakdown, recent
bookings — all aggregated in SQL (`admin_dashboard_stats`, `admin_booking_series`,
`admin_pass_breakdown`, …) and fetched through `src/lib/services/admin.ts`.

## Booking management (`/admin/bookings`)

Search (reference, name, mobile, pass id, Razorpay ids), filters (night, pass, payment
status, booking status, check-in), paging, CSV export. Contact and amounts are always
present for the single admin.

## Payments and passes (`/admin/payments`, `/admin/passes`)

Read-only payment delivery log, waiting bookings, contradictory rows; door list with
filters and CSV export. Payment status only moves when a verified gateway event says so.

## Gallery management (`/admin/gallery`)

Upload → resize/re-encode WebP server-side → Vercel Blob key → row in `gallery`.
Caption, alt text, order, publish/unpublish/archive, delete row + objects. Public
`/gallery` lists `status = 'published'` only.

## Contact and WhatsApp (`/contact`)

Read from the published `events` row: WhatsApp deep link, phone, **organiser**
`contact_email`, maps, socials, support hours (`src/lib/contact.ts`).

## Gate check-in (`/admin/scanner`)

1. Sign in at `/admin/login` (session cookie).
2. Camera scan (HTTPS required for camera access).
3. Server returns a verdict (VALID / ALREADY CHECKED IN / …); CHECK IN button calls
   `/api/staff/check-in` → `check_in_pass` (unique `check_ins.digital_pass_id`).

## Where the data comes from

Every public page reads live data through `src/lib/services`. No component talks to
Razorpay or the database directly.

| Page element | Source |
| ------------ | ------ |
| Event, venue, contact, socials | `events` (published row) |
| Nights, capacity, availability | `event_dates` + `get_event_night_availability()` |
| Pass names, prices, availability | `pass_categories` |
| Highlights / production features | `event_highlights` / `event_features` |
| Gallery | `gallery` (published; Blob keys or external `url`) |
| Booking status page | `get_booking_status(public_token)` |
| Issued passes | `get_booking_passes` / `get_pass_by_token` |
| Gate verdict / check-in | `scan_pass()` / `check_in_pass()` |
| Admin lists & dashboard | `admin_*` SQL functions via Prisma `rpc`/`sql` |
| Payment truth | `payment_events` + `bookings.payment_status` (signature-verified only) |

## Folder structure

```
├── prisma/
│   ├── schema.prisma          # Neon/Prisma models (single source for the typed client)
│   └── prisma.config.ts       # CLI datasource (generate never requires a live DB)
├── src/
│   ├── app/                   # App Router: public pages, /admin, /api/*
│   ├── components/            # UI (booking wizard, admin tables, scanner, …)
│   ├── lib/
│   │   ├── auth/              # session cookie, scrypt verify, single-admin identity, guards
│   │   ├── db/client.ts       # Prisma + PrismaNeon singleton, sql/rpc helpers
│   │   ├── gallery/           # Vercel Blob put/delete + key helpers
│   │   └── services/          # server-only data access (events, bookings, payments, …)
│   ├── proxy.ts               # middleware: /admin/*, /api/admin/*, /api/staff/*
│   └── types/                 # view models + raw row shapes (database.ts)
├── supabase/
│   ├── prelude.sql            # bare-Postgres shim (auth.uid) applied first by db:setup
│   ├── migrations/*.sql       # schema + functions + triggers (plain PostgreSQL)
│   └── seed.sql               # sample event / nights / pass types
└── docs/                      # neon-setup, deploy-vercel, one-shot-schema, …
```

## Database (Neon + Prisma)

- **Tables kept:** `events`, `event_dates`, `pass_categories`, `bookings`,
  `digital_passes`, `check_ins`, `gallery`, `payment_events`, `event_highlights`,
  `event_features` (plus setup bookkeeping outside `public`).
- **Adapted by migrations:** `20260923090000_single_admin.sql` (drops roles /
  `admin_users` / staff check-in attribution), `20260923091000_no_customer_email.sql`
  (drops `customer_email` and restates the booking/admin functions without it).
- **Guarantees preserved:** unique booking reference & pass id generation, FK
  integrity, `idempotency_key` collapse, payment-state trigger protection, unique
  `qr_token`, unique `check_ins.digital_pass_id` (no double check-in), capacity checks
  inside `create_pending_booking`, unique `payment_events.event_id` (webhook replay).
- **Runtime connection:** pooled Neon URL (`-pooler`), `channel_binding` stripped,
  `sslmode=require`. **Migrations:** direct (non-pooler) URL. Never commit either.
- Six residual public-read RLS policies remain as a database-side boundary for
  anonymous connections; the app connects as the pooler owner and does not depend on
  RLS. Authz is server-side session checks in `src/proxy.ts` + service guards.

## Security

| Control | Where |
| ------- | ----- |
| Admin password | scrypt hash in `ADMIN_PASSWORD_HASH`; never plaintext in source |
| Session | HMAC-SHA256 cookie under `AUTH_SECRET`; HTTP-only; 12h expiry |
| Route protection | `src/proxy.ts` (HTML redirect / JSON 401) + `requireStaff` in pages & APIs |
| Secrets | Server-only env names; never `NEXT_PUBLIC_`; `server-only` imports on services |
| Payment trust | Razorpay Checkout + webhook signatures only |
| Pass privacy | QR = opaque token; lists/search never return `qr_token` |
| Uploads | sharp re-encode to WebP; size cap; Blob keys generated server-side |
| Rate limiting | modest in-process limiter on public write endpoints (`src/lib/rate-limit.ts`) |
| Headers | nosniff, referrer policy, frame denial for `/admin/*` |

## Environment variables

See [`.env.example`](./.env.example). Copy to `.env.local` (git-ignored). Same names in
Vercel → Settings → Environment Variables.

| Variable | Scope | Purpose |
| -------- | ----- | ------- |
| `NEXT_PUBLIC_SITE_URL` | client + server | Canonical/OG URLs; base of every pass QR (set before printing) |
| `DATABASE_URL` | **server only** | Neon **pooled** Postgres URL (`sslmode=require`, no `channel_binding`) |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | client + server | Opens Razorpay Checkout (inlined at build) |
| `RAZORPAY_KEY_SECRET` | **server only** | Creates orders; verifies Checkout signature |
| `RAZORPAY_WEBHOOK_SECRET` | **server only** | Verifies webhook signatures |
| `ADMIN_EMAIL` | **server only** | Admin sign-in username |
| `ADMIN_PASSWORD_HASH` | **server only** | `scrypt$…` password hash |
| `AUTH_SECRET` | **server only** | Signs the `gn_admin` session cookie |
| `BLOB_READ_WRITE_TOKEN` | **server only** | Vercel Blob storage token (gallery upload/delete) |
| `RAZORPAY_ALLOW_LIVE` | **server only** | Optional; unset refuses `rzp_live_…` keys |

There are **no** Supabase variables.

## Deploying (Vercel)

`vercel.json` sets the function region to **Mumbai (`bom1`)** — keep Neon in a nearby
region (e.g. `ap-south-1`) so queries stay cheap. Build is Node 22.

1. **Import** the repo → Next.js preset → default build (`npm run build`).
2. **Environment variables** (Production + Preview) — all names from `.env.example`,
   before the first production build (`NEXT_PUBLIC_*` inline at build time).
3. **Database:** apply schema once with the **direct** Neon URL
   (`DATABASE_URL=… npm run db:setup -- --seed`), then set the **pooled** URL as
   `DATABASE_URL` for the app.
4. **Blob:** Vercel → Storage → Blob → create store → copy token to
   `BLOB_READ_WRITE_TOKEN`.
5. **Razorpay webhook:** `https://<domain>/api/payment/webhook` for
   `payment.captured`, `payment.failed`, `refund.processed` → set
   `RAZORPAY_WEBHOOK_SECRET` and redeploy.
6. **Admin:** set `ADMIN_EMAIL` / `ADMIN_PASSWORD_HASH` / `AUTH_SECRET`.

### After the first deploy

- `/` shows the event; `/passes` shows prices; `/book` runs the wizard.
- Sign in at `/admin/login` with the env credentials.
- Take one Razorpay **test** booking → appears in `/admin/bookings` with a pass.
- Scan that pass at `/admin/scanner` over HTTPS: VALID, then ALREADY USED.

### Hobby plan notes

- Non-commercial projects only on Hobby; selling passes may require Pro.
- Preview deployments sit behind Deployment Protection by default.
- Functions get 300s with Fluid Compute — fine for gallery uploads.

## Before launch checklist

- [ ] Replace placeholder brand in `src/config/site.ts`
- [ ] Fill event contact columns (`contact_phone`, `contact_email`, `whatsapp_number`,
      venue, maps, socials, `support_hours`)
- [ ] Update event / nights / prices in the database (or `supabase/seed.sql` before first setup)
- [ ] Strong `ADMIN_PASSWORD_HASH` + `AUTH_SECRET`; never commit them
- [ ] Razorpay test keys + webhook registered
- [ ] `NEXT_PUBLIC_SITE_URL` = final origin **before** printing QR codes
- [ ] Blob token set if gallery is used
- [ ] Test scanner on real phones over HTTPS

## Verification (this migration)

| Check | Result |
| ----- | ------ |
| `npm install` | OK (no `@supabase/*` packages) |
| `npm run db:generate` | OK — Prisma Client 7.10.0 |
| `npm run typecheck` | **0 errors** (Prisma engine binary stubbed because the sandbox cannot download it over TLS) |
| `npm run lint` | **0 errors** (warnings only) |
| `npm run build` | **exit 0** |
| `npm run test:prisma` | **18/18 passed**, including gallery draft/publish/delete row lifecycle |
| `npm run test:normalise` | **21/21 passed** |
| `npm run test:settings` | **8/8 passed** |
| `npm run test:gallery-upload` | **8/8 passed** |
| `npm run db:setup:test` | **20/20 passed** |
| `npm run db:verify` / `verify:web` | **Not run** — historical Supabase-era harnesses (auth/storage doubles); incompatible without a full rewrite |
| Live Neon update / Vercel Blob operations | Not run — live credentials are not available in this environment; see `docs/update-live-contact.sql` and `docs/gallery-upload-troubleshooting.md` |

## Search audit (forbidden terms)

Runtime search of `src/` (excluding `src/generated/`): **no** `customerEmail`,
`customer_email`, `SUPER_ADMIN`, `/admin/staff`, `@supabase`, `createClient`,
`NEXT_PUBLIC_SUPABASE`, `SUPABASE_SERVICE_ROLE`. Remaining `role`/`permission`/
`staff` identifiers are either ARIA (`role="alert"`), route paths (`/api/staff/*`
kept for URL stability), schema column names (`check_ins` has no staff column any
more; `events.contact_email` is the organiser), or compatibility shims that always
grant full access to the single admin. Historical docs under `docs/connect-free-supabase.md`,
`supabase/README.md` and old migration comments are marked **HISTORICAL**.
