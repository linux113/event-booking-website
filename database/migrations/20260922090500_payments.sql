-- ---------------------------------------------------------------------------
-- Razorpay payments (test mode)
--
-- Money is confirmed by the server, never by the browser:
--   * an order is created for a booking whose amount the database already fixed
--   * the checkout signature is verified server-side with the key secret
--   * the payment is re-read from the Razorpay API and must match the booking's
--     order and amount
--   * only then does the booking become paid + confirmed and get its passes
--
-- Duplicate deliveries are harmless: `payment_events.event_id` is unique, the
-- confirmation function is idempotent per booking, and `razorpay_payment_id` is
-- unique so one payment can never be applied to two bookings.
--
-- Nothing here can mark a booking paid on its own: every path requires a
-- signature-verified payment id.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Public lookup token
-- ---------------------------------------------------------------------------
-- Lets the payment page show the customer their own booking after a refresh
-- without an account and without exposing booking rows: the token is a random
-- uuid, unguessable, and the lookup returns no personal data.
alter table public.bookings
  add column if not exists public_token uuid not null default gen_random_uuid();

create unique index if not exists bookings_public_token_idx on public.bookings (public_token);

comment on column public.bookings.public_token is
  'Random token that identifies one booking for its own customer (payment refresh/status). Never sequential, never returned in lists.';

-- ---------------------------------------------------------------------------
-- 2. Webhook delivery log (duplicate-processing guard)
-- ---------------------------------------------------------------------------
create table if not exists public.payment_events (
  id                 uuid primary key default gen_random_uuid(),
  event_id           text not null unique,
  event_type         text not null,
  razorpay_order_id  text,
  razorpay_payment_id text,
  amount_paise       integer,
  outcome            text not null default 'received',
  received_at        timestamptz not null default now(),
  processed_at       timestamptz
);

comment on table public.payment_events is
  'One row per Razorpay webhook delivery. event_id is unique, so a retried delivery can never be processed twice.';
comment on column public.payment_events.event_id is
  'x-razorpay-event-id when present, otherwise a SHA-256 hash of the raw body — both are stable across retries.';
comment on column public.payment_events.outcome is
  'confirmed | already_confirmed | failed | refunded | ignored | duplicate';

create index if not exists payment_events_order_idx on public.payment_events (razorpay_order_id);
create index if not exists payment_events_received_idx on public.payment_events (received_at desc);

alter table public.payment_events enable row level security;

-- No policies at all: nothing but the service role (which bypasses RLS) can read
-- or write this table.
revoke all on public.payment_events from anon, authenticated;
grant all on public.payment_events to service_role;

-- ---------------------------------------------------------------------------
-- 3. create_pending_booking: same rules, now also returns the lookup token
-- ---------------------------------------------------------------------------
-- The OUT columns changed, so the function is recreated. Its grants are re-applied
-- at the bottom of this migration.
drop function if exists public.create_pending_booking(uuid, uuid, uuid, text, text, text, integer, integer, text);

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
  select d.id, d.event_id, d.event_date, d.status, d.capacity, d.start_time, d.end_time
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
  -- bookings only. A pending booking does not hold a place until it is paid.
  select coalesce(sum(b.number_of_people) filter (where b.payment_status = 'paid'), 0)::integer
    into v_booked
  from public.bookings b
  where b.event_date_id = p_event_date_id;

  v_remaining := greatest(v_night.capacity - v_booked, 0);

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
  'Creates one pending/unpaid booking atomically: locks the night, re-reads capacity from paid bookings only, reads the price from pass_categories and ignores any client-supplied amount. Service role only.';

revoke all on function public.create_pending_booking(uuid, uuid, uuid, text, text, text, integer, integer, text) from public;
revoke all on function public.create_pending_booking(uuid, uuid, uuid, text, text, text, integer, integer, text) from anon, authenticated;
grant execute on function public.create_pending_booking(uuid, uuid, uuid, text, text, text, integer, integer, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Attach a Razorpay order to a booking
-- ---------------------------------------------------------------------------
-- Written only when the booking does not have an order yet, so a double click
-- cannot quietly overwrite the order a customer is paying.
create or replace function public.attach_razorpay_order(
  p_booking_id       uuid,
  p_razorpay_order_id text
)
returns table (booking_uuid uuid, razorpay_order_id text, attached boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text;
begin
  select b.razorpay_order_id into v_current
  from public.bookings b
  where b.id = p_booking_id
  for update;

  if not found then
    raise exception 'booking_not_found' using errcode = 'PC004';
  end if;

  if v_current is not null then
    return query select p_booking_id, v_current, false;
    return;
  end if;

  update public.bookings b
  set razorpay_order_id = p_razorpay_order_id
  where b.id = p_booking_id;

  return query select p_booking_id, p_razorpay_order_id, true;
end;
$$;

comment on function public.attach_razorpay_order(uuid, text) is
  'Stores the Razorpay order id on a booking once. Re-running returns the order that is already attached.';

-- ---------------------------------------------------------------------------
-- 5. Confirmation — the only path that can set payment_status = paid
-- ---------------------------------------------------------------------------
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
  -- verified. Guarded so a replay can never double the passes.
  insert into public.digital_passes (booking_id, valid_date, status)
  select v_booking.id, d.event_date, 'active'
  from public.event_dates d
  cross join generate_series(1, v_booking.quantity)
  where d.id = v_booking.event_date_id
    and not exists (select 1 from public.digital_passes dp where dp.booking_id = v_booking.id);

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

comment on function public.confirm_booking_payment(text, text, integer) is
  'Marks a booking paid + confirmed after a server-verified payment, issues its digital passes, and is idempotent: a repeated call returns the same booking without writing anything.';

-- ---------------------------------------------------------------------------
-- 6. Failure and refund
-- ---------------------------------------------------------------------------
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

comment on function public.fail_booking_payment(text, text) is
  'Records a failed payment attempt on a pending booking. Never downgrades a paid booking.';

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

comment on function public.refund_booking_payment(text) is
  'Marks a refunded booking and cancels its digital passes (the unique check-in per pass still holds).';

-- ---------------------------------------------------------------------------
-- 7. Webhook dispatcher — claim, act, record, all in one transaction
-- ---------------------------------------------------------------------------
create or replace function public.apply_razorpay_event(
  p_event_id          text,
  p_event_type        text,
  p_razorpay_order_id text default null,
  p_razorpay_payment_id text default null,
  p_amount_paise      integer default null
)
returns table (
  duplicate         boolean,
  outcome           text,
  booking_reference text,
  passes_issued     integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted  integer;
  v_outcome   text := 'ignored';
  v_reference text;
  v_passes    integer;
  v_result    record;
begin
  -- Claim the delivery. A retried webhook hits the unique constraint and stops
  -- here, so no side effect can happen twice.
  insert into public.payment_events (event_id, event_type, razorpay_order_id, razorpay_payment_id, amount_paise)
  values (p_event_id, p_event_type, p_razorpay_order_id, p_razorpay_payment_id, p_amount_paise)
  on conflict (event_id) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    return query select true, 'duplicate', null::text, null::integer;
    return;
  end if;

  if p_event_type in ('payment.captured', 'order.paid') then
    begin
      select * into v_result
      from public.confirm_booking_payment(p_razorpay_order_id, p_razorpay_payment_id, p_amount_paise);

      v_outcome := case when v_result.already_confirmed then 'already_confirmed' else 'confirmed' end;
      v_reference := v_result.booking_reference;
      v_passes := v_result.passes_issued;
    exception
      when sqlstate 'PC001' then
        -- An order we do not know about (another system, or a test delivery).
        v_outcome := 'ignored';
      when sqlstate 'PC005' then
        -- `order.paid` carries no payment id; the paired payment.captured event
        -- confirms the booking, so this delivery is recorded and ignored.
        v_outcome := 'ignored';
    end;
  elsif p_event_type = 'payment.failed' then
    v_outcome := public.fail_booking_payment(p_razorpay_order_id, p_razorpay_payment_id);
  elsif p_event_type in ('refund.processed', 'payment.refunded') then
    v_outcome := public.refund_booking_payment(p_razorpay_payment_id);
  end if;

  update public.payment_events pe
  set outcome = v_outcome, processed_at = now()
  where pe.event_id = p_event_id;

  return query select false, v_outcome, v_reference, v_passes;
end;
$$;

comment on function public.apply_razorpay_event(text, text, text, text, integer) is
  'Handles one webhook delivery: claims it (unique event id), dispatches captured/paid, failed and refund events, and records the outcome. Service role only.';

-- ---------------------------------------------------------------------------
-- 8. Customer-facing status lookup (by unguessable token)
-- ---------------------------------------------------------------------------
create or replace function public.get_booking_status(p_public_token uuid)
returns table (
  booking_reference text,
  booking_status   text,
  payment_status   text,
  quantity         integer,
  number_of_people integer,
  total_amount     integer,
  currency         text,
  event_name       text,
  event_date       date,
  start_time       time,
  end_time         time,
  venue_name       text,
  city             text,
  pass_name        text,
  pass_composition text,
  passes_issued    integer,
  created_at       timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.booking_id,
    b.booking_status,
    b.payment_status,
    b.quantity,
    b.number_of_people,
    b.total_amount,
    e.currency,
    e.name,
    d.event_date,
    d.start_time,
    d.end_time,
    e.venue_name,
    e.city,
    p.name,
    p.composition,
    (select count(*)::integer from public.digital_passes dp where dp.booking_id = b.id),
    b.created_at
  from public.bookings b
  join public.event_dates d on d.id = b.event_date_id
  join public.pass_categories p on p.id = b.pass_category_id
  join public.events e on e.id = d.event_id
  where b.public_token = p_public_token;
$$;

comment on function public.get_booking_status(uuid) is
  'Returns one booking by its random public token for the customer''s own payment status. Deliberately contains no name, mobile or email.';

-- ---------------------------------------------------------------------------
-- 9. Privileges: every function above is service-role only
-- ---------------------------------------------------------------------------
revoke all on function public.attach_razorpay_order(uuid, text) from public, anon, authenticated;
revoke all on function public.confirm_booking_payment(text, text, integer) from public, anon, authenticated;
revoke all on function public.fail_booking_payment(text, text) from public, anon, authenticated;
revoke all on function public.refund_booking_payment(text) from public, anon, authenticated;
revoke all on function public.apply_razorpay_event(text, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.get_booking_status(uuid) from public, anon, authenticated;

grant execute on function public.attach_razorpay_order(uuid, text) to service_role;
grant execute on function public.confirm_booking_payment(text, text, integer) to service_role;
grant execute on function public.fail_booking_payment(text, text) to service_role;
grant execute on function public.refund_booking_payment(text) to service_role;
grant execute on function public.apply_razorpay_event(text, text, text, text, integer) to service_role;
grant execute on function public.get_booking_status(uuid) to service_role;
