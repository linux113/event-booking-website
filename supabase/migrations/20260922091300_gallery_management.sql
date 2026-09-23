-- =============================================================================
-- Garba Nights — gallery management
--
-- The first step that owns *files* rather than rows. Two ideas carry it:
--
--   1. **The bucket a file lives in is decided by the row's status, not by the
--      upload.** Photos are uploaded into a private bucket (`gallery-inbox`) and
--      only move into the public one (`gallery`) when the organiser publishes
--      them; unpublishing moves them back. So an unpublished photograph is not
--      merely unlisted — it is not publicly reachable at all, and no URL that
--      leaks can serve it. Nothing but the service role can read the inbox, and
--      nothing but the service role can write either bucket: the browser never
--      holds a key that could put a file anywhere.
--
--   2. **The database still owns the rules.** The bucket move is a file
--      operation the app performs, so the row and the file can disagree for a
--      moment; every rule that must never disagree (alt text, dimensions, one
--      row per object, ordering) is enforced here, and the app's job is to
--      report what the database decided.
--
-- Object keys are `<event or "festival">/<item uuid>/full.webp` and
-- `…/thumb.webp`: deterministic from the row, which means the app never has to
-- store a URL that can drift from the file it points at. `gallery.url` and
-- `gallery.thumbnail_url` remain for externally hosted media (a video on a CDN),
-- and the public site prefers them when they are set.
--
-- Error codes (the app maps these to a field, not to prose):
--
--   PG001 alt_text_required          PG006 gallery_item_not_found
--   PG002 title_too_long             PG007 sort_order_invalid
--   PG003 description_too_long       PG008 status_invalid
--   PG004 album_too_long             PG009 image_dimensions_invalid
--   PG005 storage_path_invalid       PG010 image_size_invalid
--                                    PG011 duplicate_storage_path
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The two buckets
--
-- Created in SQL rather than in a dashboard so a fresh project is reproducible.
-- The block is guarded: `storage` belongs to Supabase's own roles, some
-- deployments run these migrations without rights on it, and a gallery
-- migration must not break the chain of migrations that follow. When it cannot
-- create the buckets it says so, loudly, and the README says how to make them by
-- hand — see supabase/README.md.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.tables
     where table_schema = 'storage' and table_name = 'buckets'
  ) then
    -- Public: the site's <img> tags point straight at these objects, which is what
    -- makes browser caching and a CDN work without a signed URL per view.
    execute $sql$
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('gallery', 'gallery', true, 8388608,
              array['image/webp', 'image/jpeg', 'image/png', 'image/avif'])
      on conflict (id) do update
        set public             = true,
            file_size_limit    = 8388608,
            allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png', 'image/avif']
    $sql$;

    -- Private: where an upload waits until it is published. No policy below
    -- grants anybody access to it, so the service role is the only key that can
    -- read or write here.
    execute $sql$
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('gallery-inbox', 'gallery-inbox', false, 8388608,
              array['image/webp', 'image/jpeg', 'image/png', 'image/avif'])
      on conflict (id) do update
        set public             = false,
            file_size_limit    = 8388608,
            allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png', 'image/avif']
    $sql$;

    raise notice 'gallery: buckets "gallery" (public) and "gallery-inbox" (private) are in place';
  else
    raise notice 'gallery: no storage schema here — create the buckets by hand (see supabase/README.md)';
  end if;
end
$$;


-- -----------------------------------------------------------------------------
-- 2. Storage policies: nobody but the service role
--
-- There is deliberately no `select` policy on storage.objects. A public bucket
-- is served through /object/public/<bucket>/<key>, which does not consult these
-- policies; what the API *does* consult them for is listing and enumerating —
-- so with none, the anon key cannot discover a single object in either bucket,
-- and cannot write one either. Everything the app does with storage happens
-- server-side with the service-role key, which bypasses RLS.
--
-- If your deployment wants per-object reads through the authenticated API, add a
-- `select` policy scoped to `bucket_id = 'gallery'` — and read the note in
-- supabase/README.md about what that would expose.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.tables
     where table_schema = 'storage' and table_name = 'objects'
  ) then
    execute 'alter table storage.objects enable row level security';

    -- Anything left over from an earlier attempt at this step is removed, so the
    -- end state is "no anon/authenticated policy on either bucket" rather than
    -- "no policy except the one somebody added".
    execute 'drop policy if exists gallery_objects_anon_read on storage.objects';
    execute 'drop policy if exists gallery_objects_public_read on storage.objects';
    execute 'drop policy if exists gallery_objects_anon_write on storage.objects';

    raise notice 'gallery: storage.objects has no anon/authenticated policy — service role only';
  end if;
end
$$;


-- -----------------------------------------------------------------------------
-- 3. gallery: the facts about a file
--
-- `storage_path` is the object key; `thumbnail_path` is the small version of the
-- same picture; width/height let the grid reserve the right space before the
-- bytes arrive (no layout shift), and byte_size lets the screen say how heavy a
-- row is before somebody downloads it on a phone.
-- -----------------------------------------------------------------------------
alter table public.gallery
  add column if not exists thumbnail_path text,
  add column if not exists width          integer,
  add column if not exists height         integer,
  add column if not exists byte_size      integer;

comment on column public.gallery.storage_path is
  'Object key inside the gallery buckets: <event or festival>/<item uuid>/full.webp. The bucket is chosen by status, so the key never changes when a photo is published.';
comment on column public.gallery.thumbnail_path is
  'The grid-sized version of the same object (…/thumb.webp). Null for externally hosted media.';
comment on column public.gallery.width is
  'Pixel width of the stored full image, so the page can reserve space before loading it.';
comment on column public.gallery.height is 'Pixel height of the stored full image.';
comment on column public.gallery.byte_size is 'Bytes of the stored full image, as written by the upload.';

alter table public.gallery drop constraint if exists gallery_dimensions_range;
alter table public.gallery
  add constraint gallery_dimensions_range check (
    (width is null or (width between 1 and 20000))
    and (height is null or (height between 1 and 20000))
    and ((width is null) = (height is null))
  );

alter table public.gallery drop constraint if exists gallery_byte_size_range;
alter table public.gallery
  add constraint gallery_byte_size_range check (byte_size is null or (byte_size between 1 and 52428800));

-- One row per object. A second row pointing at the same file is how a delete
-- quietly breaks a picture that was still in use, so it cannot exist.
create unique index if not exists gallery_storage_path_unique
  on public.gallery (storage_path) where storage_path is not null;
create unique index if not exists gallery_thumbnail_path_unique
  on public.gallery (thumbnail_path) where thumbnail_path is not null;


-- -----------------------------------------------------------------------------
-- 4. Reading the gallery, for the screen that manages it
-- -----------------------------------------------------------------------------
create or replace function public.admin_gallery_items(p_event_id uuid default null)
returns table (
  item_id        uuid,
  event_id       uuid,
  album          text,
  title          text,
  description    text,
  alt_text       text,
  media_type     text,
  storage_path   text,
  thumbnail_path text,
  url            text,
  thumbnail_url  text,
  width          integer,
  height         integer,
  byte_size      integer,
  captured_on    date,
  item_status    text,
  sort_order     integer,
  created_at     timestamptz,
  updated_at     timestamptz,
  total_count    integer
)
language sql
stable
security definer
set search_path = public
as $$
  with target as (
    select coalesce(p_event_id, public.admin_default_event_id()) as event_id
  )
  select
    g.id,
    g.event_id,
    g.album,
    g.title,
    g.description,
    g.alt_text,
    g.media_type,
    g.storage_path,
    g.thumbnail_path,
    g.url,
    g.thumbnail_url,
    g.width,
    g.height,
    g.byte_size,
    g.captured_on,
    g.status,
    g.sort_order,
    g.created_at,
    g.updated_at,
    (select count(*)::integer
       from public.gallery g2
      where g2.event_id is not distinct from g.event_id) as total_count
  from public.gallery g
  cross join target t
  where g.event_id is not distinct from t.event_id
     or g.event_id is null
  order by g.sort_order, g.created_at desc, g.id;
$$;

comment on function public.admin_gallery_items(uuid) is
  'Every gallery row of an event — published, draft and archived alike — with the file facts (paths, dimensions, size) the management screen needs. Ordered the way the public grid orders them, so the screen shows the running order an organiser is about to change.';

revoke all on function public.admin_gallery_items(uuid) from public;
revoke all on function public.admin_gallery_items(uuid) from anon, authenticated;
grant execute on function public.admin_gallery_items(uuid) to service_role;


-- -----------------------------------------------------------------------------
-- 5. Sharing the validation between the two write paths
-- -----------------------------------------------------------------------------
create or replace function public.gallery_check_metadata(
  p_title        text,
  p_description  text,
  p_alt_text     text,
  p_album        text,
  p_sort_order   integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Alternative text is not optional: it is how the picture exists for anybody
  -- using a screen reader, and an empty one is worse than a missing row.
  if p_alt_text is null or length(btrim(p_alt_text)) = 0 then
    raise exception 'alt_text_required' using errcode = 'PG001', detail = 'alt_text';
  end if;

  if length(btrim(coalesce(p_alt_text, ''))) > 200 then
    raise exception 'alt_text_required' using errcode = 'PG001', detail = 'alt_text';
  end if;

  if length(btrim(coalesce(p_title, ''))) > 120 then
    raise exception 'title_too_long' using errcode = 'PG002', detail = 'title';
  end if;

  if length(btrim(coalesce(p_description, ''))) > 400 then
    raise exception 'description_too_long' using errcode = 'PG003', detail = 'description';
  end if;

  if length(btrim(coalesce(p_album, ''))) > 60 then
    raise exception 'album_too_long' using errcode = 'PG004', detail = 'album';
  end if;

  if p_sort_order is null or p_sort_order < 0 or p_sort_order > 9999 then
    raise exception 'sort_order_invalid' using errcode = 'PG007', detail = 'sort_order';
  end if;
end;
$$;

comment on function public.gallery_check_metadata(text, text, text, text, integer) is
  'The rules both gallery write paths share: alt text present and short, title/description/album within their column limits, order a whole number in range. Raises PG001-PG004 and PG007 with the field in `detail`.';

revoke all on function public.gallery_check_metadata(text, text, text, text, integer) from public;
revoke all on function public.gallery_check_metadata(text, text, text, text, integer) from anon, authenticated;
grant execute on function public.gallery_check_metadata(text, text, text, text, integer) to service_role;


-- -----------------------------------------------------------------------------
-- 6. Adding a row — after the file exists
--
-- The id is supplied by the caller because the object key contains it: the app
-- uploads to `<event>/<id>/full.webp`, so it has to know the id before the row
-- exists. That also makes a retried upload idempotent — the same id cannot be
-- inserted twice, and the second attempt is refused rather than becoming a
-- second picture of the same photo.
-- -----------------------------------------------------------------------------
create or replace function public.admin_add_gallery_item(
  p_id             uuid,
  p_event_id       uuid,
  p_storage_path   text,
  p_thumbnail_path text,
  p_media_type     text,
  p_width          integer,
  p_height         integer,
  p_byte_size      integer,
  p_title          text,
  p_description    text,
  p_alt_text       text,
  p_album          text,
  p_captured_on    date,
  p_sort_order     integer,
  p_status         text
)
returns table (
  item_id      uuid,
  storage_path text,
  item_status  text,
  sort_order   integer,
  updated_at   timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid := coalesce(p_event_id, public.admin_default_event_id());
  v_status   text := coalesce(nullif(btrim(coalesce(p_status, '')), ''), 'draft');
  v_media    text := coalesce(nullif(btrim(coalesce(p_media_type, '')), ''), 'image');
begin
  if p_id is null then
    raise exception 'gallery_item_not_found' using errcode = 'PG006';
  end if;

  if v_event_id is null then
    raise exception 'gallery_item_not_found' using errcode = 'PG006';
  end if;

  if v_status not in ('draft', 'published', 'archived') then
    raise exception 'status_invalid' using errcode = 'PG008', detail = 'status';
  end if;

  if v_media not in ('image', 'video') then
    raise exception 'status_invalid' using errcode = 'PG008', detail = 'media_type';
  end if;

  -- An object key is a relative path inside one bucket: no scheme, no leading
  -- slash, no `..`, no control characters. Enforced here because the key is what
  -- the app hands to storage — a key it cannot trust is a key it cannot delete.
  if p_storage_path is null
     or p_storage_path !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$'
     or position('..' in p_storage_path) > 0
     or left(p_storage_path, 1) = '/'
     or right(p_storage_path, 1) = '/' then
    raise exception 'storage_path_invalid' using errcode = 'PG005', detail = 'storage_path';
  end if;

  if p_thumbnail_path is not null
     and (p_thumbnail_path !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$'
          or position('..' in p_thumbnail_path) > 0) then
    raise exception 'storage_path_invalid' using errcode = 'PG005', detail = 'thumbnail_path';
  end if;

  if (p_width is not null and (p_width < 1 or p_width > 20000))
     or (p_height is not null and (p_height < 1 or p_height > 20000))
     or ((p_width is null) <> (p_height is null)) then
    raise exception 'image_dimensions_invalid' using errcode = 'PG009', detail = 'width';
  end if;

  if p_byte_size is not null and (p_byte_size < 1 or p_byte_size > 52428800) then
    raise exception 'image_size_invalid' using errcode = 'PG010', detail = 'byte_size';
  end if;

  perform public.gallery_check_metadata(p_title, p_description, p_alt_text, p_album, p_sort_order);

  begin
    insert into public.gallery (
      id, event_id, album, title, description, media_type,
      storage_path, thumbnail_path, width, height, byte_size,
      alt_text, captured_on, status, sort_order
    )
    values (
      p_id, v_event_id, nullif(btrim(coalesce(p_album, '')), ''),
      nullif(btrim(coalesce(p_title, '')), ''),
      nullif(btrim(coalesce(p_description, '')), ''),
      v_media, p_storage_path, nullif(btrim(coalesce(p_thumbnail_path, '')), ''),
      p_width, p_height, p_byte_size,
      btrim(p_alt_text), p_captured_on, v_status, p_sort_order
    );
  exception
    when unique_violation then
      raise exception 'duplicate_storage_path' using errcode = 'PG011', detail = 'storage_path';
  end;

  return query
    select g.id, g.storage_path, g.status, g.sort_order, g.updated_at
    from public.gallery g
    where g.id = p_id;
end;
$$;

comment on function public.admin_add_gallery_item(uuid, uuid, text, text, text, integer, integer, integer, text, text, text, text, date, integer, text) is
  'Records one uploaded gallery file. The caller supplies the id (the object key contains it, so a retry cannot create a second row for the same file) and the file facts the upload measured; the metadata rules come from gallery_check_metadata. PG005 refuses a storage key that is not a safe relative path.';

revoke all on function public.admin_add_gallery_item(uuid, uuid, text, text, text, integer, integer, integer, text, text, text, text, date, integer, text) from public;
revoke all on function public.admin_add_gallery_item(uuid, uuid, text, text, text, integer, integer, integer, text, text, text, text, date, integer, text) from anon, authenticated;
grant execute on function public.admin_add_gallery_item(uuid, uuid, text, text, text, integer, integer, integer, text, text, text, text, date, integer, text) to service_role;


-- -----------------------------------------------------------------------------
-- 7. Editing the words, and the running order
-- -----------------------------------------------------------------------------
create or replace function public.admin_update_gallery_item(
  p_id          uuid,
  p_title       text,
  p_description text,
  p_alt_text    text,
  p_album       text,
  p_captured_on date,
  p_sort_order  integer
)
returns table (
  item_id      uuid,
  title        text,
  description  text,
  alt_text     text,
  album        text,
  captured_on  date,
  sort_order   integer,
  updated_at   timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_id is null then
    raise exception 'gallery_item_not_found' using errcode = 'PG006';
  end if;

  perform public.gallery_check_metadata(p_title, p_description, p_alt_text, p_album, p_sort_order);

  update public.gallery g
     set title       = nullif(btrim(coalesce(p_title, '')), ''),
         description = nullif(btrim(coalesce(p_description, '')), ''),
         alt_text    = btrim(p_alt_text),
         album       = nullif(btrim(coalesce(p_album, '')), ''),
         captured_on = p_captured_on,
         sort_order  = p_sort_order
   where g.id = p_id;

  if not found then
    raise exception 'gallery_item_not_found' using errcode = 'PG006';
  end if;

  return query
    select g.id, g.title, g.description, g.alt_text, g.album, g.captured_on, g.sort_order, g.updated_at
    from public.gallery g
    where g.id = p_id;
end;
$$;

comment on function public.admin_update_gallery_item(uuid, text, text, text, text, date, integer) is
  'Edits the words and the running order of one gallery item: title, description, alternative text, album, the night it was taken and its position. Nothing about the file changes, so a caption can be fixed without touching storage.';

revoke all on function public.admin_update_gallery_item(uuid, text, text, text, text, date, integer) from public;
revoke all on function public.admin_update_gallery_item(uuid, text, text, text, text, date, integer) from anon, authenticated;
grant execute on function public.admin_update_gallery_item(uuid, text, text, text, text, date, integer) to service_role;


/**
 * Moves one item up or down the running order — the control an organiser actually
 * uses, which is why it does not take a number.
 *
 * The move is a *reordering*, not a swap of two numbers, because numbers are not
 * unique in the real world: two photographs uploaded in the same second, a row
 * imported with `sort_order = 0`, a deleted row leaving a gap. The list is
 * therefore read the way the public grid reads it (`sort_order`, then newest
 * first, then id), numbered `0…n-1`, and written back with the moving item and its
 * neighbour exchanged. That normalises any duplicates or gaps as it goes, and it
 * makes "up" mean what it says: the photograph is above its former neighbour.
 *
 * The first item cannot move up and the last cannot move down. That is not an
 * error — it is the end of the list — so `moved` comes back false and the screen
 * says "already first" rather than showing a failure.
 */
create or replace function public.admin_move_gallery_item(p_id uuid, p_direction text)
returns table (
  item_id    uuid,
  sort_order integer,
  moved      boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.gallery%rowtype;
  v_ids  uuid[];
  v_pos  integer;
  v_swap integer;
begin
  if p_id is null then
    raise exception 'gallery_item_not_found' using errcode = 'PG006';
  end if;

  if p_direction not in ('up', 'down') then
    raise exception 'sort_order_invalid' using errcode = 'PG007', detail = 'direction';
  end if;

  select * into v_item from public.gallery g where g.id = p_id;

  if not found then
    raise exception 'gallery_item_not_found' using errcode = 'PG006';
  end if;

  select array_agg(ordered.id order by ordered.position)
    into v_ids
    from (
      select g.id, row_number() over (order by g.sort_order, g.created_at desc, g.id) as position
        from public.gallery g
       where g.event_id is not distinct from v_item.event_id
    ) as ordered;

  v_pos := array_position(v_ids, p_id);

  if p_direction = 'up' then
    v_swap := case when v_pos > 1 then v_pos - 1 else null end;
  else
    v_swap := case when v_pos < coalesce(array_length(v_ids, 1), 1) then v_pos + 1 else null end;
  end if;

  update public.gallery g
     set sort_order = positions.position - 1
    from (
      select numbered.id,
             case
               when numbered.ord = v_pos then coalesce(v_swap, v_pos)
               when numbered.ord = v_swap then v_pos
               else numbered.ord
             end as position
        from unnest(v_ids) with ordinality as numbered(id, ord)
    ) as positions
   where g.id = positions.id
     and g.sort_order is distinct from positions.position - 1;

  return query
    select g.id, g.sort_order, v_swap is not null
    from public.gallery g
    where g.id = p_id;
end;
$$;

comment on function public.admin_move_gallery_item(uuid, text) is
  'Reorders one gallery item one place up or down. The whole list is renumbered 0…n-1 in the order the public grid shows it, with the moving item exchanged with its neighbour, so ties and gaps cannot make a move land in the wrong place. Returns moved = false at the ends of the list rather than raising, because "already first" is an answer, not an error.';

revoke all on function public.admin_move_gallery_item(uuid, text) from public;
revoke all on function public.admin_move_gallery_item(uuid, text) from anon, authenticated;
grant execute on function public.admin_move_gallery_item(uuid, text) to service_role;


-- -----------------------------------------------------------------------------
-- 8. Publishing, unpublishing, deleting
--
-- Publishing is a row change here and a bucket move in the app; the app asks for
-- the row first and moves the file to match, because a row that says "published"
-- with no public file is a broken image, while a file in the public bucket with
-- no published row is merely a file nobody links to.
-- -----------------------------------------------------------------------------
create or replace function public.admin_set_gallery_status(p_id uuid, p_status text)
returns table (
  item_id       uuid,
  item_status   text,
  storage_path  text,
  thumbnail_path text,
  was_public    boolean,
  is_public     boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.gallery%rowtype;
begin
  if p_id is null then
    raise exception 'gallery_item_not_found' using errcode = 'PG006';
  end if;

  if p_status is null or p_status not in ('draft', 'published', 'archived') then
    raise exception 'status_invalid' using errcode = 'PG008', detail = 'status';
  end if;

  select * into v_item from public.gallery g where g.id = p_id for update;

  if not found then
    raise exception 'gallery_item_not_found' using errcode = 'PG006';
  end if;

  update public.gallery g set status = p_status where g.id = p_id;

  return query
    select g.id, g.status, g.storage_path, g.thumbnail_path,
           (v_item.status = 'published'), (g.status = 'published')
    from public.gallery g
    where g.id = p_id;
end;
$$;

comment on function public.admin_set_gallery_status(uuid, text) is
  'Enables (published), disables (draft) or retires (archived) one gallery item, and reports where the file was and where it now belongs so the app can move it between the public and private buckets. Locks the row so two administrators publishing and unpublishing cannot interleave.';

revoke all on function public.admin_set_gallery_status(uuid, text) from public;
revoke all on function public.admin_set_gallery_status(uuid, text) from anon, authenticated;
grant execute on function public.admin_set_gallery_status(uuid, text) to service_role;


/**
 * Deletes the row and hands back the objects that belonged to it.
 *
 * The row goes first: if the file delete then fails, an orphaned object sits in a
 * bucket costing a few kilobytes and nothing links to it, whereas a row whose
 * file has gone is a broken picture on the public page. The returned paths are
 * what the app deletes, so a row can never be removed without the app being told
 * which files to clean up.
 */
create or replace function public.admin_delete_gallery_item(p_id uuid)
returns table (
  item_id        uuid,
  storage_path   text,
  thumbnail_path text,
  is_public      boolean,
  removed_paths  text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.gallery%rowtype;
begin
  if p_id is null then
    raise exception 'gallery_item_not_found' using errcode = 'PG006';
  end if;

  select * into v_item from public.gallery g where g.id = p_id for update;

  if not found then
    raise exception 'gallery_item_not_found' using errcode = 'PG006';
  end if;

  delete from public.gallery g where g.id = p_id;

  return query
    select v_item.id,
           v_item.storage_path,
           v_item.thumbnail_path,
           (v_item.status = 'published'),
           array_remove(array[v_item.storage_path, v_item.thumbnail_path], null)::text[];
end;
$$;

comment on function public.admin_delete_gallery_item(uuid) is
  'Removes one gallery row and returns its object paths (and whether they were public) so the app can delete the files. The database decides what existed; the app decides what to do with storage.';

revoke all on function public.admin_delete_gallery_item(uuid) from public;
revoke all on function public.admin_delete_gallery_item(uuid) from anon, authenticated;
grant execute on function public.admin_delete_gallery_item(uuid) to service_role;
