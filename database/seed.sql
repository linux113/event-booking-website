-- =============================================================================
-- Sanwariya Seth Events — initial seed data
--
-- Idempotent: every row has a hard-coded uuid and an `on conflict ... do update`
-- branch, so re-running this file never duplicates or orphans anything.
--
-- ⚠️  These are the *initial* values for the Jaipur festival. They are seed data
--     only: nothing in the application hard-codes them, and the admin dashboard
--     will edit them directly. Replace the venue/city/prices here (or in the
--     dashboard) rather than anywhere in the frontend.
--
-- Apply with: npm run db:setup -- --seed, or paste into Neon SQL Editor.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Event
-- -----------------------------------------------------------------------------
insert into public.events (
  id, slug, name, tagline, description,
  venue_name, venue_address, city, state, maps_url,
  contact_phone, contact_email, whatsapp_number,
  instagram_url, facebook_url, youtube_url, support_hours,
  currency, status
)
values (
  'e0000000-0000-4000-8000-000000000001',
  'navratri-2026-jaipur',
  'Garba Night',
  'Nine nights of garba, dandiya and non-stop beats',
  'A nine-night Navratri and Dandiya festival with live dhol, garba raas rounds, dandiya circles, an anchor, DJ, LED wall, videographer and drone coverage. Family section and food court on site.',
  'My Village Garden',
  'Ajmer Road',
  'Jaipur',
  'Rajasthan',
  'https://maps.google.com/?q=My+Village+Garden+Jaipur',
  -- Real public contact details; the admin settings screen can update these
  -- event-row values without a code deploy.
  '+91 9358535894',
  'savriyasethevents@gmail.com',
  '919358535894',
  'https://www.instagram.com/',
  'https://www.facebook.com/',
  'https://www.youtube.com/',
  array['Monday – Saturday · 10:00 AM – 8:00 PM', 'Festival days · 10:00 AM – 11:00 PM'],
  'INR',
  'published'
)
on conflict (id) do update set
  slug          = excluded.slug,
  name          = excluded.name,
  tagline       = excluded.tagline,
  description   = excluded.description,
  venue_name    = excluded.venue_name,
  venue_address = excluded.venue_address,
  city          = excluded.city,
  state         = excluded.state,
  maps_url      = excluded.maps_url,
  contact_phone = excluded.contact_phone,
  contact_email = excluded.contact_email,
  whatsapp_number = excluded.whatsapp_number,
  instagram_url = excluded.instagram_url,
  facebook_url  = excluded.facebook_url,
  youtube_url   = excluded.youtube_url,
  support_hours = excluded.support_hours,
  currency      = excluded.currency,
  status        = excluded.status;


-- -----------------------------------------------------------------------------
-- Event dates — 11 to 19 October 2026 (nine nights)
--
-- `capacity` is the number of people admitted per night. 1500 is a starting
-- assumption taken from the venue size; the organiser edits it per night.
-- -----------------------------------------------------------------------------
insert into public.event_dates (id, event_id, event_date, start_time, end_time, capacity, status)
values
  ('d0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', date '2026-10-11', time '19:00', time '23:30', 1500, 'scheduled'),
  ('d0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', date '2026-10-12', time '19:00', time '23:30', 1500, 'scheduled'),
  ('d0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000001', date '2026-10-13', time '19:00', time '23:30', 1500, 'scheduled'),
  ('d0000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000001', date '2026-10-14', time '19:00', time '23:30', 1500, 'scheduled'),
  ('d0000000-0000-4000-8000-000000000005', 'e0000000-0000-4000-8000-000000000001', date '2026-10-15', time '19:00', time '23:30', 1500, 'scheduled'),
  ('d0000000-0000-4000-8000-000000000006', 'e0000000-0000-4000-8000-000000000001', date '2026-10-16', time '19:00', time '23:30', 1500, 'scheduled'),
  ('d0000000-0000-4000-8000-000000000007', 'e0000000-0000-4000-8000-000000000001', date '2026-10-17', time '19:00', time '23:30', 1500, 'scheduled'),
  ('d0000000-0000-4000-8000-000000000008', 'e0000000-0000-4000-8000-000000000001', date '2026-10-18', time '19:00', time '23:30', 1500, 'scheduled'),
  ('d0000000-0000-4000-8000-000000000009', 'e0000000-0000-4000-8000-000000000001', date '2026-10-19', time '19:00', time '23:30', 1500, 'scheduled')
on conflict (id) do update set
  event_id   = excluded.event_id,
  event_date = excluded.event_date,
  start_time = excluded.start_time,
  end_time   = excluded.end_time,
  capacity   = excluded.capacity,
  status     = excluded.status;


-- -----------------------------------------------------------------------------
-- Pass categories — the five passes offered at this event
--
-- `number_of_people` is how many people one pass admits; it is what capacity and
-- check-in counts are measured in. The Family pass is seeded as 4 (two adults +
-- two children) — confirm with the organiser and update here if it differs.
-- -----------------------------------------------------------------------------
insert into public.pass_categories (
  id, event_id, code, name, composition, description,
  price_inr, number_of_people, max_per_booking, is_active, sort_order
)
values
  (
    'c0000000-0000-4000-8000-000000000001',
    'e0000000-0000-4000-8000-000000000001',
    'girls-2', 'Duo Pass', '2 Girls',
    'Entry for two, ideal for a friends'' pair.',
    399, 2, 10, true, 1
  ),
  (
    'c0000000-0000-4000-8000-000000000002',
    'e0000000-0000-4000-8000-000000000001',
    'couple', 'Couple Pass', '1 Boy + 1 Girl',
    'The most-booked pass, priced for a couple entering together.',
    499, 2, 10, true, 2
  ),
  (
    'c0000000-0000-4000-8000-000000000003',
    'e0000000-0000-4000-8000-000000000001',
    'boy-2-girls', 'Trio Pass', '1 Boy + 2 Girls',
    'Entry for three, so the group stays together on the floor.',
    599, 3, 10, true, 3
  ),
  (
    'c0000000-0000-4000-8000-000000000004',
    'e0000000-0000-4000-8000-000000000001',
    'girls-4', 'Squad Pass', '4 Girls',
    'Best value for a group of four friends.',
    799, 4, 10, true, 4
  ),
  (
    'c0000000-0000-4000-8000-000000000005',
    'e0000000-0000-4000-8000-000000000001',
    'family', 'Family Pass', 'Family',
    'One pass for the whole family — children are welcome.',
    1099, 4, 5, true, 5
  )
on conflict (id) do update set
  event_id         = excluded.event_id,
  code             = excluded.code,
  name             = excluded.name,
  composition      = excluded.composition,
  description      = excluded.description,
  price_inr        = excluded.price_inr,
  number_of_people = excluded.number_of_people,
  max_per_booking  = excluded.max_per_booking,
  is_active        = excluded.is_active,
  sort_order       = excluded.sort_order;


-- -----------------------------------------------------------------------------
-- Intentionally NOT seeded
--
-- gallery       → published photos/videos come from the first shoot; seeding
--                 placeholder URLs would put non-existent files on the site.
-- admin         → configured only via env (ADMIN_USERNAME, ADMIN_PASSWORD_HASH,
--                 AUTH_SECRET). The admin_users table no longer exists.
--
-- bookings,
-- digital_passes,
-- check_ins     → transactional data. Never seeded; created by the booking flow.
-- -----------------------------------------------------------------------------


-- -----------------------------------------------------------------------------
-- Event highlights — "what to expect on the night"
-- -----------------------------------------------------------------------------
insert into public.event_highlights (id, event_id, title, description, sort_order)
values
  ('a1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'Live dandiya & garba',
   'Traditional garba raas circles and dandiya rounds with live dhol, every night of the festival.', 1),
  ('a1000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', 'All-night DJ set',
   'A Bollywood and Gujarati DJ set that keeps the floor moving after the live performance ends.', 2),
  ('a1000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000001', 'Best dresser contest',
   'Daily prizes for the best chaniya choli, kediyu and duo outfits, judged by the crowd.', 3),
  ('a1000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000001', 'Food & refreshment court',
   'Gujarati thali, chaat, falooda and mocktail stalls with seating away from the dance floor.', 4),
  ('a1000000-0000-4000-8000-000000000005', 'e0000000-0000-4000-8000-000000000001', 'Safe & family friendly',
   'Separate family section, medical desk, professional bouncers and trained floor marshals.', 5),
  ('a1000000-0000-4000-8000-000000000006', 'e0000000-0000-4000-8000-000000000001', 'Secure digital entry',
   'Every booking gets a QR entry pass. No paper tickets, no queue at the gate.', 6)
on conflict (id) do update set
  event_id    = excluded.event_id,
  title       = excluded.title,
  description = excluded.description,
  sort_order  = excluded.sort_order;


-- -----------------------------------------------------------------------------
-- Event features — production inclusions. `code` drives the icon in the UI.
-- -----------------------------------------------------------------------------
insert into public.event_features (id, event_id, code, label, description, sort_order)
values
  ('f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'anchor', 'Girl Anchor',
   'Professional anchor hosting the games, contests and announcements.', 1),
  ('f0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', 'gorilla', 'Gorilla Dancer',
   'Costumed crowd performer who leads the dandiya rounds and hypes the floor.', 2),
  ('f0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000001', 'videographer', 'Videographer',
   'Full-night filming with an edited highlights reel after the festival.', 3),
  ('f0000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000001', 'drone', 'Drone Camera',
   'Aerial coverage of the garba circles and the stage, subject to local permissions.', 4),
  ('f0000000-0000-4000-8000-000000000005', 'e0000000-0000-4000-8000-000000000001', 'led-wall', 'LED Wall',
   'Large LED backdrop for visuals, live scores and contest displays.', 5),
  ('f0000000-0000-4000-8000-000000000006', 'e0000000-0000-4000-8000-000000000001', 'dj', 'DJ',
   'Resident DJ with a Gujarati, Bollywood and EDM set till close.', 6)
on conflict (id) do update set
  event_id    = excluded.event_id,
  code        = excluded.code,
  label       = excluded.label,
  description = excluded.description,
  sort_order  = excluded.sort_order;


-- -----------------------------------------------------------------------------
-- Sanity check (run manually after seeding)
--
--   select e.name, count(d.id) as nights
--     from public.events e left join public.event_dates d on d.event_id = e.id
--    group by e.name;                                   -- expect: 9
--
--   select code, composition, price_inr, number_of_people
--     from public.pass_categories order by sort_order;   -- expect: 5 rows
--
--   select code, label from public.event_features order by sort_order;    -- expect: 6 rows
--
--   select public.get_event_night_availability('e0000000-0000-4000-8000-000000000001');
--     -- expect: 9 rows, booked_people 0, is_bookable true
-- -----------------------------------------------------------------------------
