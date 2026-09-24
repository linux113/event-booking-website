-- =============================================================================
-- Garba Nights — public data API
--
-- Adds everything the public site needs to render entirely from the database:
--
--   1. public.get_event_night_availability() — per-night capacity/availability
--      without exposing a single row of the bookings table.
--   2. event_highlights — "what to expect" bullets, per event.
--   3. event_features   — production inclusions (anchor, DJ, drone…), per event.
--   4. A tweak to the event_dates read policy so cancelled nights are visible
--      (so the UI can say "cancelled" rather than silently hiding the night).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Availability, aggregated server-side
--
-- Bookings are not readable by the public (see 20260922090100_rls_policies.sql),
-- and that stays true: this function is SECURITY DEFINER, returns only counts,
-- and is the *only* way an anonymous visitor can learn how full a night is.
--
-- Capacity rule: a night is fully booked when its organiser marked it
-- 'sold_out', or when the people already paid for it reach its capacity.
-- Unpaid ('created') orders do not hold capacity — they expire.
-- -----------------------------------------------------------------------------
create or replace function public.get_event_night_availability(p_event_id uuid)
returns table (
  event_date_id   uuid,
  event_date      date,
  start_time      time,
  end_time        time,
  night_status    text,
  capacity        integer,
  booked_people   integer,
  remaining       integer,
  is_fully_booked boolean,
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
    group by d.id, d.event_date, d.start_time, d.end_time, d.status, d.capacity
  )
  select
    n.id,
    n.event_date,
    n.start_time,
    n.end_time,
    n.status,
    n.capacity,
    n.booked_people,
    greatest(n.capacity - n.booked_people, 0),
    (n.status = 'sold_out' or n.booked_people >= n.capacity),
    (n.status = 'scheduled' and n.booked_people < n.capacity)
  from night n
  order by n.event_date;
$$;

comment on function public.get_event_night_availability(uuid) is
  'Public per-night availability (capacity, booked people, remaining, FULLY BOOKED flag) for a published event. Aggregates bookings without exposing them; the only capacity signal available to anon.';

revoke execute on function public.get_event_night_availability(uuid) from public;
grant execute on function public.get_event_night_availability(uuid) to anon, authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 2. event_highlights
-- -----------------------------------------------------------------------------
create table if not exists public.event_highlights (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events (id) on delete cascade,
  title       text not null,
  description text,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint event_highlights_title_not_blank check (length(btrim(title)) > 0)
);

comment on table public.event_highlights is 'Per-event "what to expect" bullets shown on the home and about pages.';

create index if not exists event_highlights_event_idx on public.event_highlights (event_id, sort_order);

drop trigger if exists event_highlights_set_updated_at on public.event_highlights;
create trigger event_highlights_set_updated_at
  before update on public.event_highlights
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 3. event_features
--
-- `code` is the stable key the UI maps to an icon; `label` and `description` are
-- editable by the organiser.
-- -----------------------------------------------------------------------------
create table if not exists public.event_features (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events (id) on delete cascade,
  code        text not null,
  label       text not null,
  description text,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint event_features_code_unique unique (event_id, code),
  constraint event_features_label_not_blank check (length(btrim(label)) > 0)
);

comment on table public.event_features is 'Production inclusions advertised for an event (anchor, DJ, drone…). `code` drives the icon in the UI.';

create index if not exists event_features_event_idx on public.event_features (event_id, sort_order);

drop trigger if exists event_features_set_updated_at on public.event_features;
create trigger event_features_set_updated_at
  before update on public.event_features
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 4. Read access for the two new tables
-- -----------------------------------------------------------------------------
grant select on public.event_highlights, public.event_features to anon, authenticated;
grant select, insert, update, delete on public.event_highlights, public.event_features to authenticated;
grant all on public.event_highlights, public.event_features to service_role;

alter table public.event_highlights enable row level security;
alter table public.event_features enable row level security;

drop policy if exists event_highlights_anon_read on public.event_highlights;
create policy event_highlights_anon_read on public.event_highlights
  for select to anon
  using (
    exists (select 1 from public.events e where e.id = event_id and e.status = 'published')
  );

drop policy if exists event_highlights_authenticated_read on public.event_highlights;
create policy event_highlights_authenticated_read on public.event_highlights
  for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.events e where e.id = event_id and e.status = 'published')
  );

drop policy if exists event_highlights_admin_manage on public.event_highlights;
create policy event_highlights_admin_manage on public.event_highlights
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());


drop policy if exists event_features_anon_read on public.event_features;
create policy event_features_anon_read on public.event_features
  for select to anon
  using (
    exists (select 1 from public.events e where e.id = event_id and e.status = 'published')
  );

drop policy if exists event_features_authenticated_read on public.event_features;
create policy event_features_authenticated_read on public.event_features
  for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.events e where e.id = event_id and e.status = 'published')
  );

drop policy if exists event_features_admin_manage on public.event_features;
create policy event_features_admin_manage on public.event_features
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());


-- -----------------------------------------------------------------------------
-- 5. Show cancelled nights instead of hiding them
--
-- Previously anon could only read non-cancelled nights, which made a cancelled
-- night silently disappear from the site. Visitors should see that the night is
-- cancelled, so the filter moves to the UI: dates of a published event are
-- readable regardless of status (still no bookings, no draft events).
-- -----------------------------------------------------------------------------
drop policy if exists event_dates_anon_read on public.event_dates;
create policy event_dates_anon_read on public.event_dates
  for select to anon
  using (
    exists (select 1 from public.events e where e.id = event_id and e.status = 'published')
  );

drop policy if exists event_dates_authenticated_read on public.event_dates;
create policy event_dates_authenticated_read on public.event_dates
  for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.events e where e.id = event_id and e.status = 'published')
  );
