# Set up Neon — and what this app still needs after that

## Reality check first (30 seconds, saves a rewrite)

Neon is **PostgreSQL only**. This app currently takes four things from Supabase, and Neon
replaces exactly one of them:

| What the app needs | Where it comes from today | Neon provides it? |
| ------------------ | ------------------------- | ----------------- |
| **PostgreSQL** — tables, RLS, 51 functions, triggers, seed | Supabase Postgres | ✅ **Yes.** This is the whole database, and it runs on Neon unchanged |
| **A HTTP data API** (`/rest/v1/…`, `/rest/v1/rpc/…`) — how `@supabase/supabase-js` talks to the database | Supabase PostgREST | ⚠️ **Neon Data API** exists and *is* PostgREST, so this may work with a URL/key swap — it must be tested against a real project (see “the one unknown” below) |
| **Staff sign-in** (`/auth/v1/token`, session cookies, `auth.uid()` in RLS) | Supabase Auth (GoTrue) | ❌ Not the same thing. Neon has **Managed Better Auth** (free up to 60k MAU) — a different API the app would have to be rewritten against |
| **File storage** (gallery uploads, two buckets) | Supabase Storage | ❌ Different API. Neon now has **Object Storage** (available in Singapore), or Vercel Blob — either way the gallery code changes |

So: **setting up the Neon database is easy and worth doing** (it is also a nicer Postgres for
a hobby project — no 7-day pause, and a wake-on-connect cold start instead). **Pointing this
app at it is a code change**, not a config change — how big depends on the answer to the
question at the end.

---

## What is already proven

I ran the real schema against a bare PostgreSQL with **only** `supabase/prelude.sql` for
company — no Supabase platform, no `storage` schema, no `auth` schema beyond the shim — and
then exercised the security model through it. **15 checks, 0 failures:**

```
✓ prelude applies to a bare PostgreSQL
✓ auth.uid() exists and is null without claims
✓ every migration applied without error        (all 16, in filename order)
✓ 11 tables, 26 policies, RLS on all 11
✓ the SECURITY DEFINER functions are there     (44)
✓ no storage schema exists (as on Neon) and the migration did not fail
✓ one event, nine nights, five pass types      (the seed)
✓ anonymous reads the published event
✓ anonymous cannot read bookings               (42501)
✓ auth.uid() reads the PostgREST claim set
✓ a staff row resolves through auth.uid() → is_staff()/is_admin()
✓ a subject with no admin_users row gets no role at all
✓ the booking function stays service-role only
✓ gen_random_uuid() is available without an extension
```

That means the **database** half of a Neon move is done and tested; what is missing is the
access layer (auth, storage, the HTTP data API).

---

## Step 1 · Create the project

1. Sign up at <https://neon.com> (GitHub/Google) — no card required on the free plan.
2. **Create project**:
   - **Name**: `garba-nights`
   - **Postgres version**: leave the default (17)
   - **Region**: **AWS Asia Pacific (Singapore) `aws-ap-southeast-1`**
     *Neon has no Mumbai region* — verified against Neon's region list (AWS: N. Virginia,
     Ohio, Oregon, Frankfurt, London, **Singapore**, Sydney, São Paulo; Azure regions are
     deprecated). Singapore is the closest region to India, ~50–70 ms from Mumbai. **The
     region is fixed when the project is created** and cannot be changed later.
   - Plan: **Free**
3. Wait ~30 seconds for provisioning. You land on the project dashboard.

## Step 2 · Copy the two connection strings

Neon console → **Connect** (or the *Connection string* panel on the dashboard). You need
**both** variants, and they differ only by the `-pooler` suffix:

| Use it for | Which one | Shape |
| ---------- | --------- | ----- |
| Applying migrations, `psql`, backup scripts | **Direct** | `postgresql://neondb_owner:<password>@ep-xxx-123456.ap-southeast-1.aws.neon.tech/neondb?sslmode=require` |
| The app's runtime queries (serverless — many short-lived connections) | **Pooled** | `postgresql://neondb_owner:<password>@ep-xxx-123456-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require` |

Always keep `?sslmode=require`. The password is shown once at project creation — save it; if
you lose it, **Settings → Reset password** fixes that without breaking anything else.

## Step 3 · Apply the schema

### Option A — one command (nothing to install but the repo's own dependencies)

```bash
git pull
npm install
DATABASE_URL='postgresql://neondb_owner:…@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require' \
  npm run db:setup -- --seed
```

`npm run db:setup` applies `supabase/prelude.sql` (the identity shim, below), then all 16
migrations **in filename order, each in its own transaction, stopping at the first failure**
so the database is never left half-migrated — and because every migration is idempotent, a
re-run is safe. With `--seed` it also loads the demo data. Then it asserts the end state:

```
  01/16  20260922090000_init_schema.sql
  …
  16/16  20260922091500_security_hardening.sql
  seed: one event, nine nights, five pass types

The schema as it now stands:
  ✓ 11 public tables, 26 policies, RLS on every table
  ✓ 44 SECURITY DEFINER functions, each with a fixed search_path
  ✓ the identity shim answers (auth.uid() is callable)
  ✓ a stranger can read the published event
  ✓ a stranger is refused on bookings (permission denied)
```

Use **`--verify-only`** to check a database without applying anything, and `--skip-prelude`
if you have already created the `auth` schema yourself. The connection string is read from
the environment, never written to disk, and its password is masked in every message.

> Use the **direct** (non-pooler) string to migrate. The pooler is for the app's runtime
> queries; migrations are happier without it.

### Option B — `psql`, by hand

```bash
export DATABASE_URL='postgresql://neondb_owner:…@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require'

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/prelude.sql    # the shim below
for f in supabase/migrations/*.sql; do
  echo "→ $f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f" || break
done
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seed.sql       # optional demo data
```

`-v ON_ERROR_STOP=1` matters: without it `psql` carries on after a failed statement and
leaves you half-migrated.

### Option C — Neon SQL Editor, nothing installed

Console → **SQL Editor** → paste and **Run**, in this order: `supabase/prelude.sql`, then the
16 files in `supabase/migrations/` (ascending filename), then `supabase/seed.sql`. The
largest migration is ~60 KB, comfortable per paste. Expect “Success” each time; the gallery
migration prints *notices* about storage buckets it cannot create — that is the designed
skip, not an error.

### What the prelude does (and why it exists)

`supabase/prelude.sql` creates the only two things the schema assumes from the Supabase
platform:

- `auth.users` — `public.admin_users.user_id` is a foreign key to it, because on Supabase
  staff accounts live in Supabase Auth;
- `auth.uid()` — what every RLS policy reads (`is_staff(p_user_id uuid default auth.uid())`).
  Its body reads the PostgREST JWT claims (`request.jwt.claim.sub`, falling back to
  `request.jwt.claims->>'sub'`), exactly as Supabase's own helper does — so it keeps working
  under PostgREST, including Neon's Data API, and under a direct connection that sets the
  claims itself.

Nothing else in the 16 migrations is Supabase-specific. The gallery migration notices the
missing `storage` schema and skips its bucket setup.

## Step 4 · Verify the schema landed

`npm run db:setup` already prints this, but the same check by hand:

```sql
select
  (select count(*) from information_schema.tables
     where table_schema='public' and table_type='BASE TABLE')          as tables,     -- 11
  (select count(*) from pg_policies where schemaname='public')          as policies,   -- 26
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relkind='r' and c.relrowsecurity)   as rls_on,     -- 11
  (select count(*) from public.events)                                 as events,      -- 1 with --seed, else 0
  (select count(*) from public.pass_categories)                        as passes;      -- 5

-- and the boundary itself: a stranger must see nothing
set role anon;
select count(*) from public.bookings;   -- ERROR: permission denied  ← that is the correct answer
reset role;
```

Tables expected: `admin_users, bookings, check_ins, digital_passes, event_dates,
event_features, event_highlights, events, gallery, pass_categories, payment_events`.

## Step 5 · Create a staff account (only meaningful once sign-in exists)

On Supabase, Supabase Auth creates the user and the app inserts the allow-list row. On Neon
there is no `auth.users` writer yet, so for now you write both rows yourself:

```sql
insert into auth.users (id, email) values ('<uuid>', 'owner@example.com');

insert into public.admin_users (user_id, email, full_name, role)
values ('<uuid>', 'owner@example.com', 'Owner Name', 'super_admin');
```

That is enough for the database to recognise a super admin — and **not** enough for the app
to sign anyone in, because sign-in is Supabase Auth's job today (next section).

---

## What still would not work after the steps above

| Feature | Why it breaks on Neon as things stand | Replacement |
| ------- | ------------------------------------- | ----------- |
| **Staff sign-in** (`/admin/login`) | the app calls Supabase Auth's `/auth/v1/token` and reads the session back through `@supabase/ssr` | Neon **Managed Better Auth** (free, 60k MAU, same region as the database), or Clerk/Auth0 via Neon's custom-provider JWKS, or Auth.js. Each is a rewrite of `src/lib/auth/*`, `src/proxy.ts` and the sign-in action |
| **Gallery** (`/admin/gallery`, `/gallery`) | uploads go to Supabase Storage's API; the migration could not create buckets | Neon **Object Storage** (available in Singapore) or **Vercel Blob**; the gallery service + upload route change, the `gallery` table does not |
| **Every read/write in the app** | `@supabase/supabase-js` speaks PostgREST at `NEXT_PUBLIC_SUPABASE_URL` | Neon **Data API** (enable it on the branch) *may* satisfy this with a URL + token swap, because it is PostgREST — **or** the services swap to a SQL driver (`postgres.js`/`pg`), which is ~80 call sites across `src/lib/services/*` |
| **The verification harness** (`npm run verify:web`) | it stubs Supabase Auth + PostgREST + Storage so the whole flow runs with no credentials | would be re-pointed at the new stack — this is the part that makes a port a multi-step job rather than an afternoon |

### The one unknown that decides how big the port is

Whether **Neon's Data API** can serve the app's existing `supabase-js` calls *including the
service-role path*. The app's server code (`createSupabaseAdminClient`) sends the service-role
key as a Bearer token and PostgREST maps it to the `service_role` Postgres role (`BYPASSRLS`)
— that is how every booking, payment, pass and gate call works. Neon's Data API enforces RLS
from a JWT validated by a provider (Neon Auth, or a custom JWKS), so the question is whether a
token carrying `"role": "service_role"` can be minted and accepted there. If yes, the data
layer is close to a URL swap and only auth + storage need real work. If no, the services must
be rewritten against a SQL driver — which is exactly what `npm run db:setup` already does for
migrations, so there is a working precedent in `scripts/setup-database.mjs`.

---

## Free tier, and how it compares to Supabase

| | Neon Free | Supabase Free |
| - | --------- | ------------- |
| Price | $0 (no card) | $0 (no card) |
| Compute | 100 CU-hours/project/month, autoscale to 2 CU (≈8 GB RAM) | shared instance, always on while unpaused |
| Storage | 0.5 GB/project | 500 MB |
| Egress | 5 GB/project/month | 5 GB/month |
| Idle behaviour | **scale-to-zero after 5 min, wakes automatically** on the next connection (~300–500 ms cold start) | **pauses after 7 days** of inactivity and needs a manual restore |
| Branches / copies | 10 branches per project (copy-on-write) — a real dev copy in seconds | one project, no branching on free |
| Restore window | 6 hours (capped at 1 GB of changes) + 1 manual snapshot | none |
| Auth | Managed Better Auth, 60k MAU | Supabase Auth, 50k MAU |
| Objects | Object Storage (Ohio, Virginia, Frankfurt, **Singapore**) | 1 GB, all regions |
| Projects | 100 | 2 active |
| Gotcha | compute quota is a **wall**: at 100 CU-hours the project suspends until the next month | pause is manual; no backups on free |

If the goal was “stop the database going to sleep on me”, Neon genuinely fixes that — without
the 7-day manual restore.

---

## What I need from you

**Preferred (no secret leaves your machines).** Run Step 3 yourself, then paste back the
output of `npm run db:setup` (or the Step 4 queries). With the counts and any error text, I
can tell you exactly where you stand and what to do next.

**Or:** give me the **direct** connection string and I will run it from here — prelude,
migrations, seed, verification, and the Data-API experiment — then report what happened. Two
things to know before you do:

- it will sit in this conversation's history and in the sandbox workspace, so treat it as
  disclosed — after I am done, **reset the password** in Neon (Settings → Reset password) or,
  better, create a **dedicated role** for me instead of handing over `neondb_owner`;
- if you would rather not share the owner password at all, create a role with `LOGIN` plus
  the privileges needed to create schemas and roles, and give me that one.

I never need the pooled string, and I never need your Neon API key.

---

## Then: which of these do you actually want?

1. **Stay on Supabase** — nothing to do; the free tier is already wired, and the 7-day pause
   is prevented by a daily ping (see [`docs/connect-free-supabase.md`](./connect-free-supabase.md)).
   I go back to step 15 (operations screens: publishing events and event settings).
2. **Full move to Neon** — Postgres + Data API + Better Auth + Object Storage/Blob, and I
   rewrite the data layer, auth and gallery accordingly, keeping the schema, RLS rules and SQL
   functions exactly as they are. Multi-step work on this branch, each step verified.
3. **Hybrid** — data in Neon, keep Supabase for Auth + Storage (so sign-in and the gallery
   keep working untouched, and only the data layer moves).
4. **Database only for now** — set it up as above, leave the app on Supabase, and decide
   later. Useful if you want the schema in a Postgres you can poke at with any client.
