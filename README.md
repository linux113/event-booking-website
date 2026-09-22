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
| 2 | Public UI — all six public pages, responsive, accessible | ✅ done |
| 3 | Supabase database — schema, RLS, seed data, typed clients | ✅ done |
| 4 | Wire the UI to the database (replace `src/config/*` demo values) | ⏳ next |
| 5 | Auth and attendee accounts | ⏳ |
| 6 | Razorpay order creation, signature verification, webhook, booking record | ⏳ |
| 7 | Admin dashboard (publish events, capacity, check-in) | ⏳ |
| 8 | Hardening — rate limiting, analytics, perf budget | ⏳ |

**There is no backend yet, no payment code and no mock API.** Sections that will be
database-driven render explicit empty states rather than invented content, and every
placeholder value is labelled in the UI as demo content.

## Pages

| Route | Purpose |
| ----- | ------- |
| `/` | Hero (banner, dates, venue, CTAs), feature strip, about, pass preview, gallery preview, contact preview, CTA band |
| `/about` | Festival overview, what to expect, production list, organiser profiles (empty state until the DB exists) |
| `/passes` | Full pass comparison, inclusions, pass policy notes |
| `/book` | How booking will work, what to bring, event details. **Collects nothing and takes no payment** |
| `/gallery` | Photo grid, video slots (empty by design), album empty state |
| `/contact` | Contact channels, venue block, support hours, FAQ, contact-form placeholder |
| `/events` | Database-backed listing route — intentionally empty until the `events` table exists |

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in as features are added
npm run dev                  # http://localhost:3000
```

## Scripts

| Script              | What it does                                                       |
| ------------------- | ------------------------------------------------------------------ |
| `npm run dev`       | Start the dev server (http://localhost:3000)                       |
| `npm run build`     | Production build (type-checks the app as part of the build)        |
| `npm run start`     | Serve the production build                                         |
| `npm run lint`      | ESLint (Next core-web-vitals + TypeScript rules)                   |
| `npm run typecheck` | `next typegen && tsc --noEmit` (route types must exist first)      |
| `npm run db:verify` | Run the migrations + seed against PostgreSQL (WASM) and assert schema, constraints and RLS |
| `npm run check`     | typecheck → lint → build, in one command                           |

## Demo content policy

Prices, dates, venue, contact details and imagery are **placeholders**, not live data.
They are isolated so the swap to Supabase is a data-source change, not a UI rewrite:

| File | Contents | Becomes |
| ---- | -------- | ------- |
| `src/config/event.ts` | Hero event + highlights | `events` + `event_dates` (seeded — see `supabase/`) |
| `src/config/passes.ts` | Five pass tiers, prices, inclusions | `pass_categories` (seeded — see `supabase/`) |
| `src/config/features.ts` | Production elements (anchor, DJ, drone…) | `event_features` table or an enum column |
| `src/config/gallery.ts` | Gallery artwork | `gallery` table + Supabase Storage bucket |
| `src/config/promos.ts` | Video slots (no URLs set) | `gallery` rows with `media_type = 'video'` |
| `src/config/contact.ts` | Phone, email, address, map link | `organisers` table |
| `src/config/site.ts` | Branding, nav, socials | Env/DB as appropriate |

Every one of these files carries a `⚠️ DEMO CONTENT` banner, and the UI shows a
`DemoBadge` next to the affected sections so nobody mistakes placeholder content for a
live event. Pages consume domain types (`EventDetails`, `PassTier`, `GalleryItem`…), so
the data layer maps rows onto those shapes and the components stay unchanged.

## Folder structure

```
src/
├── app/                        # App Router routes (routing + composition only)
│   ├── about/ book/ contact/ events/ gallery/ passes/
│   ├── layout.tsx              # Root shell: fonts, metadata, header/footer, skip link
│   ├── page.tsx                # Home page composition
│   ├── not-found.tsx           # 404
│   └── globals.css             # Tailwind entry + @theme design tokens
├── assets/images/              # Original generated artwork (no stock, no faces)
├── components/
│   ├── brand/logo.tsx          # Inline brand mark (no image request)
│   ├── contact/contact-card.tsx
│   ├── events/                 # pass-card, gallery-tile
│   ├── icons/index.tsx         # Original inline icon set (stroke-based, 24×24)
│   ├── layout/                 # header, footer, mobile nav, page hero, WhatsApp button
│   ├── sections/               # hero, feature strip, about, passes/gallery preview, CTA
│   └── ui/                     # Button, Card, Badge, Container, Section, EmptyState…
├── config/                     # site, env, event, passes, features, gallery, promos, contact
├── lib/
│   ├── supabase/               # browser / server / admin clients (admin is server-only)
│   ├── payments/ services/     # (empty) Razorpay helpers, data-access layer
│   ├── format.ts               # INR + href helpers
│   └── utils.ts                # cn(): clsx + tailwind-merge
├── types/
│   ├── index.ts                # Presentational types used by the UI
│   └── database.ts             # Generated-shape Supabase types for every table
└── assets/images/              # Original generated artwork

supabase/
├── migrations/                 # 1) schema  2) RLS policies
├── seed.sql                    # event, 9 nights, 5 pass categories
└── README.md                   # how to apply, roles, what is/isn't seeded

scripts/verify-db.mjs           # npm run db:verify — schema + RLS test harness
```

### Conventions

- **Data flow:** pages/components call functions in `src/lib/services`, which wrap
  Supabase. No component talks to Supabase or Razorpay directly.
- **Secrets:** only `NEXT_PUBLIC_*` variables may be imported into client components.
- **Styling:** design tokens live in `globals.css` under `@theme`; components compose
  Tailwind utilities and merge classes with `cn()`.
- **Components:** primitives in `components/ui` are presentational; composition lives in
  `components/sections` and route files.
- **Server/client:** only `mobile-nav.tsx` is a client component — everything else ships
  zero JS beyond the framework runtime.

## Accessibility & performance

- Skip-to-content link, one `<h1>` per page, ordered headings, `aria-label`s on icon-only
  controls, `aria-expanded`/`aria-controls` on the mobile menu, `Escape` closes it.
- Every informative image has descriptive `alt`; decorative art and gradients are
  `aria-hidden`; empty states carry real copy rather than lorem text.
- Visible focus ring on all interactive elements (gold, 2px, offset).
- Animations are limited to two ambient CSS keyframes and are wrapped in `motion-safe:`;
  `prefers-reduced-motion` also disables smooth scrolling.
- Fonts self-hosted (no third-party requests), images optimised through `next/image`,
  production CSS ≈ 8 KB gzipped, all routes prerendered static.

## Database (Supabase)

The authoritative schema lives in `supabase/` — see **[supabase/README.md](./supabase/README.md)**
for the full table reference, roles and setup steps.

| Table | Purpose | Public read? |
| ----- | ------- | ------------ |
| `events` | One festival (venue, city, status) | ✅ published only |
| `event_dates` | One night per row, with capacity | ✅ published, not cancelled |
| `pass_categories` | Pass types + prices, per event | ✅ active only |
| `bookings` | One booking = pass category × night | ❌ staff only |
| `digital_passes` | QR passes issued after payment | ❌ staff only |
| `check_ins` | Gate scan log (one row per pass, ever) | ❌ staff only |
| `gallery` | Photo/video metadata (files in Storage) | ✅ published only |
| `admin_users` | Auth users allow-listed as staff | ❌ admins only |

Seeded: one published Jaipur event (My Village Garden), nine nights
11–19 October 2026, and five pass categories (₹399 / ₹499 / ₹599 / ₹799 / ₹1099).

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
| `NEXT_PUBLIC_SUPABASE_URL`      | client + server | for DB reads | Supabase project URL                  |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server | for DB reads | Supabase anon key (RLS-protected)     |
| `SUPABASE_SERVICE_ROLE_KEY`     | **server only** | booking writes | Bypasses RLS. Guarded by `server-only` — a client import fails the build |
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
- Swap the placeholder artwork in `src/assets/images/` for real event photography, and
  delete the `DemoBadge` components once sections read live data.
- Update the event, nights and prices in the database (or `supabase/seed.sql`) rather
  than in the frontend — the DB is now the source of truth.
- Create the first admin: insert a row in `admin_users` for an existing Auth user with
  `role = 'owner'` (see supabase/README.md).
