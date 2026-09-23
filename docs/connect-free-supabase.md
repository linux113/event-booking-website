# Connect this project to a free Supabase database

Everything below is the free tier: **Supabase Free** ($0), **Razorpay test mode** (free
forever), and the app itself. The only line item that ever costs money is hosting a
**ticket-selling** site (see §7) — nothing in this guide.

The app has no fake backend: if the two Supabase values are missing it says
"database not connected" and shows nothing, and the moment they are right it reads
your rows. There is no seed/demo mode to switch off.

---

## 0 · What you need

| Thing | Why | Cost |
| ----- | --- | ---- |
| A Supabase account | the database, auth, file storage | free |
| Node.js 20+ and the repo on your machine | to run and build the app | free |
| A terminal | the commands below | free |
| GitHub + Vercel account (optional, §7) | to put it online | free for personal projects |
| Razorpay account (optional, §7) | online payments | free in test mode |

Free-tier numbers worth knowing up front (as of late 2026): 2 active projects, **500 MB**
database, **1 GB** file storage, **5 GB** egress/month, 50,000 monthly active users, no
automatic backups, and **projects pause after 7 days without database activity**. §8 is
about living within that.

---

## 1 · Create the project (≈2 minutes)

1. Sign in at <https://supabase.com/dashboard>, then **New project**.
2. Pick an organisation, then:
   - **Name**: e.g. `garba-nights`
   - **Database password**: click *Generate a password* and **save it in a password
     manager** — the CLI (Path B in §2) asks for it, and it is not recoverable from the
     dashboard later.
   - **Region**: **Mumbai (ap-south-1)** — closest to an India audience and to your
     visitors' phones.
   - Plan: **Free**.
3. **Create new project** and wait ~2 minutes for provisioning.
4. Copy the **project ref**: it is the 20-character string in the dashboard URL,
   `https://supabase.com/dashboard/project/<project-ref>`. Your project URL is
   `https://<project-ref>.supabase.co`.

You get Auth, Storage, PostgREST and the SQL editor with the project. Nothing else in
this guide creates infrastructure.

---

## 2 · Apply the schema — pick one path

The schema is 16 plain-SQL migration files plus a seed. They must be applied **in
filename order** (they build on each other; the last one is the security hardening from
the audit).

### Path A — SQL editor, nothing installed (recommended the first time)

1. Dashboard → **SQL Editor** → **New query**.
2. For **each** file in `supabase/migrations/`, in filename order:

   | # | File |
   | - | ---- |
   | 1 | `20260922090000_init_schema.sql` |
   | 2 | `20260922090100_rls_policies.sql` |
   | 3 | `20260922090200_public_data_api.sql` |
   | 4 | `20260922090300_pass_catalogue_visibility.sql` |
   | 5 | `20260922090400_booking_flow.sql` |
   | 6 | `20260922090500_payments.sql` |
   | 7 | `20260922090600_digital_pass.sql` |
   | 8 | `20260922090700_check_in.sql` |
   | 9 | `20260922090800_admin_roles.sql` |
   | 10 | `20260922090900_admin_dashboard.sql` |
   | 11 | `20260922091000_admin_booking_management.sql` |
   | 12 | `20260922091100_admin_payments_and_passes.sql` |
   | 13 | `20260922091200_admin_pass_and_date_management.sql` |
   | 14 | `20260922091300_gallery_management.sql` |
   | 15 | `20260922091400_contact_and_social_links.sql` |
   | 16 | `20260922091500_security_hardening.sql` |

   Paste the whole file, press **Run**, and expect **“Success. No rows returned.”**
   (file 14 prints notices about the storage buckets — that is normal, the *Notices* tab
   shows them.)
3. Optionally load the demo data: paste `supabase/seed.sql` → **Run**.
   It creates one event, nine nights, five pass types, highlights and features — useful
   to see a working site immediately; §6 replaces it with your event.
4. Check it landed (paste and run):

   ```sql
   select
     (select count(*) from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE')        as tables,      -- 11
     (select count(*) from pg_policies where schemaname = 'public')        as policies,    -- 26
     (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity) as rls_on,    -- 11
     (select count(*) from storage.buckets where id in ('gallery','gallery-inbox')) as buckets; -- 2
   ```

   Expected: **11 / 26 / 11 / 2**. The tables are: `admin_users, bookings, check_ins,
   digital_passes, event_dates, event_features, event_highlights, events, gallery,
   pass_categories, payment_events`.

### Path B — Supabase CLI (repeatable, one command after setup)

```bash
# once per machine
npx supabase@latest login            # opens a browser; or export SUPABASE_ACCESS_TOKEN=...

# once per clone: adds supabase/config.toml (it only adds that file — the migrations
# and seed.sql are untouched, and config already points at ./seed.sql)
npx supabase@latest init --yes

# once per project
npx supabase@latest link --project-ref <project-ref>   # asks for the database password
npx supabase@latest db push --include-seed --dry-run   # look at what will run
npx supabase@latest db push --include-seed             # applies migrations + seed
```

- Docker is **not** needed for `link` / `db push` (it is only needed for the *local*
  stack: `supabase start`).
- `--include-seed` is what loads `supabase/seed.sql`. Drop it to get an empty database.
- The CLI records every file in `supabase_migrations.schema_migrations`, so a later
  `db push` applies only what is new. That is the reason to prefer this path long-term.
- You can commit `supabase/config.toml` (conventional) or add it to `.gitignore`; it holds
  no secrets. `project_id` inside it is just the project name.

---

## 3 · Get the two keys — and which env var each one goes in

Dashboard → **Connect** (top bar) or **Project Settings → API Keys**.

Supabase renamed these keys in 2025–26. **New projects no longer have the legacy
`anon` / `service_role` JWTs**, and the legacy ones are removed by the end of 2026. The
app's environment variable *names* still say anon / service_role — that is what the code
reads — but the *values* are the new keys, and both work exactly the same way:

| Value in the dashboard | Also called | Put it in | Reaches the browser? |
| ---------------------- | ----------- | --------- | -------------------- |
| Project URL (`https://<ref>.supabase.co`) | — | `NEXT_PUBLIC_SUPABASE_URL` | yes (it is just an address) |
| **Publishable key** `sb_publishable_…` | legacy `anon` key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes — safe by design, RLS decides what it can read |
| **Secret key** `sb_secret_…` | legacy `service_role` key | `SUPABASE_SERVICE_ROLE_KEY` | **never** — it bypasses Row Level Security |

Rules that matter:

- The secret key goes only into `.env.local` (local) or the host's server env vars. It must
  never be prefixed `NEXT_PUBLIC_`, never pasted into a chat, screenshot, issue or commit.
  The app fails the build if `src/lib/supabase/admin.ts` (the only reader) is ever pulled
  into browser code.
- Leaked something? Dashboard → **Settings → API Keys** → create a new secret key, replace
  it everywhere, then delete the old one. Rotating the publishable key is the same swap.
- The publishable key is public on purpose. Access control is the 26 RLS policies, not a
  hidden key.

---

## 4 · Run it locally against your new database (≈1 minute)

```bash
cp .env.example .env.local
```

Fill in `.env.local` (three values are enough to start; Razorpay is §7):

```dotenv
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
```

```bash
npm install
npm run dev          # http://localhost:3000
```

Then check it is really reading *your* database:

| Page | What proves it |
| ---- | -------------- |
| `/` | the event name, venue and city from your `events` row |
| `/passes` | the five pass types and prices from `pass_categories` |
| `/book` | the nine nights and their availability from `event_dates` |
| `/contact` | the WhatsApp / phone / email / socials from the event row |
| `/gallery` | empty until you upload photographs in §6 |
| `/admin/login` | refuses you until §5 creates a staff account |

Change a price in the SQL editor, refresh `/passes`: it changes. Nothing is hard-coded.

---

## 5 · Create your first admin, then sign in

1. Dashboard → **Authentication → Users → Add user** → email + password →
   tick **Auto confirm user** → *Create user*.
   (Tick it: the free tier's built-in mailer is rate-limited and unreliable; auto-confirm
   means no email is needed at all.)
2. Copy that user's **UUID** from the list.
3. SQL editor:

   ```sql
   -- the organiser: full access, including managing staff
   insert into public.admin_users (user_id, email, full_name, role)
   values ('<paste-the-uuid-here>', 'owner@example.com', 'Owner Name', 'super_admin');

   -- a gate volunteer: scanner, check-ins, limited booking lookup
   insert into public.admin_users (user_id, email, full_name, role)
   values ('<second-user-uuid>', 'gate1@example.com', 'Gate Volunteer', 'staff');
   ```

4. Go to `http://localhost:3000/admin/login` and sign in. You should land on the
   dashboard. From there: **Scanner** (camera check-in), **Bookings**, **Passes**,
   **Dates**, **Gallery**, **Settings**, **Staff** (super-admin only).

Only three roles exist: `super_admin`, `admin`, `staff`. An account with no
`admin_users` row, or with `is_active = false`, can sign in to Supabase Auth and still get
nothing — the app refuses the session and the database refuses the user id.
Suspend someone: `update public.admin_users set is_active = false where user_id = '<uuid>';`

---

## 6 · Replace the demo data with your real event

**Which event the site shows:** the *oldest **published*** event. So if you loaded the
seed, archive it first, or your real event will never appear:

```sql
update public.events set status = 'archived' where slug = 'navratri-2026-jaipur';
```

Then create your event:

```sql
insert into public.events (
  slug, name, tagline, description,
  venue_name, venue_address, city, state, maps_url,
  contact_phone, contact_email, whatsapp_number,
  instagram_url, facebook_url, youtube_url, support_hours,
  currency, status
) values (
  'navratri-2026-your-city',
  'Your Event Name',
  'One line that goes under the title',
  'A paragraph or two describing the festival.',
  'Your Ground / Hall',
  'Your Ground, Your Road',
  'Your City',
  'Your State',
  'https://maps.google.com/?q=Your+Ground',
  '+91 90000 00000',                          -- shown as a tel: link
  'hello@example.com',                        -- shown as a mailto: link
  '919000000000',                             -- digits only, no + or spaces
  'https://www.instagram.com/yourhandle',
  'https://www.facebook.com/yourpage',
  'https://www.youtube.com/@yourchannel',
  array['Mon–Sat, 10am – 8pm', 'Event days, 10am – 11pm'],   -- max 6 lines
  'INR',
  'published'                                 -- ← without this the public site is empty
);
```

Rules the database enforces (you will get a clear error otherwise):

- `whatsapp_number`: **digits only**, country code included (`919812345678`). `+`, spaces
  and a leading `0` are refused. Leave it `null` and the WhatsApp buttons simply don't
  render — the phone number is used instead.
- social URLs must be `https` **and** on that platform's own host
  (`instagram.com`, `facebook.com`, `youtube.com` / `youtu.be`).
- `support_hours`: at most 6 lines.
- One event row per festival; `slug` is unique.

Then fill in the rest — most of it through the admin screens, no SQL:

| What | Where | Notes |
| ---- | ----- | ----- |
| Nights, dates, capacity, seats held back, open/close booking | `/admin/dates` | capacity can never go below what is already paid; booking closes without unpublishing the night |
| Pass types: price, description, how many people, max per booking, minimum age, on/off sale | `/admin/passes` | prices are read by the booking function from this table — never from the page |
| Photographs | `/admin/gallery` | uploads are decoded, resized and re-encoded; new items start as **draft** in a **private** bucket and only appear on `/gallery` once published |
| Event name, venue, contact, socials, support hours | SQL editor / **Table Editor → events** | `/admin/settings` shows these values read-only today; editing them from the UI is the next step |

Seed content to tidy up if you keep it: `event_highlights` ("what to expect") and
`event_features` (anchor, DJ, drone…) are rows — delete or rewrite them for your event.

---

## 7 · Put it online (and payments)

**Vercel (free tier: Hobby).** Import the repository, framework is auto-detected, add the
same variables from §4 under *Settings → Environment Variables* (Production **and**
Preview), deploy. Set `NEXT_PUBLIC_SITE_URL` to the real domain **before printing
passes** — it is the base of the URL inside every QR code, so changing it later invalidates
passes that are already in guests' hands.

> ⚠️ **Hobby is for personal, non-commercial projects.** A site that sells passes is a
> commercial project, and Vercel's terms expect **Pro** (~$20/month) for it. Keep Hobby
> while it is a demo or a free event; budget one month of Pro for the event itself, or host
> on a provider whose free tier allows commercial use (Cloudflare/Netlify — note that
> Next.js features like ISR need their Next adapter).

**Razorpay.** Create the account, stay in **Test mode** (free, no KYC) and copy the test
key id/secret. Then:

- `NEXT_PUBLIC_RAZORPAY_KEY_ID` (test ids start `rzp_test_`) — inlined at build, so
  changing it needs a redeploy.
- `RAZORPAY_KEY_SECRET` — server-only; verifies the Checkout signature.
- Dashboard → **Settings → Webhooks** → add `https://<your-domain>/api/payment/webhook`,
  subscribe to `payment.captured`, `payment.failed`, `refund.processed`, then put its
  secret in `RAZORPAY_WEBHOOK_SECRET`.
- `RAZORPAY_ALLOW_LIVE` stays unset until you have live keys and KYC: with a `rzp_live_`
  key and no flag the server refuses to create orders rather than charging anyone.

A booking is only ever marked paid by a verified signature (Checkout or webhook); the
amount always comes from the database, never from the browser.

---

## 8 · Living inside the free tier

| Free-tier limit | What it means here | What to do |
| --------------- | ------------------ | ---------- |
| **Pause after 7 days without database activity** | the site returns errors once paused (restore from the dashboard) | a daily ping: a GitHub Actions cron job hitting `https://<domain>/passes` (a page that queries the database) is enough; or run Supabase Pro for the event month |
| 500 MB database | plenty: a booking row is ~1 KB, so ~500k bookings | nothing |
| 1 GB storage | the likely wall. Uploads are re-encoded to WebP (full + thumbnail, roughly 300–600 KB per photo) | ~1,000–2,000 photographs; delete drafts you don't publish |
| 5 GB egress/month | page views + images | fine for a few thousand visits; don't put video in the gallery |
| No automatic backups | free tier has none | before the event: **`/admin/bookings` → Export** and **`/admin/passes` → Export** give CSV copies of the rows that matter; a full `pg_dump` needs the connection string plus Docker or `psql` locally |
| 2 projects | dev + production is exactly 2 | pause the dev project when unused |
| No uptime guarantee | a paused or cold project is not a ticketing system | for the week of the event, pay for the month (Supabase Pro ~$25, Vercel Pro ~$20) and treat it as an event cost |

---

## 9 · Prove the connection

```bash
npm run check        # typecheck + lint + production build
npm run db:verify    # schema/constraints/RLS rules — runs its own throwaway PostgreSQL, needs no credentials
npm run verify:web   # the whole flow end-to-end (booking → payment stub → pass → gate) against a local database
```

Those three never touch your hosted database — they are how you know the *code* is sound.
To prove *your* database, do it from the app:

1. Open `/book`, take a booking to the payment step in Razorpay **test** mode and pay with
   a test method.
2. `/admin/bookings` shows the booking (it got there through `create_pending_booking`).
3. `/booking/success` shows a pass; open `/pass/<id>` — the QR encodes
   `NEXT_PUBLIC_SITE_URL` + the token.
4. `/admin/scanner` on a phone, signed in as the `staff` account, scans it: **✓ VALID
   PASS**; scanning it again says **⚠ PASS ALREADY USED**.
5. `/admin` dashboard numbers move. That is every layer — app, RLS, functions and storage —
   working on your data.

---

## 10 · Short version (what to actually do)

1. Supabase → **New project** (Free, Mumbai), save the database password, copy the project ref.
2. **SQL editor**: run `supabase/migrations/*.sql` in filename order (16 files), then
   optionally `supabase/seed.sql`. Verify with the count query (11 / 26 / 11 / 2).
   *Or* `npx supabase@latest init --yes && npx supabase@latest link --project-ref <ref> && npx supabase@latest db push --include-seed`.
3. Settings → API Keys: **publishable** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   **secret** → `SUPABASE_SERVICE_ROLE_KEY`, project URL → `NEXT_PUBLIC_SUPABASE_URL`
   (in `.env.local` locally, in the host's env vars for a deploy).
4. `npm install && npm run dev`.
5. Authentication → Users → Add user (auto-confirm) → copy the UUID → insert the
   `admin_users` row → sign in at `/admin/login`.
6. Archive the seed event, insert yours with `status = 'published'`, add nights in
   `/admin/dates` and passes in `/admin/passes`, upload photos in `/admin/gallery`.
7. Deploy (Vercel Hobby is fine while it is free/personal), set `NEXT_PUBLIC_SITE_URL`,
   then Razorpay test keys + webhook when you want payments.
8. Add a daily ping so the free project never pauses; export the CSVs before the event.

---

### Where this is documented in the repo

| Topic | File |
| ----- | ---- |
| Full table reference, roles, RLS rules, storage buckets | [`supabase/README.md`](../supabase/README.md) |
| Stack, pages, env var table, security model, deployment | [`README.md`](../README.md) |
| Every variable, with what breaks without it | [`.env.example`](../.env.example) |
| The checks behind "it works" | [`scripts/verify-db.mjs`](../scripts/verify-db.mjs), [`scripts/verify-web.mjs`](../scripts/verify-web.mjs) |
