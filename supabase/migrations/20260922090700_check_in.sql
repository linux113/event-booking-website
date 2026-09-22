-- =============================================================================
-- 20260922090700_check_in.sql
--
-- Gate entry: turning a scanned QR code into an admitted guest.
--
-- Everything that decides "may this person come in" happens here, in one
-- transaction, because the client is not trusted with any part of it:
--
--   * the token must be the 64-character shape the database itself mints;
--   * the pass, the booking, the night and the event must all exist (a single
--     inner join — a pass with no booking cannot be half-valid);
--   * the booking must be confirmed and paid, the pass active and unused, and the
--     pass must be for the night the gate is open (p_gate_date, computed by the
--     server from the venue's timezone, never sent by a browser);
--   * the person scanning must be an active staff member, checked against
--     admin_users inside the database — so a bug in the API layer alone can never
--     admit somebody;
--   * the write is a compare-and-swap (`where checked_in = false and status =
--     'active'`) after `for update` on the pass row, and check_ins has a unique
--     constraint on digital_pass_id. Two scanners pointed at the same code
--     therefore produce exactly one entry and one check_ins row, and the second
--     one is told the pass is already used.
--
-- `scan_pass` is the same verdict without writing: the scanner shows it, and the
-- CHECK IN button asks for the real thing.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The implementation. Not callable by any role: the two wrappers below are the
-- only entry points, and they run it as the definer.
-- -----------------------------------------------------------------------------
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
      and a.role in ('owner', 'admin', 'manager', 'scanner')
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
-- The two entry points.
-- -----------------------------------------------------------------------------
create or replace function public.scan_pass(
  p_qr_token      text,
  p_gate_date     date,
  p_staff_user_id uuid
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
language sql
security definer
set search_path = public
as $$
  select * from public.pass_entry(p_qr_token, p_gate_date, p_staff_user_id, false, null);
$$;

comment on function public.scan_pass(text, date, uuid) is
  'Gate verdict for one QR token, without writing anything. service_role only; the staff id is verified inside.';

create or replace function public.check_in_pass(
  p_qr_token      text,
  p_gate_date     date,
  p_staff_user_id uuid,
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
language sql
security definer
set search_path = public
as $$
  select * from public.pass_entry(p_qr_token, p_gate_date, p_staff_user_id, true, p_gate);
$$;

comment on function public.check_in_pass(text, date, uuid, text) is
  'Admits one guest: marks the pass used and writes one check_ins row, exactly once per pass. service_role only.';

-- -----------------------------------------------------------------------------
-- Grants: nothing here is reachable from a browser key. The staff session is
-- resolved by the server (src/lib/auth), and the staff id it passes is re-checked
-- against admin_users inside pass_entry.
-- -----------------------------------------------------------------------------
revoke all on function public.pass_entry(text, date, uuid, boolean, text)
  from public, anon, authenticated, service_role;
revoke all on function public.scan_pass(text, date, uuid) from public, anon, authenticated;
revoke all on function public.check_in_pass(text, date, uuid, text) from public, anon, authenticated;

grant execute on function public.scan_pass(text, date, uuid) to service_role;
grant execute on function public.check_in_pass(text, date, uuid, text) to service_role;
