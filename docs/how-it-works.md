# How it works, and which URLs go where

> **Update after the Neon/Prisma migration:** database access is Prisma over the Neon
> pooler (not Supabase REST), admin sign-in is `ADMIN_EMAIL`/`ADMIN_PASSWORD_HASH`
> with an HTTP-only session cookie (not Supabase Auth / roles), and gallery files live
> in Vercel Blob (not Supabase Storage). The flow narrative below is still useful for
> URLs and product behaviour; treat Supabase-specific configuration steps as historical.


Two halves: **how the thing actually flows** (customer → payment → pass → gate), and then
**every URL that has to be set**, because that is the part that silently breaks a
deployment.

---

## 1 · The customer flow (a person buying a pass)

| # | What the person does | What happens behind it |
| - | -------------------- | ---------------------- |
| 1 | Opens `/` | Next.js server component reads `events` through Supabase's REST API with the **publishable key**; RLS lets it see published rows only. No key, no data — the page says so instead of inventing content |
| 2 | `/passes`, `/book` | Same: prices, nights, remaining capacity come from `pass_categories` / `event_dates` / `get_event_night_availability()` |
| 3 | `/book` wizard: night → pass → quantity → name, mobile, email | The browser validates for speed; the *server* validates again |
| 4 | Presses **Pay** | `POST /api/payment/create-order` → `create_pending_booking()` in Postgres re-checks the price, the head count and the capacity **from the database** and writes a `pending` booking. The browser cannot send an amount |
| 5 | Razorpay Checkout opens | The server creates the Razorpay order (key **secret** stays on the server) and returns only `order_id`, the public `key_id` and the amount the database fixed |
| 6 | Pays (UPI / card / netbanking) | Razorpay's script hands back `order_id + payment_id + signature` to our page |
| 7 | `POST /api/payment/verify` | Signature verified with HMAC (`RAZORPAY_KEY_SECRET`), payment read back from Razorpay, amounts compared **against the booking row**, then `confirm_booking_payment()` → booking `paid` + one `digital_passes` row per pass, generated **in one transaction**. A QR token (64 hex chars) is minted by the database |
| 8 | Razorpay also calls `POST /api/payment/webhook` | The same confirmation path, raw-body signature verified first, each `event_id` recorded once. This is the belt to the button's braces: if the customer closes the tab, the webhook still confirms the booking |
| 9 | `/booking/success` | Booking reference, pass id, night, and a button to the pass. Refreshing never creates a second pass |
| 10 | `/pass/<passId>?t=<token>` | A printable, downloadable ticket. The QR contains exactly `NEXT_PUBLIC_SITE_URL + /verify/<token>` — nothing else: no name, no mobile, no booking reference |
| 11 | Later, `/book/status` | Looks a booking up by its reference — the lookup needs the reference, not a login |

**Key point:** the price, the capacity check and the "paid" state are decided **inside
Postgres**, never in the browser and never from a form field.

---

## 2 · The organiser flow (running the event)

| # | Where | What |
| - | ----- | ---- |
| 1 | `/admin/login` | Email + password through Supabase Auth (no custom password store). An `admin_users` row decides the role: `super_admin`, `admin`, `staff` |
| 2 | Every `/admin` page and `/api/admin/*` route | The request hook refuses before the page renders (real `307`/`403`), the page re-checks its permission, the route re-checks the capability, and RLS is the last lock. Three layers, because a mistake in one is not a breach |
| 3 | `/admin` | Eight live statistics counted in Postgres, charts, recent bookings |
| 4 | `/admin/bookings` | Search, filters, detail, CSV export. Contact details and amounts are withheld from a `staff` session **in the query itself** |
| 5 | `/admin/dates` | Add/edit nights, capacity, seats held back from online sale, open/close booking. Capacity can never go below what is already paid for |
| 6 | `/admin/passes` | Pass types: price, description, how many people, max per booking, minimum age, on/off sale |
| 7 | `/admin/gallery` | The browser shrinks large photos to WebP and sends sequential batches; the server decodes/re-encodes with `sharp` (metadata dropped) and stores full/thumbnail objects in Vercel Blob. Uploads start as drafts; a staff preview uses the authenticated route; **Publish** changes the row status, and only published rows appear on the public gallery. The project uses a public Blob store, so draft URLs are unlisted rather than access-controlled. |
| 8 | `/admin/settings` | The validated contact form edits the selected event row's phone, email, WhatsApp, street address, map/social links and support hours. Saving revalidates the public layout; the event's database values win over `siteConfig` fallbacks. |

---

## 3 · The gate flow (the night of the event)

| # | What happens |
| - | ------------ |
| 1 | A volunteer signs in on their phone, opens `/admin/scanner` |
| 2 | The camera scans a QR → the browser sends **only the token** to `POST /api/staff/scan` |
| 3 | `scan_pass()` in Postgres answers: **✓ VALID PASS**, **⚠ PASS ALREADY USED**, **✕ PAYMENT NOT VERIFIED**, **✕ INVALID PASS**, wrong night, refunded, expired |
| 4 | Pressing **Check in** calls `POST /api/staff/check-in` → `check_in_pass()` locks the pass row, re-checks every condition, compare-and-swaps `checked_in = false` → `true` and writes the `check_ins` row, all in one transaction |
| 5 | Two phones scanning the same code: exactly one wins, the other is told it is already used. A tampered scanner page can only *ask a question* — never grant entry |

---

## 4 · The pieces, and what each one is for

```
        Visitor's phone / laptop
                 │  HTTPS
                 ▼
   ┌─────────────────────────────────────┐
   │  Vercel — Next.js 16                │   pages (SSR + ISR), API routes,
   │  Mumbai region (bom1, vercel.json)  │   the request hook (src/proxy.ts)
   └──────┬───────────────────┬──────────┘
          │ server-side       │ server-side (order create, verify, webhook)
          ▼                   ▼
   ┌──────────────┐    ┌─────────────────┐
   │  Supabase    │    │   Razorpay      │
   │  Postgres    │    │   Checkout      │
   │  Auth        │    └─────────────────┘
   │  Storage     │
   └──────────────┘
```

| Piece | Free tier | Holds | Reaches the browser? |
| ----- | --------- | ----- | -------------------- |
| Vercel | Hobby ($0, personal/non-commercial) | the code, the deployment | the HTML/CSS/JS |
| Supabase Postgres | 500 MB | every row: events, nights, passes, bookings, passes, check-ins | never directly — only through the server + RLS |
| Supabase Auth | 50k MAU | staff logins | a session cookie |
| Supabase Storage | 1 GB | gallery images (2 buckets) | public images only, once published |
| Razorpay | test mode free | payments | the Checkout script + the public key **id** only |

Secrets (`SUPABASE_SERVICE_ROLE_KEY`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`) exist
only in Vercel's server environment. Nothing privileged is ever inlined into the browser.

---

## 5 · The URL I want from you

**One URL: the production deployment URL** — the address Vercel gives you, e.g.
`https://event-booking-website-abc123.vercel.app`, or your own domain if you attach one.

That is all I need. With it I can check from here: every page, the security headers, the
data actually coming from your database, and — if you create a test booking — that it
reached Postgres and that a pass is admitted exactly once.

Please **do not** send me any key, token or password. Nothing in this project needs one to
verify a deployment, and a secret pasted into a chat is a secret you then have to rotate.

Optional, if you want me to confirm the database side too: the **project ref** (the 20
characters in your Supabase dashboard URL — public, not a secret) is enough for me to see
which region it is in; I still will not be able to query it, and that is deliberate.

---

## 6 · Every URL that has to be set — and what breaks if it is wrong

| # | URL | Where it goes | What it is for | If it is wrong |
| - | --- | ------------- | -------------- | -------------- |
| 1 | `https://<your-domain>` | Vercel → Settings → Environment Variables → **`NEXT_PUBLIC_SITE_URL`** | canonical + Open Graph URLs, and **the base of every pass QR code** | QRs point at the wrong host → the gate cannot verify a printed pass. It is inlined at build time, so changing it needs a **redeploy** |
| 2 | `https://<your-domain>` | Supabase → Authentication → URL Configuration → **Site URL** | where Auth sends someone for email links (confirmation, password reset) | only bites if you later turn on email confirmation or password reset. Set it anyway |
| 3 | `https://<your-domain>/**` (+ `http://localhost:3000/**` for dev) | Supabase → Authentication → **Redirect URLs** (allow list) | lets those email links come back to your site | a reset link would land on the Supabase default page instead of your site |
| 4 | `https://<your-domain>/api/payment/webhook` | Razorpay → Settings → **Webhooks** | the authoritative "this payment happened" callback | a customer who closes the tab right after paying could stay `pending` — the Checkout callback still covers the normal path, but this is the safety net |
| 5 | `https://maps.google.com/?q=…` (or any `https` map link) | Database → `events.maps_url` | the "Open in Google Maps" button on `/contact` and the footer | the button is hidden when the value is empty; a non-`https` value is refused by a constraint |
| 6 | `https://www.instagram.com/…`, `https://www.facebook.com/…`, `https://www.youtube.com/…` | Database → `events.instagram_url`, `facebook_url`, `youtube_url` | the social links | each must be `https` **and** on that platform's own host; anything else is refused by a constraint |
| 7 | `http://localhost:3000` | `.env.local` on your machine | local development | falls back to `localhost:3000` anyway |

Nothing else needs a URL: Razorpay Checkout is opened as a modal (there is no
`callback_url` to configure), and no external image host is used — maps, socials and the
WhatsApp link are plain links, and gallery images are served from Supabase Storage.

### Decide the domain **before you print passes**

A pass QR encodes `NEXT_PUBLIC_SITE_URL + /verify/<token>`; it is a printed, physical
artefact. If you print 500 passes against
`https://event-booking-website-abc123.vercel.app` and later move to `https://garbanights.in`,
**those printed QRs still point at the old host** — the passes in people's hands must keep
working, so either keep the `*.vercel.app` domain alive as a redirect, or set the final
domain *before* the first print. The admin settings screen shows the URL currently baked in,
so it is checkable at a glance.

### Free domain options

- The `*.vercel.app` domain is free with the project and is fine for the demo and testing.
- A custom domain (`.in`, `.com`) is bought from any registrar (~₹800–1,200/year) and added
  in Vercel → Settings → **Domains**; Vercel issues the HTTPS certificate automatically.
- The camera on the scanner page requires **HTTPS** — both of the above provide it. A LAN IP
  does not, which is why the scanner cannot be tested at `http://192.168.x.x`.

---

## 7 · The shortest version

1. Deploy to Vercel (import repo → set the 4 Supabase/Razorpay variables → Deploy; point the
   Production Branch at the working branch, since PR #1 is unmerged).
2. Set `NEXT_PUBLIC_SITE_URL` to that deployment URL and redeploy.
3. In Supabase: Site URL + Redirect URLs = the same address.
4. In Razorpay: webhook = `https://<domain>/api/payment/webhook`.
5. Send me the deployment URL; I check the pages, the headers and the flows from here.
```bash
# once it is up, these are the two commands that tell you the most
curl -sI https://<domain>/admin/login | grep -i "x-frame-options\|content-security-policy"
curl -s  https://<domain>/passes | grep -o "₹[0-9,]*" | sort -u   # your real prices
```
