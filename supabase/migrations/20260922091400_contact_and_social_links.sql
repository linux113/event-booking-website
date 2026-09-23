-- =============================================================================
-- Garba Nights — contact details, social links and support hours
--
-- The public site's contact block used to be static configuration: the WhatsApp
-- number, the phone, the email, the address lines and the three social handles were
-- literals in `src/config`, so the same number lived in the footer, the header, the
-- contact page and every \"message us\" button — and changing it meant a deploy.
--
-- This migration moves that data where the rest of the event's facts already live:
-- onto `events`. The site reads it through the same service layer as the venue, the
-- dates and the prices, and every link (WhatsApp, `tel:`, `mailto:`, maps, socials)
-- is derived from the row in one place.
--
-- Column notes:
--
--   * `whatsapp_number` is the number the click-to-chat links use, in international
--     format **without** the plus or any spaces (`919000000000`). It is separate from
--     `contact_phone` because an organiser's WhatsApp Business number is often not the
--     number they take calls on; when it is empty the app falls back to the digits of
--     `contact_phone`, so a deployment that only fills one column still works.
--   * `instagram_url`, `facebook_url`, `youtube_url` are the event's profiles. They
--     must be `https://` and on the platform they claim to be — a link in the wrong
--     column sends guests somewhere the organiser did not intend, which is the kind of
--     mistake a constraint catches and a form does not.
--   * `support_hours` is a short list of lines ("Monday – Saturday · 10:00 AM – 8:00
--     PM"), because the hours really are a list and a single string with newlines in it
--     would have to be parsed back apart by whoever reads it.
--
-- Nothing here is secret: `events` is publicly readable for published rows, and these
-- columns are the ones the site is meant to show.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The columns
-- -----------------------------------------------------------------------------
alter table public.events
  add column if not exists whatsapp_number text,
  add column if not exists instagram_url   text,
  add column if not exists facebook_url    text,
  add column if not exists youtube_url     text,
  add column if not exists support_hours   text[] not null default '{}';


-- -----------------------------------------------------------------------------
-- 2. What the columns may hold
--
-- Constraints rather than triggers: this is shape, not workflow. Each is dropped and
-- re-added so the migration can be re-run against a database that already has them.
-- -----------------------------------------------------------------------------

-- International format, digits only, no plus, no leading zero: a `wa.me` URL is built
-- by concatenating this, so anything else produces a link that goes nowhere.
alter table public.events drop constraint if exists events_whatsapp_number_format;

alter table public.events add constraint events_whatsapp_number_format
  check (whatsapp_number is null or whatsapp_number ~ '^[1-9][0-9]{9,14}$');

-- One link per platform, https only, and on the platform's own domain.
alter table public.events drop constraint if exists events_social_url_https;

alter table public.events add constraint events_social_url_https
  check (
    (instagram_url is null or instagram_url ~ '^https://([a-z0-9-]+\.)?instagram\.com/')
    and (facebook_url is null or facebook_url ~ '^https://([a-z0-9-]+\.)?(facebook|fb)\.com/')
    and (youtube_url is null or youtube_url ~ '^https://([a-z0-9-]+\.)?(youtube\.com|youtu\.be)/')
  );

-- A support-hours list is a handful of lines, not a document.
alter table public.events drop constraint if exists events_support_hours_size;

alter table public.events add constraint events_support_hours_size
  check (
    array_length(support_hours, 1) is null
    or (array_length(support_hours, 1) between 1 and 6)
  );

comment on column public.events.whatsapp_number is
  'Number the site''s click-to-chat links open, in international format without "+" or spaces (919000000000). Falls back to contact_phone''s digits in the app when empty.';

comment on column public.events.instagram_url is
  'The event''s Instagram profile: https:// and on instagram.com, or null when the event has none.';

comment on column public.events.facebook_url is
  'The event''s Facebook page: https:// and on facebook.com (or fb.com), or null.';

comment on column public.events.youtube_url is
  'The event''s YouTube channel: https:// and on youtube.com (or youtu.be), or null.';

comment on column public.events.support_hours is
  'Up to six lines of opening hours, shown on the contact page and in the footer, e.g. "Monday – Saturday · 10:00 AM – 8:00 PM".';

-- The event row the public site reads is fetched by `created_at` order and limited to
-- one row, which the primary key already serves. No new index is warranted: these
-- columns are read with the row, never filtered on.
