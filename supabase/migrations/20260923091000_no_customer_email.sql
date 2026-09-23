-- =============================================================================
-- 18 · No customer email
--
-- The brief removes the customer's email address from the product entirely: the
-- form asks for a name and a mobile number, the pass shows a name and a mobile
-- number, and the database stores a name and a mobile number. The organizer's own
-- contact address (events.contact_email) is a different field and is untouched.
--
-- The column was NOT NULL *and* had a regex CHECK, and it was a parameter of
-- create_pending_booking() and a column of four admin read models — so this
-- migration is the column, the constraint, and the six functions that mentioned
-- it, restated from their live definitions with the email taken out and nothing
-- else changed.
--
-- Idempotent: guards throughout.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 · The column and its constraint
-- ---------------------------------------------------------------------------
-- Dropped by name discovered from the catalog: a table constraint that the column
-- depends on would otherwise block the drop.
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.bookings'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%customer_email%'
  loop
    execute format('alter table public.bookings drop constraint %I', c);
  end loop;
end $$;

alter table public.bookings drop column if exists customer_email;

-- ---------------------------------------------------------------------------
-- 2 · create_pending_booking, without the email argument
-- ---------------------------------------------------------------------------
-- A new signature, so the old 9-argument version must go explicitly: otherwise
-- `create or replace` would leave it behind as a second overload that callers could
-- still reach with an email argument.

drop function if exists public.create_pending_booking(uuid, uuid, uuid, text, text, text, integer, integer, text);

CREATE OR REPLACE FUNCTION public.create_pending_booking(p_event_id uuid, p_event_date_id uuid, p_pass_category_id uuid, p_customer_name text, p_customer_mobile text, p_quantity integer, p_number_of_people integer, p_idempotency_key text DEFAULT NULL::text)
 RETURNS TABLE(booking_uuid uuid, booking_reference text, public_token uuid, booking_status text, payment_status text, quantity integer, number_of_people integer, subtotal integer, total_amount integer, event_id uuid, event_date_id uuid, event_date date, start_time time without time zone, end_time time without time zone, pass_category_id uuid, pass_name text, pass_composition text, currency text, razorpay_order_id text, created_at timestamp with time zone, was_existing boolean)
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
    customer_name, customer_mobile,
    event_date_id, pass_category_id,
    quantity, booking_status, payment_status, idempotency_key
  )
  values (
    btrim(p_customer_name), p_customer_mobile,
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
$function$;


revoke all on function public.create_pending_booking(uuid, uuid, uuid, text, text, integer, integer, text) from public, anon, authenticated;
grant execute on function public.create_pending_booking(uuid, uuid, uuid, text, text, integer, integer, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3 · The admin read models
-- ---------------------------------------------------------------------------
-- Three of them return customer_email in their result set, so their return type
-- changes and `create or replace` cannot do it — drop, recreate, re-grant. The
-- other two only searched by it, so they are replaced in place.

drop function if exists public.admin_recent_bookings(integer, boolean);
drop function if exists public.admin_search_bookings(text, date, date, uuid, text, text, text, boolean, integer, integer);

CREATE OR REPLACE FUNCTION public.admin_recent_bookings(p_limit integer DEFAULT 8, p_include_contact boolean DEFAULT true)
 RETURNS TABLE(booking_uuid uuid, booking_id text, customer_name text, customer_mobile text, event_date date, start_time time without time zone, pass_name text, quantity integer, number_of_people integer, total_amount integer, currency text, booking_status text, payment_status text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    b.id,
    b.booking_id,
    b.customer_name,
    case when p_include_contact then b.customer_mobile end,
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
$function$;

CREATE OR REPLACE FUNCTION public.admin_search_bookings(p_query text DEFAULT NULL::text, p_event_date_from date DEFAULT NULL::date, p_event_date_to date DEFAULT NULL::date, p_pass_category_id uuid DEFAULT NULL::uuid, p_payment_status text DEFAULT NULL::text, p_booking_status text DEFAULT NULL::text, p_check_in_status text DEFAULT NULL::text, p_include_contact boolean DEFAULT true, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS TABLE(booking_uuid uuid, booking_id text, customer_name text, customer_mobile text, event_name text, event_slug text, event_date date, start_time time without time zone, end_time time without time zone, pass_name text, pass_composition text, quantity integer, number_of_people integer, total_amount integer, currency text, booking_status text, payment_status text, razorpay_order_id text, razorpay_payment_id text, created_at timestamp with time zone, passes_issued integer, passes_checked_in integer, check_in_times timestamp with time zone[], pass_ids text[], total_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;


revoke all on function public.admin_booking_detail(text, boolean) from public, anon, authenticated;
revoke all on function public.admin_recent_bookings(integer, boolean) from public, anon, authenticated;
revoke all on function public.admin_search_bookings(text, date, date, uuid, text, text, text, boolean, integer, integer) from public, anon, authenticated;
grant execute on function public.admin_booking_detail(text, boolean) to service_role;
grant execute on function public.admin_recent_bookings(integer, boolean) to service_role;
grant execute on function public.admin_search_bookings(text, date, date, uuid, text, text, text, boolean, integer, integer) to service_role;

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

CREATE OR REPLACE FUNCTION public.admin_payment_events(p_query text DEFAULT NULL::text, p_outcome text DEFAULT NULL::text, p_event_type text DEFAULT NULL::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_include_contact boolean DEFAULT true, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS TABLE(event_uuid uuid, event_id text, event_type text, outcome text, razorpay_order_id text, razorpay_payment_id text, amount_paise integer, received_at timestamp with time zone, processed_at timestamp with time zone, booking_uuid uuid, booking_id text, customer_name text, customer_mobile text, booking_status text, payment_status text, total_amount integer, currency text, total_count integer)
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
      -- Only values the schema holds become filters; anything else narrows nothing.
      case when p_outcome in ('received', 'confirmed', 'already_confirmed', 'failed',
                              'refunded', 'ignored', 'duplicate')
           then p_outcome end                            as outcome,
      case when nullif(btrim(coalesce(p_event_type, '')), '') is not null
           then btrim(p_event_type) end                  as event_type
  ),
  matched as (
    select pe.id, pe.received_at
    from public.payment_events pe
    cross join params p
    where (
        p.q is null
        -- Searched over what the gateway sent and over the booking it points at, so
        -- a support thread can start from whichever id the customer quoted.
        or pe.razorpay_order_id ilike '%' || p.q_like || '%'
        or pe.razorpay_payment_id ilike '%' || p.q_like || '%'
        or pe.event_id ilike '%' || p.q_like || '%'
        or pe.event_type ilike '%' || p.q_like || '%'
        or exists (
          select 1
          from public.bookings b
          where (b.razorpay_order_id = pe.razorpay_order_id
                 or (pe.razorpay_payment_id is not null and b.razorpay_payment_id = pe.razorpay_payment_id))
            and (
              b.booking_id ilike '%' || p.q_like || '%'
              or b.customer_name ilike '%' || p.q_like || '%'
              or (p.q_digits <> '' and regexp_replace(b.customer_mobile, '\D', '', 'g') like '%' || p.q_digits || '%')
            )
        )
      )
      and (p.outcome is null or pe.outcome = p.outcome)
      and (p.event_type is null or pe.event_type = p.event_type)
      and (p_from is null or (pe.received_at at time zone 'UTC')::date >= p_from)
      and (p_to   is null or (pe.received_at at time zone 'UTC')::date <= p_to)
  ),
  counted as (
    select m.id, m.received_at, count(*) over ()::integer as total_count
    from matched m
  ),
  page as (
    select c.id, c.total_count
    from counted c
    order by c.received_at desc, c.id desc
    limit (select page_size from params)
    offset (select page_offset from params)
  )
  select
    pe.id,
    pe.event_id,
    pe.event_type,
    pe.outcome,
    pe.razorpay_order_id,
    pe.razorpay_payment_id,
    case when p_include_contact then pe.amount_paise end,
    pe.received_at,
    pe.processed_at,
    b.id,
    b.booking_id,
    b.customer_name,
    case when p_include_contact then b.customer_mobile end,
    b.booking_status,
    b.payment_status,
    case when p_include_contact then b.total_amount end,
    e.currency,
    pg.total_count
  from page pg
  join public.payment_events pe on pe.id = pg.id
  -- At most one booking per delivery: an order id is unique, and a payment id is
  -- unique, so the lateral is a lookup rather than a fan-out.
  left join lateral (
    select bk.*
    from public.bookings bk
    where bk.razorpay_order_id = pe.razorpay_order_id
       or (pe.razorpay_payment_id is not null and bk.razorpay_payment_id = pe.razorpay_payment_id)
    order by bk.created_at desc
    limit 1
  ) b on true
  left join public.event_dates d on d.id = b.event_date_id
  left join public.events e      on e.id = d.event_id
  order by pe.received_at desc, pe.id desc;
$function$;

