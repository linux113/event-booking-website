# How the booking app works

A guide to the live Neon, Vercel, and Razorpay architecture.

## Public website and booking

1. A visitor opens the site. Next.js server components read published event details,
   nights, passes, contact details, and Gallery metadata from Neon through Prisma.
2. The homepage hero image is stored separately as optimized WebP bytes in
   `events.hero_image_data`. Public event queries read only whether bytes exist and the
   image revision—not the binary payload. The page loads the image through
   `/api/hero-image/<event-id>?v=<revision>`.
3. The visitor selects a night and pass type. The server calculates the price and
   creates a pending booking using the database function `create_pending_booking`,
   which enforces capacity and idempotency.
4. The server creates a Razorpay order. The browser receives only the order details,
   amount, and public key ID; secrets and price decisions stay server-side.
5. After checkout, `/api/payment/verify` validates the signature and reads the payment
   from Razorpay. The payment webhook provides a second confirmation path. The database
   issues digital passes only after a verified payment.
6. A pass contains a QR token. At the gate, the scanner asks the server to validate it;
   `check_in_pass()` atomically admits one scan and rejects repeats.

## Admin

- `/admin/login` verifies the single administrator's password hash and issues a signed,
  HTTP-only session cookie.
- `/admin/bookings`, `/admin/payments`, `/admin/dates`, `/admin/passes`, and
  `/admin/scanner` use server-side Neon queries and database functions.
- `/admin/gallery` uploads photos to Vercel Blob and saves their metadata and object
  keys in Neon. New items are drafts; only published rows appear on the public site.
  Gallery uses its own storage flow and does not store file bytes in Neon.
- **Admin → Event settings** uploads, replaces, or removes the one homepage hero image.
  The server converts the image to metadata-stripped WebP and stores it in Neon. It is
  not a Gallery item and does not use Vercel Blob. Removing it restores the built-in
  diya artwork.

## Services and data boundaries

| Piece | Responsibility | Browser access |
| ----- | -------------- | -------------- |
| Vercel / Next.js | Pages, server components, API routes, admin session | Public pages and API routes |
| Neon PostgreSQL | Events, nights, bookings, passes, Gallery metadata, and homepage hero WebP bytes | Only through server-side app routes; published hero images stream through a read-only route |
| Vercel Blob | Gallery image and thumbnail files | Published Gallery image URLs |
| Razorpay | Order creation and payment processing | Checkout script and public key ID only |
| App admin session | Signed identity for the single administrator | HTTP-only cookie; credentials remain server-side |

`DATABASE_URL`, `ADMIN_PASSWORD_HASH`, `AUTH_SECRET`, Razorpay secrets, and the optional
Gallery-only `BLOB_READ_WRITE_TOKEN` are server-side settings. Do not prefix secrets
with `NEXT_PUBLIC_`.

## URLs to configure

| Value | Where it is configured | Why it matters |
| ----- | ---------------------- | -------------- |
| `https://<your-domain>` | `NEXT_PUBLIC_SITE_URL` in Vercel | Canonical links and the host encoded in pass QR codes |
| `https://<your-domain>/api/payment/webhook` | Razorpay Dashboard | Lets Razorpay confirm payments if a visitor closes the browser |
| `https://maps.google.com/?q=…` or another HTTPS map URL | Admin → Event settings | Public venue map link |
| `https://www.instagram.com/<account>` and other HTTPS social URLs | Admin → Event settings | Optional public social links |

The hero image has no external host or environment variable. Its versioned image route
serves the current bytes from Neon; its authenticated admin preview is private and
uncached.

## Before launch

1. Apply `database/migrations/` to Neon with `npm run db:setup` using the direct,
   non-pooler connection string. Use the pooled string for the app runtime.
2. Set the production and preview environment variables listed in `.env.example`.
3. Set `NEXT_PUBLIC_SITE_URL` before printing passes.
4. In Admin → Event settings, optionally upload the homepage hero artwork. A new Neon
   database without custom artwork shows the built-in diya design.
5. Configure Razorpay test keys and its webhook, then test a booking and a gate scan.
6. Create/link a Vercel Blob store only if Gallery uploads will be used.

See [`neon-setup.md`](./neon-setup.md) and [`deploy-vercel.md`](./deploy-vercel.md) for
the full setup sequence.
