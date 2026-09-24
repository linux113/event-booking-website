-- -----------------------------------------------------------------------------
-- Admin date management: remove a night.
--
-- Restricted admin function that deletes an event date. Hard-refuses deletion
-- when the night has any bookings, digital passes or check-ins attached
-- (mirroring the paid-people protection the capacity floor already uses).
-- -----------------------------------------------------------------------------

create or replace function public.admin_delete_event_date(p_id uuid)
returns table (
  date_uuid uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking_count  integer;
  v_pass_count     integer;
  v_check_in_count integer;
begin
  if p_id is null then
    raise exception 'night_not_found' using errcode = 'PT007';
  end if;

  -- Lock the night to serialize against concurrent bookings or edits
  perform 1
    from public.event_dates d
   where d.id = p_id
   for update;

  if not found then
    raise exception 'night_not_found' using errcode = 'PT007';
  end if;

  -- Count any bookings attached to this night (paid, pending, cancelled, etc.)
  select count(*)::integer into v_booking_count
    from public.bookings b
   where b.event_date_id = p_id;

  -- Count any digital passes attached via bookings for this night
  select count(*)::integer into v_pass_count
    from public.digital_passes dp
    join public.bookings b on b.id = dp.booking_id
   where b.event_date_id = p_id;

  -- Count any check-ins attached to this night
  select count(*)::integer into v_check_in_count
    from public.check_ins ci
   where ci.event_date_id = p_id;

  if v_booking_count > 0 or v_pass_count > 0 or v_check_in_count > 0 then
    raise exception 'This night has bookings and cannot be removed — close booking instead.'
      using errcode = 'PT012', detail = 'event_date';
  end if;

  delete from public.event_dates where id = p_id;

  return query select p_id as date_uuid;
end;
$$;

comment on function public.admin_delete_event_date(uuid) is
  'Deletes one event night. Hard-refuses if any bookings, digital passes or check-ins are attached.';

revoke all on function public.admin_delete_event_date(uuid) from public;
revoke all on function public.admin_delete_event_date(uuid) from anon, authenticated;
grant execute on function public.admin_delete_event_date(uuid) to service_role;
