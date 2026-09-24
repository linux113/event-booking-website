-- -----------------------------------------------------------------------------
-- Gallery media stored locally in database bytea, never Vercel Blob.
--
-- Adds image_data and thumbnail_data to public.gallery with size check constraints.
-- External url and thumbnail_url columns remain for externally hosted media.
-- -----------------------------------------------------------------------------

alter table public.gallery
  add column if not exists image_data bytea,
  add column if not exists thumbnail_data bytea;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.gallery'::regclass
       and conname = 'gallery_image_data_size'
  ) then
    alter table public.gallery
      add constraint gallery_image_data_size
      check (image_data is null or octet_length(image_data) between 1 and 2097152);
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.gallery'::regclass
       and conname = 'gallery_thumbnail_data_size'
  ) then
    alter table public.gallery
      add constraint gallery_thumbnail_data_size
      check (thumbnail_data is null or octet_length(thumbnail_data) between 1 and 1048576);
  end if;
end
$$;

comment on column public.gallery.image_data is
  'Optimized WebP bytes for full gallery image (<= 2 MB), stored in Neon bytea, never Vercel Blob.';

comment on column public.gallery.thumbnail_data is
  'Optimized WebP bytes for gallery thumbnail (<= 1 MB), stored in Neon bytea, never Vercel Blob.';
