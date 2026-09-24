-- ---------------------------------------------------------------------------
-- 20260925130000_booking_check_in_times_text.sql
--
-- /admin/bookings and /admin/bookings/export were broken in production, with no
-- error on the screen beyond "Booking management is unavailable":
--
--   P2010 · Raw query failed. Code: `N/A`. Message: `Failed to deserialize column
--   of type 'Unknown'. If you're using $queryRaw and this column is explicitly
--   marked as `Unsupported` in your Prisma schema, try casting this column to any
--   supported Prisma type such as `String`.`
--
-- The cause was not the query and not the data. `admin_search_bookings()` returned
-- `check_in_times timestamptz[]`, and the runtime driver adapter
-- (@prisma/adapter-neon — the pooled WebSocket transport Vercel uses) has no entry
-- for OID 1185 in its result-type table. It maps 1115 `timestamp[]` and 1183
-- `time[]`; 1185 is missing, so it throws `UnsupportedNativeDataType` while it is
-- still describing the result set — before reading a row, and regardless of how
-- many bookings exist. The same defect is why the function's result could never be
-- read from the app even on an empty database.
--
-- The fix is at the source, not in the caller: the column is returned as
-- `text[]` of ISO-8601 UTC strings, which the adapter maps and which is the shape
-- the app's row contract already declares (`checkInTimes: string[]`). Every caller
-- is fixed at once — the list, the CSV export and the next screen that reads this
-- function — and no query has to remember to cast.
--
-- The type change means `create or replace` cannot be used (PostgreSQL does not
-- allow changing a function's result type in place), so this drops and recreates
-- it, then re-states the grants: the same shape the earlier return-type change in
-- 20260923091000_no_customer_email.sql used.
--
-- A guard now exists for the whole class of defect:
--   npm run test:db-types   (scripts/test/sql-driver-types.test.mjs)
-- It reads every function the app calls and every table column in the schema, and
-- fails if a single result column is a type the Neon adapter cannot map.
-- ---------------------------------------------------------------------------

-- Dropped explicitly rather than replaced: the OUT parameter list changes.
drop function if exists public.admin_search_bookings(text, date, date, uuid, text, text, text, boolean, integer, integer);

CREATE OR REPLACE FUNCTION public.admin_search_bookings(p_query text DEFAULT NULL::text, p_event_date_from date DEFAULT NULL::date, p_event_date_to date DEFAULT NULL::date, p_pass_category_id uuid DEFAULT NULL::uuid, p_payment_status text DEFAULT NULL::text, p_booking_status text DEFAULT NULL::text, p_check_in_status text DEFAULT NULL::text, p_include_contact boolean DEFAULT true, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS TABLE(booking_uuid uuid, booking_id text, customer_name text, customer_mobile text, event_name text, event_slug text, event_date date, start_time time without time zone, end_time time without time zone, pass_name text, pass_composition text, quantity integer, number_of_people integer, total_amount integer, currency text, booking_status text, payment_status text, razorpay_order_id text, razorpay_payment_id text, created_at timestamp with time zone, passes_issued integer, passes_checked_in integer, check_in_times text[], pass_ids text[], total_count integer)
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
      -- When each pass was admitted, as ISO-8601 UTC strings — and deliberately
      -- `text[]`, not `timestamptz[]`.
      --
      -- The app reaches Neon through @prisma/adapter-neon, whose result-type table
      -- has no entry for `timestamp with time zone[]` (OID 1185). It maps 1115
      -- (`timestamp[]`) and 1183 (`time[]`), but not 1185, and anything it cannot
      -- map fails the *whole query* before a single row is read:
      --
      --   P2010 · Raw query failed. Code: `N/A`. Message: `Failed to deserialize
      --   column of type 'Unknown'. … try casting this column to any supported
      --   Prisma type such as `String`.`
      --
      -- which is exactly what blanked /admin/bookings and its CSV export with
      -- "Booking management is unavailable". `text[]` is a type the adapter maps,
      -- and `2026-10-11T20:12:33.000Z` is the string shape the app's row contract
      -- already promises for every other timestamp (src/lib/db/normalise.ts).
      --
      -- `to_char` rather than `::text[]`: a bare cast renders timestamps in the
      -- session's DateStyle (`2026-10-11 20:12:33+00`), which is not the ISO-8601
      -- form the rest of the app reads. An empty array (`{}`) rather than NULL, as
      -- for `pass_ids`: "nobody has been admitted yet" is a list with no entries.
      coalesce(
        array_agg(
          to_char(dp.checked_in_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          order by dp.pass_number
        ) filter (where dp.checked_in_at is not null),
        '{}'::text[]
      ) as check_in_times,
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
comment on function public.admin_search_bookings(text, date, date, uuid, text, text, text, boolean, integer, integer) is
  'One page of the admin booking list, filtered and counted in SQL. check_in_times is text[] of ISO-8601 UTC strings and not timestamptz[]: the Neon driver adapter cannot map OID 1185.';

revoke all on function public.admin_search_bookings(text, date, date, uuid, text, text, text, boolean, integer, integer) from public, anon, authenticated;
grant execute on function public.admin_search_bookings(text, date, date, uuid, text, text, text, boolean, integer, integer) to service_role;
