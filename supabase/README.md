# Database (Supabase)

PostgreSQL schema for the event booking system. Everything the application reads
about events, passes and bookings lives here — nothing is hard-coded in the UI.

```
supabase/
├── migrations/
│   ├── 20260922090000_init_schema.sql            # tables, constraints, indexes, triggers, grants
│   ├── 20260922090100_rls_policies.sql           # Row Level Security + role helper functions
│   ├── 20260922090200_public_data_api.sql        # per-night availability RPC, highlights, features
│   └── 20260922090300_pass_catalogue_visibility.sql  # disabled passes stay visible to the site
└── seed.sql                                      # event, 9 nights, 5 passes, features, highlights
```

## Tables

| Table | Purpose | Public read? |
| ----- | ------- | ------------ |
| `events` | One festival (venue, city, status) | ✅ published only |
| `event_dates` | One night per row, with capacity and status | ✅ nights of a published event (status tells the UI it is cancelled or finished) |
| `pass_categories` | Pass types + prices (per event) | ✅ every row of a published event — `is_active` decides whether it can be bought, not whether it is shown |
| `event_highlights` | "What to expect" bullets per event | ✅ rows of a published event |
| `event_features` | Production inclusions (anchor, DJ, drone…) | ✅ rows of a published event |
| `bookings` | One booking = one pass category on one night | ❌ staff only |
| `digital_passes` | Scannable QR passes issued after payment | ❌ staff only |
| `check_ins` | Gate scan log (one row per pass, ever) | ❌ staff only |
| `gallery` | Photo/video metadata (files in Storage) | ✅ published only |
| `admin_users` | Auth users allow-listed as staff | ❌ admins only |

### What the public API exposes

The website never reads a booking. Two things exist so it can say "Fully booked"
without seeing anybody's data:

- **`get_event_night_availability(p_event_id uuid)`** — `SECURITY DEFINER`, returns one
  row per night with `booked_people`, `capacity`, `remaining`, `is_fully_booked` and
  `is_bookable`. It counts people from bookings that are `confirmed` + `paid` only, so
  an abandoned checkout never holds capacity. `execute` is granted to `anon`,
  `authenticated` and `service_role`.
- **Pass visibility.** `pass_categories` rows are readable for a published event even
  when `is_active = false`, because a pass that is deliberately off sale must still be
  visible to visitors as "Not on sale". `is_active` is enforced where it matters — the
  booking step, which runs with the service role.

Everything else public (events, nights, features, highlights, gallery) is a plain RLS
read on tables that hold no personal data.

### Integrity rules worth knowing

- **Prices cannot be tampered with.** `bookings.subtotal` and `number_of_people`
  are recomputed by the `set_booking_amounts()` trigger from `pass_categories`, and
  `total_amount` may not exceed the computed subtotal. A client that posts a fake
  price gets corrected (or rejected), not trusted.
- **One check-in per pass, ever.** `check_ins.digital_pass_id` is unique, so
  double entry is impossible at the database level.
- **Consistent check-in state.** `digital_passes.checked_in` can only be true when
  `checked_in_at` is set.
- **`updated_at` is server-owned** via the `set_updated_at()` trigger.
- **Money is stored in whole rupees** (`integer`). Razorpay amounts are derived as
  `price_inr * 100` paise at order-creation time.

## Applying the schema

### Local (Supabase CLI)

```bash
npx supabase init          # only once, creates config.toml
npx supabase start         # local Postgres + Studio in Docker
npx supabase db reset      # applies migrations, then seed.sql
```

### Hosted project

Either link the project and push,

```bash
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

or paste `migrations/*.sql` (in filename order) and then `seed.sql` into the
Supabase **SQL editor**.

## Roles and access

| Role | What it can do |
| ---- | -------------- |
| `anon` | Read published events, their nights, their pass categories (active or not), features, highlights and published gallery rows, plus per-night availability counts through `get_event_night_availability()`. Nothing else — no read or write access to bookings, passes, check-ins or admin users. |
| `authenticated` | Same public reads. Gains admin powers only when present in `admin_users` with an active role (`is_admin()` for owner/admin/manager, `is_staff()` to also include scanners). |
| `service_role` | Bypasses RLS. Server-only: booking writes and Razorpay webhooks. Never sent to the browser — see `src/lib/supabase/admin.ts`, which imports `server-only`. |

There is deliberately **no INSERT policy on `bookings`**: bookings are created by
server code after recalculating the amount from `pass_categories`, so the browser
can never fabricate a booking or a price.

## Creating the first admin

1. Create the user in **Authentication → Users** (or let them sign up).
2. Insert the allow-list row:

```sql
insert into public.admin_users (user_id, email, full_name, role)
values ('<auth-user-uuid>', 'owner@example.com', 'Owner Name', 'owner');
```

Only `owner` can manage `admin_users` rows; `scanner` can only check passes in.

## Regenerating TypeScript types

Types are hand-written in `src/types/database.ts` to match these migrations. Once
the project is linked, regenerate them from the live schema so they can never
drift:

```bash
npx supabase gen types typescript --project-id <your-project-ref> --schema public \
  > src/types/database.ts
```

The file mirrors the output shape (`Database["public"]["Tables"][...]["Row"]`), so
regeneration is a drop-in replacement.
