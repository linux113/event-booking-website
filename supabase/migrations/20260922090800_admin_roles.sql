-- =============================================================================
-- 20260922090800_admin_roles.sql
--
-- Step 8 — admin authentication and role-based access control.
--
-- The allow-list gains a three-role model, and this migration is what makes those
-- three roles mean something *inside the database*, not just in the app:
--
--   super_admin  full access, including staff/role management
--   admin        bookings, payments, passes, dates, gallery, scanner, settings
--   staff        the scanner, check-ins, and a limited booking lookup
--
-- Three things change:
--
--   1. `admin_users.role` accepts exactly those three values. The old four
--      (owner / admin / manager / scanner) are mapped across first, in the same
--      migration, so no row is ever in a value the constraint would reject.
--   2. The role helpers are redefined: `is_staff()` is any active role, the new
--      `is_super_admin()` is the full-access role, and `is_admin()` is the
--      management role (super_admin or admin). Every RLS policy that used to ask
--      "is this an owner?" now asks "is this a super admin?".
--   3. Two service-role functions the admin area needs, so that the app never
--      counts or filters rows in the browser: `admin_lookup_bookings()` (with the
--      contact fields withheld when the caller may not see them) and
--      `admin_dashboard_stats()`.
--
-- The gate verdict in `pass_entry()` is re-created with the new role list — same
-- body, one line changed.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. owner → super_admin, manager → admin, scanner → staff.
--    The data moves before the constraint does, in one transaction, so the table
--    is never in a state that violates its own rules.
-- -----------------------------------------------------------------------------
alter table public.admin_users drop constraint if exists admin_users_role_check;

update public.admin_users
   set role = case role
                when 'owner'   then 'super_admin'
                when 'manager' then 'admin'
                when 'scanner' then 'staff'
                else role
              end
 where role in ('owner', 'manager', 'scanner');

-- Anything that was neither a known legacy value nor a known new one would now be
-- an invalid row; fail loudly here rather than at the constraint below, so the
-- message says which rows are wrong.
do $$
declare
  v_bad text;
begin
  select string_agg(distinct role, ', ') into v_bad
  from public.admin_users
  where role not in ('super_admin', 'admin', 'staff');

  if v_bad is not null then
    raise exception 'admin_users holds unrecognised roles after migration: %', v_bad;
  end if;
end;
$$;

alter table public.admin_users
  add constraint admin_users_role_check check (role in ('super_admin', 'admin', 'staff'));

alter table public.admin_users alter column role set default 'staff';

comment on column public.admin_users.role is
  'super_admin = full access (including staff/role management); admin = bookings, payments, passes, dates, gallery, scanner, settings; staff = scanner, check-ins and a limited booking lookup.';

-- -----------------------------------------------------------------------------
-- 2. Role helpers. SECURITY DEFINER for the same reason as before: a check against
--    admin_users must not recurse through that table's own policies.
-- -----------------------------------------------------------------------------
create or replace function public.is_staff(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.admin_users
     where user_id = p_user_id
       and is_active
       and role in ('super_admin', 'admin', 'staff')
  );
$$;

comment on function public.is_staff(uuid) is
  'True when the given user is an active admin_users row of any role (super_admin, admin or staff).';

create or replace function public.is_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.admin_users
     where user_id = p_user_id
       and is_active
       and role in ('super_admin', 'admin')
  );
$$;

comment on function public.is_admin(uuid) is
  'True for super_admin and admin — the roles that may manage events, bookings and passes. Staff are excluded.';

create or replace function public.is_super_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.admin_users
     where user_id = p_user_id
       and is_active
       and role = 'super_admin'
  );
$$;

comment on function public.is_super_admin(uuid) is
  'True only for the super_admin role — the only role allowed to manage admin_users rows.';

revoke execute on function public.is_staff(uuid) from public;
revoke execute on function public.is_admin(uuid) from public;
revoke execute on function public.is_super_admin(uuid) from public;
grant execute on function public.is_staff(uuid), public.is_admin(uuid), public.is_super_admin(uuid)
  to anon, authenticated, service_role;

-- The old owner-only name is gone rather than quietly redefined: two names for one
-- question is how a policy ends up asking the wrong one. The policy below is the
-- only thing that used it.
drop policy if exists admin_users_owner_manage on public.admin_users;
drop function if exists public.is_owner(uuid);

drop policy if exists admin_users_super_admin_manage on public.admin_users;
create policy admin_users_super_admin_manage on public.admin_users
  for all
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- Who is asking? The caller's own role, or null.
--
-- This exists for the edge: `src/proxy.ts` runs before a page is rendered and has to
-- answer "may this person open this section?" *before* anything streams, because a
-- redirect issued while a response is already streaming cannot change its status code.
-- It returns one word — never a row, never anybody else's role — and it is safe for
-- `anon` to call: there is no auth user, so the answer is simply null.
create or replace function public.current_staff_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
    from public.admin_users
   where user_id = auth.uid()
     and is_active
   limit 1;
$$;

comment on function public.current_staff_role() is
  'The caller''s own admin_users role, or null. Used by the request hook to decide access before a response starts streaming.';

revoke execute on function public.current_staff_role() from public;
grant execute on function public.current_staff_role() to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. The gate verdict, re-created with the new roles.
--    (An active row of any of the three roles may work the gate — a super admin
--    standing on the door is still a person who can check a pass in.)
-- -----------------------------------------------------------------------------
-- Re-created verbatim from 20260922090700_check_in.sql, with one change: the role
-- list now uses the three-role model. Everything else — the lock, the verdict
-- order, the compare-and-swap, the audit row — is byte-for-byte the same.
create or replace function public.pass_entry(
  p_qr_token      text,
  p_gate_date     date,
  p_staff_user_id uuid,
  p_commit        boolean,
  p_gate          text default null
)
returns table (
  outcome           text,
  reason            text,
  pass_id           text,
  pass_status       text,
  checked_in        boolean,
  checked_in_at     timestamptz,
  pass_number       integer,
  pass_total        integer,
  customer_name     text,
  pass_name         text,
  pass_composition  text,
  booking_reference text,
  booking_status    text,
  payment_status    text,
  event_name        text,
  event_date        date,
  start_time        time,
  end_time          time,
  venue_name        text,
  venue_address     text,
  city              text,
  gate_date         date,
  staff_name        text,
  check_in_id       uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Scalars, not a record: the staff lookup is skipped entirely when no id is given,
  -- and an unassigned record cannot be tested for "not found".
  v_staff_id   uuid;
  v_staff_name text;
  v_pass    record;
  v_total   integer;
  v_updated integer;
  v_log_id  uuid;
begin
  -- 0. Who is holding the scanner? Check-in is a staff action, and the staff
  --    member is recorded on the check-in row.
  if p_staff_user_id is not null then
    select a.id, coalesce(nullif(btrim(a.full_name), ''), a.email)
      into v_staff_id, v_staff_name
    from public.admin_users a
    where a.user_id = p_staff_user_id
      and a.is_active
      and a.role in ('super_admin', 'admin', 'staff')
    limit 1;
  end if;

  if v_staff_id is null then
    return query select
      'not_authorised'::text,
      'Sign in as event staff to scan passes.'::text,
      null::text, null::text, null::boolean, null::timestamptz,
      null::integer, null::integer, null::text, null::text, null::text,
      null::text, null::text, null::text, null::text, null::date,
      null::time, null::time, null::text, null::text, null::text,
      p_gate_date, null::text, null::uuid;

    return;
  end if;

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
  insert into public.check_ins (digital_pass_id, event_date_id, gate, checked_in_by, notes)
  values (
    v_pass.id,
    v_pass.event_date_id,
    nullif(btrim(coalesce(p_gate, '')), ''),
    v_staff_id,
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
$$;

comment on function public.pass_entry(text, date, uuid, boolean, text) is
  'Internal: the single implementation of the gate verdict. Call scan_pass to preview or check_in_pass to admit.';

-- -----------------------------------------------------------------------------
-- 4. Admin lookups.
--
--    Both are service_role only: they read across bookings, passes and check-ins,
--    which no browser session may do. The app is the only caller, and it decides
--    *which* of its own staff may see the result — but the contact fields are
--    withheld here, in the same statement that reads them, so a mistake above this
--    line cannot put a customer's mobile number on a staff member's screen.
-- -----------------------------------------------------------------------------
create or replace function public.admin_lookup_bookings(
  p_query           text,
  p_include_contact boolean default true,
  p_limit           integer default 25
)
returns table (
  booking_uuid        uuid,
  booking_id          text,
  customer_name       text,
  customer_mobile     text,
  customer_email      text,
  event_name          text,
  event_slug          text,
  event_date          date,
  start_time          time,
  end_time            time,
  pass_name           text,
  pass_composition    text,
  quantity            integer,
  number_of_people    integer,
  total_amount        integer,
  currency            text,
  booking_status      text,
  payment_status      text,
  razorpay_order_id   text,
  created_at          timestamptz,
  passes_issued       integer,
  passes_checked_in   integer,
  check_in_times      timestamptz[]
)
language sql
stable
security definer
set search_path = public
as $$
  with matches as (
    select b.id
      from public.bookings b
     where p_query is not null
       and btrim(p_query) <> ''
       and (
         -- Booking reference, as printed on the confirmation: partial, case-free.
         b.booking_id ilike '%' || btrim(p_query) || '%'
         -- The guest's name, as they will say it at the door.
         or b.customer_name ilike '%' || btrim(p_query) || '%'
         -- The mobile number, however the staff member typed it (spaces, +91, a
         -- leading zero). Guarded by "the query has digits": matching an empty digit
         -- string against every number would return the whole table.
         or (
           regexp_replace(btrim(p_query), '\D', '', 'g') <> ''
           and regexp_replace(b.customer_mobile, '\D', '', 'g') like
               '%' || regexp_replace(btrim(p_query), '\D', '', 'g') || '%'
         )
       )
     order by b.created_at desc
     limit greatest(1, least(coalesce(p_limit, 25), 100))
  )
  select
    b.id,
    b.booking_id,
    b.customer_name,
    case when p_include_contact then b.customer_mobile end,
    case when p_include_contact then b.customer_email end,
    e.name,
    e.slug,
    d.event_date,
    d.start_time,
    d.end_time,
    p.name,
    p.composition,
    b.quantity,
    b.number_of_people,
    case when p_include_contact then b.total_amount end,
    e.currency,
    b.booking_status,
    b.payment_status,
    case when p_include_contact then b.razorpay_order_id end,
    b.created_at,
    coalesce(dp.issued, 0),
    coalesce(dp.checked_in, 0),
    dp.check_in_times
  from matches m
  join public.bookings b        on b.id = m.id
  join public.event_dates d     on d.id = b.event_date_id
  join public.events e          on e.id = d.event_id
  join public.pass_categories p on p.id = b.pass_category_id
  left join lateral (
    select count(*)::integer as issued,
           count(*) filter (where dp.checked_in)::integer as checked_in,
           array_remove(array_agg(dp.checked_in_at order by dp.pass_number), null) as check_in_times
      from public.digital_passes dp
     where dp.booking_id = b.id
  ) dp on true
  order by b.created_at desc;
$$;

comment on function public.admin_lookup_bookings(text, boolean, integer) is
  'Staff-side booking lookup: reference, mobile or name. Contact details, amounts and gateway ids come back null when p_include_contact is false (the limited view). service_role only.';

create or replace function public.admin_dashboard_stats(p_today date)
returns table (
  bookings_total     integer,
  bookings_paid      integer,
  bookings_pending   integer,
  bookings_refunded  integer,
  people_admitted    integer,
  passes_issued      integer,
  passes_active      integer,
  passes_used        integer,
  check_ins_today    integer,
  nights_total       integer,
  nights_upcoming    integer,
  gallery_published  integer,
  gallery_draft      integer,
  staff_active       integer,
  staff_total        integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*)::integer from public.bookings),
    (select count(*)::integer from public.bookings where payment_status = 'paid'),
    (select count(*)::integer from public.bookings where payment_status = 'unpaid'),
    (select count(*)::integer from public.bookings where payment_status = 'refunded'),
    (select coalesce(sum(number_of_people), 0)::integer
       from public.bookings where payment_status = 'paid'),
    (select count(*)::integer from public.digital_passes),
    (select count(*)::integer from public.digital_passes where status = 'active' and not checked_in),
    (select count(*)::integer from public.digital_passes where checked_in),
    (select count(*)::integer from public.check_ins where checked_in_at::date = p_today),
    (select count(*)::integer from public.event_dates),
    (select count(*)::integer from public.event_dates where event_date >= p_today and status = 'scheduled'),
    (select count(*)::integer from public.gallery where status = 'published'),
    (select count(*)::integer from public.gallery where status <> 'published'),
    (select count(*)::integer from public.admin_users where is_active),
    (select count(*)::integer from public.admin_users);
$$;

comment on function public.admin_dashboard_stats(date) is
  'Live counts for the admin dashboard, counted in the database rather than in the app. Takes the venue''s today so "tonight" means the venue''s tonight. service_role only.';

revoke execute on function public.admin_lookup_bookings(text, boolean, integer) from public, anon, authenticated;
revoke execute on function public.admin_dashboard_stats(date) from public, anon, authenticated;
grant execute on function public.admin_lookup_bookings(text, boolean, integer) to service_role;
grant execute on function public.admin_dashboard_stats(date) to service_role;
