-- -----------------------------------------------------------------------------
-- Editable site content: public-page copy the organiser can change from admin.
--
-- The About Us text, the gallery heading and the contact-page FAQs have no
-- home of their own in the schema — they are per-event copy, so they live on
-- the event row beside the other public fields. One jsonb column keeps them
-- together and lets later sections extend it without another migration. The
-- shape is validated by the app (never by the browser), and an empty object
-- means "every page falls back to its built-in default copy", so nothing
-- changes visually until the organiser saves something from Event settings.
-- -----------------------------------------------------------------------------

alter table public.events
  add column if not exists site_content jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.events'::regclass
       and conname = 'events_site_content_object'
  ) then
    alter table public.events
      add constraint events_site_content_object
      check (jsonb_typeof(site_content) = 'object');
  end if;
end
$$;

comment on column public.events.site_content is
  'Organiser-edited public copy: About Us title/body/checklist, gallery title/intro and contact-page FAQs. Empty object means the pages use their built-in defaults.';
