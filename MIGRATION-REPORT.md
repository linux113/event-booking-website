# Migration report — Neon + Prisma, single admin, no customer email

Branch: `arena/01a0ce9c-event-booking-website` (from `main` @ `e47a332`)  
Working tree: **92 paths changed** (90 in diff vs HEAD: +2,897 / −6,007), uncommitted on purpose so you can review before merge.

---

## 1. Files changed (high level)

| Area | What changed |
| ---- | ------------ |
| **Dependencies** | `package.json` / `package-lock.json` — removed all `@supabase/*`; added/kept `@neondatabase/serverless`, `@prisma/adapter-neon`, `@vercel/blob`, Prisma 7 |
| **Env** | `.env.example` rewritten (exact names below); `src/config/env.ts` reads only those |
| **DB client** | `src/lib/db/client.ts` — single `PrismaClient` + `PrismaNeon`, strips `channel_binding`, `sql` / `rpc` / `rpcScalar`, `withDb` |
| **Auth** | New `src/lib/auth/session.ts` (HMAC cookie + scrypt); `staff.ts` / `guard.ts` / `permissions.ts` reduced to single-admin shims; `src/app/admin/actions.ts` login/logout |
| **Edge gate** | `src/proxy.ts` — `/admin/*`, `/api/admin/*`, `/api/staff/*` |
| **Services** | All `src/lib/services/*` rewritten off Supabase to `sql`/`rpc` (typed row interfaces: dashboard, payments, passes, gallery, events, check-in, mappers) |
| **Gallery** | `src/lib/gallery/storage.ts` + `paths.ts` — Vercel Blob `put`/`head`+`fetch`/`del`; keys `gallery/<uuid>/{full,thumb}.webp` |
| **UI** | Login, header, tables, charts, empty/error states, booking steps — no email field; no “hidden for your role” copy; Email column removed from bookings table |
| **Admin routes** | Deleted `/admin/staff` (`staff/page.tsx`, `loading.tsx`) |
| **Types** | `src/types/database.ts` rewritten to lean row shapes (no Supabase Functions blob, no roles, no `customer_email`) |
| **Prisma** | `prisma/schema.prisma` + `prisma.config.ts` aligned (comment fix); generated client in `src/generated/prisma` |
| **Config** | `next.config.ts` — Supabase image hosts dropped |
| **SQL** | Existing chain kept + `20260923090000_single_admin.sql` + `20260923091000_no_customer_email.sql` (plain PostgreSQL); `prelude.sql` / `seed.sql` comments updated |
| **Docs** | `README.md` fully rewritten; `docs/neon-setup.md`, `docs/deploy-vercel.md` rewritten; historical banners on `docs/connect-free-supabase.md`, `supabase/README.md`, `docs/how-it-works.md`, `scripts/verify-db.mjs`, `scripts/verify-web.mjs` |

## 2. Files removed

- `src/lib/supabase/*` (entire directory: `client.ts`, `server.ts`, `admin.ts`, `public.ts`, `cookies.ts`, `.gitkeep`)
- `src/app/admin/(shell)/staff/page.tsx` and `loading.tsx` (`/admin/staff`)
- `@supabase/*` packages from `package.json`

## 3. Environment variables (exact)

From `.env.example` — no Supabase names exist:

| Name | Scope |
| ---- | ----- |
| `NEXT_PUBLIC_SITE_URL` | public |
| `DATABASE_URL` | server (Neon **pooled**, `sslmode=require`, no `channel_binding`) |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | public |
| `RAZORPAY_KEY_SECRET` | server |
| `RAZORPAY_WEBHOOK_SECRET` | server |
| `ADMIN_EMAIL` | server |
| `ADMIN_PASSWORD_HASH` | server (`scrypt$salt$hash`) |
| `AUTH_SECRET` | server |
| `BLOB_READ_WRITE_TOKEN` | server (Vercel Blob storage token, documented in `.env.example`) |
| `RAZORPAY_ALLOW_LIVE` | server (optional) |

Secrets are never `NEXT_PUBLIC_*` and never committed.

## 4. Build / type / lint results

| Command | Result |
| ------- | ------ |
| `npm install` | OK (no Supabase packages) |
| `npm run db:generate` | OK — Prisma Client **7.10.0** → `src/generated/prisma` |
| `npm run typecheck` | **exit 0** — 0 TypeScript errors |
| `npm run lint` | **exit 0** — **0 errors**, 16 unused-var **warnings** only |
| `npm run build` | **exit 0** — full Next production build, all routes |

(Prisma engine downloads blocked in this sandbox: `PRISMA_SCHEMA_ENGINE_BINARY=/tmp/schema-engine` stub for generate; not needed on a normal machine.)

## 5. Tests (where compatible)

| Script | Result |
| ------ | ------ |
| `npm run test:prisma` | **14 / 14 passed** — Prisma client + `create_pending_booking` / payment → one pass / `scan_pass` without staff id / double check-in refused / generated columns |
| `npm run db:setup:test` | **20 / 20 passed** — fresh apply (20 sections), re-run idempotent, resume, edited-file warning, one-shot paste |
| `npm run db:verify` / `npm run verify:web` | **Not run** — legacy harnesses still encode customer email, roles and Supabase Auth/storage doubles; flagged HISTORICAL in file headers and README |
| Live Neon apply / Vercel deploy | **Not run** — needs your credentials (sandbox has no Neon/Vercel access) |

## 6. Acceptance criteria status

| # | Criterion | Status |
| - | --------- | ------ |
| 1 | No Supabase runtime / env | ✅ `src/` has **zero** `supabase` strings; package/env/next.config clean |
| 2 | Single admin, hashed password, HTTP-only cookie, route+API protection | ✅ env credentials + `gn_admin` HMAC cookie; `/admin/staff` deleted; proxy + guards |
| 3 | No customer email | ✅ form/API/lists/pass/search clean; migration drops column; `events.contact_email` kept |
| 4 | Schema tables + DB guarantees + features kept | ✅ migrations 17–18 remove roles/email only; wizard, pricing, capacity, QR, scanner, CSV, dashboard, gallery CRUD, WhatsApp intact; Razorpay `/api/payment/*` not rewritten |
| 5 | Env names exactly as brief | ✅ see §3 |
| 6 | `.env.example`, README, `next.config`, docs | ✅ rewritten / bannered historical |
| 7 | install, generate, typecheck, lint, build, tests | ✅ see §4–5 |
| 8 | Search audit | ✅ see §7 |
| 9 | This 10-point report | ✅ |
| 10 | Work on session branch; merge to main yourself | ✅ `arena/01a0ce9c-event-booking-website` (session-pinned) |

## 7. Search audit classification

**Forbidden (must be absent from runtime `src/`):**

| Term | Result |
| ---- | ------ |
| `customerEmail` / `customer_email` | **0** in `src/` |
| `SUPER_ADMIN` | **0** |
| `/admin/staff` | **0** |
| `@supabase`, `createClient`, `NEXT_PUBLIC_SUPABASE*`, `SUPABASE_SERVICE*` | **0** |
| any `supabase` in `src/` (excl. `generated/`) | **0** |
| `supabase` in `package.json` / `.env.example` / `next.config.ts` | **0** |

**Allowed / classified remaining mentions:**

| Match class | Where | Why allowed |
| ----------- | ----- | ----------- |
| Historical docs | `docs/connect-free-supabase.md`, `supabase/README.md`, `docs/how-it-works.md` body | Bannered **HISTORICAL** |
| Migration SQL history | `supabase/migrations/*` (early files create then later drop email/roles) | Forward-only chain; final state has neither |
| Legacy harnesses | `scripts/verify-db.mjs`, `verify-web.mjs` | Header marks HISTORICAL; not in acceptance path |
| Path name `supabase/` | migrations/prelude/seed | Standard PostgreSQL; applied by `db:setup` |
| ARIA `role="…"` | many components | Accessibility, not authz |
| URL `/api/staff/*` | proxy, scanner, logout, check-in | Stable public API paths; single admin behind them |
| `StaffRole = "super_admin"` | `types/admin.ts`, `session.ts`, `permissions.ts` | Compatibility shim only; `can()` always true; no second role, no staff table |
| `events.contact_email` | schema, mappers, contact | Organiser email — required to stay |
| Column `check_ins` has no staff id | migration 17 dropped `checked_in_by` | Gate audit uses booking reference |

## 8. Security model (post-migration)

- Password: `scrypt$<salt>$<hash>` in `ADMIN_PASSWORD_HASH`, compared with `timingSafeEqual`
- Session: cookie `gn_admin` = `<exp>.<hex-hmac-SHA256(AUTH_SECRET)>`, 12h, HTTP-only, `sameSite=lax`, `secure` in production
- `src/proxy.ts` gates HTML (redirect) and APIs (JSON 401)
- No plaintext password in repo; no service-role key; no RLS dependency for app queries
- Razorpay amount/signature/webhook logic unchanged

## 9. What you still must do (credentials / merge)

1. Review the dirty tree and **merge** `arena/01a0ce9c-event-booking-website` → `main` (session cannot push other branches).
2. On Neon: apply schema with **direct** URL:  
   `DATABASE_URL='…' npm run db:setup -- --seed`  
   (or paste `docs/one-shot-schema.sql` **once**).
3. Set Vercel env vars from `.env.example` (pooled `DATABASE_URL`, admin hash, `AUTH_SECRET`, Razorpay, Blob).
4. Create Razorpay **test** webhook → `RAZORPAY_WEBHOOK_SECRET`.
5. Set `NEXT_PUBLIC_SITE_URL` before printing any pass QR codes.
6. Rotate any password that was ever pasted in chat (Neon → Reset password) — never commit it.

## 10. Honest limits

- No live Neon connection from this sandbox (TLS to `*.neon.tech` blocked) — schema correctness is covered by PGlite-based `db:setup:test` + `test:prisma`, not a live Neon apply.
- No Vercel deploy from this sandbox — follow `docs/deploy-vercel.md`.
- `verify:web` / `db:verify` not modernized (explicitly “where compatible”: they are not).
- Lint still has 16 unused-variable **warnings** (no errors); none affect behaviour.
- Razorpay payment routes were not rewritten, per brief.
