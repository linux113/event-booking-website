-- =============================================================================
-- Garba Nights — Row Level Security
--
-- Model
--   anon           → may read published public content only (events, dates,
--                    pass categories, gallery). No access to bookings, passes,
--                    check-ins or admin users. Cannot create bookings at all.
--   authenticated  → same public read access as anon, plus admin powers when the
--                    user is present in admin_users with an active role.
--   service_role   → bypasses RLS. Used only in server code for writing
--                    bookings/passes and for Razorpay webhooks. Never shipped
--                    to the browser (see src/lib/supabase/admin.ts).
--
-- Helper functions are SECURITY DEFINER so an admin check on admin_users does not
-- recurse through that table's own policies.
-- =============================================================================

alter table public.events          enable row level security;
alter table public.event_dates     enable row level security;
alter table public.pass_categories enable row level security;
alter table public.bookings        enable row level security;
alter table public.digital_passes  enable row level security;
alter table public.check_ins       enable row level security;
alter table public.gallery         enable row level security;
alter table public.admin_users     enable row level security;


-- -----------------------------------------------------------------------------
-- Helpers
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
  );
$$;

comment on function public.is_staff(uuid) is
  'True when the given user is an active admin_users row (any role, including scanner).';

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
      and role in ('owner', 'admin', 'manager')
  );
$$;

comment on function public.is_admin(uuid) is
  'True for owner/admin/manager. Scanners are excluded — they may only check passes in.';

create or replace function public.is_owner(p_user_id uuid default auth.uid())
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
      and role = 'owner'
  );
$$;

comment on function public.is_owner(uuid) is
  'True only for the owner role — the only role allowed to manage admin_users rows.';

revoke execute on function public.is_staff(uuid) from public;
revoke execute on function public.is_admin(uuid) from public;
revoke execute on function public.is_owner(uuid) from public;
grant execute on function public.is_staff(uuid), public.is_admin(uuid), public.is_owner(uuid)
  to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- Public catalogue: events, event_dates, pass_categories, gallery
--
-- Readable by anon and by any signed-in user (published rows only);
-- fully manageable by admins.
-- -----------------------------------------------------------------------------

drop policy if exists events_anon_read on public.events;
create policy events_anon_read on public.events
  for select to anon
  using (status = 'published');

drop policy if exists events_authenticated_read on public.events;
create policy events_authenticated_read on public.events
  for select to authenticated
  using (status = 'published' or public.is_admin());

drop policy if exists events_admin_manage on public.events;
create policy events_admin_manage on public.events
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());


drop policy if exists event_dates_anon_read on public.event_dates;
create policy event_dates_anon_read on public.event_dates
  for select to anon
  using (
    status <> 'cancelled'
    and exists (
      select 1 from public.events e
      where e.id = event_id and e.status = 'published'
    )
  );

drop policy if exists event_dates_authenticated_read on public.event_dates;
create policy event_dates_authenticated_read on public.event_dates
  for select to authenticated
  using (
    public.is_admin()
    or (
      status <> 'cancelled'
      and exists (
        select 1 from public.events e
        where e.id = event_id and e.status = 'published'
      )
    )
  );

drop policy if exists event_dates_admin_manage on public.event_dates;
create policy event_dates_admin_manage on public.event_dates
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());


drop policy if exists pass_categories_anon_read on public.pass_categories;
create policy pass_categories_anon_read on public.pass_categories
  for select to anon
  using (
    is_active
    and exists (
      select 1 from public.events e
      where e.id = event_id and e.status = 'published'
    )
  );

drop policy if exists pass_categories_authenticated_read on public.pass_categories;
create policy pass_categories_authenticated_read on public.pass_categories
  for select to authenticated
  using (
    public.is_admin()
    or (
      is_active
      and exists (
        select 1 from public.events e
        where e.id = event_id and e.status = 'published'
      )
    )
  );

drop policy if exists pass_categories_admin_manage on public.pass_categories;
create policy pass_categories_admin_manage on public.pass_categories
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());


drop policy if exists gallery_anon_read on public.gallery;
create policy gallery_anon_read on public.gallery
  for select to anon
  using (status = 'published');

drop policy if exists gallery_authenticated_read on public.gallery;
create policy gallery_authenticated_read on public.gallery
  for select to authenticated
  using (status = 'published' or public.is_admin());

drop policy if exists gallery_admin_manage on public.gallery;
create policy gallery_admin_manage on public.gallery
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());


-- -----------------------------------------------------------------------------
-- Bookings — never readable or writable by the public.
--
-- There is deliberately no INSERT policy: bookings are created by server code
-- with the service role, after the amount has been recalculated from
-- pass_categories. Staff can read and correct them from the admin dashboard.
-- -----------------------------------------------------------------------------

drop policy if exists bookings_staff_read on public.bookings;
create policy bookings_staff_read on public.bookings
  for select to authenticated
  using (public.is_staff());

drop policy if exists bookings_staff_update on public.bookings;
create policy bookings_staff_update on public.bookings
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());


-- -----------------------------------------------------------------------------
-- Digital passes — staff only.
-- -----------------------------------------------------------------------------

drop policy if exists digital_passes_staff_read on public.digital_passes;
create policy digital_passes_staff_read on public.digital_passes
  for select to authenticated
  using (public.is_staff());

drop policy if exists digital_passes_staff_update on public.digital_passes;
create policy digital_passes_staff_update on public.digital_passes
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());


-- -----------------------------------------------------------------------------
-- Check-ins — gate staff read and append; nobody edits or deletes history.
-- -----------------------------------------------------------------------------

drop policy if exists check_ins_staff_read on public.check_ins;
create policy check_ins_staff_read on public.check_ins
  for select to authenticated
  using (public.is_staff());

drop policy if exists check_ins_staff_insert on public.check_ins;
create policy check_ins_staff_insert on public.check_ins
  for insert to authenticated
  with check (public.is_staff());


-- -----------------------------------------------------------------------------
-- Admin users — readable by admins, writable only by the owner.
-- -----------------------------------------------------------------------------

drop policy if exists admin_users_admin_read on public.admin_users;
create policy admin_users_admin_read on public.admin_users
  for select to authenticated
  using (public.is_admin());

drop policy if exists admin_users_owner_manage on public.admin_users;
create policy admin_users_owner_manage on public.admin_users
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());


-- -----------------------------------------------------------------------------
-- Defence in depth: strip table privileges that no browser session should hold,
-- even if a future migration adds a permissive policy by mistake.
-- -----------------------------------------------------------------------------
revoke all on public.bookings, public.digital_passes, public.check_ins, public.admin_users
  from anon;

revoke insert, delete, truncate on public.bookings from authenticated;
revoke insert, delete, truncate on public.digital_passes from authenticated;
revoke update, delete, truncate on public.check_ins from authenticated;

-- Anonymous visitors must never be able to write to any table.
revoke insert, update, delete, truncate on all tables in schema public from anon;
