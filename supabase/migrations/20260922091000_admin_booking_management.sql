-- =============================================================================
-- 20260922091000_admin_booking_management.sql
--
-- Step 10 — managing bookings, and the rule about who may say a payment succeeded.
--
--   * `admin_search_bookings()` replaces `admin_lookup_bookings()`. The old function
--     searched three fields with no filters and no paging; this one searches six
--     fields (reference, name, mobile, email, gateway ids, pass id), filters by event
--     date, pass category, payment status, booking status and check-in state, pages,
--     and reports the size of the whole result set. Its matching is a superset of the
--     old one, so nothing that used to be found stops being found.
--   * `admin_booking_detail()` returns one booking completely: the night and venue,
--     the pass category, every pass and its state, every gate entry with the staff
--     member who made it, the gateway ids, and the webhook deliveries received for
--     that order.
--   * `bookings.payment_status` becomes something only a verified gateway event can
--     move (see the guard below). There is no administrative path that sets a booking
--     to paid by hand, and this migration makes that a database fact rather than a
--     convention the next contributor has to notice.
--
-- All of the reads are `service_role` only, like every other admin read.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The old lookup goes.
--
--    Replaced, not deprecated: leaving both in place would give the admin area two
--    searches with different, drifting rules for "which bookings match this".
-- -----------------------------------------------------------------------------
drop function if exists public.admin_lookup_bookings(text, boolean, integer);

-- -----------------------------------------------------------------------------
-- 2. The booking list.
--
--    One function answers every question the management screen asks: six search
--    fields, five filters, paging and the size of the whole result set, in one round
--    trip. `admin_lookup_bookings` is gone rather than kept alongside — its matching
--    rules were a strict subset of these, and two searches that answer "which
--    bookings" slightly differently is how an admin ends up looking at a list that
--    does not contain the row they are hunting for.
--
--    The contact columns (mobile, email, amounts, gateway ids) come back NULL when
--    `p_include_contact` is false. That is the staff view, and the withholding happens
--    here, in the same statement that reads the columns.
-- -----------------------------------------------------------------------------
create or replace function public.admin_search_bookings(
  p_query            text    default null,
  p_event_date_from  date    default null,
  p_event_date_to    date    default null,
  p_pass_category_id uuid    default null,
  p_payment_status   text    default null,
  p_booking_status   text    default null,
  p_check_in_status  text    default null,
  p_include_contact  boolean default true,
  p_limit            integer default 25,
  p_offset           integer default 0
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
  razorpay_payment_id text,
  created_at          timestamptz,
  passes_issued       integer,
  passes_checked_in   integer,
  check_in_times      timestamptz[],
  pass_ids            text[],
  total_count         integer
)
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    select
      -- An empty search box is not a search: it means "the list", which is what a
      -- management screen should open on. Long input is truncated rather than
      -- refused: nobody is typing a 64-character booking reference.
      nullif(left(btrim(coalesce(p_query, '')), 64), '')   as q,
      -- The same term with LIKE's own wildcards neutralised, so a search for "50%"
      -- or "a_b" means those characters and not "anything". Without this, "%" would
      -- quietly return every booking in the event.
      replace(
        replace(
          replace(left(btrim(coalesce(p_query, '')), 64), '\', '\\'),
          '%', '\%'
        ),
        '_', '\_'
      )                                                    as q_like,
      -- The digits of the search term, for matching a mobile number however it was
      -- typed — but only when the term *is* a number. Empty string means the mobile
      -- clause is skipped, and that is what keeps two very different searches apart:
      --
      --   * "98123 45678" and "+91 98000 01001" are phone numbers, and the digits are
      --     matched against the mobile column without regard to how they were typed;
      --   * "Bulk Fixture 01" and "Room 101" are names with numbers in them. Their
      --     digits are not a phone number, and matching "01" against every mobile
      --     containing "01" would answer a name search with half the event.
      --
      -- A term with no letters qualifies, and only from four digits up: two digits
      -- appear in most phone numbers, which is the same as matching everything.
      case
        when left(btrim(coalesce(p_query, '')), 64) !~ '[[:alpha:]]'
         and length(regexp_replace(coalesce(p_query, ''), '\D', '', 'g')) >= 4
        then regexp_replace(coalesce(p_query, ''), '\D', '', 'g')
        else ''
      end                                                    as q_digits,
      greatest(1, least(coalesce(p_limit, 25), 100))       as page_size,
      greatest(0, coalesce(p_offset, 0))                   as page_offset,
      -- Only values the schema actually holds become filters. A typo in the query
      -- string narrows nothing; it does not silently return an empty list that looks
      -- like "no such booking".
      case when p_payment_status in ('unpaid', 'created', 'paid', 'failed', 'refunded')
           then p_payment_status end                       as payment_status,
      case when p_booking_status in ('pending', 'confirmed', 'cancelled', 'expired', 'refunded')
           then p_booking_status end                       as booking_status,
      case when p_check_in_status in ('none', 'some', 'all')
           then p_check_in_status end                      as check_in_status
  ),
  pass_state as (
    select
      dp.booking_id                                      as booking_uuid,
      count(*)::integer                                  as issued,
      count(*) filter (where dp.checked_in)::integer      as checked_in,
      array_remove(array_agg(dp.checked_in_at order by dp.pass_number), null) as check_in_times,
      -- Every pass on the booking, in the order they were issued: the numbers a
      -- guest reads out at the gate, and the rows a door list is printed from.
      array_agg(dp.pass_id order by dp.pass_number)        as pass_ids
    from public.digital_passes dp
    group by dp.booking_id
  ),
  matched as (
    select b.id, b.created_at
    from public.bookings b
    join public.event_dates d     on d.id = b.event_date_id
    left join pass_state ps       on ps.booking_uuid = b.id
    cross join params p
    where (
        p.q is null
        or b.booking_id ilike '%' || p.q_like || '%'
        or b.customer_name ilike '%' || p.q_like || '%'
        or b.customer_email ilike '%' || p.q_like || '%'
        -- The gateway ids, so a payment id from a Razorpay receipt finds its booking.
        or b.razorpay_payment_id ilike '%' || p.q_like || '%'
        or b.razorpay_order_id ilike '%' || p.q_like || '%'
        or (
          p.q_digits <> ''
          and regexp_replace(b.customer_mobile, '\D', '', 'g') like '%' || p.q_digits || '%'
        )
        -- A pass id, printed on the guest's ticket.
        or exists (
          select 1 from public.digital_passes dp
          where dp.booking_id = b.id and dp.pass_id ilike '%' || p.q_like || '%'
        )
      )
      and (p_event_date_from is null or d.event_date >= p_event_date_from)
      and (p_event_date_to   is null or d.event_date <= p_event_date_to)
      and (p_pass_category_id is null or b.pass_category_id = p_pass_category_id)
      and (p.payment_status is null or b.payment_status = p.payment_status)
      and (p.booking_status is null or b.booking_status = p.booking_status)
      and (
        p.check_in_status is null
        -- "none" means nobody has been admitted yet: no pass checked in, whether or
        -- not passes were issued (an unpaid booking has none).
        or (p.check_in_status = 'none' and coalesce(ps.checked_in, 0) = 0)
        -- "some" is the interesting one: part of a group is inside.
        or (
          p.check_in_status = 'some'
          and coalesce(ps.checked_in, 0) > 0
          and coalesce(ps.checked_in, 0) < coalesce(ps.issued, 0)
        )
        or (
          p.check_in_status = 'all'
          and coalesce(ps.issued, 0) > 0
          and coalesce(ps.checked_in, 0) = coalesce(ps.issued, 0)
        )
      )
  ),
  counted as (
    -- The size of the whole result set, not of the page: the screen has to say
    -- "showing 1–25 of 240" before the admin scrolls.
    select m.id, m.created_at, count(*) over ()::integer as total_count
    from matched m
  ),
  page as (
    select c.id, c.total_count
    from counted c
    order by c.created_at desc, c.id desc
    limit (select page_size from params)
    offset (select page_offset from params)
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
    case when p_include_contact then b.razorpay_payment_id end,
    b.created_at,
    coalesce(ps.issued, 0),
    coalesce(ps.checked_in, 0),
    ps.check_in_times,
    coalesce(ps.pass_ids, '{}'::text[]),
    pg.total_count
  from page pg
  join public.bookings b        on b.id = pg.id
  join public.event_dates d     on d.id = b.event_date_id
  join public.events e          on e.id = d.event_id
  join public.pass_categories p on p.id = b.pass_category_id
  left join pass_state ps       on ps.booking_uuid = b.id
  order by b.created_at desc, b.id desc;
$$;

comment on function public.admin_search_bookings(text, date, date, uuid, text, text, text, boolean, integer, integer) is
  'The admin booking list: search by reference, name, mobile, email, Razorpay payment/order id or pass id, filtered by event date, pass category, payment status, booking status and check-in state, paged, with the total number of matches. Contact details, amounts and gateway ids come back null when p_include_contact is false. service_role only.';

-- -----------------------------------------------------------------------------
-- 3. One booking, completely.
--
--    Everything a support conversation needs, in one row: the booking, the night and
--    venue, the pass category, every pass with its state, every gate entry with who
--    made it, the gateway ids, and the webhook deliveries that were received for this
--    order. The payment events are the point: they are read-only evidence of what
--    Razorpay actually reported, as opposed to what somebody believes happened.
--
--    `p_lookup` accepts the booking reference, a pass id or either gateway id, so a
--    support link can be built from whatever the guest has in front of them.
--
--    The QR token is deliberately not returned. It is the credential that admits one
--    person at the gate, and nothing on this screen needs it: the guest's own pass
--    page is the only thing that shows a pass, and it shows it to the guest.
-- -----------------------------------------------------------------------------
create or replace function public.admin_booking_detail(
  p_lookup          text,
  p_include_contact boolean default true
)
returns table (
  booking_uuid        uuid,
  booking_id          text,
  customer_name       text,
  customer_mobile     text,
  customer_email      text,
  event_name          text,
  event_slug          text,
  venue_name          text,
  venue_address       text,
  city                text,
  event_date          date,
  start_time          time,
  end_time            time,
  pass_name           text,
  pass_composition    text,
  quantity            integer,
  number_of_people    integer,
  subtotal            integer,
  total_amount        integer,
  currency            text,
  booking_status      text,
  payment_status      text,
  razorpay_order_id   text,
  razorpay_payment_id text,
  notes               text,
  created_at          timestamptz,
  updated_at          timestamptz,
  passes              jsonb,
  check_ins           jsonb,
  payment_events      jsonb
)
language sql
stable
security definer
set search_path = public
as $$
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
    case when p_include_contact then b.customer_email end,
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
                   'staff', coalesce(nullif(btrim(au.full_name), ''), au.email),
                   'pass_id', dp.pass_id
                 )
                 order by ci.checked_in_at
               )
        from public.check_ins ci
        join public.digital_passes dp on dp.id = ci.digital_pass_id
        left join public.admin_users au on au.id = ci.checked_in_by
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
$$;

comment on function public.admin_booking_detail(text, boolean) is
  'One booking in full — passes, gate entries and the Razorpay events received for its order — found by booking reference, pass id, payment id or order id. Contact details, amounts and gateway ids come back null when p_include_contact is false. service_role only.';

-- -----------------------------------------------------------------------------
-- 4. The payment-status guard.
--
--    `payment_status` describes what the *gateway* did, so the database refuses to
--    let it change unless the statement that changes it carries proof that a verified
--    gateway event is behind it. The three functions that legitimately move it set
--    `app.payment_proof` for the duration of their own transaction (re-created below,
--    bodies otherwise unchanged); everything else — an ad-hoc `update` in the SQL
--    editor, a script, a future "mark as paid" button somebody adds in a hurry —
--    fails with PB007.
--
--    This is the "clearly defined secure administrative process" from the other
--    direction: there is no manual path to paid at all. A payment that Razorpay
--    captured but the site did not record is fixed by re-delivering the gateway's own
--    event (Razorpay dashboard → Webhooks → resend), which lands in
--    `confirm_booking_payment` with a signature-verified payload — never by typing a
--    status into a row.
--
--    Refunds are held to the same rule, because `refund_booking_payment` is the same
--    kind of thing: it is driven by `refund.processed` from the gateway.
-- -----------------------------------------------------------------------------
create or replace function public.guard_booking_payment_status()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.payment_status is distinct from old.payment_status
     and coalesce(current_setting('app.payment_proof', true), '') <> 'razorpay-verified' then
    raise exception 'payment_status may only change through a verified Razorpay event'
      using errcode = 'PB007',
            hint = 'Re-deliver the gateway event (Razorpay → Webhooks → resend) instead of writing the status by hand.';
  end if;

  return new;
end;
$$;

comment on function public.guard_booking_payment_status() is
  'Refuses any change to bookings.payment_status that does not come from a verified gateway event (set app.payment_proof inside the payment functions).';

drop trigger if exists bookings_guard_payment_status on public.bookings;
create trigger bookings_guard_payment_status
  before update on public.bookings
  for each row execute function public.guard_booking_payment_status();


-- Re-created from 20260922090600_digital_pass.sql with the payment-proof line added at the top of the body; nothing else changed.
create or replace function public.confirm_booking_payment(
  p_razorpay_order_id  text,
  p_razorpay_payment_id text,
  p_amount_paise       integer default null
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
  event_date       date,
  start_time       time,
  end_time         time,
  pass_name        text,
  pass_composition text,
  currency         text,
  passes_issued    integer,
  already_confirmed boolean,
  capacity_note    text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking  record;
  v_holder   uuid;
  v_booked   integer;
  v_capacity integer;
  v_note     text;
begin
  -- This function runs because a gateway event was verified (or because the
  -- checkout was confirmed with a valid signature). The token is local to this
  -- transaction and is what the guard trigger looks for.
  perform set_config('app.payment_proof', 'razorpay-verified', true);
  select b.* into v_booking
  from public.bookings b
  where b.razorpay_order_id = p_razorpay_order_id
  for update;

  if not found then
    raise exception 'order_not_found' using errcode = 'PC001';
  end if;

  -- The amount must be what the database says the booking costs. A ₹1 payment
  -- cannot confirm a ₹998 booking.
  if p_amount_paise is not null and p_amount_paise <> v_booking.total_amount * 100 then
    raise exception 'amount_mismatch' using errcode = 'PC002';
  end if;

  -- One payment can only ever belong to one booking.
  select b.id into v_holder
  from public.bookings b
  where b.razorpay_payment_id = p_razorpay_payment_id
    and b.id <> v_booking.id;

  if found then
    raise exception 'payment_already_used' using errcode = 'PC003';
  end if;

  -- Already paid: a duplicate callback gets the same answer, and nothing is
  -- written again (no second set of passes).
  if v_booking.payment_status = 'paid' then
    return query
      select b.id, b.booking_id, b.public_token, b.booking_status, b.payment_status, b.quantity,
             b.number_of_people, b.subtotal, b.total_amount, d.event_id, d.event_date,
             d.start_time, d.end_time, p.name, p.composition, e.currency,
             (select count(*)::integer from public.digital_passes dp where dp.booking_id = b.id),
             true, b.notes
      from public.bookings b
      join public.event_dates d on d.id = b.event_date_id
      join public.pass_categories p on p.id = b.pass_category_id
      join public.events e on e.id = d.event_id
      where b.id = v_booking.id;

    return;
  end if;

  -- From here on the booking is being paid for the first time, so a payment id is
  -- mandatory: an event without one (`order.paid` on its own) is ignored by the
  -- dispatcher and the `payment.captured` delivery does the work instead.
  if p_razorpay_payment_id is null or length(btrim(p_razorpay_payment_id)) = 0 then
    raise exception 'payment_id_required' using errcode = 'PC005';
  end if;

  -- Capacity is checked again, but the customer has already paid: the booking is
  -- confirmed either way and an organiser flag is recorded instead of silently
  -- dropping a paid booking.
  select coalesce(sum(b.number_of_people) filter (where b.payment_status = 'paid'), 0)::integer
    into v_booked
  from public.bookings b
  where b.event_date_id = v_booking.event_date_id
    and b.id <> v_booking.id;

  select d.capacity into v_capacity
  from public.event_dates d
  where d.id = v_booking.event_date_id;

  if v_booked + v_booking.number_of_people > v_capacity then
    v_note := 'capacity exceeded when payment was confirmed — needs organiser review';
  end if;

  update public.bookings b
  set payment_status   = 'paid',
      booking_status   = 'confirmed',
      razorpay_payment_id = p_razorpay_payment_id,
      notes            = coalesce(v_note, b.notes)
  where b.id = v_booking.id;

  -- One scannable pass per purchased pass, issued only now that payment is
  -- verified. Guarded three ways: the replay above returns early, the not-exists
  -- check skips a booking that already has passes, and the unique
  -- (booking_id, pass_number) index makes a duplicate slot impossible.
  insert into public.digital_passes (booking_id, valid_date, pass_number, status)
  select v_booking.id, d.event_date, s.slot, 'active'
  from public.event_dates d
  cross join generate_series(1, v_booking.quantity) as s(slot)
  where d.id = v_booking.event_date_id
    and not exists (select 1 from public.digital_passes dp where dp.booking_id = v_booking.id)
  on conflict (booking_id, pass_number) do nothing;

  return query
    select b.id, b.booking_id, b.public_token, b.booking_status, b.payment_status, b.quantity,
           b.number_of_people, b.subtotal, b.total_amount, d.event_id, d.event_date,
           d.start_time, d.end_time, p.name, p.composition, e.currency,
           (select count(*)::integer from public.digital_passes dp where dp.booking_id = b.id),
           false, b.notes
    from public.bookings b
    join public.event_dates d on d.id = b.event_date_id
    join public.pass_categories p on p.id = b.pass_category_id
    join public.events e on e.id = d.event_id
    where b.id = v_booking.id;
end;
$$;

-- Re-created from 20260922090500_payments.sql with the payment-proof line added at the top of the body; nothing else changed.
create or replace function public.fail_booking_payment(
  p_razorpay_order_id   text,
  p_razorpay_payment_id text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking record;
begin
  -- This function runs because a gateway event was verified (or because the
  -- checkout was confirmed with a valid signature). The token is local to this
  -- transaction and is what the guard trigger looks for.
  perform set_config('app.payment_proof', 'razorpay-verified', true);
  select b.* into v_booking
  from public.bookings b
  where b.razorpay_order_id = p_razorpay_order_id
  for update;

  if not found then
    return 'not_found';
  end if;

  -- A paid booking is never downgraded by a late failure event.
  if v_booking.payment_status = 'paid' then
    return 'already_paid';
  end if;

  update public.bookings b
  set payment_status = 'failed'
  where b.id = v_booking.id;

  return 'failed';
end;
$$;

-- Re-created from 20260922090500_payments.sql with the payment-proof line added at the top of the body; nothing else changed.
create or replace function public.refund_booking_payment(
  p_razorpay_payment_id text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking record;
begin
  -- This function runs because a gateway event was verified (or because the
  -- checkout was confirmed with a valid signature). The token is local to this
  -- transaction and is what the guard trigger looks for.
  perform set_config('app.payment_proof', 'razorpay-verified', true);
  select b.* into v_booking
  from public.bookings b
  where b.razorpay_payment_id = p_razorpay_payment_id
  for update;

  if not found then
    return 'not_found';
  end if;

  if v_booking.payment_status = 'refunded' then
    return 'already_refunded';
  end if;

  update public.bookings b
  set payment_status = 'refunded',
      booking_status = 'refunded'
  where b.id = v_booking.id;

  update public.digital_passes dp
  set status = 'cancelled'
  where dp.booking_id = v_booking.id;

  return 'refunded';
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Grants. The search and the detail read across bookings, passes, check-ins and
--    payment events: no browser session may call them, whatever key it holds.
-- -----------------------------------------------------------------------------
revoke execute on function public.admin_search_bookings(text, date, date, uuid, text, text, text, boolean, integer, integer) from public, anon, authenticated;
revoke execute on function public.admin_booking_detail(text, boolean) from public, anon, authenticated;

grant execute on function public.admin_search_bookings(text, date, date, uuid, text, text, text, boolean, integer, integer) to service_role;
grant execute on function public.admin_booking_detail(text, boolean) to service_role;
