import { siteConfig } from "@/config/site";
import { publicGalleryUrl } from "@/lib/gallery/paths";
import type {
  EventFeature,
  EventHighlight,
  EventNight,
  EventSummary,
  GalleryItem,
  MediaType,
  NightStatus,
  PassOption,
} from "@/types";
import type {
  EventDateRow,
  EventFeatureRow,
  EventHighlightRow,
  EventRow,
  GalleryRow,
  PassCategoryRow,
} from "@/types/database";

/**
 * Pure mappers: database rows → view models.
 *
 * These are the only place that knows about column names, nullability and the
 * availability RPC's shape, so the UI can stay stable if the schema moves. They
 * contain no I/O, which makes them directly unit-testable.
 */

export function toEventSummary(row: EventRow): EventSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    description: row.description,
    venueName: row.venue_name,
    venueAddress: row.venue_address,
    city: row.city,
    state: row.state,
    mapsUrl: row.maps_url,
    heroImageUrl: row.hero_image_url,
    contactPhone: row.contact_phone,
    contactEmail: row.contact_email,
    whatsappNumber: row.whatsapp_number,
    instagramUrl: row.instagram_url,
    facebookUrl: row.facebook_url,
    youtubeUrl: row.youtube_url,
    // A null array from PostgREST and an empty one mean the same thing here: no hours
    // published, so the contact page shows the row of channels it has and no hours.
    supportHours: row.support_hours ?? [],
    currency: row.currency,
  };
}

/** Shape returned by the `get_event_night_availability` RPC. */
export interface AvailabilityRow {
  event_date_id: string;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  night_status: string;
  capacity: number;
  /** Seats withheld from online sale. Absent on rows from before 20260922091200. */
  capacity_held?: number;
  booked_people: number;
  remaining: number;
  is_fully_booked: boolean;
  /** Whether the organiser has booking open on this night. */
  is_booking_open?: boolean;
  is_bookable: boolean;
}

const NIGHT_STATUSES: readonly NightStatus[] = ["scheduled", "sold_out", "cancelled", "completed"];

function toNightStatus(value: string): NightStatus {
  return NIGHT_STATUSES.find((status) => status === value) ?? "scheduled";
}

export function toEventNight(row: AvailabilityRow): EventNight {
  const status = toNightStatus(row.night_status);

  return {
    id: row.event_date_id,
    date: row.event_date,
    startTime: row.start_time,
    endTime: row.end_time,
    status,
    capacity: row.capacity,
    // Both default to the pre-20260922091200 reading when the columns are absent,
    // so a night that predates them is treated as "nothing held back, open".
    capacityHeld: row.capacity_held ?? 0,
    bookedPeople: row.booked_people,
    remaining: row.remaining,
    isFullyBooked: row.is_fully_booked,
    isBookingOpen: row.is_booking_open !== false,
    // Trust the database's verdict over a client-side re-derivation: it is the one
    // the booking path will apply.
    isBookable: row.is_bookable && status === "scheduled",
  };
}

/**
 * A pass is bookable when the organiser left it active. Inactive passes are
 * still returned (greyed out in the UI) rather than hidden, so visitors
 * understand the option exists but is not on sale.
 */
export function toPassOption(row: PassCategoryRow): PassOption {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    composition: row.composition,
    description: row.description,
    priceInr: row.price_inr,
    numberOfPeople: row.number_of_people,
    maxPerBooking: row.max_per_booking,
    minAge: row.min_age ?? 0,
    isActive: row.is_active,
    availability: row.is_active
      ? { enabled: true }
      : { enabled: false, reason: "Not on sale for this event" },
  };
}

export function toEventHighlight(row: EventHighlightRow): EventHighlight {
  return { id: row.id, title: row.title, description: row.description };
}

export function toEventFeature(row: EventFeatureRow): EventFeature {
  return { id: row.id, code: row.code, label: row.label, description: row.description };
}

/**
 * Gallery rows → tiles. Rows with neither a public URL nor a storage path are
 * skipped (the database forbids them, but storage_path is not publicly readable
 * without a signed URL, which needs the service role — so such rows are omitted
 * until the organiser supplies a public URL).
 */
/**
 * One gallery row, as the public site needs it.
 *
 * The URL is **derived, not stored**: an uploaded photograph's row holds the object
 * key inside the gallery bucket, and the public address is that key under
 * `/storage/v1/object/public/gallery/`. Only externally hosted media (a video on a
 * CDN, a photo added straight from a URL) carries its own `url`, and that wins when
 * it is set.
 *
 * A row with neither is dropped rather than rendered as a broken image — which is
 * also what keeps a draft honest: a draft's file lives in the private bucket, so
 * there is no public address for it even if somebody published the row by hand.
 */
export function toGalleryItem(row: GalleryRow): GalleryItem | null {
  const src = row.url ?? publicGalleryUrl(row.storage_path);

  if (!src) {
    return null;
  }

  return {
    id: row.id,
    src,
    thumbnailSrc: row.thumbnail_url ?? publicGalleryUrl(row.thumbnail_path),
    alt: row.alt_text,
    caption: row.title ?? row.album ?? "Festival moment",
    tag: row.album ?? (row.media_type === "video" ? "Video" : "Photo"),
    mediaType: row.media_type as MediaType,
    width: row.width ?? null,
    height: row.height ?? null,
  };
}

/** Convenience used by the seed script's sanity queries and the tests. */
export function summariseNights(nights: readonly EventNight[]) {
  return {
    total: nights.length,
    bookable: nights.filter((night) => night.isBookable).length,
    fullyBooked: nights.filter((night) => night.isFullyBooked).length,
    currency: siteConfig.currency,
  };
}

export type { EventDateRow };
