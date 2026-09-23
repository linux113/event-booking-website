-- =============================================================================
-- 17 · One admin, no roles — plus the columns the new brief asks for
--
-- Why this exists
--   The application is moving off Supabase onto Neon through a single trusted
--   server-side connection, and off the staff/role model onto one admin account
--   authenticated by the app itself. In that world the database does not need to
--   know who is asking:
--
--     * there is one admin, so there is no staff table, no roles and no
--       permissions matrix — and nothing left that references the Supabase auth
--       schema;
--     * the gate verdict (pass_entry) no longer resolves a staff row: the session
--       was already proven before the call, and the audit row records the booking
--       instead of the staff member;
--     * it adds the columns the brief specifies that did not exist yet.
--
-- What survives, deliberately
--   The six public read policies (published events, their nights, active passes,
--   published gallery, highlights, features) stay, and are now the only policies
--   in the database. The app no longer reads through them — it connects as the
--   table owner, which bypasses RLS — but they remain the database-side boundary:
--   anything connecting as `anon` can still read exactly the public surface and
--   nothing else. Everything that protects a pass or a payment (token shape,
--   payment-confirmed, compare-and-swap check-in, unique(digital_pass_id)) is
--   untouched.
--
-- Idempotent: every statement is guarded, so re-running it changes nothing.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 · The columns the brief asks for
-- ---------------------------------------------------------------------------

-- events: bilingual copy, a logo, and the festival window. The banner is the
-- existing `hero_image_url` (mapped as banner_url in Prisma) so there is exactly
-- one banner column, not two that can disagree.
alter table public.events
  add column if not exists name_hindi        text,
  add column if not exists description_hindi text,
  add column if not exists venue_hindi       text,
  add column if not exists logo_url          text,
  add column if not exists start_date        date,
  add column if not exists end_date          date;

comment on column public.events.name_hindi        is 'Hindi name of the festival. Falls back to events.name when empty.';
comment on column public.events.description_hindi is 'Hindi description. Falls back to events.description when empty.';
comment on column public.events.venue_hindi       is 'Hindi venue line. Falls back to events.venue_name when empty.';
comment on column public.events.logo_url          is 'Organiser logo, shown in the header and on the digital pass.';
comment on column public.events.start_date        is 'First night of the festival. Kept in step with event_dates by the admin screens.';
comment on column public.events.end_date          is 'Last night of the festival. Kept in step with event_dates by the admin screens.';

-- pass_categories: Hindi name, its own image, and the brief's `status`. Status is
-- derived from `is_active` — the flag every existing function, the catalogue RPCs
-- and the admin screen already own — so there is one source of truth with two
-- spellings rather than two columns that can disagree.
alter table public.pass_categories
  add column if not exists name_hindi text,
  add column if not exists image_url  text,
  add column if not exists status     text generated always as (
    case when is_active then 'active' else 'inactive' end) stored;

comment on column public.pass_categories.name_hindi is 'Hindi pass name. Falls back to pass_categories.name when empty.';
comment on column public.pass_categories.image_url  is 'Optional image for the pass card.';
comment on column public.pass_categories.status     is 'Derived from is_active: active | inactive. Read-only.';

-- event_dates: the brief's available_capacity, derived so it cannot drift from
-- capacity/capacity_held and cannot go negative. The existing
-- event_dates_guard_capacity trigger is what keeps capacity_held honest.
alter table public.event_dates
  add column if not exists available_capacity integer generated always as (
    greatest(capacity - capacity_held, 0)) stored;

comment on column public.event_dates.available_capacity is 'Derived: greatest(capacity - capacity_held, 0). Read-only.';

-- check_ins: the booking on the audit row (the brief asks for it), a created_at,
-- and no staff id.
alter table public.check_ins
  add column if not exists booking_id uuid references public.bookings (id) on delete cascade,
  add column if not exists created_at timestamptz not null default now();

update public.check_ins c
   set booking_id = p.booking_id
  from public.digital_passes p
 where p.id = c.digital_pass_id
   and c.booking_id is null;

alter table public.check_ins alter column booking_id set not null;
alter table public.check_ins drop column if exists checked_in_by;

create index if not exists check_ins_booking_idx on public.check_ins (booking_id);

comment on column public.check_ins.booking_id is 'The booking this entry belongs to, denormalised from the pass at check-in time.';

-- ---------------------------------------------------------------------------
-- 2 · The role system goes
-- ---------------------------------------------------------------------------
-- Order matters. Policies reference the helper functions; the helper functions
-- read admin_users; check_ins.checked_in_by referenced admin_users too (dropped
-- above). Everything that depends on a role goes before the thing it depends on.

drop policy if exists admin_users_admin_read            on public.admin_users;
drop policy if exists admin_users_super_admin_manage    on public.admin_users;
drop policy if exists bookings_admin_read               on public.bookings;
drop policy if exists bookings_admin_update             on public.bookings;
drop policy if exists check_ins_admin_insert            on public.check_ins;
drop policy if exists check_ins_staff_read              on public.check_ins;
drop policy if exists digital_passes_admin_read         on public.digital_passes;
drop policy if exists digital_passes_admin_update       on public.digital_passes;
drop policy if exists event_dates_admin_manage          on public.event_dates;
drop policy if exists event_dates_authenticated_read    on public.event_dates;
drop policy if exists event_features_admin_manage       on public.event_features;
drop policy if exists event_features_authenticated_read on public.event_features;
drop policy if exists event_highlights_admin_manage     on public.event_highlights;
drop policy if exists event_highlights_authenticated_read on public.event_highlights;
drop policy if exists events_admin_manage               on public.events;
drop policy if exists events_authenticated_read         on public.events;
drop policy if exists gallery_admin_manage              on public.gallery;
drop policy if exists gallery_authenticated_read        on public.gallery;
drop policy if exists pass_categories_admin_manage      on public.pass_categories;
drop policy if exists pass_categories_authenticated_read on public.pass_categories;

drop function if exists public.is_staff(uuid);
drop function if exists public.is_admin(uuid);
drop function if exists public.is_super_admin(uuid);
drop function if exists public.current_staff_role();

-- The allow-list itself. It referenced auth.users, so this also removes the last
-- database object that knew about Supabase Auth.
drop table if exists public.admin_users;

-- ---------------------------------------------------------------------------
-- 3 · The admin read models that joined the staff table
-- ---------------------------------------------------------------------------
-- Three SQL functions read admin_users (to label who admitted a pass, and to
-- count staff on the dashboard). A SQL function body is parsed when it is
-- created, so these must be restated in the same migration that drops the table.
--
-- admin_booking_detail and admin_pass_list also lose their customer_email column
-- here rather than in the next migration: it dies with the same join in the same
-- restatement, and restating a function twice to change it twice would be worse.
--
-- `admitted_by` is kept in the pass list's result shape and returned as null: the
-- staff identity it described no longer exists, and dropping the column would
-- change the function's return type for no benefit.

drop function if exists public.admin_booking_detail(text, boolean);
drop function if exists public.admin_dashboard_stats(date, text, boolean);

CREATE OR REPLACE FUNCTION public.admin_booking_detail(p_lookup text, p_include_contact boolean DEFAULT true)
 RETURNS TABLE(booking_uuid uuid, booking_id text, customer_name text, customer_mobile text, event_name text, event_slug text, venue_name text, venue_address text, city text, event_date date, start_time time without time zone, end_time time without time zone, pass_name text, pass_composition text, quantity integer, number_of_people integer, subtotal integer, total_amount integer, currency text, booking_status text, payment_status text, razorpay_order_id text, razorpay_payment_id text, notes text, created_at timestamp with time zone, updated_at timestamp with time zone, passes jsonb, check_ins jsonb, payment_events jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with target as (
    select b.*
    from public.bookings b
    where coalesce(btrim(p_lookup), '') <> ''
      and (
        lower(b.booking_id) = lower(btrim(p_lookup))
        or b.razorpay_payment_id = btrim(p_lookup)
        or b.razorpay_order_id = btrim(p_lookup)
        or exists (
          select 1 from public.digital_passes dp
          where dp.booking_id = b.id and lower(dp.pass_id) = lower(btrim(p_lookup))
        )
      )
    limit 1
  )
  select
    b.id,
    b.booking_id,
    b.customer_name,
    case when p_include_contact then b.customer_mobile end,
    e.name,
    e.slug,
    e.venue_name,
    e.venue_address,
    e.city,
    d.event_date,
    d.start_time,
    d.end_time,
    p.name,
    p.composition,
    b.quantity,
    b.number_of_people,
    case when p_include_contact then b.subtotal end,
    case when p_include_contact then b.total_amount end,
    e.currency,
    b.booking_status,
    b.payment_status,
    case when p_include_contact then b.razorpay_order_id end,
    case when p_include_contact then b.razorpay_payment_id end,
    case when p_include_contact then b.notes end,
    b.created_at,
    b.updated_at,
    coalesce(
      (
        select jsonb_agg(
                 jsonb_build_object(
                   'pass_id', dp.pass_id,
                   'pass_number', dp.pass_number,
                   'status', dp.status,
                   'checked_in', dp.checked_in,
                   'checked_in_at', dp.checked_in_at,
                   'valid_date', dp.valid_date
                 )
                 order by dp.pass_number
               )
        from public.digital_passes dp
        where dp.booking_id = b.id
      ),
      '[]'::jsonb
    ),
    coalesce(
      (
        select jsonb_agg(
                 jsonb_build_object(
                   'checked_in_at', ci.checked_in_at,
                   'gate', ci.gate,
                   'notes', ci.notes,
                   'pass_id', dp.pass_id
                 )
                 order by ci.checked_in_at
               )
        from public.check_ins ci
        join public.digital_passes dp on dp.id = ci.digital_pass_id
        where dp.booking_id = b.id
      ),
      '[]'::jsonb
    ),
    case
      when p_include_contact then coalesce(
        (
          select jsonb_agg(
                   jsonb_build_object(
                     'event_id', pe.event_id,
                     'event_type', pe.event_type,
                     'outcome', pe.outcome,
                     'amount_paise', pe.amount_paise,
                     'received_at', pe.received_at,
                     'processed_at', pe.processed_at
                   )
                   order by pe.received_at
                 )
          from public.payment_events pe
          where pe.razorpay_order_id = b.razorpay_order_id
             or (b.razorpay_payment_id is not null and pe.razorpay_payment_id = b.razorpay_payment_id)
        ),
        '[]'::jsonb
      )
    end
  from target b
  join public.event_dates d     on d.id = b.event_date_id
  join public.events e          on e.id = d.event_id
  join public.pass_categories p on p.id = b.pass_category_id;
$function$;

CREATE OR REPLACE FUNCTION public.admin_pass_list(p_query text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_check_in text DEFAULT NULL::text, p_event_date_id uuid DEFAULT NULL::uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_include_contact boolean DEFAULT true, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS TABLE(pass_uuid uuid, pass_id text, pass_number integer, pass_status text, checked_in boolean, checked_in_at timestamp with time zone, valid_date date, gate text, admitted_by text, issued_at timestamp with time zone, booking_uuid uuid, booking_id text, booking_status text, payment_status text, customer_name text, customer_mobile text, pass_name text, quantity integer, number_of_people integer, total_amount integer, currency text, event_name text, start_time time without time zone, end_time time without time zone, passes_on_booking integer, total_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with params as (
    select
      nullif(left(btrim(coalesce(p_query, '')), 64), '') as q,
      public.admin_search_pattern(p_query)               as q_like,
      public.admin_search_digits(p_query)                as q_digits,
      greatest(1, least(coalesce(p_limit, 25), 100))     as page_size,
      greatest(0, coalesce(p_offset, 0))                 as page_offset,
      case when p_status in ('active', 'used', 'cancelled', 'expired')
           then p_status end                             as status,
      case when p_check_in in ('in', 'out') then p_check_in end as check_in,
      -- The night a filter asks for, resolved once. An id that matches no night
      -- resolves to null, and nothing matches a null night — the honest answer.
      (select d.event_date from public.event_dates d where d.id = p_event_date_id) as night
  ),
  matched as (
    select
      dp.id,
      dp.created_at,
      b.booking_id,
      dp.pass_number,
      count(*) over ()::integer as total_count
    from public.digital_passes dp
    join public.bookings b on b.id = dp.booking_id
    cross join params p
    where (
        p.q is null
        or dp.pass_id ilike '%' || p.q_like || '%'
        or b.booking_id ilike '%' || p.q_like || '%'
        or b.customer_name ilike '%' || p.q_like || '%'
        or (p.q_digits <> '' and regexp_replace(b.customer_mobile, '\D', '', 'g') like '%' || p.q_digits || '%')
      )
      and (p.status is null or dp.status = p.status)
      -- "in" and "out" are about the pass's own flag, not about its status: a pass
      -- cancelled after the guest was admitted is still a pass that let somebody in.
      and (p.check_in is null
           or (p.check_in = 'in' and dp.checked_in)
           or (p.check_in = 'out' and not dp.checked_in))
      and (p.night is null or dp.valid_date = p.night)
      and (p_from is null or dp.valid_date >= p_from)
      and (p_to is null or dp.valid_date <= p_to)
  ),
  page as (
    select m.id, m.booking_id, m.pass_number, m.total_count
    from matched m
    order by m.created_at desc, m.booking_id desc, m.pass_number desc
    limit (select page_size from params)
    offset (select page_offset from params)
  )
  select
    dp.id,
    dp.pass_id,
    dp.pass_number,
    dp.status,
    dp.checked_in,
    dp.checked_in_at,
    dp.valid_date,
    ci.gate,
    null::text,
    dp.created_at,
    b.id,
    b.booking_id,
    b.booking_status,
    b.payment_status,
    b.customer_name,
    case when p_include_contact then b.customer_mobile end,
    pc.name,
    b.quantity,
    b.number_of_people,
    case when p_include_contact then b.total_amount end,
    e.currency,
    e.name,
    d.start_time,
    d.end_time,
    -- How many passes this booking holds in total: a door needs to know that the
    -- guest in front of them is pass 1 of 4, without opening the booking.
    (select count(*)::integer from public.digital_passes allp where allp.booking_id = b.id),
    pg.total_count
  from page pg
  join public.digital_passes dp on dp.id = pg.id
  join public.bookings b         on b.id = dp.booking_id
  -- The night the booking is for. The pass's own valid_date is the same date by
  -- construction (the payment function copies it), so this is a lookup, not a join
  -- that could drop a pass.
  join public.event_dates d      on d.id = b.event_date_id
  join public.events e           on e.id = d.event_id
  join public.pass_categories pc on pc.id = b.pass_category_id
  left join public.check_ins ci  on ci.digital_pass_id = dp.id
  order by dp.created_at desc, b.booking_id desc, dp.pass_number desc;
$function$;

CREATE OR REPLACE FUNCTION public.admin_dashboard_stats(p_today date, p_tz text DEFAULT 'UTC'::text, p_include_revenue boolean DEFAULT true)
 RETURNS TABLE(bookings_total integer, bookings_confirmed integer, bookings_paid integer, bookings_pending integer, bookings_refunded integer, bookings_today integer, revenue_total integer, revenue_today integer, revenue_refunded integer, check_ins_total integer, check_ins_today integer, passes_issued integer, passes_active integer, passes_used integer, people_paid integer, capacity_total integer, capacity_taken integer, capacity_available integer, tonight_date date, tonight_capacity integer, tonight_taken integer, tonight_available integer, nights_total integer, nights_upcoming integer, gallery_published integer, gallery_draft integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with booked as (
    select
      b.id,
      b.number_of_people,
      b.total_amount,
      b.booking_status,
      b.payment_status,
      (b.created_at at time zone p_tz)::date as booked_on,
      d.event_date,
      d.status as night_status
      from public.bookings b
      join public.event_dates d on d.id = b.event_date_id
  ),
  paid as (
    select * from booked where payment_status = 'paid'
  ),
  -- Capacity is a property of a *night*, so these are the nights themselves. Summing
  -- capacity over booking rows would count a busy night's capacity once per booking,
  -- which is the kind of wrong number that looks plausible on a dashboard.
  upcoming_nights as (
    select d.id, d.event_date, d.capacity
      from public.event_dates d
     where d.status = 'scheduled'
       and d.event_date >= p_today
  ),
  tonight_nights as (
    select * from upcoming_nights where event_date = p_today
  ),
  taken_upcoming as (
    select coalesce(sum(b.number_of_people), 0) as people
      from public.bookings b
      join public.event_dates d on d.id = b.event_date_id
     where b.payment_status = 'paid'
       and d.status = 'scheduled'
       and d.event_date >= p_today
  ),
  taken_tonight as (
    select coalesce(sum(b.number_of_people), 0) as people
      from public.bookings b
      join public.event_dates d on d.id = b.event_date_id
     where b.payment_status = 'paid'
       and d.status = 'scheduled'
       and d.event_date = p_today
  )
  select
    (select count(*)::integer from booked),
    (select count(*)::integer from booked where booking_status = 'confirmed'),
    (select count(*)::integer from booked where payment_status = 'paid'),
    (select count(*)::integer from booked where payment_status = 'unpaid'),
    (select count(*)::integer from booked where payment_status = 'refunded'),
    (select count(*)::integer from booked where booked_on = p_today),

    case when p_include_revenue
         then (select coalesce(sum(total_amount), 0)::integer from paid)
    end,
    case when p_include_revenue
         then (select coalesce(sum(total_amount), 0)::integer from paid where booked_on = p_today)
    end,
    case when p_include_revenue
         then (select coalesce(sum(total_amount), 0)::integer from booked where payment_status = 'refunded')
    end,

    (select count(*)::integer from public.check_ins),
    (select count(*)::integer from public.check_ins
      where (checked_in_at at time zone p_tz)::date = p_today),

    (select count(*)::integer from public.digital_passes),
    (select count(*)::integer from public.digital_passes where status = 'active' and not checked_in),
    (select count(*)::integer from public.digital_passes where checked_in),

    (select coalesce(sum(number_of_people), 0)::integer from paid),
    (select coalesce(sum(capacity), 0)::integer from upcoming_nights),
    (select people::integer from taken_upcoming),
    (select greatest(
              coalesce((select sum(capacity) from upcoming_nights), 0)
              - (select people from taken_upcoming),
              0
            )::integer),

    (select min(event_date) from tonight_nights),
    (select coalesce(sum(capacity), 0)::integer from tonight_nights),
    (select people::integer from taken_tonight),
    (select greatest(
              coalesce((select sum(capacity) from tonight_nights), 0)
              - (select people from taken_tonight),
              0
            )::integer),

    (select count(*)::integer from public.event_dates),
    (select count(*)::integer from public.event_dates
      where event_date >= p_today and status = 'scheduled'),
    (select count(*)::integer from public.gallery where status = 'published'),
    (select count(*)::integer from public.gallery where status <> 'published');
$function$
;;


revoke all on function public.admin_booking_detail(text, boolean) from public, anon, authenticated;
revoke all on function public.admin_dashboard_stats(date, text, boolean) from public, anon, authenticated;
grant execute on function public.admin_booking_detail(text, boolean) to service_role;
grant execute on function public.admin_dashboard_stats(date, text, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 4 · The gate verdict, without a staff table
-- ---------------------------------------------------------------------------
-- Dropped in dependency order: the two entry points are SQL functions, so they
-- hold a real dependency on pass_entry.

drop function if exists public.scan_pass(text, date, uuid);
drop function if exists public.check_in_pass(text, date, uuid, text);
drop function if exists public.pass_entry(text, date, uuid, boolean, text);

CREATE OR REPLACE FUNCTION public.pass_entry(p_qr_token text, p_gate_date date, p_commit boolean, p_gate text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, reason text, pass_id text, pass_status text, checked_in boolean, checked_in_at timestamp with time zone, pass_number integer, pass_total integer, customer_name text, pass_name text, pass_composition text, booking_reference text, booking_status text, payment_status text, event_name text, event_date date, start_time time without time zone, end_time time without time zone, venue_name text, venue_address text, city text, gate_date date, staff_name text, check_in_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- The single admin's label, recorded on the check-in row. There is no staff table
  -- any more: the admin session is proven at the edge (src/proxy.ts), not in here.
  v_staff_name text;
  v_pass    record;
  v_total   integer;
  v_updated integer;
  v_log_id  uuid;
begin
  -- 0. Nobody to look up. The scanner is the single admin, who was authenticated
  --    before this function was ever reached, so the verdict starts here.
  v_staff_name := 'Admin';

  -- 1. The shape first: a token that is not 64 hex characters cannot exist, so the
  --    lookup is skipped entirely (and a 1 MB "token" never reaches a query).
  if p_qr_token is null or p_qr_token !~ '^[0-9a-f]{64}$' then
    return query select
      'invalid'::text,
      'That code is not a pass for this event.'::text,
      null::text, null::text, null::boolean, null::timestamptz,
      null::integer, null::integer, null::text, null::text, null::text,
      null::text, null::text, null::text, null::text, null::date,
      null::time, null::time, null::text, null::text, null::text,
      p_gate_date, v_staff_name, null::uuid;

    return;
  end if;

  -- 2. Pass, booking, night and event, in one read. `for update of dp` locks the
  --    pass row: a second scanner waits here and then sees the committed result,
  --    which is what makes the compare-and-swap below impossible to lose.
  select dp.id,
         dp.pass_id,
         dp.status,
         dp.checked_in,
         dp.checked_in_at,
         dp.valid_date,
         b.event_date_id,
         dp.pass_number,
         b.id as booking_uuid,
         b.booking_id as booking_reference,
         b.booking_status,
         b.payment_status,
         b.customer_name,
         pc.name as pass_name,
         pc.composition as pass_composition,
         e.name as event_name,
         e.venue_name,
         e.venue_address,
         e.city,
         e.status as event_status,
         d.status as night_status,
         d.start_time,
         d.end_time
    into v_pass
  from public.digital_passes dp
  join public.bookings b on b.id = dp.booking_id
  join public.event_dates d on d.id = b.event_date_id
  join public.events e on e.id = d.event_id
  join public.pass_categories pc on pc.id = b.pass_category_id
  where dp.qr_token = p_qr_token
  for update of dp;

  if not found then
    return query select
      'invalid'::text,
      'That code does not match any pass for this event.'::text,
      null::text, null::text, null::boolean, null::timestamptz,
      null::integer, null::integer, null::text, null::text, null::text,
      null::text, null::text, null::text, null::text, null::date,
      null::time, null::time, null::text, null::text, null::text,
      p_gate_date, v_staff_name, null::uuid;

    return;
  end if;

  select count(*)::integer
    into v_total
  from public.digital_passes dp
  where dp.booking_id = (select b.id from public.bookings b where b.booking_id = v_pass.booking_reference);

  -- 3. Verdict, worst first. Every branch returns the pass details it has, so the
  --    scanner can show who is standing there even when the answer is no.
  if v_pass.night_status = 'cancelled' or v_pass.event_status <> 'published' then
    return query select 'invalid'::text, 'That night is not taking place.'::text,
      v_pass.pass_id, v_pass.status, v_pass.checked_in, v_pass.checked_in_at,
      v_pass.pass_number, v_total, v_pass.customer_name, v_pass.pass_name, v_pass.pass_composition,
      v_pass.booking_reference, v_pass.booking_status, v_pass.payment_status,
      v_pass.event_name, v_pass.valid_date, v_pass.start_time, v_pass.end_time,
      v_pass.venue_name, v_pass.venue_address, v_pass.city, p_gate_date, v_staff_name, null::uuid;

    return;
  end if;

  if v_pass.status = 'cancelled'
     or v_pass.booking_status in ('refunded', 'cancelled')
     or v_pass.payment_status = 'refunded' then
    return query select 'refunded'::text, 'The booking behind this pass was cancelled or refunded.'::text,
      v_pass.pass_id, v_pass.status, v_pass.checked_in, v_pass.checked_in_at,
      v_pass.pass_number, v_total, v_pass.customer_name, v_pass.pass_name, v_pass.pass_composition,
      v_pass.booking_reference, v_pass.booking_status, v_pass.payment_status,
      v_pass.event_name, v_pass.valid_date, v_pass.start_time, v_pass.end_time,
      v_pass.venue_name, v_pass.venue_address, v_pass.city, p_gate_date, v_staff_name, null::uuid;

    return;
  end if;

  if v_pass.booking_status <> 'confirmed' or v_pass.payment_status <> 'paid' then
    return query select 'payment_not_verified'::text, 'No verified payment is recorded for this booking.'::text,
      v_pass.pass_id, v_pass.status, v_pass.checked_in, v_pass.checked_in_at,
      v_pass.pass_number, v_total, v_pass.customer_name, v_pass.pass_name, v_pass.pass_composition,
      v_pass.booking_reference, v_pass.booking_status, v_pass.payment_status,
      v_pass.event_name, v_pass.valid_date, v_pass.start_time, v_pass.end_time,
      v_pass.venue_name, v_pass.venue_address, v_pass.city, p_gate_date, v_staff_name, null::uuid;

    return;
  end if;

  if v_pass.checked_in or v_pass.status = 'used' then
    return query select 'already_used'::text, 'This pass was already scanned at the gate.'::text,
      v_pass.pass_id, v_pass.status, v_pass.checked_in, v_pass.checked_in_at,
      v_pass.pass_number, v_total, v_pass.customer_name, v_pass.pass_name, v_pass.pass_composition,
      v_pass.booking_reference, v_pass.booking_status, v_pass.payment_status,
      v_pass.event_name, v_pass.valid_date, v_pass.start_time, v_pass.end_time,
      v_pass.venue_name, v_pass.venue_address, v_pass.city, p_gate_date, v_staff_name, null::uuid;

    return;
  end if;

  if v_pass.status = 'expired' or v_pass.valid_date < p_gate_date then
    return query select 'expired'::text, 'This pass was for an earlier night.'::text,
      v_pass.pass_id, v_pass.status, v_pass.checked_in, v_pass.checked_in_at,
      v_pass.pass_number, v_total, v_pass.customer_name, v_pass.pass_name, v_pass.pass_composition,
      v_pass.booking_reference, v_pass.booking_status, v_pass.payment_status,
      v_pass.event_name, v_pass.valid_date, v_pass.start_time, v_pass.end_time,
      v_pass.venue_name, v_pass.venue_address, v_pass.city, p_gate_date, v_staff_name, null::uuid;

    return;
  end if;

  if v_pass.valid_date > p_gate_date then
    return query select 'not_yet_valid'::text, 'This pass is for a later night.'::text,
      v_pass.pass_id, v_pass.status, v_pass.checked_in, v_pass.checked_in_at,
      v_pass.pass_number, v_total, v_pass.customer_name, v_pass.pass_name, v_pass.pass_composition,
      v_pass.booking_reference, v_pass.booking_status, v_pass.payment_status,
      v_pass.event_name, v_pass.valid_date, v_pass.start_time, v_pass.end_time,
      v_pass.venue_name, v_pass.venue_address, v_pass.city, p_gate_date, v_staff_name, null::uuid;

    return;
  end if;

  if v_pass.status <> 'active' then
    return query select 'invalid'::text, 'This pass is no longer usable.'::text,
      v_pass.pass_id, v_pass.status, v_pass.checked_in, v_pass.checked_in_at,
      v_pass.pass_number, v_total, v_pass.customer_name, v_pass.pass_name, v_pass.pass_composition,
      v_pass.booking_reference, v_pass.booking_status, v_pass.payment_status,
      v_pass.event_name, v_pass.valid_date, v_pass.start_time, v_pass.end_time,
      v_pass.venue_name, v_pass.venue_address, v_pass.city, p_gate_date, v_staff_name, null::uuid;

    return;
  end if;

  -- 4. The guest may come in.
  if not p_commit then
    -- Preview only: the scanner shows this, and the button asks for the real thing.
    return query select 'valid'::text, null::text,
      v_pass.pass_id, v_pass.status, v_pass.checked_in, v_pass.checked_in_at,
      v_pass.pass_number, v_total, v_pass.customer_name, v_pass.pass_name, v_pass.pass_composition,
      v_pass.booking_reference, v_pass.booking_status, v_pass.payment_status,
      v_pass.event_name, v_pass.valid_date, v_pass.start_time, v_pass.end_time,
      v_pass.venue_name, v_pass.venue_address, v_pass.city, p_gate_date, v_staff_name, null::uuid;

    return;
  end if;

  -- Compare-and-swap: the row only flips if it is still unused and active. The
  -- `for update` above already serialises competing scanners; this makes the
  -- guarantee independent of lock timing, and a losing caller is told the truth
  -- instead of overwriting the first scan's timestamp.
  update public.digital_passes dp
  set checked_in = true,
      checked_in_at = now(),
      status = 'used'
  where dp.id = v_pass.id
    and dp.checked_in = false
    and dp.status = 'active';

  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    return query select 'already_used'::text, 'This pass was already scanned at the gate.'::text,
      v_pass.pass_id, v_pass.status, true, v_pass.checked_in_at,
      v_pass.pass_number, v_total, v_pass.customer_name, v_pass.pass_name, v_pass.pass_composition,
      v_pass.booking_reference, v_pass.booking_status, v_pass.payment_status,
      v_pass.event_name, v_pass.valid_date, v_pass.start_time, v_pass.end_time,
      v_pass.venue_name, v_pass.venue_address, v_pass.city, p_gate_date, v_staff_name, null::uuid;

    return;
  end if;

  -- The audit row. `on conflict do nothing` means the unique constraint on
  -- digital_pass_id ends a race with a duplicate entry rather than an error, and
  -- `notes` keeps which gate (or device label) scanned the pass.
  insert into public.check_ins (digital_pass_id, event_date_id, gate, booking_id, notes)
  values (
    v_pass.id,
    v_pass.event_date_id,
    nullif(btrim(coalesce(p_gate, '')), ''),
    v_pass.booking_uuid,
    'web scanner'
  )
  on conflict (digital_pass_id) do nothing
  returning id into v_log_id;

  return query select 'checked_in'::text, null::text,
    v_pass.pass_id, 'used'::text, true, now(),
    v_pass.pass_number, v_total, v_pass.customer_name, v_pass.pass_name, v_pass.pass_composition,
    v_pass.booking_reference, v_pass.booking_status, v_pass.payment_status,
    v_pass.event_name, v_pass.valid_date, v_pass.start_time, v_pass.end_time,
    v_pass.venue_name, v_pass.venue_address, v_pass.city, p_gate_date, v_staff_name, v_log_id;
end;
$function$;


create or replace function public.scan_pass(
  p_qr_token  text,
  p_gate_date date
)
returns table (
  outcome text, reason text, pass_id text, pass_status text, checked_in boolean,
  checked_in_at timestamptz, pass_number integer, pass_total integer, customer_name text,
  pass_name text, pass_composition text, booking_reference text, booking_status text,
  payment_status text, event_name text, event_date date, start_time time, end_time time,
  venue_name text, venue_address text, city text, gate_date date, staff_name text, check_in_id uuid
)
language sql
security definer
set search_path = public
as $$
  select * from public.pass_entry(p_qr_token, p_gate_date, false, null);
$$;

comment on function public.scan_pass(text, date) is
  'Gate verdict for one QR token, without writing anything. Server-only; the caller is authenticated by the app.';

create or replace function public.check_in_pass(
  p_qr_token  text,
  p_gate_date date,
  p_gate      text default null
)
returns table (
  outcome text, reason text, pass_id text, pass_status text, checked_in boolean,
  checked_in_at timestamptz, pass_number integer, pass_total integer, customer_name text,
  pass_name text, pass_composition text, booking_reference text, booking_status text,
  payment_status text, event_name text, event_date date, start_time time, end_time time,
  venue_name text, venue_address text, city text, gate_date date, staff_name text, check_in_id uuid
)
language sql
security definer
set search_path = public
as $$
  select * from public.pass_entry(p_qr_token, p_gate_date, true, p_gate);
$$;

comment on function public.check_in_pass(text, date, text) is
  'Admits one guest: marks the pass used and writes exactly one check_ins row. Server-only.';

-- Nothing here is reachable from a browser key. service_role is the role the
-- server uses until the Prisma port lands; after that, the table owner.
revoke all on function public.pass_entry(text, date, boolean, text) from public, anon, authenticated, service_role;
revoke all on function public.scan_pass(text, date) from public, anon, authenticated;
revoke all on function public.check_in_pass(text, date, text) from public, anon, authenticated;
grant execute on function public.scan_pass(text, date) to service_role;
grant execute on function public.check_in_pass(text, date, text) to service_role;
