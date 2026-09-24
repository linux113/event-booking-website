-- -----------------------------------------------------------------------------
-- Add optional referral name to bookings and passes.
-- -----------------------------------------------------------------------------

alter table public.bookings
  add column if not exists referred_by text;

comment on column public.bookings.referred_by is
  'Optional referral name or partner who referred this booking (up to 80 chars).';

-- Drop previous 8-argument create_pending_booking
drop function if exists public.create_pending_booking(uuid, uuid, uuid, text, text, integer, integer, text);

-- Recreate create_pending_booking with p_referred_by text DEFAULT NULL
CREATE OR REPLACE FUNCTION public.create_pending_booking(
  p_event_id uuid,
  p_event_date_id uuid,
  p_pass_category_id uuid,
  p_customer_name text,
  p_customer_mobile text,
  p_quantity integer,
  p_number_of_people integer,
  p_idempotency_key text DEFAULT NULL::text,
  p_referred_by text DEFAULT NULL::text
)
 RETURNS TABLE(
   booking_uuid uuid,
   booking_reference text,
   public_token uuid,
   booking_status text,
   payment_status text,
   quantity integer,
   number_of_people integer,
   subtotal integer,
   total_amount integer,
   event_id uuid,
   event_date_id uuid,
   event_date date,
   start_time time without time zone,
   end_time time without time zone,
   pass_category_id uuid,
   pass_name text,
   pass_composition text,
   currency text,
   razorpay_order_id text,
   created_at timestamp with time zone,
   was_existing boolean,
   referred_by text
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_clean_ref   text;
begin
  v_clean_ref := nullif(btrim(coalesce(p_referred_by, '')), '');
  if v_clean_ref is not null and length(v_clean_ref) > 80 then
    raise exception 'referred_by_too_long' using errcode = 'PB007', detail = '80';
  end if;

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
               b.razorpay_order_id, b.created_at, true, b.referred_by
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

  select coalesce(sum(b.number_of_people) filter (where b.payment_status = 'paid'), 0)::integer
    into v_booked
  from public.bookings b
  where b.event_date_id = p_event_date_id;

  v_remaining := greatest(v_night.capacity - v_night.capacity_held - v_booked, 0);

  if v_required > v_remaining then
    raise exception 'capacity_unavailable' using errcode = 'PB001', detail = v_remaining::text;
  end if;

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
             b.razorpay_order_id, b.created_at, true, b.referred_by
      from public.bookings b
      join public.event_dates d on d.id = b.event_date_id
      join public.pass_categories p on p.id = b.pass_category_id
      join public.events e on e.id = d.event_id
      where b.id = v_existing.id;

    return;
  end if;

  insert into public.bookings (
    customer_name, customer_mobile,
    event_date_id, pass_category_id,
    quantity, booking_status, payment_status, idempotency_key, referred_by
  )
  values (
    btrim(p_customer_name), p_customer_mobile,
    p_event_date_id, p_pass_category_id,
    p_quantity, 'pending', 'unpaid',
    nullif(btrim(coalesce(p_idempotency_key, '')), ''),
    v_clean_ref
  )
  returning id, bookings.booking_id into v_booking_id, v_reference;

  return query
    select b.id, b.booking_id, b.public_token, b.booking_status, b.payment_status, b.quantity,
           b.number_of_people, b.subtotal, b.total_amount, d.event_id, d.id, d.event_date,
           d.start_time, d.end_time, p.id, p.name, p.composition, e.currency,
           b.razorpay_order_id, b.created_at, false, b.referred_by
    from public.bookings b
    join public.event_dates d on d.id = b.event_date_id
    join public.pass_categories p on p.id = b.pass_category_id
    join public.events e on e.id = d.event_id
    where b.id = v_booking_id;
end;
$function$;

revoke all on function public.create_pending_booking(uuid, uuid, uuid, text, text, integer, integer, text, text) from public, anon, authenticated;
grant execute on function public.create_pending_booking(uuid, uuid, uuid, text, text, integer, integer, text, text) to service_role;

-- Update get_pass_by_token to return referred_by as well
drop function if exists public.get_pass_by_token(text);

create or replace function public.get_pass_by_token(p_qr_token text)
returns table (
  pass_id          text,
  qr_token         text,
  pass_status      text,
  checked_in       boolean,
  checked_in_at    timestamptz,
  valid_date       date,
  issued_at        timestamptz,
  pass_number      integer,
  pass_total       integer,
  booking_reference text,
  booking_status   text,
  payment_status   text,
  customer_name    text,
  quantity         integer,
  total_amount     integer,
  currency         text,
  event_name       text,
  event_date       date,
  start_time       time,
  end_time         time,
  venue_name       text,
  venue_address    text,
  city             text,
  pass_name        text,
  pass_composition text,
  referred_by      text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    dp.pass_id,
    dp.qr_token,
    dp.status,
    dp.checked_in,
    dp.checked_in_at,
    dp.valid_date,
    dp.created_at,
    dp.pass_number,
    (select count(*)::integer from public.digital_passes all_passes where all_passes.booking_id = b.id),
    b.booking_id,
    b.booking_status,
    b.payment_status,
    b.customer_name,
    b.quantity,
    b.total_amount,
    e.currency,
    e.name,
    d.event_date,
    d.start_time,
    d.end_time,
    e.venue_name,
    e.venue_address,
    e.city,
    p.name,
    p.composition,
    b.referred_by
  from public.digital_passes dp
  join public.bookings b on b.id = dp.booking_id
  join public.event_dates d on d.id = b.event_date_id
  join public.pass_categories p on p.id = b.pass_category_id
  join public.events e on e.id = d.event_id
  where dp.qr_token = p_qr_token;
$$;

revoke all on function public.get_pass_by_token(text) from public, anon, authenticated;
grant execute on function public.get_pass_by_token(text) to service_role;

-- Update admin_booking_detail to return referred_by
drop function if exists public.admin_booking_detail(text, boolean);

CREATE OR REPLACE FUNCTION public.admin_booking_detail(p_lookup text, p_include_contact boolean DEFAULT true)
 RETURNS TABLE(
   booking_uuid uuid,
   booking_id text,
   customer_name text,
   customer_mobile text,
   event_name text,
   event_slug text,
   venue_name text,
   venue_address text,
   city text,
   event_date date,
   start_time time without time zone,
   end_time time without time zone,
   pass_name text,
   pass_composition text,
   quantity integer,
   number_of_people integer,
   subtotal integer,
   total_amount integer,
   currency text,
   booking_status text,
   payment_status text,
   razorpay_order_id text,
   razorpay_payment_id text,
   notes text,
   created_at timestamp with time zone,
   updated_at timestamp with time zone,
   passes jsonb,
   check_ins jsonb,
   payment_events jsonb,
   referred_by text
 )
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
    end,
    b.referred_by
  from target b
  join public.event_dates d     on d.id = b.event_date_id
  join public.events e          on e.id = d.event_id
  join public.pass_categories p on p.id = b.pass_category_id;
$function$;

revoke all on function public.admin_booking_detail(text, boolean) from public, anon, authenticated;
grant execute on function public.admin_booking_detail(text, boolean) to service_role;
