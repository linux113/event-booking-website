# Go live — every step in plain language

This guide assumes **nothing**. Do the steps **in order**.  
Each block ends with a **CHECK** — if the check fails, stop and fix it before continuing. Do not “skip ahead and fix later.”

---

## 0. What you are building (2 minutes of reading)

You will put this booking website on the internet so real people can open it.

| Piece | What it is | Like… |
| ----- | ---------- | ----- |
| **Website code** | This repo (Next.js) | The shop |
| **Vercel** | Company that runs the website 24/7 | The landlord / electricity |
| **Neon** | Company that stores data (Postgres) | The ledger / accounts book |
| **Razorpay** | Company that takes card/UPI payments | The cash register |
| **Vercel Blob** | Stores Gallery photos only; the homepage hero WebP is stored in Neon | The gallery shelf; hero art stays in the event record |
| **Admin login** | Only you sign in with email + password | The shop key |

**Important rules**

1. **Never** paste passwords, database URLs, or secrets into GitHub or chat.  
2. **Never** put secrets in variable names that start with `NEXT_PUBLIC_` (those are public).  
3. Do steps **in this order**: local checks → database → Vercel settings → first deploy → payments.

**Accounts you need**

- [ ] GitHub account (you already have the repo)  
- [ ] [Vercel](https://vercel.com) account (free tier is OK to start)  
- [ ] [Neon](https://neon.com) account (Postgres database)  
- [ ] [Razorpay](https://dashboard.razorpay.com) account (test mode is free)  
- [ ] A computer with **Node.js 22** and this project cloned  

---

## PART A — Check the code on your computer first

Do this **before** creating any paid/cloud resources. You already passed these in the migration; run them again so you know the merge is clean.

### A1. Open a terminal in the project folder

```bash
cd /path/to/event-booking-website   # your clone path
git status                          # should show your branch, e.g. arena/…
```

### A2. Install and prove the project builds

```bash
npm install
npm run db:generate      # creates the database “remote control” (Prisma client)
npm run typecheck        # TypeScript errors? must say nothing / exit 0
npm run lint             # ESLint: “0 errors” is enough (warnings OK)
npm run build            # production build; must finish without error
```

**CHECK A2:** every command above finishes without an error.  
If `typecheck` or `build` fails, fix code first — cloud setup will only waste your time.

### A3. Run the project’s own tests

```bash
npm run test:prisma      # expect: 25 passed, 0 failed (includes the Neon hero-image lifecycle)
npm run test:normalise   # expect: 21 passed, 0 failed
npm run test:settings    # expect: 9 passed, 0 failed (includes the WhatsApp icon)
npm run test:gallery-upload # expect: 8 passed, 0 failed
npm run test:hero-image  # expect: 7 passed, 0 failed
npm run db:setup:test    # expect: 20 passed, 0 failed
```

**CHECK A3:** all tests report zero failures.

### A4. Merge the feature branch to `main` (so Vercel can deploy it)

Vercel normally deploys the branch called **`main`**. Keep your work on its current
feature branch, push it, then open a pull request to `main`:

```bash
git push origin "$(git branch --show-current)"
```

On GitHub, choose **Pull requests → New pull request**, set base to `main` and compare
to your feature branch, review the diff and checks, then merge the pull request.

**CHECK A4:** On GitHub, `main` includes
`supabase/migrations/20260924090000_database_hero_image.sql` and the Event settings
hero-image feature.

---

## PART B — Create the database (Neon) and fill it with tables

You will do this **only on your computer**, not inside Vercel yet.

### B1. Create a Neon project

1. Go to https://neon.com → **Sign up** (GitHub login is fine).  
2. **Create project**.  
   - Name: e.g. `event-booking`  
   - Region: **Mumbai** / **Asia Pacific (Mumbai)** if offered (same area as Vercel `bom1`).  
3. Click **Create** / **Continue**.

### B2. Copy TWO connection strings (this confuses everyone — read carefully)

Neon’s **Connect** / **Dashboard** page shows something like:

```
postgresql://neondb_owner:PASSWORD@ep-xxx-abc.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
```

and a second one whose host contains **`-pooler`**:

```
postgresql://neondb_owner:PASSWORD@ep-xxx-abc-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
```

| Which one | Host looks like | Use it for |
| --------- | --------------- | ---------- |
| **Direct** | `ep-xxx-abc.neon.tech` (**no** `-pooler`) | **Only** running `npm run db:setup` (creating tables) |
| **Pooled** | `ep-xxx-abc-pooler.neon.tech` (**has** `-pooler`) | The **app** on Vercel (`DATABASE_URL`) |

**For BOTH strings, edit the text before you use it:**

1. Keep `sslmode=require`  
2. **Delete** `channel_binding=require` (and the `&` or `?` that attached it) if present  

Why: Node.js does not understand `channel_binding` and the connection fails.

Save both cleaned strings in a notes app / password manager. **Do not** put them in GitHub.

### B3. Generate your admin password hash + secret (on your computer)

Open a terminal **in the project folder** and run these one at a time.

**Command 1 — password hash** (replace `YourStrongPasswordHere` with your real password):

```bash
node -e "const c=require('crypto');const s=c.randomBytes(16).toString('hex');const h=c.scryptSync(process.argv[1],Buffer.from(s,'hex'),64).toString('hex');console.log('scrypt$'+s+'$'+h)" 'YourStrongPasswordHere'
```

Output looks like:

```
scrypt$a1b2c3…$9f8e7d…
```

Copy the **whole** line including `scrypt$`. That is `ADMIN_PASSWORD_HASH`.  
You will type the **original password** only on the login screen — never the hash as your password.

**Command 2 — AUTH_SECRET** (signs the login cookie):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the long hex string.

**CHECK B3:** you have saved:

- [ ] password (the one you typed)  
- [ ] `scrypt$…` hash  
- [ ] 64-character hex `AUTH_SECRET`  
- [ ] direct Neon URL (cleaned)  
- [ ] pooled Neon URL (cleaned)  

### B4. Create all tables in Neon (run from your computer)

Still in the project folder:

```bash
npm run db:generate

DATABASE_URL='粘贴DIRECT直接连接字符串在这里' npm run db:setup -- --seed
```

Replace `粘贴DIRECT…` with your **direct** (non-pooler) URL from B2, including quotes as shown.

What this does in plain words:

1. Creates a small helper schema (`auth.uid`) the SQL expects on a bare Postgres.  
2. Runs every file in `supabase/migrations/` in order (including the homepage hero-image `bytea` migration).
3. Runs `supabase/seed.sql` (demo event, 9 nights, 5 pass types) because you passed `--seed`.  
4. Checks the end state and prints success / failure.

For an existing Neon database, this safe re-run applies the new pending migration only.
You may instead run `supabase/migrations/20260924090000_database_hero_image.sql` by
itself in Neon SQL Editor. Do not paste the full one-shot schema into an existing database.

**Re-running is safe.** It remembers what it already applied.

**If it fails:** read the error. Common causes: wrong URL (used pooler), still has `channel_binding`, wrong password, or used the pooler for long DDL.

### B5. CHECK the database by looking at Neon (no app yet)

1. Neon Dashboard → your project → **SQL Editor** (or “Queries”).  
2. Paste each snippet and **Run**.

**Check 1 — tables exist:**

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
order by table_name;
```

You should see names like: `bookings`, `check_ins`, `digital_passes`, `event_dates`, `event_features`, `event_highlights`, `events`, `gallery`, `pass_categories`, `payment_events`.  
You should **not** see `admin_users` or `roles`.

**Check 2 — no customer email column:**

```sql
select column_name
from information_schema.columns
where table_name = 'bookings'
  and column_name like '%email%';
```

Result must be **0 rows**.

**Check 3 — booking function has no email argument:**

```sql
select proname, pg_get_function_identity_arguments(oid)
from pg_proc
where proname = 'create_pending_booking';
```

The arguments list must **not** contain `p_customer_email`.

**Check 4 — seed data:**

```sql
select slug, name, status from public.events;
select count(*) as nights from public.event_dates;
select count(*) as passes from public.pass_categories;
```

Expect: 1 event (slug like `navratri-2026-jaipur`), **9** nights, **5** passes (if you used `--seed`).

**Check 5 — gate functions exist:**

```sql
select proname from pg_proc
where proname in ('scan_pass', 'check_in_pass', 'admin_default_event_id');
```

Expect those names listed.

**CHECK B5:** all five checks OK.  
If Check 2 or 3 fails, migrations didn’t finish — go back to B4 (re-run setup) before any Vercel work.

---

## PART C — Local website against real Neon (still no Vercel)

Goal: prove **your computer → Neon** works before involving the host.

### C1. Create `.env.local`

```bash
cp .env.example .env.local
```

Open `.env.local` in any editor. Fill:

```bash
NEXT_PUBLIC_SITE_URL=http://localhost:3000

# POOLED URL from B2 (has -pooler, no channel_binding)
DATABASE_URL=ppostgresql://…-pooler…?sslmode=require

NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_test_xxxxxxxx
RAZORPAY_KEY_SECRET=your_test_secret

RAZORPAY_WEBHOOK_SECRET=          # leave empty for now (webhook comes later)

ADMIN_EMAIL=yourname
ADMIN_PASSWORD_HASH=scrypt$…your hash from B3…
AUTH_SECRET=…your hex from B3…

BLOB_READ_WRITE_TOKEN=            # optional until gallery
RAZORPAY_ALLOW_LIVE=              # leave empty always for now
```

`.env.local` is git-ignored — safe. Still never commit it.

### C2. Start the site

```bash
npm run dev
```

Browser: http://localhost:3000

### C3. Local CHECK list

| Step | Do this | Pass looks like |
| ---- | ------- | ----------------- |
| 1 | Open `/` | Festival name from database (not “Database not connected”) |
| 2 | Open `/passes` | 5 pass types with ₹ prices |
| 3 | Open `/book` | You can pick a night |
| 4 | Open `/admin` while logged out | Jumps to `/admin/login` |
| 5 | Login with your password + `ADMIN_EMAIL` | Dashboard with numbers |
| 6 | Wrong password | Generic “details did not match” (not a crash) |
| 7 | Neon → Monitoring / History | You see queries when you refresh pages |

**CHECK C:** steps 1–7 all pass.  
Ctrl+C stops the server when done.

If step 1 fails: `DATABASE_URL` empty, wrong password, or still has `channel_binding`, or you used the wrong (non-pooler vs pooler) host.

---

## PART D — Razorpay and photo storage (accounts only)

### D1. Razorpay TEST keys

1. https://dashboard.razorpay.com → sign up / log in → complete basic profile if asked.  
2. Stay in **Test Mode** (toggle usually says Test vs Live — stay on **Test**).  
3. **Settings → API Keys → Generate Key**.  
4. You get:  
   - **Key ID** → `rzp_test_…` → this is `NEXT_PUBLIC_RAZORPAY_KEY_ID`  
   - **Key Secret** → only shown once → `RAZORPAY_KEY_SECRET`  

Copy both into your password manager. Do **not** commit them.

Leave `RAZORPAY_ALLOW_LIVE` **empty**. The app refuses live keys until you set it to `true` on purpose.

**You will create the webhook later (Part F)** — after the website has a real domain. Checkout can be tested before the webhook exists.

### D2. Vercel account + Blob storage

1. https://vercel.com → **Sign up** with GitHub.  
2. You will create the project in Part E.  
3. For photos: after the project exists → project → **Storage → Blob → Create**.  
   Vercel then provides `BLOB_READ_WRITE_TOKEN` automatically when the store is linked, **or** you copy the token into env vars yourself.

Gallery can wait until after the first deploy; only Gallery needs Blob. The homepage hero is stored in Neon and does not need a Blob token.

**CHECK D:** you have saved test Key ID + Key Secret. Vercel account can log in with GitHub.

---

## PART E — Create the Vercel project and paste environment variables

### E1. Import the repository

1. Vercel → **Add New… → Project**.  
2. Import **linux113/event-booking-website** (grant GitHub access if asked).  
3. Framework preset: **Next.js** (auto-detected).  
4. Build Command: leave default (`npm run build`).  
5. **Do not click Deploy yet** (or if you do, you’ll get a “not connected” shell — that’s OK but confusing). Prefer setting env first.

### E2. Production branch

**Settings → Git → Production Branch** → set to **`main`** (after Part A merge).

### E3. Environment variables (type each carefully)

**Settings → Environment Variables.**  
Add each key for **Production** (and again for **Preview** if you want previews to work).

| # | Name (exact) | Value (from where) | Public? |
| - | ------------ | ------------------ | ------- |
| 1 | `NEXT_PUBLIC_SITE_URL` | `https://your-domain.com` **or** for now `https://your-app.vercel.app` | Public |
| 2 | `DATABASE_URL` | **Pooled** cleaned Neon URL (B2) | **Secret** |
| 3 | `NEXT_PUBLIC_RAZORPAY_KEY_ID` | `rzp_test_…` (D1) | Public |
| 4 | `RAZORPAY_KEY_SECRET` | test secret (D1) | **Secret** |
| 5 | `RAZORPAY_WEBHOOK_SECRET` | fill in Part F (can add empty later) | **Secret** |
| 6 | `ADMIN_EMAIL` | your admin email (C1) | **Secret** |
| 7 | `ADMIN_PASSWORD_HASH` | `scrypt$…` (B3) | **Secret** |
| 8 | `AUTH_SECRET` | hex (B3) | **Secret** |
| 9 | `BLOB_READ_WRITE_TOKEN` | from Blob store (D2) — can add later | **Secret** |
| 10 | `RAZORPAY_ALLOW_LIVE` | leave **empty** / do not set `true` | **Secret** |

**How to paste a multi-line / special URL:** Vercel sometimes wraps values — paste on one line.

**Never add:** `NEXT_PUBLIC_DATABASE_URL`, `NEXT_PUBLIC_AUTH_SECRET`, anything `SUPABASE_*`.

**CHECK E:** Environment Variables list shows **all required names** with values (webhook secret may be pending until F). Red badge / empty value = not saved.

### E4. Custom domain (optional but needed before real QR printing)

1. Vercel → project → **Domains** → enter `www.yourdomain.com` (or apex).  
2. At your DNS registrar, add the records Vercel shows (A / CNAME).  
3. Wait until status is **Valid**.  
4. Then set `NEXT_PUBLIC_SITE_URL` to exactly `https://yourdomain.com` (no trailing `/`) and **Redeploy**.

Until you have a domain, use `https://your-app.vercel.app` as `NEXT_PUBLIC_SITE_URL`.

---

## PART F — First deploy and smoke test (still no real money)

### F1. Deploy

1. Vercel → **Deployments** → **Redeploy** (or push to `main` to trigger).  
2. Wait for **Ready**. Build log should show Prisma generate + Next build success.

### F2. Open the site and walk this checklist (print / tick)

Open `https://your-domain-or-vercel.app/`:

| # | Click / URL | PASS condition |
| - | ----------- | -------------- |
| 1 | `/` | Shows event name from DB — **not** “Database not connected” |
| 2 | `/passes` | Prices and pass names |
| 3 | `/events` or home dates | Nights visible |
| 4 | `/book` | Wizard starts; night list loads |
| 5 | Browser in private window: `/admin` | Redirects to `/admin/login` |
| 6 | Login with admin user + **your password** | Dashboard opens; stats not all zero if seed exists |
| 7 | `/admin/bookings` | Page opens (may be empty) |
| 8 | `/gallery` | Opens (may be empty) |
| 9 | View Page Source → search `supabase` | No matches |
| 10 | Neon query history | New queries when you reload (proves Vercel → Neon) |

**CHECK F (Gate before payments):** **all 10 pass.**

If #1 fails → fix `DATABASE_URL` on Vercel and redeploy.  
If #6 fails → check all three: `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `AUTH_SECRET` (Production scope).  
If #10 fails → Vercel isn’t really using your DB (wrong URL or env not applied to Production).

**Do not set up the webhook or take a booking until CHECK F passes.**

---

## PART G — Wire payments end-to-end (now the domain is real)

### G1. Create the Razorpay webhook

1. Razorpay Dashboard → **Settings → Webhooks → Add New Webhook**.  
2. **URL:** `https://YOUR-DOMAIN/api/payment/webhook`  
3. **Secret:** click generate / type a long random string → save it.  
4. **Events:** `payment.captured`, `payment.failed`, `refund.processed`  
   (`order.paid` optional).  
5. Save.

### G2. Put that secret on Vercel

1. Vercel → Environment Variables → add/update `RAZORPAY_WEBHOOK_SECRET` = the webhook secret from G1.  
2. **Deployments → Redeploy** (so the server definitely has it).

### G3. Test one full booking (TEST money, not real)

1. Open `https://YOUR-DOMAIN/book`  
2. Night → Pass → form: **Full Name + Mobile only** (there is no email field — correct).  
3. Continue to review → **Pay** → Razorpay Checkout opens.  
4. Use Razorpay’s **test** card / test UPI (they document e.g. success cards in their dashboard under “Test Cards”).  
5. Complete payment.

**You should land on a success page** listing booking id and pass(es).

### G4. Verify each system saw it

| Where | What to open | PASS |
| ----- | ------------ | ---- |
| Site | `/booking/success` (or link from flow) | Pass IDs listed |
| Admin | `/admin/bookings` | Your booking; payment status paid/confirmed |
| Admin | `/admin/payments` | Events / outcomes recorded (after verify and/or webhook) |
| Pass | Click a pass | QR image; URL host is **your domain** (not localhost) |
| Razorpay | Payments (test) | Your payment shows captured |
| Neon | SQL: `select payment_status, booking_status from public.bookings order by created_at desc limit 5;` | Top row paid/confirmed |

### G5. Gate / scanner test (phone)

1. Phone browser → `https://YOUR-DOMAIN/admin/login` → sign in.  
2. `/admin/scanner` → allow camera (HTTPS required — works on domain, not `http://LAN-IP`).  
3. Scan the QR from the pass (open pass on another screen or print).  
4. **First scan:** VALID → tap CHECK IN.  
5. **Second scan of same pass:** ALREADY CHECKED IN (must refuse).

**CHECK G:** booking paid + pass works + double scan refused + webhook appears in Razorpay delivery logs (Razorpay → Webhooks → dashboard “Success”).

If payment succeeds on Razorpay but site stays unpaid:

- Webhook URL wrong, or  
- `RAZORPAY_WEBHOOK_SECRET` doesn’t match, or  
- Webhook not hitting production.  

Check Razorpay → Webhooks → **View Webhook History / logs** for status codes.

---

## PART H — Homepage hero + Gallery images

### H1. Homepage hero (stored in Neon)

1. Confirm migration `20260924090000_database_hero_image.sql` has been applied (see B4).
2. Sign in → **Event settings** → **Homepage hero image** → upload or replace a photo.
3. The server optimizes and stores it as WebP bytes in Neon. No Gallery row, Blob store or `BLOB_READ_WRITE_TOKEN` is involved.
4. Use **Remove and restore diya** to return the homepage to its built-in artwork.

**CHECK H1:** upload/replacement appears beside **Book Now**; removal restores the diya.

### H2. Gallery (stored in Vercel Blob)

1. Vercel → project → **Storage → Blob → Create store** (if not done).  
2. Ensure `BLOB_READ_WRITE_TOKEN` is set (UI link often does this) → redeploy if you added it manually.  
3. `/admin/login` → **Gallery** → upload a JPG/PNG.  
4. Fill caption / alt → **Publish**.  
5. Public `/gallery` shows the image.

**CHECK H2:** image appears publicly; delete in admin removes it.

---

## PART I — Final checklist before you tell anyone the URL

- [ ] Code merged to `main`; Vercel Production Branch = `main`  
- [ ] All env vars set on **Production** (list in E3)  
- [ ] `NEXT_PUBLIC_SITE_URL` = final domain; **redeployed** after setting it  
- [ ] Still using **test** Razorpay keys (`rzp_test_`) until you’re ready to charge  
- [ ] Webhook URL is `https://domain/api/payment/webhook` and secret matches  
- [ ] Admin password strong; hash only in Vercel; password only in your password manager  
- [ ] No secrets in GitHub (`git status` clean; no `.env.local` committed)  
- [ ] Neon: schema applied **once**; seed replaced with **real** event/nights/prices  
- [ ] Contact page: phone, organiser email, WhatsApp, venue filled in database  
- [ ] Scanner tested on a real phone over HTTPS  
- [ ] You understand Vercel Hobby may require **Pro** if you sell tickets commercially  

### Going “real money” later (only after a full test E2E)

1. Razorpay → complete KYC if needed → create **Live** keys.  
2. Vercel: set `NEXT_PUBLIC_RAZORPAY_KEY_ID` = `rzp_live_…`, `RAZORPAY_KEY_SECRET` = live secret.  
3. Set `RAZORPAY_ALLOW_LIVE=true`.  
4. Update webhook secret if you recreate the webhook for live.  
5. **Redeploy.**  
6. Do one small real payment end-to-end before announcing.

---

## Troubleshooting — what the message usually means

| You see | It means | Fix |
| ------- | -------- | --- |
| “Database not connected” | App has no `DATABASE_URL` on that deployment | Set pooled URL on Production; redeploy |
| Login: “not configured” | Admin env incomplete | Set all three: username, hash, AUTH_SECRET |
| Login: “details did not match” | Wrong password or wrong email | Retype password (not the hash) |
| Checkout never opens | Razorpay keys missing or live without allow | Check key id/secret; leave test keys |
| Paid but site unpaid | Webhook/verify failed | G1–G2; check Razorpay webhook logs |
| QR opens localhost | Old `NEXT_PUBLIC_SITE_URL` | Set domain; redeploy |
| Gallery: needs Blob token | No `BLOB_READ_WRITE_TOKEN` | Create Blob store; link; redeploy |
| `db:setup` connection error | Wrong string for migrations | Use **direct** URL; remove `channel_binding` |
| Build fails only locally on Prisma engines | Restricted network | Vercel build usually fine; retry online |

---

## One-page summary (the whole thing)

1. Build green on your machine → merge to **`main`**.  
2. Create **Neon** → clean **direct** URL → `npm run db:setup -- --seed` → run 5 SQL checks.  
3. Create password hash + `AUTH_SECRET` → fill **`.env.local`** with **pooled** URL → `npm run dev` → site shows real data + admin login works.  
4. Razorpay **test** keys.  
5. **Vercel** → import repo → paste all env vars (E3) → optional domain.  
6. Deploy → smoke checklist **F2 (10 items)** — all pass.  
7. Razorpay **webhook** → secret into Vercel → redeploy.  
8. Full test booking → paid → pass → scan twice (second refused) → gallery upload.  
9. Replace seed with real content → lock `NEXT_PUBLIC_SITE_URL` → only then think about live keys.

If any **CHECK** fails, stop at that part, fix only that part, re-run that CHECK, then continue.  
When stuck, write down: **which Part letter (A–I), which CHECK number, and the exact error text.**
