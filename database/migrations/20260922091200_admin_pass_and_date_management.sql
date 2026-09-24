-- =============================================================================
-- Garba Nights — admin pass and date management
--
-- Two screens, and one idea behind both: the organiser owns what is on sale, and
-- the database owns what that means.
--
--   1. event_dates gains the two things a night needs to be sellable — how many
--      seats are held back from online booking, and whether booking is open —
--      plus guards that make an impossible capacity unrepresentable.
--   2. pass_categories gains min_age, so "age restriction" is a fact on the pass
--      rather than a sentence in a description.
--   3. create_pending_booking and get_event_night_availability are replaced, so
--      the booking path and the public availability figure agree about held
--      seats and closed nights. One capacity rule, in two places that must
--      match, kept in step by being written the same way.
--   4. The admin functions: save/toggle a pass, save a night, set capacity,
--      open and close booking.
--
-- Where the rules live, and why:
--
--   * **Row invariants are constraints and a trigger.** capacity >= 1,
--     capacity_held >= 0, capacity_held <= capacity, min_age in range: true of
--     any row at any time, so the database refuses to hold a row that breaks
--     them, whatever wrote it — this file, a migration, the SQL editor.
--   * **The data-dependent rule is the same trigger, because it must hold for
--     every write.** "Capacity may never drop below the people already paid for
--     the night" needs a count, and a count in a trigger is a query — that is
--     fine. It is written as *never make the shortfall worse* rather than
--     *always be sufficient*, because a night can legitimately end up
--     over-subscribed (a booking that pays after the night filled is honoured
--     with an organiser note, see 20260922090500_payments.sql) and an organiser
--     must still be able to raise the capacity, cancel the night or edit a note
--     on it.
--   * **Concurrency is row locks, not hope.** Every admin write locks the night
--     row `for update` before it counts, exactly as create_pending_booking
--     does, so an admin lowering capacity and a customer paying for the last
--     seat cannot interleave: one of them waits for the other.
--
-- Error codes (the app maps these to a field, not to prose):
--
--   PT001 capacity_below_one        PT007 night_not_found
--   PT002 capacity_held_negative    PT008 night_time_order
--   PT003 capacity_held_above_cap   PT009 night_date_required
--   PT004 capacity_below_taken      PT010 night_status_invalid
--   PT005 night_date_locked         PT011 notes_too_long
--   PT006 night_duplicate
--
--   PC001 pass_name_invalid         PC007 pass_age_invalid
--   PC002 pass_code_invalid         PC008 pass_not_found
--   PC003 pass_code_duplicate       PC009 pass_composition_invalid
--   PC004 pass_price_invalid        PC010 pass_not_configured
--   PC005 pass_people_invalid       PC011 pass_sort_order_invalid
--   PC006 pass_max_per_booking_invalid
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. event_dates: seats held back, and whether booking is open
-- -----------------------------------------------------------------------------
alter table public.event_dates
  add column if not exists capacity_held integer not null default 0,
  add column if not exists booking_open  boolean not null default true;

comment on column public.event_dates.capacity_held is
  'Seats withheld from online booking (gate sales, sponsors, crew). Available = capacity - capacity_held - paid people.';
comment on column public.event_dates.booking_open is
  'Whether booking is open on this night. Closing it stops new bookings without cancelling the night.';

-- Constraints rather than defaults alone: the row cannot be made impossible even by
-- a hand-written INSERT that names the columns.
alter table public.event_dates drop constraint if exists event_dates_capacity_held_range;
alter table public.event_dates
  add constraint event_dates_capacity_held_range check (capacity_held >= 0);

alter table public.event_dates drop constraint if exists event_dates_capacity_held_within_capacity;
alter table public.event_dates
  add constraint event_dates_capacity_held_within_capacity check (capacity_held <= capacity);


-- -----------------------------------------------------------------------------
-- 2. pass_categories: age restriction
-- -----------------------------------------------------------------------------
-- 0 means "no restriction", which is what every pass sold today means. An integer
-- rather than free text because "18+" is a rule a door can apply, and a rule the
-- database can check.
alter table public.pass_categories
  add column if not exists min_age integer not null default 0;

comment on column public.pass_categories.min_age is
  'Minimum age in years for this pass; 0 means no age restriction. Shown on the pass card and checked at the door.';

alter table public.pass_categories drop constraint if exists pass_categories_min_age_range;
alter table public.pass_categories
  add constraint pass_categories_min_age_range check (min_age between 0 and 120);


-- -----------------------------------------------------------------------------
-- 3. The guard on a night
--
-- Fires before every INSERT and UPDATE of event_dates — the admin function, a
-- migration, or somebody in the SQL editor. It knows two things: what the row
-- must look like, and what the row must not take away from people who have
-- already paid.
-- -----------------------------------------------------------------------------
create or replace function public.event_dates_guard_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid      integer;
  v_old_room  integer;
  v_new_room  integer;
begin
  -- 1. The row itself. These are also table constraints; they are repeated here so
  -- the app receives an error code it can attach to a field instead of a raw
  -- constraint violation.
  if new.capacity is null or new.capacity < 1 then
    raise exception 'capacity_below_one' using errcode = 'PT001';
  end if;

  if new.capacity_held is null or new.capacity_held < 0 then
    raise exception 'capacity_held_negative' using errcode = 'PT002';
  end if;

  if new.capacity_held > new.capacity then
    raise exception 'capacity_held_above_capacity' using errcode = 'PT003',
      detail = new.capacity::text;
  end if;

  -- 2. The night's own bookings. Counted from paid bookings only, the same rule
  -- the booking path and the public availability figure use: a pending booking
  -- does not hold a seat until the money is verified.
  select coalesce(sum(b.number_of_people), 0)::integer
    into v_paid
  from public.bookings b
  where b.event_date_id = new.id
    and b.payment_status = 'paid';

  if v_paid > 0 then
    -- Room left for the people who have paid, after the seats held back.
    v_new_room := new.capacity - new.capacity_held;

    -- An UPDATE that does not make things worse is always allowed: raising the
    -- capacity, cancelling the night, correcting a time. An INSERT has no old row
    -- and no bookings, so it can only be measured as it stands.
    v_old_room := case when tg_op = 'UPDATE' then old.capacity - old.capacity_held else v_new_room end;

    if v_new_room < v_paid and v_new_room < v_old_room then
      -- detail carries the lowest capacity this night may now have, so the screen
      -- can say "at least 82" rather than "invalid".
      raise exception 'capacity_below_taken' using errcode = 'PT004',
        detail = (v_paid + new.capacity_held)::text;
    end if;
  end if;

  -- 3. A night that has been paid for keeps its date. Passes are issued with the
  -- night's date printed on them and scanned against it, so moving the night would
  -- silently invalidate them; the organiser moves the bookings, not the night.
  if tg_op = 'UPDATE' and new.event_date is distinct from old.event_date and v_paid > 0 then
    raise exception 'night_date_locked' using errcode = 'PT005', detail = v_paid::text;
  end if;

  return new;
end;
$$;

drop trigger if exists event_dates_guard_capacity on public.event_dates;
create trigger event_dates_guard_capacity
  before insert or update on public.event_dates
  for each row execute function public.event_dates_guard_capacity();

comment on function public.event_dates_guard_capacity() is
  'Refuses a night whose capacity is impossible (PT001-PT003) and any edit that would take seats away from people who have already paid (PT004), or move a night that has paid bookings to another date (PT005).';


-- -----------------------------------------------------------------------------
-- 4. The booking path, restated with held seats and closed booking
--
-- create_pending_booking is restated here rather than patched from where it was last
-- defined (20260922090500_payments.sql): it is the one place that decides whether a
-- booking may exist, and it has to read the two new columns. The body below is that
-- definition, verbatim apart from three lines — the columns the night lock fetches,
-- the closed-booking refusal, and the seats held back taken off the available count.
-- Everything else is unchanged: the night row is still locked first, the price still
-- comes from pass_categories, the amount is still never accepted from the caller, and
-- the idempotency and capacity behaviour are exactly as they were.
-- -----------------------------------------------------------------------------
create or replace function public.create_pending_booking(
  p_event_id         uuid,
  p_event_date_id    uuid,
  p_pass_category_id uuid,
  p_customer_name    text,
  p_customer_mobile  text,
  p_customer_email   text,
  p_quantity         integer,
  p_number_of_people integer,
  p_idempotency_key  text default null
)
returns table (
  booking_uuid     uuid,
  booking_reference text,
  public_token     uuid,
  booking_status   text,
  payment_status   text,
  quantity         integer,
  number_of_people integer,
  subtotal         integer,
  total_amount     integer,
  event_id         uuid,
  event_date_id    uuid,
  event_date       date,
  start_time       time,
  end_time         time,
  pass_category_id uuid,
  pass_name        text,
  pass_composition text,
  currency         text,
  razorpay_order_id text,
  created_at       timestamptz,
  was_existing     boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_night       record;
  v_pass        record;
  v_event       record;
  v_existing    record;
  v_booked      integer;
  v_remaining   integer;
  v_required    integer;
  v_booking_id  uuid;
  v_reference   text;
begin
  -- Idempotency: has this attempt already produced a booking?
  if p_idempotency_key is not null and length(btrim(p_idempotency_key)) > 0 then
    select b.id into v_existing
    from public.bookings b
    where b.idempotency_key = btrim(p_idempotency_key);

    if found then
      return query
        select b.id, b.booking_id, b.public_token, b.booking_status, b.payment_status, b.quantity,
               b.number_of_people, b.subtotal, b.total_amount, d.event_id, d.id, d.event_date,
               d.start_time, d.end_time, p.id, p.name, p.composition, e.currency,
               b.razorpay_order_id, b.created_at, true
        from public.bookings b
        join public.event_dates d on d.id = b.event_date_id
        join public.pass_categories p on p.id = b.pass_category_id
        join public.events e on e.id = d.event_id
        where b.id = v_existing.id;

      return;
    end if;
  end if;

  -- Lock the night: concurrent attempts for the same night queue here, so the
  -- capacity read below cannot be stale.
  select d.id, d.event_id, d.event_date, d.status, d.capacity, d.capacity_held,
         d.booking_open, d.start_time, d.end_time
    into v_night
  from public.event_dates d
  where d.id = p_event_date_id
  for update;

  if not found then
    raise exception 'night_not_found' using errcode = 'PB006';
  end if;

  if v_night.event_id <> p_event_id then
    raise exception 'night_not_found' using errcode = 'PB006';
  end if;

  select e.id, e.name, e.status, e.currency into v_event
  from public.events e
  where e.id = p_event_id;

  if not found or v_event.status <> 'published' then
    raise exception 'night_not_bookable' using errcode = 'PB002';
  end if;

  if v_night.status <> 'scheduled' then
    raise exception 'night_not_bookable' using errcode = 'PB002';
  end if;

  -- An organiser can close booking on a night without cancelling it (gate sales
  -- only, a private hire, a capacity recount). Same verdict, same code: from the
  -- booking flow's point of view the night is simply not on sale.
  if v_night.booking_open is not true then
    raise exception 'night_not_bookable' using errcode = 'PB002';
  end if;

  select p.id, p.name, p.composition, p.price_inr, p.number_of_people, p.max_per_booking, p.is_active
    into v_pass
  from public.pass_categories p
  where p.id = p_pass_category_id;

  if not found or v_pass.is_active is not true then
    raise exception 'pass_not_available' using errcode = 'PB003';
  end if;

  if not exists (
    select 1 from public.pass_categories p
    where p.id = p_pass_category_id and p.event_id = p_event_id
  ) then
    raise exception 'pass_not_available' using errcode = 'PB003';
  end if;

  if p_quantity is null or p_quantity < 1 or p_quantity > v_pass.max_per_booking then
    raise exception 'quantity_invalid' using errcode = 'PB004', detail = v_pass.max_per_booking::text;
  end if;

  v_required := p_quantity * v_pass.number_of_people;

  if p_number_of_people is null or p_number_of_people <> v_required then
    raise exception 'people_mismatch' using errcode = 'PB005', detail = v_required::text;
  end if;

  -- Capacity, counted the same way as the public availability function: paid
  -- bookings only, with the seats the organiser has held back removed from what is
  -- on sale. A pending booking does not hold a place until it is paid.
  select coalesce(sum(b.number_of_people) filter (where b.payment_status = 'paid'), 0)::integer
    into v_booked
  from public.bookings b
  where b.event_date_id = p_event_date_id;

  -- Seats an organiser has held back are subtracted before the booking is measured
  -- against what is left: a night with 1,000 seats and 50 held has 950 on sale.
  v_remaining := greatest(v_night.capacity - v_night.capacity_held - v_booked, 0);

  if v_required > v_remaining then
    raise exception 'capacity_unavailable' using errcode = 'PB001', detail = v_remaining::text;
  end if;

  -- Same content, brand-new key inside the double-submit window (a page reload
  -- loses the key): treat it as the same attempt instead of creating a second
  -- booking. Paid or older bookings are never reused.
  select b.id into v_existing
  from public.bookings b
  where b.event_date_id = p_event_date_id
    and b.pass_category_id = p_pass_category_id
    and b.customer_mobile = p_customer_mobile
    and b.quantity = p_quantity
    and b.booking_status = 'pending'
    and b.payment_status = 'unpaid'
    and b.created_at > now() - interval '15 minutes'
  order by b.created_at desc
  limit 1;

  if found then
    return query
      select b.id, b.booking_id, b.public_token, b.booking_status, b.payment_status, b.quantity,
             b.number_of_people, b.subtotal, b.total_amount, d.event_id, d.id, d.event_date,
             d.start_time, d.end_time, p.id, p.name, p.composition, e.currency,
             b.razorpay_order_id, b.created_at, true
      from public.bookings b
      join public.event_dates d on d.id = b.event_date_id
      join public.pass_categories p on p.id = b.pass_category_id
      join public.events e on e.id = d.event_id
      where b.id = v_existing.id;

    return;
  end if;

  -- number_of_people, subtotal and total_amount are deliberately not part of the
  -- INSERT column list: the set_booking_amounts() trigger computes all three from
  -- pass_categories before the row is written.
  insert into public.bookings (
    customer_name, customer_mobile, customer_email,
    event_date_id, pass_category_id,
    quantity, booking_status, payment_status, idempotency_key
  )
  values (
    btrim(p_customer_name), p_customer_mobile, p_customer_email,
    p_event_date_id, p_pass_category_id,
    p_quantity, 'pending', 'unpaid',
    nullif(btrim(coalesce(p_idempotency_key, '')), '')
  )
  returning id, bookings.booking_id into v_booking_id, v_reference;

  return query
    select b.id, b.booking_id, b.public_token, b.booking_status, b.payment_status, b.quantity,
           b.number_of_people, b.subtotal, b.total_amount, d.event_id, d.id, d.event_date,
           d.start_time, d.end_time, p.id, p.name, p.composition, e.currency,
           b.razorpay_order_id, b.created_at, false
    from public.bookings b
    join public.event_dates d on d.id = b.event_date_id
    join public.pass_categories p on p.id = b.pass_category_id
    join public.events e on e.id = d.event_id
    where b.id = v_booking_id;
end;
$$;

comment on function public.create_pending_booking(uuid, uuid, uuid, text, text, text, integer, integer, text) is
  'Creates one pending/unpaid booking atomically: locks the night, re-reads capacity from paid bookings and the seats held back, refuses a night whose booking is closed, reads the price from pass_categories and ignores any client-supplied amount. Service role only — browsers cannot call it.';

revoke all on function public.create_pending_booking(uuid, uuid, uuid, text, text, text, integer, integer, text) from public;
revoke all on function public.create_pending_booking(uuid, uuid, uuid, text, text, text, integer, integer, text) from anon, authenticated;
grant execute on function public.create_pending_booking(uuid, uuid, uuid, text, text, text, integer, integer, text) to service_role;


-- -----------------------------------------------------------------------------
-- 5. Public availability, with the same arithmetic
--
-- The public site must not be able to promise a seat the booking path will refuse,
-- so this function and create_pending_booking compute "available" identically:
-- capacity − held − paid people. The return type gains three columns, so the
-- function is dropped and recreated rather than replaced.
-- -----------------------------------------------------------------------------
drop function if exists public.get_event_night_availability(uuid);

create function public.get_event_night_availability(p_event_id uuid)
returns table (
  event_date_id   uuid,
  event_date      date,
  start_time      time,
  end_time        time,
  night_status    text,
  capacity        integer,
  capacity_held   integer,
  booked_people   integer,
  remaining       integer,
  is_fully_booked boolean,
  is_booking_open boolean,
  is_bookable     boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with night as (
    select
      d.id,
      d.event_date,
      d.start_time,
      d.end_time,
      d.status,
      d.capacity,
      d.capacity_held,
      d.booking_open,
      coalesce(
        sum(b.number_of_people) filter (where b.payment_status = 'paid'),
        0
      )::integer as booked_people
    from public.event_dates d
    left join public.bookings b on b.event_date_id = d.id
    where d.event_id = p_event_id
      and exists (
        select 1 from public.events e
        where e.id = p_event_id and e.status = 'published'
      )
    group by d.id, d.event_date, d.start_time, d.end_time, d.status, d.capacity,
             d.capacity_held, d.booking_open
  )
  select
    n.id,
    n.event_date,
    n.start_time,
    n.end_time,
    n.status,
    n.capacity,
    n.capacity_held,
    n.booked_people,
    greatest(n.capacity - n.capacity_held - n.booked_people, 0),
    (n.status = 'sold_out' or n.booked_people + n.capacity_held >= n.capacity),
    n.booking_open,
    (n.status = 'scheduled'
      and n.booking_open
      and n.booked_people + n.capacity_held < n.capacity)
  from night n
  order by n.event_date;
$$;

comment on function public.get_event_night_availability(uuid) is
  'Published events only. One row per night with capacity, the seats held back from online booking, the paid people, and what is actually left on sale. Counts only — a visitor can never read a booking row.';

revoke execute on function public.get_event_night_availability(uuid) from public;
grant execute on function public.get_event_night_availability(uuid) to anon, authenticated, service_role;


-- The seed's codes are lower case ("girls-2") and an organiser may type "Girls-2";
-- both are one pass, quoted one way at the door. A case-folded unique index makes
-- that a fact rather than a convention, for every writer — this function, a
-- migration, or the SQL editor.
create unique index if not exists pass_categories_event_code_ci_idx
  on public.pass_categories (event_id, upper(code));


-- -----------------------------------------------------------------------------
-- 6. Shared helpers for the two admin save functions
-- -----------------------------------------------------------------------------

-- The event a pass or a night belongs to, when the caller did not name one.
create or replace function public.admin_default_event_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select e.id
  from public.events e
  order by (e.status = 'published') desc, e.created_at
  limit 1;
$$;

comment on function public.admin_default_event_id() is
  'The event the admin screens operate on: the published one, or the oldest if none is published.';

revoke all on function public.admin_default_event_id() from public;
revoke all on function public.admin_default_event_id() from anon, authenticated;
grant execute on function public.admin_default_event_id() to service_role;


-- -----------------------------------------------------------------------------
-- 7. The pass catalogue
--
-- Everything an organiser needs to run the ticket desk, and the numbers they need
-- to decide with: what is on sale, at what price, for how many people, how many
-- have been sold, and how much they have taken.
-- -----------------------------------------------------------------------------
create or replace function public.admin_pass_catalogue(p_event_id uuid default null)
returns table (
  pass_uuid        uuid,
  code             text,
  name             text,
  composition      text,
  description      text,
  price_inr        integer,
  number_of_people integer,
  max_per_booking  integer,
  min_age          integer,
  is_active        boolean,
  sort_order       integer,
  bookings_count   integer,
  paid_bookings    integer,
  passes_issued    integer,
  people_sold      integer,
  revenue_inr      integer,
  created_at       timestamptz,
  updated_at       timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with target as (
    select coalesce(p_event_id, public.admin_default_event_id()) as event_id
  ),
  sold as (
    select
      b.pass_category_id,
      count(*)::integer                                            as bookings_count,
      count(*) filter (where b.payment_status = 'paid')::integer    as paid_bookings,
      coalesce(sum(b.number_of_people) filter (where b.payment_status = 'paid'), 0)::integer as people_sold,
      coalesce(sum(b.total_amount) filter (where b.payment_status = 'paid'), 0)::integer      as revenue_inr
    from public.bookings b
    where b.pass_category_id is not null
    group by b.pass_category_id
  ),
  issued as (
    select b.pass_category_id, count(dp.id)::integer as passes_issued
    from public.bookings b
    join public.digital_passes dp on dp.booking_id = b.id
    where b.payment_status = 'paid'
    group by b.pass_category_id
  )
  select
    p.id,
    p.code,
    p.name,
    p.composition,
    p.description,
    p.price_inr,
    p.number_of_people,
    p.max_per_booking,
    p.min_age,
    p.is_active,
    p.sort_order,
    coalesce(s.bookings_count, 0),
    coalesce(s.paid_bookings, 0),
    coalesce(i.passes_issued, 0),
    coalesce(s.people_sold, 0),
    coalesce(s.revenue_inr, 0),
    p.created_at,
    p.updated_at
  from public.pass_categories p
  cross join target t
  left join sold s on s.pass_category_id = p.id
  left join issued i on i.pass_category_id = p.id
  where p.event_id = t.event_id
  order by p.sort_order, p.price_inr, p.name;
$$;

comment on function public.admin_pass_catalogue(uuid) is
  'Every pass type for an event — on sale or not — with what has been sold on it: bookings, paid bookings, passes issued, people and takings. Read-only; the writes below are narrow functions on purpose.';

revoke all on function public.admin_pass_catalogue(uuid) from public;
revoke all on function public.admin_pass_catalogue(uuid) from anon, authenticated;
grant execute on function public.admin_pass_catalogue(uuid) to service_role;


-- -----------------------------------------------------------------------------
-- 8. Create or edit a pass
--
-- One function for both, because the validation is identical and the only
-- difference is whether the row exists yet. Every rule is checked here, in the
-- order a form reads: name, code, composition, price, people, per-booking limit,
-- age. An invalid value raises with a code the app turns into a message under the
-- field that caused it.
-- -----------------------------------------------------------------------------
create or replace function public.admin_save_pass_category(
  p_id                uuid,
  p_event_id          uuid,
  p_code              text,
  p_name              text,
  p_composition       text,
  p_description       text,
  p_price_inr         integer,
  p_number_of_people  integer,
  p_max_per_booking   integer,
  p_min_age           integer,
  p_sort_order        integer,
  p_is_active         boolean
)
returns table (
  pass_uuid        uuid,
  code             text,
  name             text,
  composition      text,
  description      text,
  price_inr        integer,
  number_of_people integer,
  max_per_booking  integer,
  min_age          integer,
  is_active        boolean,
  sort_order       integer,
  created_at       timestamptz,
  updated_at       timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid := coalesce(p_event_id, public.admin_default_event_id());
  v_code     text := btrim(coalesce(p_code, ''));
  v_name     text := btrim(coalesce(p_name, ''));
  v_compose  text := btrim(coalesce(p_composition, ''));
  v_id       uuid := p_id;
  v_age      integer := coalesce(p_min_age, 0);
  v_order    integer := coalesce(p_sort_order, 0);
  v_active   boolean := coalesce(p_is_active, true);
begin
  if v_event_id is null then
    raise exception 'pass_not_configured' using errcode = 'PC010';
  end if;

  if v_name = '' or length(v_name) > 60 then
    raise exception 'pass_name_invalid' using errcode = 'PC001', detail = 'name';
  end if;

  -- The code is the stable, human-quotable handle ("girls-2", "Squad-4"). Spaces and
  -- underscores become dashes so it is one word at the desk, and the organiser's own
  -- capitalisation is kept — "Family Pass" stays "Family-Pass" rather than being
  -- shouted back at them. What is *not* allowed is two codes that differ only by
  -- case: the case-folded unique index added above makes that a fact for every
  -- writer, so "Family-Pass" and "family-pass" cannot become two rows at two prices.
  v_code := replace(replace(v_code, ' ', '-'), '_', '-');

  if v_code !~ '^[A-Za-z0-9-]{2,24}$' then
    raise exception 'pass_code_invalid' using errcode = 'PC002', detail = 'code';
  end if;

  if v_compose = '' or length(v_compose) > 80 then
    raise exception 'pass_composition_invalid' using errcode = 'PC009', detail = 'composition';
  end if;

  -- The price is whole rupees the organiser sets; Razorpay is billed in paise from
  -- it. Refusing 0 is deliberate: a free pass is a marketing decision that needs a
  -- payment method that does not exist here, and a typo would be worse.
  if p_price_inr is null or p_price_inr < 1 or p_price_inr > 500000 then
    raise exception 'pass_price_invalid' using errcode = 'PC004', detail = 'price_inr';
  end if;

  if p_number_of_people is null or p_number_of_people < 1 or p_number_of_people > 50 then
    raise exception 'pass_people_invalid' using errcode = 'PC005', detail = 'number_of_people';
  end if;

  if p_max_per_booking is null or p_max_per_booking < 1 or p_max_per_booking > 100 then
    raise exception 'pass_max_per_booking_invalid' using errcode = 'PC006', detail = 'max_per_booking';
  end if;

  if v_age < 0 or v_age > 120 then
    raise exception 'pass_age_invalid' using errcode = 'PC007', detail = 'min_age';
  end if;

  if v_order < 0 or v_order > 9999 then
    raise exception 'pass_sort_order_invalid' using errcode = 'PC011', detail = 'sort_order';
  end if;

  if v_id is null then
    begin
      insert into public.pass_categories (
        event_id, code, name, composition, description,
        price_inr, number_of_people, max_per_booking, min_age, sort_order, is_active
      )
      values (
        v_event_id, v_code, v_name, v_compose, nullif(btrim(coalesce(p_description, '')), ''),
        p_price_inr, p_number_of_people, p_max_per_booking, v_age, v_order, v_active
      )
      returning id into v_id;
    exception
      when unique_violation then
        raise exception 'pass_code_duplicate' using errcode = 'PC003', detail = 'code';
    end;
  else
    -- The event is not reassignable: a pass that has been sold belongs to the event
    -- it was sold for, and moving it would rewrite history.
    update public.pass_categories p
       set code             = v_code,
           name             = v_name,
           composition      = v_compose,
           description      = nullif(btrim(coalesce(p_description, '')), ''),
           price_inr        = p_price_inr,
           number_of_people = p_number_of_people,
           max_per_booking  = p_max_per_booking,
           min_age          = v_age,
           sort_order       = v_order,
           is_active        = v_active
     where p.id = v_id
       and p.event_id = v_event_id;

    if not found then
      raise exception 'pass_not_found' using errcode = 'PC008';
    end if;
  end if;

  return query
    select c.id, c.code, c.name, c.composition, c.description,
           c.price_inr, c.number_of_people, c.max_per_booking, c.min_age,
           c.is_active, c.sort_order, c.created_at, c.updated_at
    from public.pass_categories c
    where c.id = v_id;
end;
$$;

comment on function public.admin_save_pass_category(uuid, uuid, text, text, text, text, integer, integer, integer, integer, integer, boolean) is
  'Creates (p_id null) or updates one pass type, with every rule in the database rather than the form: name and composition required, code normalised and unique per event, price 1..500000 rupees, people 1..50, at most 100 per booking, age 0..120. Error codes PC001-PC011 name the offending field.';

revoke all on function public.admin_save_pass_category(uuid, uuid, text, text, text, text, integer, integer, integer, integer, integer, boolean) from public;
revoke all on function public.admin_save_pass_category(uuid, uuid, text, text, text, text, integer, integer, integer, integer, integer, boolean) from anon, authenticated;
grant execute on function public.admin_save_pass_category(uuid, uuid, text, text, text, text, integer, integer, integer, integer, integer, boolean) to service_role;


-- -----------------------------------------------------------------------------
-- 9. Enable or disable a pass
--
-- Its own function so the control that takes a pass off sale cannot rewrite the
-- price, the age or the composition on its way past.
-- -----------------------------------------------------------------------------
create or replace function public.admin_set_pass_category_active(
  p_id        uuid,
  p_is_active boolean
)
returns table (
  pass_uuid  uuid,
  code       text,
  name       text,
  is_active  boolean,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_id is null or p_is_active is null then
    raise exception 'pass_not_found' using errcode = 'PC008';
  end if;

  update public.pass_categories p
     set is_active = p_is_active
   where p.id = p_id;

  if not found then
    raise exception 'pass_not_found' using errcode = 'PC008';
  end if;

  return query
    select c.id, c.code, c.name, c.is_active, c.updated_at
    from public.pass_categories c
    where c.id = p_id;
end;
$$;

comment on function public.admin_set_pass_category_active(uuid, boolean) is
  'Takes one pass on or off sale. Deliberately narrow: nothing else about the pass is touched, and nothing is deleted — a pass with bookings on it stays as the record of what was sold.';

revoke all on function public.admin_set_pass_category_active(uuid, boolean) from public;
revoke all on function public.admin_set_pass_category_active(uuid, boolean) from anon, authenticated;
grant execute on function public.admin_set_pass_category_active(uuid, boolean) to service_role;


-- -----------------------------------------------------------------------------
-- 10. The nights
--
-- Same shape as the pass catalogue: one read that carries the numbers an organiser
-- decides with, so the screen never has to count anything itself.
-- -----------------------------------------------------------------------------
create or replace function public.admin_event_dates(p_event_id uuid default null)
returns table (
  date_uuid        uuid,
  event_date       date,
  start_time       time,
  end_time         time,
  night_status     text,
  capacity         integer,
  capacity_held    integer,
  booking_open     boolean,
  notes            text,
  booked_people    integer,
  booked_bookings  integer,
  passes_issued    integer,
  seats_on_sale    integer,
  seats_available  integer,
  over_committed   boolean,
  is_full          boolean,
  created_at       timestamptz,
  updated_at       timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with target as (
    select coalesce(p_event_id, public.admin_default_event_id()) as event_id
  ),
  taken as (
    select
      b.event_date_id,
      coalesce(sum(b.number_of_people) filter (where b.payment_status = 'paid'), 0)::integer as booked_people,
      count(*) filter (where b.payment_status = 'paid')::integer                              as booked_bookings
    from public.bookings b
    group by b.event_date_id
  ),
  issued as (
    select b.event_date_id, count(dp.id)::integer as passes_issued
    from public.bookings b
    join public.digital_passes dp on dp.booking_id = b.id
    where b.payment_status = 'paid'
    group by b.event_date_id
  )
  select
    d.id,
    d.event_date,
    d.start_time,
    d.end_time,
    d.status,
    d.capacity,
    d.capacity_held,
    d.booking_open,
    d.notes,
    coalesce(t.booked_people, 0),
    coalesce(t.booked_bookings, 0),
    coalesce(i.passes_issued, 0),
    -- What is on sale, and what is left of it. Both are computed here rather than
    -- in the screen: a night's arithmetic is the database's, once.
    greatest(d.capacity - d.capacity_held, 0),
    greatest(d.capacity - d.capacity_held - coalesce(t.booked_people, 0), 0),
    (coalesce(t.booked_people, 0) + d.capacity_held > d.capacity),
    (d.status = 'sold_out' or coalesce(t.booked_people, 0) + d.capacity_held >= d.capacity),
    d.created_at,
    d.updated_at
  from public.event_dates d
  cross join target g
  left join taken t on t.event_date_id = d.id
  left join issued i on i.event_date_id = d.id
  where d.event_id = g.event_id
  order by d.event_date;
$$;

comment on function public.admin_event_dates(uuid) is
  'Every night of an event with what is on sale and what is left: capacity, seats held back, paid people, passes issued, seats available, and whether the night is over-committed or full. Aggregated in SQL so the screen counts nothing.';

revoke all on function public.admin_event_dates(uuid) from public;
revoke all on function public.admin_event_dates(uuid) from anon, authenticated;
grant execute on function public.admin_event_dates(uuid) to service_role;


-- -----------------------------------------------------------------------------
-- 11. Add or edit a night
--
-- The row is locked before anything is counted, so a capacity this function agrees
-- to cannot be made wrong by a payment landing in the next millisecond: the
-- customer's booking is holding the same lock.
-- -----------------------------------------------------------------------------
create or replace function public.admin_save_event_date(
  p_id            uuid,
  p_event_id      uuid,
  p_event_date    date,
  p_start_time    time,
  p_end_time      time,
  p_capacity      integer,
  p_capacity_held integer,
  p_status        text,
  p_booking_open  boolean,
  p_notes         text
)
returns table (
  date_uuid    uuid,
  event_date   date,
  start_time   time,
  end_time     time,
  night_status text,
  capacity     integer,
  capacity_held integer,
  booking_open boolean,
  notes        text,
  booked_people integer,
  seats_available integer,
  updated_at   timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid := coalesce(p_event_id, public.admin_default_event_id());
  v_id       uuid := p_id;
  v_status   text := coalesce(nullif(btrim(coalesce(p_status, '')), ''), 'scheduled');
  v_held     integer := coalesce(p_capacity_held, 0);
  v_open     boolean := coalesce(p_booking_open, true);
  v_paid     integer;
begin
  if v_event_id is null then
    raise exception 'night_not_found' using errcode = 'PT007';
  end if;

  if p_event_date is null then
    raise exception 'night_date_required' using errcode = 'PT009', detail = 'event_date';
  end if;

  if p_capacity is null or p_capacity < 1 then
    raise exception 'capacity_below_one' using errcode = 'PT001', detail = 'capacity';
  end if;

  if v_held < 0 then
    raise exception 'capacity_held_negative' using errcode = 'PT002', detail = 'capacity_held';
  end if;

  if v_held > p_capacity then
    raise exception 'capacity_held_above_capacity' using errcode = 'PT003', detail = 'capacity_held';
  end if;

  if v_status not in ('scheduled', 'sold_out', 'cancelled', 'completed') then
    raise exception 'night_status_invalid' using errcode = 'PT010', detail = 'status';
  end if;

  if p_start_time is not null and p_end_time is not null and p_end_time <= p_start_time then
    raise exception 'night_time_order' using errcode = 'PT008', detail = 'end_time';
  end if;

  -- 11.1 An existing night is locked before it is measured, so the count below
  -- cannot be stale.
  if v_id is not null then
    perform 1
      from public.event_dates d
     where d.id = v_id and d.event_id = v_event_id
     for update;

    if not found then
      raise exception 'night_not_found' using errcode = 'PT007';
    end if;
  end if;

  -- 11.2 Capacity may not be lowered below the seats already paid for (plus the
  -- ones held back): that is what would make availability negative. The guard
  -- trigger enforces the same rule for any other writer; this carries the numbers
  -- so the message can say what the floor is.
  select coalesce(sum(b.number_of_people) filter (where b.payment_status = 'paid'), 0)::integer
    into v_paid
  from public.bookings b
  where b.event_date_id = v_id;

  if v_paid + v_held > p_capacity then
    raise exception 'capacity_below_taken' using errcode = 'PT004',
      detail = (v_paid + v_held)::text;
  end if;

  if v_id is null then
    begin
      insert into public.event_dates (
        event_id, event_date, start_time, end_time, capacity, capacity_held,
        status, booking_open, notes
      )
      values (
        v_event_id, p_event_date, p_start_time, p_end_time, p_capacity, v_held,
        v_status, v_open, nullif(btrim(coalesce(p_notes, '')), '')
      )
      returning id into v_id;
    exception
      when unique_violation then
        raise exception 'night_duplicate' using errcode = 'PT006', detail = 'event_date';
    end;
  else
    begin
      update public.event_dates d
         set event_date    = p_event_date,
             start_time    = p_start_time,
             end_time      = p_end_time,
             capacity      = p_capacity,
             capacity_held = v_held,
             status        = v_status,
             booking_open  = v_open,
             notes         = nullif(btrim(coalesce(p_notes, '')), '')
       where d.id = v_id;
    exception
      when unique_violation then
        -- Another night of this event already holds that date.
        raise exception 'night_duplicate' using errcode = 'PT006', detail = 'event_date';
    end;
  end if;

  return query
    select d.id, d.event_date, d.start_time, d.end_time, d.status, d.capacity,
           d.capacity_held, d.booking_open, d.notes,
           coalesce((select sum(b.number_of_people) from public.bookings b
                      where b.event_date_id = d.id and b.payment_status = 'paid'), 0)::integer,
           -- Cast because sum() is bigint and both return columns are integer: without
           -- it Postgres refuses the row at RETURN QUERY time, not at call time.
           (greatest(d.capacity - d.capacity_held
                     - coalesce((select sum(b.number_of_people) from public.bookings b
                                  where b.event_date_id = d.id and b.payment_status = 'paid'), 0), 0))::integer,
           d.updated_at
    from public.event_dates d
    where d.id = v_id;
end;
$$;

comment on function public.admin_save_event_date(uuid, uuid, date, time, time, integer, integer, text, boolean, text) is
  'Creates (p_id null) or edits one night: date, times, capacity, seats held back, status, booking open/closed and notes. Locks the night before counting, refuses capacity below seats paid for (PT004 carries the floor), an impossible held figure (PT002/PT003) or a duplicate date (PT006).';

revoke all on function public.admin_save_event_date(uuid, uuid, date, time, time, integer, integer, text, boolean, text) from public;
revoke all on function public.admin_save_event_date(uuid, uuid, date, time, time, integer, integer, text, boolean, text) from anon, authenticated;
grant execute on function public.admin_save_event_date(uuid, uuid, date, time, time, integer, integer, text, boolean, text) to service_role;


-- -----------------------------------------------------------------------------
-- 12. The two controls an organiser reaches for mid-event
--
-- "The queue is longer than we thought, open another 200 seats" and "we are full,
-- stop selling" happen in the moment, from a phone, while the event is running.
-- They get their own narrow functions so neither can arrive with a whole form
-- attached to it — and so both can take the night lock and refuse to make
-- availability negative, with the floor in the error.
-- -----------------------------------------------------------------------------
create or replace function public.admin_set_event_date_capacity(
  p_id            uuid,
  p_capacity      integer,
  p_capacity_held integer default null
)
returns table (
  date_uuid       uuid,
  capacity        integer,
  capacity_held   integer,
  booked_people   integer,
  seats_available integer,
  updated_at      timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_held integer;
  v_paid integer;
begin
  if p_id is null then
    raise exception 'night_not_found' using errcode = 'PT007';
  end if;

  if p_capacity is null or p_capacity < 1 then
    raise exception 'capacity_below_one' using errcode = 'PT001', detail = 'capacity';
  end if;

  -- The night is locked first: whoever else is counting seats for it — a customer
  -- paying for the last one — finishes before this reads.
  perform 1 from public.event_dates d where d.id = p_id for update;

  if not found then
    raise exception 'night_not_found' using errcode = 'PT007';
  end if;

  select d.capacity_held into v_held from public.event_dates d where d.id = p_id;
  v_held := coalesce(p_capacity_held, v_held);

  if v_held < 0 then
    raise exception 'capacity_held_negative' using errcode = 'PT002', detail = 'capacity_held';
  end if;

  if v_held > p_capacity then
    raise exception 'capacity_held_above_capacity' using errcode = 'PT003', detail = 'capacity_held';
  end if;

  select coalesce(sum(b.number_of_people) filter (where b.payment_status = 'paid'), 0)::integer
    into v_paid
  from public.bookings b
  where b.event_date_id = p_id;

  if v_paid + v_held > p_capacity then
    raise exception 'capacity_below_taken' using errcode = 'PT004',
      detail = (v_paid + v_held)::text;
  end if;

  update public.event_dates d
     set capacity = p_capacity,
         capacity_held = v_held
   where d.id = p_id;

  return query
    select d.id, d.capacity, d.capacity_held, v_paid,
           greatest(d.capacity - d.capacity_held - v_paid, 0),
           d.updated_at
    from public.event_dates d
    where d.id = p_id;
end;
$$;

comment on function public.admin_set_event_date_capacity(uuid, integer, integer) is
  'Sets a night''s capacity, and optionally how many seats are held back from online booking. Locks the night, refuses a capacity below seats paid for or held (PT004 carries the lowest allowed figure), so availability can never be made negative.';

revoke all on function public.admin_set_event_date_capacity(uuid, integer, integer) from public;
revoke all on function public.admin_set_event_date_capacity(uuid, integer, integer) from anon, authenticated;
grant execute on function public.admin_set_event_date_capacity(uuid, integer, integer) to service_role;


create or replace function public.admin_set_event_date_booking(
  p_id           uuid,
  p_booking_open boolean
)
returns table (
  date_uuid    uuid,
  booking_open boolean,
  night_status text,
  capacity     integer,
  capacity_held integer,
  booked_people integer,
  seats_available integer,
  updated_at   timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid integer;
begin
  if p_id is null or p_booking_open is null then
    raise exception 'night_not_found' using errcode = 'PT007';
  end if;

  perform 1 from public.event_dates d where d.id = p_id for update;

  if not found then
    raise exception 'night_not_found' using errcode = 'PT007';
  end if;

  update public.event_dates d
     set booking_open = p_booking_open
   where d.id = p_id;

  select coalesce(sum(b.number_of_people) filter (where b.payment_status = 'paid'), 0)::integer
    into v_paid
  from public.bookings b
  where b.event_date_id = p_id;

  return query
    select d.id, d.booking_open, d.status, d.capacity, d.capacity_held, v_paid,
           greatest(d.capacity - d.capacity_held - v_paid, 0),
           d.updated_at
    from public.event_dates d
    where d.id = p_id;
end;
$$;

comment on function public.admin_set_event_date_booking(uuid, boolean) is
  'Opens or closes booking on one night without touching the night''s status, capacity or dates. Closing it makes create_pending_booking refuse the night (PB002) exactly as a cancelled night would.';

revoke all on function public.admin_set_event_date_booking(uuid, boolean) from public;
revoke all on function public.admin_set_event_date_booking(uuid, boolean) from anon, authenticated;
grant execute on function public.admin_set_event_date_booking(uuid, boolean) to service_role;
