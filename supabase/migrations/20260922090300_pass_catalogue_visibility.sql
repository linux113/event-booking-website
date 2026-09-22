-- =============================================================================
-- Garba Nights — pass catalogue visibility
--
-- The site must be able to show a pass that is *not on sale* (greyed out, with
-- the reason) instead of removing it: a visitor who was told about the family
-- pass should still find it and see why it cannot be booked.
--
-- Before this migration, anon could only read pass_categories rows with
-- is_active = true, so a disabled pass silently disappeared. The read policy now
-- exposes the whole catalogue of a published event and `is_active` becomes what
-- it was always meant to be: a flag consumed by the UI and enforced server-side
-- at booking time (bookings are only ever created with the service role).
--
-- No private data is involved — this is catalogue metadata (name, composition,
-- price), not customer or booking information.
-- =============================================================================

drop policy if exists pass_categories_anon_read on public.pass_categories;
create policy pass_categories_anon_read on public.pass_categories
  for select to anon
  using (
    exists (
      select 1 from public.events e
      where e.id = event_id and e.status = 'published'
    )
  );

drop policy if exists pass_categories_authenticated_read on public.pass_categories;
create policy pass_categories_authenticated_read on public.pass_categories
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.events e
      where e.id = event_id and e.status = 'published'
    )
  );

comment on column public.pass_categories.is_active is
  'Whether the pass can be booked. Inactive passes stay visible on the public site (shown as not on sale) but are rejected at booking time.';
