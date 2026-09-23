-- =============================================================================
-- Garba Nights — initial schema
--
-- Target: Supabase (PostgreSQL 15+). Managed with the Supabase CLI
-- (`supabase db push` / `supabase migration up`) or by pasting into the
-- Supabase SQL editor. See supabase/README.md.
--
-- Conventions used throughout:
--   * uuid primary keys with `gen_random_uuid()` (built into PG13+, no extension)
--   * `timestamptz` everywhere, defaulting to `now()`
--   * `updated_at` maintained by the `set_updated_at()` trigger, never by clients
--   * status columns are `text` + CHECK constraints (easier to evolve than enums)
--   * money is stored in whole rupees (`integer`); Razorpay amounts are derived
--     as `price_inr * 100` paise at order-creation time
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Roles
--
-- Supabase already defines anon / authenticated / service_role, so this block is
-- a no-op there. It exists so the migration can also be applied to a bare
-- PostgreSQL instance (CI, local testing) without edits.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;


-- -----------------------------------------------------------------------------
-- Shared helpers
-- -----------------------------------------------------------------------------

-- Keeps `updated_at` honest regardless of which client writes the row.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'BEFORE UPDATE trigger: stamps updated_at with now(). Attached to every table that has the column.';

-- Human-readable booking reference, e.g. BK2609-00042.
create sequence if not exists public.booking_id_seq start with 1 increment by 1;

create or replace function public.generate_booking_id()
returns text
language sql
volatile
as $$
  select 'BK' || to_char(now(), 'YYMM') || '-' || lpad(nextval('public.booking_id_seq')::text, 5, '0');
$$;

comment on function public.generate_booking_id() is
  'Generates the customer-facing booking reference. Uniqueness is enforced by bookings.booking_id.';

-- Human-readable pass number, e.g. PS-000123.
create sequence if not exists public.pass_id_seq start with 1 increment by 1;

create or replace function public.generate_pass_id()
returns text
language sql
volatile
as $$
  select 'PS-' || lpad(nextval('public.pass_id_seq')::text, 6, '0');
$$;

comment on function public.generate_pass_id() is
  'Generates the customer-facing digital pass number. Uniqueness is enforced by digital_passes.pass_id.';


-- -----------------------------------------------------------------------------
-- 1. events
-- -----------------------------------------------------------------------------
create table if not exists public.events (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,
  name            text not null,
  tagline         text,
  description     text,
  venue_name      text not null,
  venue_address   text,
  city            text not null,
  state           text,
  maps_url        text,
  hero_image_url  text,
  contact_phone   text,
  contact_email   text,
  currency        text not null default 'INR' check (char_length(currency) = 3),
  status          text not null default 'draft'
                    check (status in ('draft', 'published', 'archived')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint events_name_not_blank check (length(btrim(name)) > 0)
);

comment on table public.events is 'One Navratri/Dandiya festival. Public read access is limited to published events.';
comment on column public.events.status is 'draft = hidden from the public site, published = live, archived = kept for history.';

create index if not exists events_status_idx on public.events (status);
create index if not exists events_city_idx on public.events (city);

drop trigger if exists events_set_updated_at on public.events;
create trigger events_set_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 2. event_dates
-- -----------------------------------------------------------------------------
create table if not exists public.event_dates (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events (id) on delete cascade,
  event_date  date not null,
  start_time  time,
  end_time    time,
  capacity    integer not null default 1000 check (capacity > 0),
  status      text not null default 'scheduled'
                check (status in ('scheduled', 'sold_out', 'cancelled', 'completed')),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint event_dates_unique_night unique (event_id, event_date),
  constraint event_dates_time_order check (end_time is null or start_time is null or end_time > start_time)
);

comment on table public.event_dates is 'One row per night of the festival. Booking is always against a specific night.';
comment on column public.event_dates.capacity is 'Maximum number of people admitted on this night (sum of bookings.number_of_people).';

-- The unique (event_id, event_date) constraint already indexes event_id as a prefix.
create index if not exists event_dates_event_date_idx on public.event_dates (event_date);
create index if not exists event_dates_status_idx on public.event_dates (status);

drop trigger if exists event_dates_set_updated_at on public.event_dates;
create trigger event_dates_set_updated_at
  before update on public.event_dates
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 3. pass_categories
-- -----------------------------------------------------------------------------
create table if not exists public.pass_categories (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references public.events (id) on delete cascade,
  code              text not null,
  name              text not null,
  composition       text not null,
  description       text,
  price_inr         integer not null check (price_inr >= 0),
  number_of_people  integer not null check (number_of_people > 0),
  max_per_booking   integer not null default 10 check (max_per_booking > 0),
  is_active         boolean not null default true,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint pass_categories_unique_code unique (event_id, code)
);

comment on table public.pass_categories is 'Entry pass types sold for an event, e.g. "2 Girls — Rs 399". Prices live here, never in client code.';
comment on column public.pass_categories.price_inr is 'Whole rupees. Razorpay order amounts are price_inr * 100 (paise).';
comment on column public.pass_categories.number_of_people is 'People admitted by one pass; used for capacity maths.';

create index if not exists pass_categories_active_idx on public.pass_categories (event_id, sort_order) where is_active;

drop trigger if exists pass_categories_set_updated_at on public.pass_categories;
create trigger pass_categories_set_updated_at
  before update on public.pass_categories
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 4. bookings
-- -----------------------------------------------------------------------------
create table if not exists public.bookings (
  id                  uuid primary key default gen_random_uuid(),
  booking_id          text not null unique default public.generate_booking_id(),
  customer_name       text not null,
  customer_mobile     text not null,
  customer_email      text not null,
  event_date_id       uuid not null references public.event_dates (id) on delete restrict,
  pass_category_id    uuid not null references public.pass_categories (id) on delete restrict,
  quantity            integer not null check (quantity > 0),
  number_of_people    integer not null check (number_of_people > 0),
  subtotal            integer not null check (subtotal >= 0),
  total_amount        integer not null check (total_amount >= 0),
  booking_status      text not null default 'pending'
                        check (booking_status in ('pending', 'confirmed', 'cancelled', 'expired', 'refunded')),
  payment_status      text not null default 'unpaid'
                        check (payment_status in ('unpaid', 'created', 'paid', 'failed', 'refunded')),
  razorpay_order_id   text unique,
  razorpay_payment_id text unique,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint bookings_customer_name_not_blank check (length(btrim(customer_name)) > 0),
  constraint bookings_mobile_format check (customer_mobile ~ '^\+?[0-9]{8,15}$'),
  constraint bookings_email_format check (customer_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint bookings_total_within_subtotal check (total_amount <= subtotal)
);

comment on table public.bookings is 'One booking for one pass category on one event night. Amounts are always computed server-side.';
comment on column public.bookings.number_of_people is 'quantity * pass_categories.number_of_people, snapshotted at booking time for capacity maths.';
comment on column public.bookings.subtotal is 'quantity * pass_categories.price_inr at booking time. Derived by trigger, never trusted from the client.';
comment on column public.bookings.total_amount is 'Equals subtotal on insert. A lower value is only reachable through an authorised discount update.';
comment on column public.bookings.booking_status is 'Booking lifecycle, independent of payment_status.';
comment on column public.bookings.payment_status is 'Razorpay payment lifecycle. paid is only ever set after signature verification.';

create index if not exists bookings_event_date_idx on public.bookings (event_date_id);
create index if not exists bookings_pass_category_idx on public.bookings (pass_category_id);
create index if not exists bookings_booking_status_idx on public.bookings (booking_status);
create index if not exists bookings_payment_status_idx on public.bookings (payment_status);
create index if not exists bookings_created_at_idx on public.bookings (created_at desc);
create index if not exists bookings_customer_mobile_idx on public.bookings (customer_mobile);
create index if not exists bookings_customer_email_idx on public.bookings (lower(customer_email));

drop trigger if exists bookings_set_updated_at on public.bookings;
create trigger bookings_set_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

-- Amounts are derived from the pass category so a tampered client payload cannot
-- change the price. subtotal / number_of_people are always overwritten; a
-- total_amount may be supplied for a discount but can never exceed the subtotal.
create or replace function public.set_booking_amounts()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_price integer;
  v_people integer;
  v_max integer;
begin
  select price_inr, number_of_people, max_per_booking
    into v_price, v_people, v_max
  from public.pass_categories
  where id = new.pass_category_id;

  if v_price is null then
    raise exception 'pass_category_id % does not exist', new.pass_category_id
      using errcode = 'foreign_key_violation';
  end if;

  if new.quantity > v_max then
    raise exception 'quantity % exceeds max_per_booking % for this pass category', new.quantity, v_max
      using errcode = 'check_violation';
  end if;

  new.subtotal := new.quantity * v_price;
  new.number_of_people := new.quantity * v_people;

  if tg_op = 'INSERT' then
    -- total_amount is never taken from the caller on insert: the booking costs
    -- exactly what the database says it costs, so a tampered payload cannot
    -- underpay. Discounts are applied afterwards by authorized staff (below).
    new.total_amount := new.subtotal;
  else
    if new.total_amount is null then
      new.total_amount := new.subtotal;
    end if;

    if new.total_amount > new.subtotal then
      raise exception 'total_amount % cannot exceed subtotal %', new.total_amount, new.subtotal
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.set_booking_amounts() is
  'BEFORE INSERT OR UPDATE trigger: recomputes subtotal and number_of_people from pass_categories (prices can only come from the database) and forces total_amount = subtotal on insert. On update a lower total_amount is allowed for authorised discounts, but never more than the subtotal.';

drop trigger if exists bookings_set_amounts on public.bookings;
create trigger bookings_set_amounts
  before insert or update on public.bookings
  for each row execute function public.set_booking_amounts();


-- -----------------------------------------------------------------------------
-- 5. digital_passes
-- -----------------------------------------------------------------------------
create table if not exists public.digital_passes (
  id             uuid primary key default gen_random_uuid(),
  booking_id     uuid not null references public.bookings (id) on delete cascade,
  pass_id        text not null unique default public.generate_pass_id(),
  qr_token       text not null unique
                   default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  qr_code_url    text,
  valid_date     date not null,
  status         text not null default 'active'
                   check (status in ('active', 'used', 'cancelled', 'expired')),
  checked_in     boolean not null default false,
  checked_in_at  timestamptz,
  created_at     timestamptz not null default now(),
  constraint digital_passes_checked_in_consistency
    check (not checked_in or checked_in_at is not null)
);

comment on table public.digital_passes is 'One scannable pass per admitted group/person, issued after payment is verified.';
comment on column public.digital_passes.qr_token is 'Opaque random token encoded into the QR code. Defaults to 64 hex chars (two UUIDs).';
comment on column public.digital_passes.status is 'used is set together with checked_in/checked_in_at once the pass is scanned at the gate.';

create index if not exists digital_passes_booking_idx on public.digital_passes (booking_id);
create index if not exists digital_passes_valid_date_idx on public.digital_passes (valid_date);
create index if not exists digital_passes_status_idx on public.digital_passes (status);


-- -----------------------------------------------------------------------------
-- 6. gallery
-- -----------------------------------------------------------------------------
-- 'scanner' exists because gate staff need to check passes in without being able
-- to edit events, pricing or bookings.
create table if not exists public.admin_users (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null unique references auth.users (id) on delete cascade,
  email          text not null unique,
  full_name      text,
  role           text not null default 'admin'
                   check (role in ('owner', 'admin', 'manager', 'scanner')),
  is_active      boolean not null default true,
  last_login_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.admin_users is 'Allow-list mapping Supabase Auth users to an admin role. No public access whatsoever.';
comment on column public.admin_users.user_id is 'References auth.users(id); rows are created after the user signs up.';

create index if not exists admin_users_active_idx on public.admin_users (is_active);

drop trigger if exists admin_users_set_updated_at on public.admin_users;
create trigger admin_users_set_updated_at
  before update on public.admin_users
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 7. admin_users
-- -----------------------------------------------------------------------------
create table if not exists public.check_ins (
  id               uuid primary key default gen_random_uuid(),
  digital_pass_id  uuid not null references public.digital_passes (id) on delete cascade,
  event_date_id    uuid not null references public.event_dates (id) on delete restrict,
  checked_in_at    timestamptz not null default now(),
  gate             text,
  checked_in_by    uuid references public.admin_users (id) on delete set null,
  notes            text,
  constraint check_ins_one_per_pass unique (digital_pass_id)
);

comment on table public.check_ins is 'Gate scan audit log. The unique constraint on digital_pass_id makes double entry impossible.';

create index if not exists check_ins_event_date_idx on public.check_ins (event_date_id);
create index if not exists check_ins_checked_in_at_idx on public.check_ins (checked_in_at desc);


-- -----------------------------------------------------------------------------
-- 8. check_ins
-- -----------------------------------------------------------------------------
create table if not exists public.gallery (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid references public.events (id) on delete cascade,
  album         text,
  title         text,
  description   text,
  media_type    text not null default 'image' check (media_type in ('image', 'video')),
  storage_path  text,
  url           text,
  thumbnail_url text,
  alt_text      text not null,
  captured_on   date,
  status        text not null default 'draft'
                  check (status in ('draft', 'published', 'archived')),
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint gallery_has_source check (url is not null or storage_path is not null),
  constraint gallery_alt_text_not_blank check (length(btrim(alt_text)) > 0)
);

comment on table public.gallery is 'Event photos and videos. Files live in Supabase Storage; this table holds the metadata.';
comment on column public.gallery.alt_text is 'Required: every published image needs descriptive alternative text for accessibility.';
comment on column public.gallery.event_id is 'Nullable so festival-wide media can exist outside a single event.';

create index if not exists gallery_event_idx on public.gallery (event_id);
create index if not exists gallery_status_sort_idx on public.gallery (status, sort_order);

drop trigger if exists gallery_set_updated_at on public.gallery;
create trigger gallery_set_updated_at
  before update on public.gallery
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- Table privileges
--
-- Supabase grants broad privileges to anon/authenticated by default; stating them
-- explicitly keeps the intent readable and makes the migration portable to a bare
-- PostgreSQL instance. Row Level Security (see the next migration) is what
-- actually restricts which rows each role can see.
-- -----------------------------------------------------------------------------
grant select on public.events, public.event_dates, public.pass_categories, public.gallery
  to anon, authenticated;

grant select, insert, update, delete on public.events, public.event_dates,
  public.pass_categories, public.gallery, public.admin_users to authenticated;

grant select, insert, update on public.bookings to authenticated;
grant select, insert, update on public.digital_passes to authenticated;
grant select, insert on public.check_ins to authenticated;

grant all on public.events, public.event_dates, public.pass_categories, public.bookings,
  public.digital_passes, public.check_ins, public.gallery, public.admin_users
  to service_role;

grant usage, select on all sequences in schema public to service_role;
