# Garba Nights — Navratri & Dandiya event booking

A production-oriented booking platform for Navratri / Dandiya events: browse nights,
reserve passes and pay online. Built with **Next.js (App Router) + React + TypeScript +
Tailwind CSS**, backed by **Supabase** (Postgres, Auth, Storage), **Razorpay** for
payments, deployed on **Vercel**, versioned on **GitHub**. Chosen so the whole stack
fits within free tiers for development and small-scale launch.

## Status

**Step 1 — project setup only.** What exists today:

- Next.js 16 App Router project with TypeScript (strict) and Tailwind CSS v4.
- Reusable UI primitives, layout shell (header / footer / mobile nav) and a home page.
- `/events` route, `not-found` page, SEO metadata, brand tokens.
- `.env.example` documenting every variable the later steps will need.

Not built yet (deliberately): Supabase client and schema, Razorpay integration,
authentication, admin dashboard, booking flow. There is **no mock data and no fake
payment logic anywhere** — sections that will be database-driven render explicit empty
states instead.

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
| `npm run check`     | typecheck → lint → build, in one command                           |

> Next.js 16 no longer runs ESLint inside `next build`, so run `npm run lint`
> (or `npm run check`) separately — in CI and before deploying.

### Notes on the current setup

- **Typed routes** (`typedRoutes: true`) means `href` values are checked against the
  routes generated from `src/app`. `npm run typecheck` runs `next typegen` first so the
  generated `.next/types` exist even on a fresh clone.
- **Fonts are self-hosted** through the [`geist`](https://www.npmjs.com/package/geist)
  package instead of `next/font/google`: the build never depends on reaching Google
  Fonts, and visitors make zero third-party requests.
- **Theme tokens** live in `src/app/globals.css` (`@theme`). Change the hex values there
  to re-skin the site.

## Folder structure

```
src/
├── app/                       # App Router routes (routing + layout only, no business logic)
│   ├── events/page.tsx        # /events listing (waiting on the database)
│   ├── layout.tsx             # Root shell: fonts, metadata, header/footer, skip link
│   ├── page.tsx               # Home page composition
│   ├── not-found.tsx          # 404
│   ├── globals.css            # Tailwind entry + design tokens (@theme)
│   └── icon.svg               # Favicon
├── components/
│   ├── brand/                 # Logo / brand marks
│   ├── events/                # (empty) event-specific UI: cards, filters, lists
│   ├── layout/                # Site header, footer, mobile nav
│   ├── sections/              # Page-level composed sections (hero, how-it-works…)
│   └── ui/                    # Reusable primitives: Button, Card, Badge, Container…
├── config/
│   ├── env.ts                 # Single place that reads process.env + site URL
│   └── site.ts                # Branding, navigation, SEO copy (no event data)
├── lib/
│   ├── payments/              # (empty) Razorpay — server-only helpers
│   ├── services/              # (empty) data-access layer used by pages/actions
│   ├── supabase/              # (empty) browser/server/admin Supabase clients
│   └── utils.ts               # cn(): clsx + tailwind-merge
└── types/                     # Shared types (domain types follow the DB schema)
```

### Conventions

- **Data flow:** pages/components call functions in `src/lib/services`, which wrap
  Supabase. No component talks to Supabase or Razorpay directly, and nothing that
  belongs in the database is hard-coded in the UI.
- **Secrets:** only `NEXT_PUBLIC_*` variables may be imported into client components.
  Server-only keys (`RAZORPAY_KEY_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`) live in code
  that must only run on the server (route handlers, server actions).
- **Styling:** design tokens are declared once in `src/app/globals.css` under `@theme`;
  components compose Tailwind utilities and merge classes with `cn()`.
- **Components:** primitives in `components/ui` stay presentational and receive props;
  page-specific composition lives in `components/sections` and route files.

## Environment variables

See [`.env.example`](./.env.example). Copy it to `.env.local`; the values are git-ignored.
The same variables must be added in Vercel → Settings → Environment Variables for
production. `src/config/env.ts` is the only module that reads `process.env`.

| Variable                        | Scope          | Used now? | Purpose                                  |
| ------------------------------- | -------------- | --------- | ---------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`          | client + server | yes       | Canonical/OG URLs, absolute links        |
| `NEXT_PUBLIC_SUPABASE_URL`      | client + server | no        | Supabase project URL                     |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server | no        | Supabase anon key (RLS-protected)        |
| `SUPABASE_SERVICE_ROLE_KEY`     | server only     | no        | Admin/webhook operations — keep secret   |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID`   | client + server | no        | Opens Razorpay Checkout                  |
| `RAZORPAY_KEY_SECRET`           | server only     | no        | Creates orders, verifies signatures      |
| `RAZORPAY_WEBHOOK_SECRET`       | server only     | no        | Verifies webhook signatures              |

## Deploying (Vercel)

1. Push the branch to GitHub.
2. In Vercel, **New Project → Import** this repository (framework auto-detected).
3. Add the environment variables from the table above (Production + Preview).
4. Deploy. `NEXT_PUBLIC_SITE_URL` should be the production domain; `VERCEL_URL` is used
   automatically for preview deployments.

## Roadmap

1. **Setup** — scaffold, structure, layout, tooling. ✅
2. Supabase project + schema (events, pass tiers, bookings, payments) and typed clients.
3. Auth and attendee accounts.
4. Events listing + event detail with pass selection.
5. Razorpay order creation, server-side signature verification, webhook, booking record.
6. Admin dashboard for organisers (publish events, capacity, check-in).
7. Hardening: rate limiting, RLS tests, analytics, accessibility and performance budget.
