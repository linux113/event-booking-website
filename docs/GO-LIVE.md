# Go-live runbook — Neon → local check → Vercel → end-to-end

Order matters: **build the database first, prove it locally, then wire Vercel, then open the money path.**  
Each phase has a **Gate** you must pass before the next phase. Do not skip gates.

**Final stack reminders**

| Piece | Value |
| ----- | ----- |
| Database | Neon PostgreSQL (pooled URL at runtime) |
| Schema apply | `npm run db:setup` with the **direct** URL (or paste `docs/one-shot-schema.sql` **once**) |
| App host | Vercel, region `bom1` (Mumbai) — already in `vercel.json` |
| Storage | Vercel Blob (`BLOB_READ_WRITE_TOKEN`) — no files in Neon |
| Payments | Razorpay **test** keys first |
| Admin | One account: `ADMIN_EMAIL` + `ADMIN_PASSWORD_HASH` + `AUTH_SECRET` |
| Public URL | `NEXT_PUBLIC_SITE_URL` — set **before** any QR pass is printed |

**Never commit:** `.env.local`, connection strings, password hashes, Razorpay secrets, Blob tokens.

---

## Phase 0 — Repo ready (before any cloud wiring)

### 0.1 Merge branch → `main`

You are on `arena/01a0ce9c-event-booking-website` (session branch). Review `MIGRATION-REPORT.md`, then:

```bash
git status
# commit migration work on the arena branch if not already committed
git push origin arena/01a0ce9c-event-booking-website
# then in GitHub: open PR → merge into main
# or locally (only after review):
# git checkout main && git pull && git merge arena/01a0ce9c-event-booking-website && git push
```

Vercel Production Branch should be **`main`** (or whatever branch you deliberately deploy).

### 0.2 Local green build (already verified in migration; re-run after merge)

```bash
npm install
npm run db:generate
npm run typecheck    # must exit 0
npm run lint         # must exit 0 (warnings OK)
npm run build        # must exit 0
npm run test:prisma  # 18/18
npm run db:setup:test # 20/20
```

**Gate 0 — all six commands exit 0.** Do not create cloud resources on a red tree.

---

## Phase 1 — Neon database (standalone; no Vercel yet)

### 1.1 Create the project

1. [neon.tech](https://neon.tech) → Create project (region **Mumbai / ap-south-1** if offered — matches `bom1`).
2. From **Connect**, copy **two** strings:
   - **Pooled** (host contains `-pooler`) → will become app `DATABASE_URL`
   - **Direct** (no `-pooler`) → used **only** for `db:setup`
3. For **both** strings:
   - keep `sslmode=require`
   - **delete** `channel_binding=require` if present (Node will fail otherwise)

Store them in a password manager — never in git.

### 1.2 Apply schema + seed (direct URL only)

From your machine, repo root:

```bash
# Optional sanity: generate client (no DB needed)
npm run db:generate

# Apply everything (20 sections: prelude + 18 migrations + seed)
DATABASE_URL='postgresql://USER:PASS@HOST/dbname?sslmode=require' \
  npm run db:setup -- --seed
```

Expected: every section applied, then end-state checks pass (tables, public-read policies, stranger refused on bookings).

Re-running is safe (bookkeeping in `setup.applied_migrations`).

**Alternative (SQL editor only):** Neon → SQL → paste `docs/one-shot-schema.sql` **once** and run.  
Do **not** paste the same file twice. Do **not** paste individual migration files by hand unless you know the order.

### 1.3 Verify the database before anything connects to it

In Neon SQL Editor (or `psql`):

```sql
-- 1) Core tables exist
select table_name from information_schema.tables
 where table_schema = 'public'
 order by table_name;
-- expect: bookings, check_ins, digital_passes, event_dates, event_features,
--         event_highlights, events, gallery, pass_categories, payment_events
--         (+ nothing like admin_users, roles)

-- 2) No customer email column
select column_name from information_schema.columns
 where table_name = 'bookings' and column_name like '%email%';
-- expect: 0 rows

-- 3) Seed loaded (if you used --seed or seeded one-shot)
select slug, name, status from public.events;
select count(*) as nights from public.event_dates;     -- 9 with seed
select count(*) as passes from public.pass_categories; -- 5 with seed

-- 4) Booking API still exists without email args
select proname, pg_get_function_identity_arguments(oid)
  from pg_proc
 where proname = 'create_pending_booking';
-- expect: one function; arguments must NOT include p_customer_email

-- 5) Gate functions present
select proname from pg_proc
 where proname in ('scan_pass','check_in_pass','admin_default_event_id');
```

**Gate 1 — schema applied once, seed counts match, no email column, functions present.**  
If `create_pending_booking` still has `p_customer_email`, the no-email migration did not run — stop and fix before Vercel.

### 1.4 Optional: local app against Neon (proves the pooler)

```bash
cp .env.example .env.local
# Edit .env.local:
#   DATABASE_URL=  <POOLED string, no channel_binding>
#   NEXT_PUBLIC_RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET  <Razorpay test keys>
#   RAZORPAY_WEBHOOK_SECRET=  <can fill after webhook step; empty fails webhook only>
#   ADMIN_EMAIL / ADMIN_PASSWORD_HASH / AUTH_SECRET
#   BLOB_READ_WRITE_TOKEN=  <optional until gallery>
#   NEXT_PUBLIC_SITE_URL=  leave localhost for local

# Generate admin hash + AUTH_SECRET:
node -e "const c=require('crypto');const s=c.randomBytes(16).toString('hex');const h=c.scryptSync(process.argv[1],Buffer.from(s,'hex'),64).toString('hex');console.log('scrypt$'+s+'$'+h)" 'YourStrongPasswordHere'
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

npm run dev
```

**Gate 1b — local checks:**

| URL / action | Pass looks like |
| ------------ | --------------- |
| `http://localhost:3000/` | Real event name from Neon (not “Database not connected”) |
| `/passes` | Five pass types with prices |
| `/admin` (signed out) | Redirect to `/admin/login` |
| `/admin/login` | Wrong password → vague error; correct → dashboard with stats |
| Neon dashboard → Monitoring | Queries appear when you load pages |

If home says not connected: `DATABASE_URL` empty or still has `channel_binding`.

**Stop here until Gate 1 + 1b pass.** Do not import into Vercel yet.

---

## Phase 2 — Razorpay + Blob (still independent of Vercel deploy)

### 2.1 Razorpay test keys

1. Razorpay Dashboard → Settings → **API Keys** → Generate **Test** key pair.  
   - `NEXT_PUBLIC_RAZORPAY_KEY_ID` = `rzp_test_…`  
   - `RAZORPAY_KEY_SECRET` = secret (server only)
2. Leave **`RAZORPAY_ALLOW_LIVE` empty** until you deliberately go live. Live keys are refused while it is not exactly `true`.
3. Webhook — **after** the production domain exists (Phase 3), create:
   - URL: `https://<your-domain>/api/payment/webhook`
   - Events: `payment.captured`, `payment.failed`, `refund.processed` (`order.paid` optional)
   - Secret → `RAZORPAY_WEBHOOK_SECRET`

For local-only testing before domain exists you can create a webhook later; Checkout + `/api/payment/verify` can still complete a test payment without the webhook (webhook is for server-side confirmation when the browser never returns).

### 2.2 Vercel Blob

1. Vercel (same team/project you will use) → **Storage → Blob → Create store**.
2. Vercel injects `BLOB_READ_WRITE_TOKEN` into functions when the store is connected to the project — or copy the token manually into env vars.
3. Gallery upload fails with a clear message until this is set; public pages work without it.

**Gate 2 — test keys in hand; Blob store created; no live keys in any draft env.**

---

## Phase 3 — Vercel project + environment (wire config, still controlled deploy)

### 3.1 Import the repo

1. Vercel → **Add New → Project** → import `linux113/event-booking-website`.
2. Framework: Next.js (auto). Leave build command `npm run build` (runs `prisma generate` — no DB needed at build).
3. **Settings → Git → Production Branch** = `main` (after merge).
4. Do **not** deploy until env vars in §3.2 are saved (or accept one “shell” deploy first).

### 3.2 Environment variables (Production **and** Preview)

Exact names from `.env.example` — no Supabase variables exist:

| Key | Scope | Value source | Notes |
| --- | ----- | ------------ | ----- |
| `NEXT_PUBLIC_SITE_URL` | Production | `https://<final-domain>` | **Inlined at build.** QR base URL. Change ⇒ redeploy. |
| `DATABASE_URL` | Production | Neon **pooled** URL | Strip `channel_binding`; keep `sslmode=require`. Server only. |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | Production | `rzp_test_…` | Public (Checkout). |
| `RAZORPAY_KEY_SECRET` | Production | test secret | Server only. |
| `RAZORPAY_WEBHOOK_SECRET` | Production | from webhook create | Server only. Can add in same step as webhook. |
| `ADMIN_EMAIL` | Production | your admin email | Server only. |
| `ADMIN_PASSWORD_HASH` | Production | `scrypt$salt$hash` | Server only. Generate locally; paste hash only. |
| `AUTH_SECRET` | Production | 32+ random bytes | Server only. Signs `gn_admin`. |
| `BLOB_READ_WRITE_TOKEN` | Production | Blob store | Server only; or connect store in UI. |
| `RAZORPAY_ALLOW_LIVE` | Production | *(leave unset)* | Set `true` only when going live. |

Repeat for **Preview** if you want branch previews to work (`DATABASE_URL` can point at the same Neon DB or a separate branch DB).

**Never** prefix secrets with `NEXT_PUBLIC_`.

### 3.3 Domain

1. Project → Settings → Domains → add production domain.
2. After DNS is live, set `NEXT_PUBLIC_SITE_URL=https://exact-domain` (no trailing slash) and **Redeploy** so QR/OG URLs bake in.

**Gate 3 — env panel shows all required keys; domain status “Valid” (or you are still on `*.vercel.app` and using that as SITE_URL).**

---

## Phase 4 — First production deploy (before full payment wiring)

Deploy `main`. Watch build logs: Prisma generate + Next build must succeed.

### 4.1 Smoke checklist (no money yet)

Open `https://<domain>/`:

| # | Check | Pass |
| - | ----- | ---- |
| 1 | Home | Event content from DB, **not** “Database not connected” |
| 2 | `/passes` | Prices render |
| 3 | `/book` step 1 | Nights selectable / list loads |
| 4 | `/admin` signed out | 307 → `/admin/login` |
| 5 | `/admin/login` | Env credentials work → `/admin` dashboard numbers |
| 6 | `/admin/bookings` | Empty or seeded list, no 500 |
| 7 | `/gallery` | Renders (empty OK) |
| 8 | View source | No `SUPABASE`, no `service_role` strings |
| 9 | Response headers on `/admin/*` | Site not open to anonymous admin HTML |
| 10 | Neon → Queries | Hits when you load pages (proves pooled URL from Vercel) |

If home is “not connected”: `DATABASE_URL` missing/wrong on Production, or still `channel_binding`, or non-pooler host blocked.

If admin login unavailable: all three of `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `AUTH_SECRET` must be non-empty on Production.

**Gate 4 — public site + admin login work on Vercel against Neon.**  
Only now wire payments fully.

---

## Phase 5 — End-to-end wiring (payments, webhook, scanner, gallery)

### 5.1 Complete Razorpay webhook (domain is real now)

1. Razorpay → Webhooks → Add  
   `https://<domain>/api/payment/webhook`  
   Events: `payment.captured`, `payment.failed`, `refund.processed`
2. Copy secret → Vercel `RAZORPAY_WEBHOOK_SECRET` → **Redeploy** (env is read at runtime for server vars; redeploy still safest).

### 5.2 Full booking → payment → pass (test mode)

1. `/book` → night → pass → **Full Name + Mobile only** (no email field) → review.
2. Checkout opens with **server** amount (₹ … from DB).
3. Razorpay test success page (use test card/UPI from Razorpay docs).
4. Land on `/booking/success` → pass IDs listed.
5. Open a pass → QR present; URL uses `NEXT_PUBLIC_SITE_URL`.
6. `/admin/bookings` → booking **paid/confirmed**.
7. `/admin/payments` → delivery rows / outcome after webhook or verify.
8. `/admin/scanner` on a **phone over HTTPS** → scan → VALID → CHECK IN.
9. Scan again → ALREADY CHECKED IN.

If verify works but never “paid”: browser returned but webhook secret wrong — fix §5.1.  
If Checkout never opens: missing `RAZORPAY_KEY_SECRET` or live key without `RAZORPAY_ALLOW_LIVE`.

### 5.3 Gallery

1. `/admin/gallery` → upload image → stored (Blob) → publish.
2. Public `/gallery` shows it.
3. Delete removes row + object.

Failure text will name `BLOB_READ_WRITE_TOKEN` if unset.

### 5.4 CSV + catalogue admin

- Export bookings CSV (name, mobile, amount present for single admin).
- Edit a night capacity / pass price → public pages reflect after revalidate.

**Gate 5 — booking paid, pass issued, double check-in refused, webhook/verify recorded, gallery upload works.**

---

## Phase 6 — Pre-launch hardening checklist

- [ ] Merge to `main`; Vercel Production Branch = `main`
- [ ] `NEXT_PUBLIC_SITE_URL` = final custom domain; **redeployed** after set
- [ ] Razorpay still **test** (`rzp_test_`) until ready for money
- [ ] Webhook URL is production HTTPS, secret matches env
- [ ] Strong admin password hash; `AUTH_SECRET` random; neither in git
- [ ] Neon: direct URL used only for setup; pooled in Vercel only
- [ ] No `channel_binding` in any runtime URL
- [ ] Blob store connected; no large binaries in Postgres
- [ ] Seed event replaced with real event/nights/prices (SQL or admin UI)
- [ ] Contact columns filled (`contact_phone`, `contact_email`, WhatsApp, venue, maps)
- [ ] Brand placeholder in `src/config/site.ts` updated if used
- [ ] Test scanner on real phones (HTTPS + camera permission)
- [ ] Vercel Hobby: confirm commercial use terms if you will **sell** tickets (may need Pro)
- [ ] Going live later: swap to `rzp_live_…`, set `RAZORPAY_ALLOW_LIVE=true`, rebuild — **after** a full test-mode E2E

---

## Phase 7 — “Is everything wired?” quick matrix

| Layer | Configure in | Runtime proof |
| ----- | ------------ | ------------- |
| Schema | Local `db:setup` or one-shot paste | SQL checks §1.3 |
| App ↔ DB | Vercel `DATABASE_URL` (pooled) | Home shows live rows |
| Admin auth | Vercel `ADMIN_*` + `AUTH_SECRET` | `/admin/login` works; `/admin` redirects when signed out |
| Checkout | Vercel `NEXT_PUBLIC_RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` | Checkout opens with server amount |
| Webhook | Razorpay URL + Vercel `RAZORPAY_WEBHOOK_SECRET` | `/admin/payments` receives events; booking paid if browser closed |
| QR base | Vercel `NEXT_PUBLIC_SITE_URL` | Pass QR host = production domain |
| Gallery | Blob store / `BLOB_READ_WRITE_TOKEN` | Upload + public `/gallery` |
| Gate | HTTPS domain + session | Scanner VALID once, refused second time |

---

## Troubleshooting quick reference

| Symptom | Likely fix |
| ------- | ---------- |
| “Database not connected” on Vercel | Empty/wrong `DATABASE_URL`; strip `channel_binding`; use `-pooler` host |
| `db:setup` fails mid-file | Re-run; resumes from `setup.applied_migrations`. Use **direct** URL |
| Login always fails | Hash must be `scrypt$salt$hash`; all three admin env vars set on Production |
| Checkout missing | Key id/secret missing; or live key without `RAZORPAY_ALLOW_LIVE=true` |
| Paid in Razorpay but site unpaid | Webhook secret mismatch or webhook URL wrong; check Razorpay webhook logs |
| QR opens localhost | `NEXT_PUBLIC_SITE_URL` still local — set + redeploy |
| Gallery upload error | `BLOB_READ_WRITE_TOKEN` / store not connected |
| Build fails on Prisma engines | Network; retry on Vercel (online) — local sandbox may need engine stub only |
| Wrong app on domain | Production Branch or domain bound to old project |

---

## What this environment could not do for you

- No Neon/Vercel/Razorpay credentials in this sandbox — **you** run Phases 1–5.
- Local automated proof already done: typecheck, lint, build, `test:prisma` 18/18, `test:normalise` 21/21, `test:settings` 8/8, `test:gallery-upload` 8/8, `db:setup:test` 20/20.
- Live E2E (real Neon + real Vercel + real Razorpay) starts at Gate 1.

**Recommended order (one line):** merge → local green → Neon create + `db:setup --seed` → SQL verify → local `.env.local` smoke → Vercel import + env + domain → deploy smoke (Gate 4) → webhook + full booking E2E (Gate 5) → harden → only then live keys.
