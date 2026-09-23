import { fail, failFromPostgrest, ok, type Result } from "@/lib/services/result";
import {
  toEventFeature,
  toEventHighlight,
  toEventNight,
  toEventSummary,
  toPassOption,
  type AvailabilityRow,
} from "@/lib/services/mappers";
import { getPublicClient, isDatabaseConfigured } from "@/lib/supabase/public";
import type {
  EventBundle,
  EventFeature,
  EventHighlight,
  EventNight,
  EventSummary,
  PassOption,
} from "@/types";

/**
 * Event data access.
 *
 * Every function returns a `Result`, never throws, and only ever runs through the
 * anon-key client, so Row Level Security decides what is visible: published
 * events, their nights, active passes. Nothing here can reach bookings.
 */

const NOT_CONFIGURED_MESSAGE =
  "The database is not connected yet. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to the environment.";

function notConfigured<T>(): Result<T> {
  return fail<T>("not-configured", NOT_CONFIGURED_MESSAGE);
}

/** Published events, soonest first by their earliest night. */
export async function listPublishedEvents(): Promise<Result<EventSummary[]>> {
  if (!isDatabaseConfigured()) {
    return notConfigured();
  }

  const { data, error } = await getPublicClient()
    .from("events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(12);

  if (error) {
    return failFromPostgrest(error, "listPublishedEvents");
  }

  return ok(data.map(toEventSummary));
}

/** Per-night availability for an event, aggregated server-side. */
export async function listEventNights(eventId: string): Promise<Result<EventNight[]>> {
  if (!isDatabaseConfigured()) {
    return notConfigured();
  }

  const { data, error } = await getPublicClient().rpc("get_event_night_availability", {
    p_event_id: eventId,
  });

  if (error) {
    return failFromPostgrest(error, "listEventNights");
  }

  return ok((data as AvailabilityRow[]).map(toEventNight));
}

/**
 * Passes sold for an event.
 *
 * Inactive passes are returned too (the pass card shows them as not bookable),
 * so the query deliberately does not filter on `is_active`.
 */
export async function listEventPasses(eventId: string): Promise<Result<PassOption[]>> {
  if (!isDatabaseConfigured()) {
    return notConfigured();
  }

  const { data, error } = await getPublicClient()
    .from("pass_categories")
    .select("*")
    .eq("event_id", eventId)
    .order("sort_order", { ascending: true });

  if (error) {
    return failFromPostgrest(error, "listEventPasses");
  }

  return ok(data.map(toPassOption));
}

/** The event the site currently features: the soonest published one. */
export async function getFeaturedEvent(): Promise<Result<EventSummary | null>> {
  if (!isDatabaseConfigured()) {
    return notConfigured();
  }

  const { data, error } = await getPublicClient()
    .from("events")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) {
    return failFromPostgrest(error, "getFeaturedEvent");
  }

  const [row] = data;

  if (!row) {
    return ok(null);
  }

  return ok(toEventSummary(row));
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

  const [nights, passes, highlights, features] = await Promise.all([
    listEventNights(event.id),
    listEventPasses(event.id),
    listEventHighlights(event.id),
    listEventFeatures(event.id),
  ]);

  // The event itself loaded; if a related table fails, surface that rather than
  // rendering a half-populated page.
  const failure = [nights, passes, highlights, features].find((result) => !result.ok);

  if (failure && !failure.ok) {
    return fail(failure.error.kind, failure.error.message);
  }

  return ok({
    event,
    nights: nights.ok ? nights.data : [],
    passes: passes.ok ? passes.data : [],
    highlights: highlights.ok ? highlights.data : [],
    features: features.ok ? features.data : [],
  });
}

export async function listEventHighlights(eventId: string): Promise<Result<EventHighlight[]>> {
  if (!isDatabaseConfigured()) {
    return notConfigured<EventHighlight[]>();
  }

  const { data, error } = await getPublicClient()
    .from("event_highlights")
    .select("*")
    .eq("event_id", eventId)
    .order("sort_order", { ascending: true });

  if (error) {
    return failFromPostgrest(error, "listEventHighlights");
  }

  return ok(data.map(toEventHighlight));
}

export async function listEventFeatures(eventId: string): Promise<Result<EventFeature[]>> {
  if (!isDatabaseConfigured()) {
    return notConfigured<EventFeature[]>();
  }

  const { data, error } = await getPublicClient()
    .from("event_features")
    .select("*")
    .eq("event_id", eventId)
    .order("sort_order", { ascending: true });

  if (error) {
    return failFromPostgrest(error, "listEventFeatures");
  }

  return ok(data.map(toEventFeature));
}
