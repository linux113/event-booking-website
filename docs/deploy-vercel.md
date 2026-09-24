# Deploy this project on Vercel

**Stack:** Next.js on Vercel · Neon PostgreSQL · Razorpay (test mode) · Vercel Blob.
Runtime database access uses the Neon `DATABASE_URL` only.

**Time:** about 10–15 minutes if Neon and Razorpay already exist.

---

## Before you start

1. **Which branch goes live?** Vercel’s Production Branch defaults to **`main`**.
   Merge your migration branch first, or temporarily point *Settings → Git →
   Production Branch* at the branch you want deployed. Deploying the wrong branch is
   the most common “it shows the scaffold” failure.
2. **Neon database** created and schema applied — see
   [`docs/neon-setup.md`](./neon-setup.md). Use the **direct** URL for migrations,
   then keep the **pooled** URL for the app.
3. **Razorpay test keys** and a webhook secret (step 4 below).
4. **Vercel Blob store** if you will use gallery uploads; the homepage hero image is
   stored in Neon and does not need Blob.

---

## Apply the homepage hero migration before deploying

For an **existing** Neon database, apply `database/migrations/20260924090000_database_hero_image.sql`
first. From this repository, `npm run db:setup` with the **direct** (non-pooler)
`DATABASE_URL` applies any pending migrations and records them in `setup.applied_migrations`:

```bash
DATABASE_URL='<DIRECT_NEON_URL>' npm run db:setup
```

Alternatively, open Neon SQL Editor and run that migration file once. Do not paste the
whole one-shot schema into a database that is already set up.

For a **new** database, the generated `docs/one-shot-schema.sql` already includes the
migration; `npm run db:setup -- --seed` is also supported.

The migration adds `events.hero_image_data` (`bytea`) and its revision counter. Admin
uploads are converted to a metadata-stripped WebP and saved there; removing the image
clears the database bytes and restores the built-in diya artwork. Gallery media remains
separate and continues to use Vercel Blob.

---

## Environment variables

Vercel → **Settings → Environment Variables**. Set for **Production** and **Preview**.
Exact names (also in [`.env.example`](../.env.example)):

| Variable | Scope | Value |
| -------- | ----- | ----- |
| `NEXT_PUBLIC_SITE_URL` | public | `https://<your-domain>` — **base of every pass QR**; set before printing passes |
| `DATABASE_URL` | server | Neon **pooled** string (`-pooler`, `sslmode=require`, no `channel_binding`) |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | public | `rzp_test_…` (inlined at build) |
| `RAZORPAY_KEY_SECRET` | server | test key secret |
| `RAZORPAY_WEBHOOK_SECRET` | server | from the webhook you create below |
| `ADMIN_EMAIL` | server | admin sign-in email |
| `ADMIN_PASSWORD_HASH` | server | `scrypt$<salt>$<hash>` — generate with the Node one-liner in neon-setup.md |
| `AUTH_SECRET` | server | ≥32 random bytes |
| `BLOB_READ_WRITE_TOKEN` | server | Vercel Blob read/write token (gallery) |
| `RAZORPAY_ALLOW_LIVE` | server | leave **unset** until you deliberately go live |

**Never** prefix secrets with `NEXT_PUBLIC_`. **Never** commit them.

`NEXT_PUBLIC_*` values are inlined at **build** time — add them before the first
production build, or redeploy after changing them.

If `DATABASE_URL` is missing, the site still builds and serves its shell with a
“database not connected” state (honest failure, not a broken deploy).

---

## Import & build

1. Vercel → **Add New → Project → Import** `linux113/event-booking-website`.
2. Framework preset **Next.js**; defaults are fine (`npm run build` runs
   `prisma generate && next build` — generate does not need a live DB).
3. Region is already forced to **Mumbai (`bom1`)** in `vercel.json`. Keep Neon in a
   nearby region (`ap-south-1`).
4. Node **22** (`engines` in `package.json`).

---

## Razorpay webhook

1. Razorpay Dashboard → Settings → Webhooks → Add  
   `https://<your-domain>/api/payment/webhook`
2. Subscribe: `payment.captured`, `payment.failed`, `refund.processed`
   (`order.paid` optional).
3. Copy the **secret** into `RAZORPAY_WEBHOOK_SECRET` and redeploy.

Payment amounts are always recomputed on the server from the booking row; signatures
are verified on `/api/payment/verify` and the webhook. That logic is intentional — do
not “simplify” it.

---

## Homepage hero image (Neon)

The homepage hero image is uploaded, replaced and removed in **Admin → Event settings**.
The server resizes it, strips source metadata, converts it to WebP, and stores the bytes
in Neon `events.hero_image_data`. It is served from the app's public hero-image route.
It is **not** a Gallery item, does not use Vercel Blob and needs no extra environment
variable. Removing it returns the homepage to its built-in diya artwork.

Apply the `20260924090000_database_hero_image.sql` migration before deploying this
feature; see the instructions at the top of this guide.

---

## Gallery storage (Vercel Blob)

1. Open **Vercel → Project → Storage → Create → Blob**.
2. Create the Blob store and connect it to this project; enable **Production** and also
   **Preview** if uploads will be made from preview deployments.
3. In **Project → Settings → Environment Variables**, confirm `BLOB_READ_WRITE_TOKEN`
   is available for each deployment environment that needs uploads. The app checks this
   variable before accepting uploads.
4. Redeploy after creating/connecting the store or changing its environment selection.

Gallery rows store **keys** and URLs only (`storage_path`, `thumbnail_path`, `url`);
image bytes stay in Blob, not Neon. Uploads are sent in small sequential batches under
Vercel's request-body cap. New rows are drafts; the admin must select **Publish** to
show a photo on `/gallery`. For setup errors and failed previews, see
[`gallery-upload-troubleshooting.md`](./gallery-upload-troubleshooting.md).

---

## Admin sign-in

1. Generate `ADMIN_PASSWORD_HASH` and `AUTH_SECRET` (commands in `docs/neon-setup.md`).
2. Set `ADMIN_EMAIL` + both values in Vercel.
3. Open `https://<your-domain>/admin/login` — HTTP-only `gn_admin` session, full
   access to `/admin`. There is no staff directory and no role picker.

---

## Hobby plan notes

- Non-commercial projects only on Hobby; a paid ticket-selling site may need **Pro**.
- Preview deployments sit behind Deployment Protection by default.
- Functions: 300s with Fluid Compute (enough for a gallery upload).

---

## Six checks that prove the deployment is real

1. `/` shows **your** event data from Neon (not the empty shell).
2. `/admin/login` accepts the env credentials and lands on `/admin`.
3. **Admin → Event settings** can upload, replace and remove a hero image; removing it
   restores the diya artwork beside **Book Now**.
4. A Razorpay **test** booking appears under `/admin/bookings` with an issued pass.
5. `/admin/scanner` on a phone (HTTPS) validates that pass, then refuses a second
   check-in.
6. Gallery upload/publish works (Blob token set) and `/gallery` shows the image.

---

## Troubleshooting

| Symptom | Likely cause |
| ------- | ------------ |
| Scaffold / wrong app | Production Branch points at the wrong branch |
| Database not connected | Pooled `DATABASE_URL` missing or still has `channel_binding` |
| Build succeeds, images 404 | `NEXT_PUBLIC_*` added after build — redeploy |
| Webhook 401 | Wrong `RAZORPAY_WEBHOOK_SECRET` or proxy modifying the body |
| Login always fails | Hash not in `scrypt$salt$hash` form, or wrong `ADMIN_EMAIL` |
| Camera scanner dead | Page not HTTPS, or browser permission denied |
