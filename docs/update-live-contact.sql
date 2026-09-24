-- Update the public contact details for the event the website actually features.
--
-- `getFeaturedEvent()` selects the oldest published row (created_at ASC), so this
-- updates exactly that row rather than every published event. If RETURNING shows no
-- row, there is no published event; do not broaden the predicate. The public address
-- UI prints venue_name, venue_address, city and state separately; keep venue_address
-- to the street/area only to avoid repeating "My Village Garden".

update public.events
set contact_phone = '+91 9358535894',
    contact_email = 'savriyasethevents@gmail.com',
    whatsapp_number = '919358535894',
    venue_address = 'Ajmer Road',
    updated_at = now()
where id = (
  select id
  from public.events
  where status = 'published'
  order by created_at asc
  limit 1
)
returning slug, status, venue_name, venue_address, city, state,
          contact_phone, contact_email, whatsapp_number;
