import { isDatabaseConfigured } from "@/config/env";
import { DatabaseError, isMissingColumnError, rpc, sql } from "@/lib/db/client";
import {
  toEventFeature,
  toEventHighlight,
  toEventNight,
  toEventSummary,
  toPassOption,
  type AvailabilityRow,
} from "@/lib/services/mappers";
import { fail, failFromPostgrest, ok, type Result } from "@/lib/services/result";
import { parseSiteContentJson } from "@/lib/site-content";
import type { EventRow as EventDbRow, EventHighlightRow as EventHighlightDbRow, EventFeatureRow as EventFeatureDbRow, PassCategoryRow as PassCategoryDbRow } from "@/types/database";
import type {
  EventBundle,
  EventFeature,
  EventHighlight,
  EventNight,
  EventSummary,
  PassOption,
  SiteContent,
} from "@/types";

/**
 * Event data access — Prisma + PostgreSQL functions on Neon.
 *
 * Every function returns a `Result`, never throws. There is no anon key and no
 * RLS: the connection string only reaches server code, and these queries only
 * touch published/public content tables.
 */

/** The public row deliberately selects only hero-image presence, never its bytea payload. */
const EVENT_PUBLIC_SELECT = `
  select
    id, slug, name, name_hindi, tagline, description, description_hindi,
    venue_name, venue_hindi, venue_address, city, state, maps_url, hero_image_url,
    (hero_image_data is not null) as hero_image_data_present,
    hero_image_version::text as hero_image_version,
    logo_url, contact_phone, contact_email, whatsapp_number,
    instagram_url, facebook_url, youtube_url, support_hours, currency,
    status, start_date, end_date, created_at, updated_at
  from public.events
`;

const NOT_CONFIGURED_MESSAGE =
  "The database is not connected yet. Add DATABASE_URL to the environment (see .env.example).";

function notConfigured<T>(): Result<T> {
  return fail<T>("not-configured", NOT_CONFIGURED_MESSAGE);
}

function queryFailure<T>(error: unknown, context: string): Result<T> {
  const normalised =
    error instanceof DatabaseError
      ? { message: error.message, code: error.code }
      : { message: String(error) };

  return failFromPostgrest(normalised, context);
}



/** Published events, soonest first by creation. */
export async function listPublishedEvents(): Promise<Result<EventSummary[]>> {
  if (!isDatabaseConfigured()) {
    return notConfigured();
  }

  try {
    const rows = await sql<EventDbRow[]>(`
      ${EVENT_PUBLIC_SELECT}
      where status = 'published'
      order by created_at desc
      limit 12
    `);
    return ok(rows.map((row) => toEventSummary(row)));
  } catch (error) {
    return queryFailure(error, "listPublishedEvents");
  }
}

/** Per-night availability for an event, aggregated server-side. */
export async function listEventNights(eventId: string): Promise<Result<EventNight[]>> {
  if (!isDatabaseConfigured()) {
    return notConfigured();
  }

  try {
    const rows = await rpc<AvailabilityRow>("get_event_night_availability", {
      p_event_id: eventId,
    });
    return ok(rows.map(toEventNight));
  } catch (error) {
    return queryFailure(error, "listEventNights");
  }
}

/**
 * Passes sold for an event.
 *
 * Inactive passes are returned too (the pass card shows them as not bookable).
 */
export async function listEventPasses(eventId: string): Promise<Result<PassOption[]>> {
  if (!isDatabaseConfigured()) {
    return notConfigured();
  }

  try {
    const rows = await sql<PassCategoryDbRow[]>`
      select * from public.pass_categories
      where event_id = ${eventId}::uuid
      order by sort_order asc
    `;
    return ok(rows.map((row) => toPassOption(row)));
  } catch (error) {
    return queryFailure(error, "listEventPasses");
  }
}

/** The event the site currently features: the soonest published one. */
export async function getFeaturedEvent(): Promise<Result<EventSummary | null>> {
  if (!isDatabaseConfigured()) {
    return notConfigured();
  }

  try {
    const rows = await sql<EventDbRow[]>(`
      ${EVENT_PUBLIC_SELECT}
      where status = 'published'
      order by created_at asc
      limit 1
    `);
    const [row] = rows;
    if (!row) {
      return ok(null);
    }
    return ok(toEventSummary(row));
  } catch (error) {
    return queryFailure(error, "getFeaturedEvent");
  }
}

interface SiteContentRow {
  site_content: unknown;
}

/**
 * The organiser-edited page copy for the featured event.
 *
 * The copy is optional dressing: when the `site_content` column is missing
 * — an installation that has not applied the latest migration yet — the
 * pages simply render their built-in defaults instead of erroring.
 */
export async function getSiteContent(): Promise<Result<SiteContent>> {
  if (!isDatabaseConfigured()) {
    return notConfigured<SiteContent>();
  }

  try {
    const rows = await sql<SiteContentRow[]>`
      select site_content
      from public.events
      where status = 'published'
      order by created_at asc
      limit 1
    `;
    return ok(parseSiteContentJson(rows[0]?.site_content));
  } catch (error) {
    if (isMissingColumnError(error, "site_content")) {
      return ok(parseSiteContentJson(null));
    }
    return queryFailure(error, "getSiteContent");
  }
}

/** Everything a public page needs about the featured event. */
export async function getFeaturedEventBundle(): Promise<Result<EventBundle | null>> {
  const featured = await getFeaturedEvent();

  if (!featured.ok) {
    return featured;
  }

  if (featured.data === null) {
    return ok(null);
  }

  const event = featured.data;

  const [nights, passes, highlights, features, content] = await Promise.all([
    listEventNights(event.id),
    listEventPasses(event.id),
    listEventHighlights(event.id),
    listEventFeatures(event.id),
    getSiteContent(),
  ]);

  const failure = [nights, passes, highlights, features, content].find((result) => !result.ok);

  if (failure && !failure.ok) {
    return fail(failure.error.kind, failure.error.message);
  }

  return ok({
    event,
    nights: nights.ok ? nights.data : [],
    passes: passes.ok ? passes.data : [],
    highlights: highlights.ok ? highlights.data : [],
    features: features.ok ? features.data : [],
    content: content.ok ? content.data : parseSiteContentJson(null),
  });
}

export async function listEventHighlights(eventId: string): Promise<Result<EventHighlight[]>> {
  if (!isDatabaseConfigured()) {
    return notConfigured<EventHighlight[]>();
  }

  try {
    const rows = await sql<EventHighlightDbRow[]>`
      select * from public.event_highlights
      where event_id = ${eventId}::uuid
      order by sort_order asc
    `;
    return ok(rows.map(toEventHighlight));
  } catch (error) {
    return queryFailure(error, "listEventHighlights");
  }
}

export async function listEventFeatures(eventId: string): Promise<Result<EventFeature[]>> {
  if (!isDatabaseConfigured()) {
    return notConfigured<EventFeature[]>();
  }

  try {
    const rows = await sql<EventFeatureDbRow[]>`
      select * from public.event_features
      where event_id = ${eventId}::uuid
      order by sort_order asc
    `;
    return ok(rows.map(toEventFeature));
  } catch (error) {
    return queryFailure(error, "listEventFeatures");
  }
}
