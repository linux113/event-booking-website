-- -----------------------------------------------------------------------------
-- 20260922091500_security_hardening
--
-- Row level security for the gate role.
--
-- The original staff policies were written as "an active staff member may work the
-- gate". `admin_users.role = 'staff'` is the role that gets a phone at the door,
-- and a session holding it could, straight through PostgREST with its own token:
--
--   * read every booking, mobile number and email address in the database;
--   * read every digital pass, including its `qr_token` — the credential that
--     admits the holder;
--   * update bookings: `payment_status = 'paid'`, or `booking_status =
--     'cancelled'` on somebody else's booking;
--   * update passes: `checked_in = false, status = 'active'` on a used pass, so the
--     same QR code is admitted a second time, or `valid_date` moved to another
--     night;
--   * insert into `check_ins`, where `check_ins_one_per_pass` turns each row into a
--     denial of service against a real guest, plus a fake entry log.
--
-- None of that is what the gate needs. `pass_entry()` and `check_in_pass()` are
-- SECURITY DEFINER functions called with the service role, and `src/lib/auth/*`
-- checks the role server-side before either is reached. **No application code
-- reads these tables with a user session at all** — the only table a session
-- touches directly is `admin_users`, to resolve the caller's own staff row. These
-- policies are therefore defence in depth, and the narrowest version of them
-- cannot break a working screen.
--
-- What is left for the gate role:
--   check_ins  — SELECT, so a shift can see the night's entries: pass ids, gate,
--                timestamp. No personal data, no credentials.
--   everything else on `bookings` and `digital_passes` — admin and super_admin.
-- -----------------------------------------------------------------------------

drop policy if exists bookings_staff_read on public.bookings;
drop policy if exists bookings_staff_update on public.bookings;

create policy bookings_admin_read on public.bookings
  for select
  to authenticated
  using (public.is_admin());

create policy bookings_admin_update on public.bookings
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

comment on policy bookings_admin_read on public.bookings is
  'Guest names, mobile numbers and email addresses are admin work. A scanner session reads a pass through pass_entry(), which returns only the pass in front of it.';

drop policy if exists digital_passes_staff_read on public.digital_passes;
drop policy if exists digital_passes_staff_update on public.digital_passes;

create policy digital_passes_admin_read on public.digital_passes
  for select
  to authenticated
  using (public.is_admin());

create policy digital_passes_admin_update on public.digital_passes
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

comment on policy digital_passes_admin_read on public.digital_passes is
  'A pass row carries qr_token, the credential that admits its holder, so reading the table is admin work.';

drop policy if exists check_ins_staff_insert on public.check_ins;

create policy check_ins_admin_insert on public.check_ins
  for insert
  to authenticated
  with check (public.is_admin());

comment on policy check_ins_staff_read on public.check_ins is
  'Any active staff role may read the entry log for the night. The row itself is written by check_in_pass() as the service role, in the same transaction that flips the pass, so INSERT is admin-only here.';
