# Deploy this project on Vercel — do this now

**The repo is ready: `4137ca7` is pushed and the branch is Vercel-ready.** What is left is
the click inside your Vercel account, which needs your login — I have no Vercel credentials
in this sandbox and I will not ask you to paste one into a chat. Everything below is the
sequence to follow, in order, and each step says what you should see.

**Time: about 10 minutes** for a live site with an empty database, plus ~5 minutes for the
Supabase steps if you have not done those yet (see `docs/connect-free-supabase.md`).

---

## Before you start: two decisions

**1. Which branch goes live?** The work — all 15 steps — is on
`arena/01a0c957-event-booking-website` (PR #1, deliberately unmerged). Vercel's Production
Branch defaults to **`main`**, which only has the initial scaffold. So either:

- **Point Vercel at the branch** (recommended while the PR is open): after importing,
  *Settings → Git → Production Branch* → `arena/01a0c957-event-booking-website`, or
- merge PR #1 first and let `main` deploy.

If you skip this, the deploy succeeds and shows the scaffold — that is the single most
common way this looks broken when it isn't.

**2. Have the Supabase values ready.** The site builds and goes live with **no**
environment variables (verified: build exit 0), but it then serves its shell with a
"database is not connected" panel. `NEXT_PUBLIC_*` values are **inlined at build time**, so
add them *before* the first production build — or redeploy after adding them.

| You need | Where it comes from |
| -------- | ------------------- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API (or the Connect dialog) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the **publishable** key `sb_publishable_…` (legacy `anon` key also works) |
| `SUPABASE_SERVICE_ROLE_KEY` | the **secret** key `sb_secret_…` (legacy `service_role` key also works) — server-only, never paste it anywhere public |

If the database does not exist yet: `docs/connect-free-supabase.md` steps 1–2 (create the
project, run the migrations in filename order, then `seed.sql`). Do that first, or the
site will deploy and show nothing.

---

## Step 1 — Import the repository

1. <https://vercel.com/new> → **Import Git Repository** → `linux113/event-booking-website`
   (public repo, so no extra GitHub permissions are needed).
2. Vercel detects **Next.js**. **Leave everything at the defaults** — root directory `.`,
   install `npm install`/`npm ci`, build `npm run build`. Do not change the output
   directory.
3. Do **not** press Deploy yet if you want the env vars in the first build. Use
   *Environment Variables → Add* on the same screen, or deploy now and redeploy in step 3.

What the project already carries (committed, so nothing to configure by hand):

| File | What it sets | Why |
| ---- | ------------ | --- |
| `vercel.json` | function region **`bom1`** (Mumbai) | server rendering and ISR run next to a Supabase project in `ap-south-1`. Hobby allows exactly one region — keep it at one |
| `package.json` → `engines.node` | **22.x** | the Node major the verification scripts run against |
| `next.config.ts` | security headers, image `remotePatterns` | `nosniff`, referrer policy, camera-only permissions policy; frame protection on `/admin` |
| `.env.example` | the full variable list | copy those names exactly |

## Step 2 — Add the environment variables

*Settings → Environment Variables.* Add each one for **Production** *and* **Preview** (so
branch previews work), then:

| Variable | Value | Notes |
| -------- | ----- | ----- |
| `NEXT_PUBLIC_SITE_URL` | `https://your-domain.vercel.app` (or your domain) | **The base of every pass QR code.** Set it before printing passes |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_…` | public by design |
| `SUPABASE_SERVICE_ROLE_KEY` | `sb_secret_…` | server-only |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | `rzp_test_…` | optional until you take payments |
| `RAZORPAY_KEY_SECRET` | test secret | optional until then |
| `RAZORPAY_WEBHOOK_SECRET` | from step 4 | optional until then |
| `RAZORPAY_ALLOW_LIVE` | *(leave unset)* | live keys are refused without it |

## Step 3 — Deploy (and set the production branch)

1. **Deploy**. First build takes ~1–2 minutes.
2. **Settings → Git → Production Branch** → `arena/01a0c957-event-booking-website`
   (if you did not merge the PR). Then *Deployments → ⋯ → Redeploy* so the production
   domain serves that branch rather than `main`.
3. If you added the env vars *after* the first build: redeploy now. `NEXT_PUBLIC_*` values
   are baked in at build time, so a redeploy is what makes them take effect.

**What you should see:** the build log ends with the route list (about 40 routes, ending in
`ƒ Proxy (Middleware)`), and the site loads `/` with your event from the database. If it
shows the "database is not connected" panel, the three Supabase values are missing or were
added after the build — fix, redeploy.

## Step 4 — Razorpay webhook (only when you want payments)

Razorpay dashboard → **Settings → Webhooks → Add** → `https://<your-domain>/api/payment/webhook`,
subscribe to `payment.captured`, `payment.failed`, `refund.processed` (`order.paid`
optional), copy the webhook secret into `RAZORPAY_WEBHOOK_SECRET`, redeploy.

## Step 5 — Verify the deployment is real

| Check | Expected |
| ----- | -------- |
| `/` | your event name, venue, city — from `events`, not the placeholder |
| `/passes` | your pass types and prices from `pass_categories` |
| `/book` | your nights and their remaining capacity |
| `/contact` | your WhatsApp/phone/email/socials; the WhatsApp button opens with the message prefilled |
| `/admin/login` | the sign-in form (create the account per `supabase/README.md` → *Creating the first admin*) |
| After signing in | `/admin` dashboard with counts, `/admin/scanner` asking for the camera |
| `curl -sI https://<domain>/admin/login \| grep -i x-frame` | `x-frame-options: DENY` |
| One booking in Razorpay test mode | appears in `/admin/bookings`; `/booking/success` issues a pass |
| Scan that pass at `/admin/scanner` on a phone | **✓ VALID PASS**, then **⚠ PASS ALREADY USED** |

The camera needs **HTTPS** — a Vercel domain has it, a LAN IP does not.

---

## Things that will bite, in order of likelihood

1. **The site shows the scaffold** → the Production Branch is still `main`.
2. **"Database is not connected"** → the Supabase three are missing, or were added after the
   build without a redeploy.
3. **Bookings fail with a 503** → `SUPABASE_SERVICE_ROLE_KEY` is missing. The public pages
   only need the URL + publishable key, but creating a booking is a server write.
4. **`/admin` asks you to log in to Vercel** → that is *Deployment Protection* on preview
   URLs. Either use the production domain, or turn protection off for the project
   (*Settings → Deployment Protection*).
5. **A gallery photo 500s** → the two storage buckets are missing. The migration creates
   them; if your SQL role could not, create them by hand — table in
   `supabase/README.md` → *Creating the two storage buckets*.
6. **Uploads time out** → check *Settings → Functions*: with Fluid Compute (the default for
   new projects) you have 300 s; without it the legacy default was 10 s. Upload fewer at a time.
7. **Everything is slow from India** → the function region and the Supabase region should
   both be Mumbai (`bom1` / `ap-south-1`). `vercel.json` sets the first; the second is
   chosen when the Supabase project is created.

## Free-tier reality (Hobby)

- **Hobby is for personal, non-commercial projects.** A site that sells passes is commercial
  use; Vercel's terms expect **Pro** (~$20/month) for that. Budget one month of Pro for the
  event itself, or self-host.
- **Supabase free projects pause after 7 days without database activity** — that is the
  limit that actually takes a quiet site down. A daily ping (a GitHub Actions cron hitting
  `/passes`) prevents it; Supabase Pro removes it.
- Free tier has **no automatic backups**: export the booking and pass CSVs from the admin
  screens before the event.

---

## If you would rather deploy from the CLI

On your own machine, with your own login (I cannot do this from here):

```bash
npm i -g vercel        # or: npx vercel@latest
vercel login           # opens a browser — the token stays on your machine
vercel                 # first deploy: links the project, creates .vercel/
vercel env add NEXT_PUBLIC_SUPABASE_URL production      # repeat for each variable
vercel --prod          # production deployment
```

Vercel CLI never asks you to paste a token to anyone — `vercel login` authenticates in your
browser. Do not send a token to me or to any chat window; nothing here needs one.

---

## Then tell me

Paste the deployment URL back and I will verify it from here: the pages, the headers, the
security hardening, and the two flows that matter (a booking reaching the database, and a
pass being admitted exactly once). If the build log complains about anything, paste that
too — a failed first build is usually one missing variable, not a broken project.
