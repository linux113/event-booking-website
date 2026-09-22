-- ---------------------------------------------------------------------------
-- 20260922090600_digital_pass.sql
--
-- Digital passes: a stable slot per pass, and the two read paths the website
-- needs to show one.
--
-- Passes are already issued exactly once, inside confirm_booking_payment(), at
-- the moment a payment is verified — nothing in the browser can create one, and
-- re-running the confirmation returns early without touching the table. This
-- migration makes that guarantee structural as well:
--
--   * digital_passes.pass_number numbers the passes of a booking (1..quantity);
--   * a unique index on (booking_id, pass_number) means the same slot can never
--     be filled twice, whatever a future code path does.
--
-- It also adds the two read functions the pages use. Both are service_role only:
-- the browser is never allowed to ask for a pass, it can only open a page that
-- asks the server for it.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. One slot per pass
-- ---------------------------------------------------------------------------
alter table public.digital_passes
  add column if not exists pass_number integer;

-- Backfill for any pass issued before this migration: within a booking, order by
-- creation (then id, so the result is deterministic), and number them 1..n.
with numbered as (
  select id,
         row_number() over (partition by booking_id order by created_at, id) as slot
  from public.digital_passes
)
update public.digital_passes dp
set pass_number = numbered.slot
from numbered
where dp.id = numbered.id
  and dp.pass_number is distinct from numbered.slot;

alter table public.digital_passes
  alter column pass_number set not null;

alter table public.digital_passes
  drop constraint if exists digital_passes_pass_number_check;

alter table public.digital_passes
  add constraint digital_passes_pass_number_check check (pass_number >= 1);

comment on column public.digital_passes.pass_number is
  'Slot of this pass within its booking: 1..quantity. Unique per booking, so a booking can never end up with two pass 1s.';

-- The guarantee, in the database rather than in a code path.
create unique index if not exists digital_passes_booking_pass_number_idx
  on public.digital_passes (booking_id, pass_number);

-- ---------------------------------------------------------------------------
-- 2. Issue passes with their slot (same behaviour, one added column)
--
-- Recreated only so the insert can fill pass_number from the series that already
-- creates one row per purchased pass. Every rule from the previous definition is
-- unchanged: amount check, payment-reuse check, idempotent replay, capacity note.
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

comment on function public.confirm_booking_payment(text, text, integer) is
  'Marks a booking paid + confirmed after a server-verified payment, issues one digital pass per purchased pass, and is idempotent: a repeated call returns the same booking without writing anything.';

-- ---------------------------------------------------------------------------
-- 3. The passes of one booking, for the customer's own success page
--
-- Called with the booking's random public_token, so it needs no session: the
-- token is the credential. Returns pass rows only — the page already has the
-- booking's own details — and never a mobile number or an email address.
-- ---------------------------------------------------------------------------
create or replace function public.get_booking_passes(p_public_token uuid)
returns table (
  pass_id       text,
  qr_token      text,
  pass_status   text,
  checked_in    boolean,
  checked_in_at timestamptz,
  valid_date    date,
  issued_at     timestamptz,
  pass_number   integer,
  pass_total    integer
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
    (select count(*)::integer from public.digital_passes all_passes where all_passes.booking_id = b.id)
  from public.bookings b
  join public.digital_passes dp on dp.booking_id = b.id
  where b.public_token = p_public_token
  order by dp.pass_number;
$$;

comment on function public.get_booking_passes(uuid) is
  'Every pass of one booking, found by the booking''s random public token. Service role only; contains no mobile number or email address.';

-- ---------------------------------------------------------------------------
-- 4. One pass by its QR token — what the QR code points at
--
-- The QR encodes https://<site>/verify/<qr_token>. The token is 64 random hex
-- characters and is the only credential needed: no booking reference, no mobile
-- number and no customer id is in the QR, so a screenshot of a pass reveals
-- nothing that the pass does not already show.
-- ---------------------------------------------------------------------------
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
  pass_composition text
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
    p.composition
  from public.digital_passes dp
  join public.bookings b on b.id = dp.booking_id
  join public.event_dates d on d.id = b.event_date_id
  join public.pass_categories p on p.id = b.pass_category_id
  join public.events e on e.id = d.event_id
  where dp.qr_token = p_qr_token;
$$;

comment on function public.get_pass_by_token(text) is
  'Resolves one digital pass from the token inside its QR code: the ticket and the gate verification page both use it. Service role only; contains no mobile number or email address.';

-- ---------------------------------------------------------------------------
-- 5. Privileges: the two read functions are service_role only
--
-- A pass is personal. The browser never queries these directly — the server
-- renders the page after checking that the caller holds the right token.
-- ---------------------------------------------------------------------------
revoke all on function public.get_booking_passes(uuid) from public, anon, authenticated;
revoke all on function public.get_pass_by_token(text) from public, anon, authenticated;

grant execute on function public.get_booking_passes(uuid) to service_role;
grant execute on function public.get_pass_by_token(text) to service_role;
