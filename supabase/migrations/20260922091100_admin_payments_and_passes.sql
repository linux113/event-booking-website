-- =============================================================================
-- 20260922091100_admin_payments_and_passes.sql
--
-- Step 11 (part 1) — the two read-only operations screens: /admin/payments and
-- /admin/passes.
--
-- Both answer a question the bookings list cannot, because both are about
-- *artefacts* rather than about orders:
--
--   payments   what the gateway actually sent us, delivery by delivery, and which
--              rows contradict themselves;
--   passes     every ticket that exists, where it is, and whether it is in.
--
-- Six functions:
--
--   admin_search_pattern(text)            shared: a search term, wildcards escaped
--   admin_search_digits(text)             shared: the term's digits, when it is a
--                                         number and not just a name with digits in it
--   admin_payment_events(...)             one row per gateway delivery, with the
--                                         booking it belongs to
--   admin_payment_attention(...)          bookings whose payment state contradicts
--                                         the rest of the row
--   admin_payment_summary(...)            the counts above the deliveries
--   admin_pass_list(...)                  one row per issued pass, with its booking
--   admin_pass_summary(...)               the counts above the pass list
--
-- Three conventions, all inherited from step 10 because an operator moving between
-- these three screens should not have to learn a second set of rules:
--
--   * **Searching is one function's job.** `admin_search_pattern` escapes LIKE's own
--     wildcards, so a term of `%` finds nothing rather than everything, and
--     `admin_search_digits` decides whether a term is a phone number at all — a name
--     with digits in it ("Gate 4") must not sweep in every mobile containing "4".
--   * **An unknown filter value narrows nothing.** A status the schema does not hold
--     is dropped rather than forwarded, because an empty list that reads as "nothing
--     here" is a worse answer than ignoring a typo.
--   * **Contact details and money are the caller's business.** Every list takes
--     `p_include_contact`, and returns NULL rather than a figure it may not show.
--     Nothing on these screens can change a payment status: the guard trigger from
--     step 10 (`PB007`) refuses that, whichever path is taken.
--
-- All six are `service_role` only, like every other admin read.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The two search helpers.
--
--    Step 10 inlined these expressions in `admin_search_bookings`. They live as
--    functions here so both of this migration's lists share one definition rather
--    than three copies of the same rule — the rule being: a search term is a term,
--    not a pattern, and its digits are a phone number only when the term is one.
-- -----------------------------------------------------------------------------
create or replace function public.admin_search_pattern(p_query text)
returns text
language sql
immutable
set search_path = public
as $$
  -- The term, trimmed and capped, with LIKE's wildcards neutralised. Backslashes
  -- first, then `%`, then `_`: escaping the escape last would double it.
  select replace(
           replace(
             replace(left(btrim(coalesce(p_query, '')), 64), '\', '\\'),
             '%', '\%'
           ),
           '_', '\_'
         );
$$;

comment on function public.admin_search_pattern(text) is
  'A search term with LIKE wildcards escaped, so a term means the characters it contains. Empty in, empty out.';

create or replace function public.admin_search_digits(p_query text)
returns text
language sql
immutable
set search_path = public
as $$
  -- The digits of the term, but only when the term *is* a number: no letters, and at
  -- least four digits. Two digits appear in most phone numbers (matching everything),
  -- and "Gate 4" is a name — neither should reach the mobile column.
  select case
           when left(btrim(coalesce(p_query, '')), 64) !~ '[[:alpha:]]'
            and length(regexp_replace(coalesce(p_query, ''), '\D', '', 'g')) >= 4
           then regexp_replace(coalesce(p_query, ''), '\D', '', 'g')
           else ''
         end;
$$;

comment on function public.admin_search_digits(text) is
  'The digits of a search term when the term is a phone number (no letters, 4+ digits), otherwise an empty string.';

-- -----------------------------------------------------------------------------
-- 2. The gateway's deliveries.
--
--    One row per event the gateway sent or the checkout confirmed, newest first,
--    matched to the booking it belongs to where one can be identified. An event that
--    matches nothing is still listed: "a delivery arrived that belongs to no booking"
--    is exactly the kind of thing this screen exists to show.
-- -----------------------------------------------------------------------------
create or replace function public.admin_payment_events(
  p_query           text default null,
  p_outcome         text default null,
  p_event_type      text default null,
  p_from            date default null,
  p_to              date default null,
  p_include_contact boolean default true,
  p_limit           integer default 25,
  p_offset          integer default 0
)
returns table (
  event_uuid          uuid,
  event_id            text,
  event_type          text,
  outcome             text,
  razorpay_order_id   text,
  razorpay_payment_id text,
  amount_paise        integer,
  received_at         timestamptz,
  processed_at        timestamptz,
  booking_uuid        uuid,
  booking_id          text,
  customer_name       text,
  customer_mobile     text,
  booking_status      text,
  payment_status      text,
  total_amount        integer,
  currency            text,
  total_count         integer
)
language sql
stable
security definer
set search_path = public
as $$
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
              or b.customer_email ilike '%' || p.q_like || '%'
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
$$;

comment on function public.admin_payment_events(text, text, text, date, date, boolean, integer, integer) is
  'Every gateway delivery (and every checkout confirmation) as a row, newest first, with the booking it belongs to where one can be identified — including deliveries that match no booking at all. Money and contact details come back null when p_include_contact is false. service_role only.';

-- -----------------------------------------------------------------------------
-- 3. The counts above the deliveries.
--
--    Counted from the gateway's own rows rather than from the bookings, so the figures
--    describe what actually arrived. `captured_paise` and `refunded_paise` are the
--    gateway's amounts, which is the point: they are the one number on this screen that
--    does not come from a figure the site wrote down itself.
-- -----------------------------------------------------------------------------
create or replace function public.admin_payment_summary(
  p_include_contact boolean default true
)
returns table (
  events_total          integer,
  events_confirmed      integer,
  events_failed         integer,
  events_refunded       integer,
  events_ignored        integer,
  events_duplicate      integer,
  orders_awaiting       integer,
  last_received_at      timestamptz,
  last_processed_at     timestamptz,
  captured_paise        bigint,
  refunded_paise        bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with events as (
    select
      count(*)::integer                                        as total,
      count(*) filter (where pe.outcome in ('confirmed', 'already_confirmed'))::integer as confirmed,
      count(*) filter (where pe.outcome = 'failed')::integer     as failed,
      count(*) filter (where pe.outcome = 'refunded')::integer   as refunded,
      count(*) filter (where pe.outcome = 'ignored')::integer    as ignored,
      count(*) filter (where pe.outcome = 'duplicate')::integer  as duplicate,
      max(pe.received_at)                                       as last_received,
      max(pe.processed_at)                                      as last_processed,
      coalesce(sum(pe.amount_paise) filter (where pe.outcome in ('confirmed', 'already_confirmed')), 0)::bigint as captured,
      coalesce(sum(pe.amount_paise) filter (where pe.outcome = 'refunded'), 0)::bigint as refunded_amount
    from public.payment_events pe
  )
  select
    e.total,
    e.confirmed,
    e.failed,
    e.refunded,
    e.ignored,
    e.duplicate,
    -- Money the gateway has an order for and nothing has verified yet: an abandoned
    -- checkout, or a customer who is still on the payment page.
    (select count(*)::integer
       from public.bookings b
      where b.razorpay_order_id is not null
        and b.payment_status in ('unpaid', 'created', 'failed')),
    e.last_received,
    e.last_processed,
    case when p_include_contact then e.captured end,
    case when p_include_contact then e.refunded_amount end
  from events e;
$$;

comment on function public.admin_payment_summary(boolean) is
  'Counts over the gateway deliveries by outcome, the orders the gateway has an order for and nothing has verified, when the last delivery arrived and how much the gateway says was captured and refunded — the last two null when p_include_contact is false. service_role only.';

-- -----------------------------------------------------------------------------
-- 3. The rows that contradict themselves.
--
--    Not a heuristic: every row here is a state the database''s own rules call a
--    contradiction, which is why each one carries the reason and what to do about it.
--    A screen that lists "things that look odd" without saying why is a screen nobody
--    trusts; this one names the broken invariant in the row itself.
-- -----------------------------------------------------------------------------
create or replace function public.admin_payment_attention(
  p_include_contact boolean default true,
  p_limit           integer default 25
)
returns table (
  reason_code        text,
  reason             text,
  action             text,
  booking_uuid       uuid,
  booking_id         text,
  customer_name      text,
  customer_mobile    text,
  booking_status     text,
  payment_status     text,
  total_amount       integer,
  currency           text,
  razorpay_order_id  text,
  razorpay_payment_id text,
  event_date         date,
  passes_issued      integer,
  passes_active      integer,
  event_count        integer,
  created_at         timestamptz,
  total_count        integer
)
language sql
stable
security definer
set search_path = public
as $$
  with candidates as (
    select
      -- Each case is one broken expectation, in the order an operator should care.
      case
        when b.payment_status = 'paid' and coalesce(pst.issued, 0) = 0
          then 'paid-no-pass'
        when b.payment_status = 'paid' and b.booking_status <> 'confirmed'
          then 'paid-not-confirmed'
        when b.payment_status = 'refunded' and coalesce(pst.active, 0) > 0
          then 'refunded-with-active-pass'
        when b.payment_status = 'failed' and coalesce(pst.issued, 0) > 0
          then 'failed-with-pass'
        else 'event-ignored'
      end                                                as reason_code,
      b.*,
      coalesce(pst.issued, 0)                             as passes_issued,
      coalesce(pst.active, 0)                             as passes_active,
      coalesce(ev.n, 0)                                   as event_count
    from public.bookings b
    left join (
      select dp.booking_id,
             count(*)::integer                                   as issued,
             count(*) filter (where dp.status = 'active')::integer as active
      from public.digital_passes dp
      group by dp.booking_id
    ) pst on pst.booking_id = b.id
    left join (
      select pe.razorpay_order_id, count(*)::integer as n
      from public.payment_events pe
      where pe.outcome = 'ignored'
      group by pe.razorpay_order_id
    ) ev on ev.razorpay_order_id = b.razorpay_order_id
    where (b.payment_status = 'paid' and coalesce(pst.issued, 0) = 0)
       or (b.payment_status = 'paid' and b.booking_status <> 'confirmed')
       or (b.payment_status = 'refunded' and coalesce(pst.active, 0) > 0)
       or (b.payment_status = 'failed' and coalesce(pst.issued, 0) > 0)
       -- An event we could not act on: `order.paid` with no payment id, an amount
       -- that did not match, a delivery for an order we do not hold (PC005 and
       -- friends). Recorded rather than dropped, so it can be looked at.
       or (b.payment_status <> 'paid' and b.payment_status <> 'refunded' and coalesce(ev.n, 0) > 0)
  ),
  counted as (
    select c.*, count(*) over ()::integer as total_count from candidates c
  )
  select
    c.reason_code,
    case c.reason_code
      when 'paid-no-pass' then 'Paid, but no pass was ever issued'
      when 'paid-not-confirmed' then 'Paid, but the booking is not marked confirmed'
      when 'refunded-with-active-pass' then 'Refunded, but a pass is still active'
      when 'failed-with-pass' then 'A failed payment that nevertheless holds a pass'
      else 'A gateway event we could not act on'
    end,
    case c.reason_code
      when 'paid-no-pass' then 'Re-deliver the gateway event (Razorpay → Webhooks → resend) so the pass is issued and the guest can be admitted.'
      when 'paid-not-confirmed' then 'Check the booking on /admin/bookings, then re-deliver the gateway event.'
      when 'refunded-with-active-pass' then 'Cancel the pass before the gate opens, or the guest will be admitted on a refunded booking.'
      when 'failed-with-pass' then 'Cancel the pass, and check with the guest — the money did not arrive.'
      else 'Look at the delivery on /admin/payments: it belongs to no booking we hold, or the amount did not match.'
    end,
    c.id,
    c.booking_id,
    c.customer_name,
    case when p_include_contact then c.customer_mobile end,
    c.booking_status,
    c.payment_status,
    case when p_include_contact then c.total_amount end,
    e.currency,
    case when p_include_contact then c.razorpay_order_id end,
    case when p_include_contact then c.razorpay_payment_id end,
    d.event_date,
    c.passes_issued,
    c.passes_active,
    c.event_count,
    c.created_at,
    c.total_count
  from counted c
  join public.event_dates d on d.id = c.event_date_id
  join public.events e      on e.id = d.event_id
  order by c.created_at desc, c.id desc
  limit greatest(1, least(coalesce(p_limit, 25), 100));
$$;

comment on function public.admin_payment_attention(boolean, integer) is
  'Bookings whose payment state contradicts the rest of the row (paid with no pass, refunded with an active pass, a gateway event that could not be acted on), each with the reason and what to do. Contact details and gateway ids come back null when p_include_contact is false. service_role only.';

-- -----------------------------------------------------------------------------
-- 4. Every pass there is.
--
--    One row per issued pass, with its booking, its night and its gate entry. This is
--    the door list: who is expected, which ticket is which, and who is already inside.
--    The QR token is not selected — the credential that admits a guest is not this
--    screen's business, and there is no parameter that would make it so.
--
--    Ordered by when the pass was issued, then by booking and pass number, so the
--    passes of one booking stay together and in order across page boundaries. The
--    ordering is written the same way in the slice and in the final select; a list
--    whose pages are drawn in a different order than they were chosen is a list that
--    can show one pass twice and hide another.
-- -----------------------------------------------------------------------------
create or replace function public.admin_pass_list(
  p_query           text default null,
  p_status          text default null,
  p_check_in        text default null,
  p_event_date_id   uuid default null,
  p_from            date default null,
  p_to              date default null,
  p_include_contact boolean default true,
  p_limit           integer default 25,
  p_offset          integer default 0
)
returns table (
  pass_uuid           uuid,
  pass_id             text,
  pass_number         integer,
  pass_status         text,
  checked_in          boolean,
  checked_in_at       timestamptz,
  valid_date          date,
  gate                text,
  admitted_by         text,
  issued_at           timestamptz,
  booking_uuid        uuid,
  booking_id          text,
  booking_status      text,
  payment_status      text,
  customer_name       text,
  customer_mobile     text,
  pass_name           text,
  quantity            integer,
  number_of_people    integer,
  total_amount        integer,
  currency            text,
  event_name          text,
  start_time          time,
  end_time            time,
  passes_on_booking   integer,
  total_count         integer
)
language sql
stable
security definer
set search_path = public
as $$
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
        or b.customer_email ilike '%' || p.q_like || '%'
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
    coalesce(nullif(btrim(au.full_name), ''), au.email),
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
  left join public.admin_users au on au.id = ci.checked_in_by
  order by dp.created_at desc, b.booking_id desc, dp.pass_number desc;
$$;

comment on function public.admin_pass_list(text, text, text, uuid, date, date, boolean, integer, integer) is
  'Every issued pass, newest first: pass id, state, check-in time and gate, the booking and guest it belongs to, the night it is valid for, how many passes that booking holds and who admitted the guest. Contact details and amounts come back null when p_include_contact is false. The QR token is never returned. service_role only.';

-- -----------------------------------------------------------------------------
-- 5. The counts above the pass list.
--
--    Counted in the venue's days, like the dashboard, so "checked in today" means the
--    day it is at the gate.
--
--    Money is counted from the *bookings*, not from the join with passes: a booking
--    with four passes would otherwise be counted four times, and a screen that
--    overstates takings is worse than one that shows none.
-- -----------------------------------------------------------------------------
create or replace function public.admin_pass_summary(
  p_tz              text default 'UTC',
  p_include_contact boolean default true
)
returns table (
  passes_issued        integer,
  passes_active        integer,
  passes_used          integer,
  passes_cancelled     integer,
  passes_expired       integer,
  bookings_with_passes integer,
  checked_in_total     integer,
  checked_in_today     integer,
  last_check_in_at     timestamptz,
  gates_used           integer,
  passes_revenue       integer
)
language sql
stable
security definer
set search_path = public
as $$
  with pass_state as (
    select
      dp.booking_id,
      dp.status,
      dp.checked_in,
      ci.checked_in_at,
      ci.gate
    from public.digital_passes dp
    left join public.check_ins ci on ci.digital_pass_id = dp.id
  ),
  paid_for_passes as (
    -- Every paid booking that is holding at least one pass, counted once each.
    select coalesce(sum(b.total_amount), 0)::integer as revenue
    from public.bookings b
    where b.payment_status = 'paid'
      and exists (select 1 from public.digital_passes dp where dp.booking_id = b.id)
  )
  select
    pc.issued,
    pc.active,
    pc.used,
    pc.cancelled,
    pc.expired,
    pc.bookings,
    pc.checked_in,
    pc.today,
    pc.last_at,
    pc.gates,
    case when p_include_contact then pp.revenue end
  -- One row per counter, and the declared column order is the select order: PostgREST
  -- binds `returns table` by position, so a counter moved here and not there would be
  -- reported under the wrong name.
  from (
    select
      count(*)::integer                                             as issued,
      count(*) filter (where ps.status = 'active')::integer          as active,
      count(*) filter (where ps.status = 'used')::integer            as used,
      count(*) filter (where ps.status = 'cancelled')::integer       as cancelled,
      count(*) filter (where ps.status = 'expired')::integer         as expired,
      count(distinct ps.booking_id)::integer                        as bookings,
      count(*) filter (where ps.checked_in)::integer                 as checked_in,
      count(*) filter (where ps.checked_in_at is not null
                        and (ps.checked_in_at at time zone p_tz)::date
                            = (now() at time zone p_tz)::date)::integer as today,
      max(ps.checked_in_at)                                         as last_at,
      count(distinct ps.gate)::integer                              as gates
    from pass_state ps
  ) pc
  cross join paid_for_passes pp;
$$;

comment on function public.admin_pass_summary(text, boolean) is
  'The counts above the pass list: passes by state, bookings holding passes, check-ins today in the venue''s timezone, the last entry, how many gates have been used, and what the paid bookings behind those passes were worth — counted once per booking, and null when p_include_contact is false. service_role only.';

-- -----------------------------------------------------------------------------
-- 6. Grants. These read across bookings, passes, check-ins and payment events:
--    no browser session may call them, whatever key it holds.
-- -----------------------------------------------------------------------------
revoke execute on function public.admin_search_pattern(text) from public, anon, authenticated;
revoke execute on function public.admin_search_digits(text) from public, anon, authenticated;
revoke execute on function public.admin_payment_events(text, text, text, date, date, boolean, integer, integer) from public, anon, authenticated;
revoke execute on function public.admin_payment_attention(boolean, integer) from public, anon, authenticated;
revoke execute on function public.admin_payment_summary(boolean) from public, anon, authenticated;
revoke execute on function public.admin_pass_list(text, text, text, uuid, date, date, boolean, integer, integer) from public, anon, authenticated;
revoke execute on function public.admin_pass_summary(text, boolean) from public, anon, authenticated;

grant execute on function public.admin_search_pattern(text) to service_role;
grant execute on function public.admin_search_digits(text) to service_role;
grant execute on function public.admin_payment_events(text, text, text, date, date, boolean, integer, integer) to service_role;
grant execute on function public.admin_payment_attention(boolean, integer) to service_role;
grant execute on function public.admin_payment_summary(boolean) to service_role;
grant execute on function public.admin_pass_list(text, text, text, uuid, date, date, boolean, integer, integer) to service_role;
grant execute on function public.admin_pass_summary(text, boolean) to service_role;
