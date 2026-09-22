# Database (Supabase)

PostgreSQL schema for the event booking system. Everything the application reads
about events, passes and bookings lives here — nothing is hard-coded in the UI.

```
supabase/
├── migrations/
│   ├── 20260922090000_init_schema.sql   # tables, constraints, indexes, triggers, grants
│   └── 20260922090100_rls_policies.sql  # Row Level Security + role helper functions
└── seed.sql                             # initial event, 9 event dates, 5 pass categories
```

## Tables

| Table | Purpose | Public read? |
| ----- | ------- | ------------ |
| `events` | One festival (venue, city, status) | ✅ published only |
| `event_dates` | One night per row, with capacity | ✅ published event, not cancelled |
| `pass_categories` | Pass types + prices (per event) | ✅ active rows on a published event |
| `bookings` | One booking = one pass category on one night | ❌ staff only |
| `digital_passes` | Scannable QR passes issued after payment | ❌ staff only |
| `check_ins` | Gate scan log (one row per pass, ever) | ❌ staff only |
| `gallery` | Photo/video metadata (files in Storage) | ✅ published only |
| `admin_users` | Auth users allow-listed as staff | ❌ admins only |

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
| `anon` | Read published events, their dates, active pass categories and gallery. Nothing else — no read or write access to bookings, passes, check-ins or admin users. |
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
