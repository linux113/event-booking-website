-- -----------------------------------------------------------------------------
-- Admin date management: can this night actually be removed?
--
-- `admin_delete_event_date` refuses to delete a night that has *anything*
-- attached to it: a booking in any state (paid, pending, expired, cancelled,
-- refunded), a digital pass, or a check-in. The nights list, on the other hand,
-- only ever reported the *paid* figures — `booked_people`, `booked_bookings`
-- and `passes_issued` all filter on `payment_status = 'paid'`.
--
-- So a night whose only history was an abandoned checkout (a booking that was
-- created and never paid for) looked empty to the screen and offered a working
-- "Remove night" button, while the database quite correctly refused to delete
-- it. The control promised a removal the rule would not allow, and the organiser
-- was left with a red box instead of a night removed.
--
-- The read now carries the three counts the delete rule checks, plus the boolean
-- that rule reduces to, so the control and the database answer from the same
-- facts. Nothing about the paid figures changes: capacity, seats left and
-- over-commitment still count paid people only, exactly as the booking path does.
--
-- Forward-only: the return shape changes, so the function is dropped and
-- recreated (PostgreSQL will not alter a return type in place).
-- -----------------------------------------------------------------------------

drop function if exists public.admin_event_dates(uuid);

create function public.admin_event_dates(p_event_id uuid default null)
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
  -- What `admin_delete_event_date` counts before it will delete a night. Unlike
  -- the figures above these ignore payment state: an unpaid booking still blocks
  -- a removal, because it can still become a paid one.
  attached_bookings  integer,
  attached_passes    integer,
  attached_check_ins integer,
  removable          boolean,
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
  ),
  -- Anything at all that would make `admin_delete_event_date` refuse.
  attached as (
    select b.event_date_id, count(*)::integer as attached_bookings
      from public.bookings b
     group by b.event_date_id
  ),
  passes_any as (
    select b.event_date_id, count(dp.id)::integer as attached_passes
      from public.bookings b
      join public.digital_passes dp on dp.booking_id = b.id
     group by b.event_date_id
  ),
  gates as (
    select ci.event_date_id, count(*)::integer as attached_check_ins
      from public.check_ins ci
     group by ci.event_date_id
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
    coalesce(a.attached_bookings, 0),
    coalesce(pa.attached_passes, 0),
    coalesce(gate.attached_check_ins, 0),
    -- Removable exactly when `admin_delete_event_date` would not refuse: nothing
    -- of any kind is attached to the night.
    (coalesce(a.attached_bookings, 0) = 0
       and coalesce(pa.attached_passes, 0) = 0
       and coalesce(gate.attached_check_ins, 0) = 0),
    d.created_at,
    d.updated_at
  from public.event_dates d
  cross join target g
  left join taken t on t.event_date_id = d.id
  left join issued i on i.event_date_id = d.id
  left join attached a on a.event_date_id = d.id
  left join passes_any pa on pa.event_date_id = d.id
  left join gates gate on gate.event_date_id = d.id
  where d.event_id = g.event_id
  order by d.event_date;
$$;

comment on function public.admin_event_dates(uuid) is
  'Every night of an event with what is on sale and what is left: capacity, seats held back, paid people, passes issued, seats available, whether the night is over-committed or full, what is attached to it (bookings of any state, passes, check-ins) and therefore whether it can be removed. Aggregated in SQL so the screen counts nothing.';

revoke all on function public.admin_event_dates(uuid) from public;
revoke all on function public.admin_event_dates(uuid) from anon, authenticated;
grant execute on function public.admin_event_dates(uuid) to service_role;
