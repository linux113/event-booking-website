-- -----------------------------------------------------------------------------
-- Homepage hero artwork: optimized WebP bytes live in Neon, not in Gallery/Blob.
--
-- Gallery media deliberately remains in Vercel Blob. The single homepage hero image
-- is different: it is owned by the event row, saved by Event settings, and streamed
-- from the public hero-image route. The existing hero_image_url stays for legacy
-- installations; new uploads clear it and use hero_image_data instead.
-- -----------------------------------------------------------------------------

alter table public.events
  add column if not exists hero_image_data bytea,
  add column if not exists hero_image_version bigint not null default 0;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.events'::regclass
       and conname = 'events_hero_image_data_size'
  ) then
    alter table public.events
      add constraint events_hero_image_data_size
      check (hero_image_data is null or octet_length(hero_image_data) between 1 and 2097152);
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.events'::regclass
       and conname = 'events_hero_image_version_nonnegative'
  ) then
    alter table public.events
      add constraint events_hero_image_version_nonnegative
      check (hero_image_version >= 0);
  end if;
end
$$;

comment on column public.events.hero_image_data is
  'Metadata-stripped, optimized WebP bytes for the homepage hero. Separate from gallery media and stored in Neon bytea, never Vercel Blob.';

comment on column public.events.hero_image_version is
  'Incremented when the homepage hero image is replaced or removed, so cached image URLs change with the artwork.';

comment on column public.events.hero_image_url is
  'Legacy external hero URL. New homepage hero uploads use hero_image_data; replacing or removing one clears this URL.';
