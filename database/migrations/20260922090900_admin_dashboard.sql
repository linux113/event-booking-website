-- =============================================================================
-- 20260922090900_admin_dashboard.sql
--
-- Step 9 — the statistics behind the admin dashboard.
--
-- Every number on /admin is counted here, in one query per panel, by the database.
-- Nothing is summed in the browser and nothing is summed in Node either: the admin
-- area asks for aggregates, which is the only way a statistic like "total revenue"
-- can be trusted to match the rows it claims to describe.
--
-- Four functions:
--
--   admin_dashboard_stats(today, tz, include_revenue)   one row of headline numbers
--   admin_booking_series(today, days, tz, include_revenue)  a day-by-day time series
--   admin_pass_breakdown(include_revenue)                distribution across pass types
--   admin_recent_bookings(limit, include_contact)        the latest bookings
--
-- Three deliberate conventions:
--
--   * **Days are the venue's days.** Every date calculation takes the timezone from
--     the caller (`p_tz`, which is `siteConfig.timezone`) rather than assuming UTC, so
--     a booking made at 1am in Jaipur lands on the night it was actually made.
--   * **Money is the caller's business.** `p_include_revenue` / `p_include_contact`
--     return NULL instead of a figure when a role may not see it, so a staff session
--     never receives an amount it has no business rendering. Same rule as the booking
--     lookup in the step-8 migration.
--   * **"Revenue" means paid, never refunded.** `payment_status = 'paid'` is the only
--     definition used here; a refunded booking stops counting the moment it is
--     refunded, which is why the tests can subtract one and watch the total move.
--
-- All four are `service_role` only, like every other admin read.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Headline numbers.
--
--    The step-8 version (one parameter) is replaced rather than kept alongside: two
--    functions answering the same question is how a dashboard ends up disagreeing
--    with itself. The argument list grows, so the old signature is dropped first.
-- -----------------------------------------------------------------------------
drop function if exists public.admin_dashboard_stats(date);

create or replace function public.admin_dashboard_stats(
  p_today           date,
  p_tz              text default 'UTC',
  p_include_revenue boolean default true
)
returns table (
  -- bookings
  bookings_total      integer,
  bookings_confirmed  integer,
  bookings_paid       integer,
  bookings_pending    integer,
  bookings_refunded   integer,
  bookings_today      integer,
  -- money (null when the caller may not see it)
  revenue_total       integer,
  revenue_today       integer,
  revenue_refunded    integer,
  -- the gate
  check_ins_total     integer,
  check_ins_today     integer,
  -- passes
  passes_issued       integer,
  passes_active       integer,
  passes_used         integer,
  -- capacity, over the nights still to come. `capacity_taken` counts people on paid
  -- bookings; `people_paid` is the same figure across every night, past included.
  people_paid         integer,
  capacity_total      integer,
  capacity_taken      integer,
  capacity_available  integer,
  -- tonight specifically, when there is a night tonight
  tonight_date        date,
  tonight_capacity    integer,
  tonight_taken       integer,
  tonight_available   integer,
  -- everything else the dashboard shows
  nights_total        integer,
  nights_upcoming     integer,
  gallery_published   integer,
  gallery_draft       integer,
  staff_active        integer,
  staff_total         integer
)
language sql
stable
security definer
set search_path = public
as $$
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
    (select count(*)::integer from public.gallery where status <> 'published'),
    (select count(*)::integer from public.admin_users where is_active),
    (select count(*)::integer from public.admin_users);
$$;

comment on function public.admin_dashboard_stats(date, text, boolean) is
  'The admin dashboard''s headline numbers, counted in the database. Days are the venue''s days (p_tz); money is null when p_include_revenue is false. service_role only.';

-- -----------------------------------------------------------------------------
-- 2. Bookings and revenue, day by day.
--
--    The series always covers every day in the window, including the quiet ones: a
--    chart with gaps in it tells a different story than the data does.
-- -----------------------------------------------------------------------------
create or replace function public.admin_booking_series(
  p_today           date,
  p_days            integer default 14,
  p_tz              text default 'UTC',
  p_include_revenue boolean default true
)
returns table (
  day        date,
  bookings   integer,
  confirmed  integer,
  revenue    integer
)
language sql
stable
security definer
set search_path = public
as $$
  with span as (
    select generate_series(
             p_today - (greatest(1, least(coalesce(p_days, 14), 90)) - 1),
             p_today,
             interval '1 day'
           )::date as day
  )
  select
    s.day,
    count(b.id)::integer as bookings,
    count(b.id) filter (where b.booking_status = 'confirmed')::integer as confirmed,
    case when p_include_revenue
         then coalesce(sum(b.total_amount) filter (where b.payment_status = 'paid'), 0)::integer
         else null
    end as revenue
  from span s
  left join public.bookings b
    on (b.created_at at time zone p_tz)::date = s.day
  group by s.day
  order by s.day;
$$;

comment on function public.admin_booking_series(date, integer, text, boolean) is
  'Bookings (and, when allowed, paid revenue) per day over the last p_days days, in the venue''s timezone, with the empty days included. service_role only.';

-- -----------------------------------------------------------------------------
-- 3. Distribution across pass types.
-- -----------------------------------------------------------------------------
create or replace function public.admin_pass_breakdown(
  p_include_revenue boolean default true
)
returns table (
  pass_category_id uuid,
  pass_name        text,
  pass_composition text,
  price_inr        integer,
  is_active        boolean,
  bookings         integer,
  paid_bookings    integer,
  passes_issued    integer,
  people           integer,
  revenue          integer
)
language sql
stable
security definer
set search_path = public
as $$
  -- Bookings and passes are aggregated in separate subqueries on purpose. Joining
  -- bookings to their passes in one query multiplies each booking by the number of
  -- passes it has, and a category with two two-pass bookings would report four times
  -- the people and the money it actually took.
  select
    p.id,
    p.name,
    p.composition,
    p.price_inr,
    p.is_active,
    b.bookings::integer,
    b.paid_bookings::integer,
    dp.passes_issued::integer,
    b.people::integer,
    case when p_include_revenue then b.revenue::integer end
  from public.pass_categories p
  left join lateral (
    select
      count(*) as bookings,
      count(*) filter (where o.payment_status = 'paid') as paid_bookings,
      coalesce(sum(o.number_of_people) filter (where o.payment_status = 'paid'), 0) as people,
      coalesce(sum(o.total_amount) filter (where o.payment_status = 'paid'), 0) as revenue
    from public.bookings o
    where o.pass_category_id = p.id
  ) b on true
  left join lateral (
    select count(*) as passes_issued
    from public.digital_passes d
    join public.bookings o on o.id = d.booking_id
    where o.pass_category_id = p.id
  ) dp on true
  -- Biggest first: this is a distribution chart, so the reader should not have to sort
  -- it in their head. Ties fall back to the organiser's own ordering.
  order by b.bookings desc, p.sort_order asc;
$$;

comment on function public.admin_pass_breakdown(boolean) is
  'How bookings and passes are distributed across the pass categories, biggest first. Revenue is null when p_include_revenue is false. service_role only.';

-- -----------------------------------------------------------------------------
-- 4. The latest bookings.
-- -----------------------------------------------------------------------------
create or replace function public.admin_recent_bookings(
  p_limit           integer default 8,
  p_include_contact boolean default true
)
returns table (
  booking_uuid      uuid,
  booking_id        text,
  customer_name     text,
  customer_mobile   text,
  customer_email    text,
  event_date        date,
  start_time        time,
  pass_name         text,
  quantity          integer,
  number_of_people  integer,
  total_amount      integer,
  currency          text,
  booking_status    text,
  payment_status    text,
  created_at        timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.id,
    b.booking_id,
    b.customer_name,
    case when p_include_contact then b.customer_mobile end,
    case when p_include_contact then b.customer_email end,
    d.event_date,
    d.start_time,
    p.name,
    b.quantity,
    b.number_of_people,
    case when p_include_contact then b.total_amount end,
    e.currency,
    b.booking_status,
    b.payment_status,
    b.created_at
  from public.bookings b
  join public.event_dates d     on d.id = b.event_date_id
  join public.events e          on e.id = d.event_id
  join public.pass_categories p on p.id = b.pass_category_id
  order by b.created_at desc
  limit greatest(1, least(coalesce(p_limit, 8), 50));
$$;

comment on function public.admin_recent_bookings(integer, boolean) is
  'The most recently created bookings, newest first. Contact details and the amount are null when p_include_contact is false. service_role only.';

-- -----------------------------------------------------------------------------
-- 5. Grants. Every one of these reads across bookings, passes and money: the
--    browser may never call them, whatever key it is holding.
-- -----------------------------------------------------------------------------
revoke execute on function public.admin_dashboard_stats(date, text, boolean) from public, anon, authenticated;
revoke execute on function public.admin_booking_series(date, integer, text, boolean) from public, anon, authenticated;
revoke execute on function public.admin_pass_breakdown(boolean) from public, anon, authenticated;
revoke execute on function public.admin_recent_bookings(integer, boolean) from public, anon, authenticated;

grant execute on function public.admin_dashboard_stats(date, text, boolean) to service_role;
grant execute on function public.admin_booking_series(date, integer, text, boolean) to service_role;
grant execute on function public.admin_pass_breakdown(boolean) to service_role;
grant execute on function public.admin_recent_bookings(integer, boolean) to service_role;
