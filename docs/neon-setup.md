# Set up Neon — PostgreSQL for this app

This project runs on **Neon PostgreSQL** with **Prisma** (`@prisma/adapter-neon`).
There is no Supabase Auth, PostgREST client, or Supabase Storage in the runtime path.

## What you need

| Thing | Why |
| ----- | ----- |
| A Neon account ([neon.com](https://neon.com)) | Hosted PostgreSQL (free tier is fine to start) |
| Node.js 22+ and this repo | `npm install`, `db:setup`, `db:generate` |
| Direct + pooled connection strings | Migrations use **direct**; the app uses **pooled** |

---

## Step 1 · Create the project

1. Neon → **Create project** → pick a region near Vercel (`bom1` / Mumbai is ideal).
2. From **Connect**, copy:
   - the **pooled** JDBC/SQL string (host contains `-pooler`) → app `DATABASE_URL`
   - the **direct** (non-pooler) string → `db:setup` / migrations only
3. On both strings:
   - keep `sslmode=require`
   - **remove** `channel_binding=require` if present (Node drivers do not understand it)

Never commit either string. The repo is public.

---

## Step 2 · Apply the schema

The schema is plain PostgreSQL under `supabase/migrations/` (filename history; not a
Supabase dependency), applied by `npm run db:setup`. It also runs `supabase/prelude.sql`
first — a tiny `auth.uid()` shim so residual public-read RLS policies can be created on
bare PostgreSQL.

```bash
# Use the DIRECT (non-pooler) connection string:
DATABASE_URL='postgresql://USER:PASSWORD@HOST/dbname?sslmode=require' \
  npm run db:setup -- --seed
```

What that does:

1. Applies `supabase/prelude.sql` once.
2. Applies every `supabase/migrations/*.sql` in filename order, each in its own
   transaction, recorded in `setup.applied_migrations` (safe to re-run; stops at the
   first failure).
3. Optionally applies `supabase/seed.sql` (`--seed`).
4. Asserts the end state (tables, public-read policies, stranger refused on bookings).

**Alternative — one paste:** open Neon’s SQL editor and run
[`docs/one-shot-schema.sql`](./one-shot-schema.sql) for a new database. It is generated
and includes the full schema (and seed only if built with `--seed`). Do not paste the
full one-shot file into an existing database.

For an existing database, use `npm run db:setup` with the **direct** URL to apply pending
migrations, or run only the new migration in Neon SQL Editor:
`supabase/migrations/20260924090000_database_hero_image.sql`.

The latest migrations are:

| File | Effect |
| ---- | ------ |
| `20260923090000_single_admin.sql` | Drops roles / `admin_users` / staff check-in attribution; keeps capacity, payment, pass and check-in guarantees |
| `20260923091000_no_customer_email.sql` | Drops `bookings.customer_email`; restates booking/admin functions without email |
| `20260924090000_database_hero_image.sql` | Adds optimized WebP `bytea` storage and a cache revision for the homepage hero; Gallery storage is unchanged |

Organiser `events.contact_email` is untouched. The homepage hero image is stored in
Neon; `BLOB_READ_WRITE_TOKEN` remains a Gallery-only requirement.

---

## Step 3 · Point the app at Neon

```bash
cp .env.example .env.local
# DATABASE_URL = pooled string (sslmode=require, no channel_binding)
# plus Razorpay, ADMIN_*, AUTH_SECRET, NEXT_PUBLIC_SITE_URL
# BLOB_READ_WRITE_TOKEN is only needed for Gallery uploads (the homepage hero is in Neon)
```

```bash
npm run db:generate   # prisma generate → src/generated/prisma
npm run typecheck
npm run dev
```

Runtime details (`src/lib/db/client.ts`):

- one `PrismaClient` with `PrismaNeon` (HTTP driver — serverless-safe on Vercel);
- `channel_binding` is stripped defensively from `DATABASE_URL`;
- `sql` tagged templates for reads; `rpc` / `rpcScalar` for SQL functions
  (`create_pending_booking`, `scan_pass`, `admin_*`, …).

If Prisma cannot download engines in a locked-down environment, set
`PRISMA_SCHEMA_ENGINE_BINARY` to a stub executable for `generate` only; normal
developer machines do not need this.

---

## Step 4 · Admin credentials

There is **one** administrator (no staff table, no roles):

```bash
# Password hash for ADMIN_PASSWORD_HASH (never store the plaintext):
node -e "const c=require('crypto');const s=c.randomBytes(16).toString('hex');const h=c.scryptSync(process.argv[1],Buffer.from(s,'hex'),64).toString('hex');console.log('scrypt$'+s+'$'+h)" 'your-strong-password'

# AUTH_SECRET for the session cookie HMAC:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Set `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `AUTH_SECRET` in `.env.local` (and later
in Vercel). Sign in at `/admin/login`.

---

## Step 5 · Verify

```bash
npm run typecheck   # 0 errors expected
npm run lint        # 0 errors
npm run build       # exit 0
npm run test:prisma # 25/25 against a throwaway Postgres
npm run test:hero-image # 7/7 image validation/optimization checks
npm run test:settings # 9/9 settings and WhatsApp icon checks
npm run db:setup:test # 20/20 setup tooling checks
```

`npm run db:verify` and `npm run verify:web` are **historical** Supabase-era harnesses
(auth/storage doubles) and are not part of the post-migration acceptance path.

---

## Common issues

| Symptom | Fix |
| ------- | ----- |
| `channel_binding` / libpq error | Remove `channel_binding=…` from the URL |
| App cannot connect from Vercel | Use the **pooled** host (`-pooler`) + `sslmode=require` |
| Migration fails mid-file | Re-run `db:setup` — it resumes from `setup.applied_migrations` |
| “Database not connected” panel | `DATABASE_URL` missing/empty at runtime |
| Prisma generate downloads blocked | `PRISMA_SCHEMA_ENGINE_BINARY` stub (sandbox only) |

## What still mentions Supabase (and why that is OK)

- **Path names** `supabase/migrations`, `supabase/prelude.sql`, `supabase/seed.sql` —
  historical layout; the SQL is standard PostgreSQL.
- **Docs** `docs/connect-free-supabase.md`, `supabase/README.md` — marked HISTORICAL;
  follow this file and `docs/deploy-vercel.md` instead.
- **Runtime** — zero `@supabase/*` imports, zero Supabase env vars.
