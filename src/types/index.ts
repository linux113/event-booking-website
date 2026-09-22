import type { Route } from "next";
import type { StaticImageData } from "next/image";

/**
 * Shared application types.
 *
 * Domain types that will eventually be derived from the Supabase schema
 * (EventRow, BookingRow, OrderRow…) are intentionally absent. The presentational
 * types below describe what the UI needs today; when the database lands, the data
 * layer maps DB rows onto these shapes instead of the UI changing.
 */

/** A single navigation link rendered in the header, footer or mobile menu. */
export interface NavItem {
  label: string;
  /**
   * Application route. Next.js generates this union from the files in `src/app`
   * (see `next typegen`), so a typo in a link is a type error at build time.
   */
  href: Route;
}

/** A bundled image (static import) or a remote URL — e.g. a future Supabase Storage URL. */
export type ImageSource = StaticImageData | string;

/** Stable identifiers for the pass tiers offered at an event. */
export type PassTierId = "girls-2" | "couple" | "boy-2-girls" | "girls-4" | "family";

/** One entry pass an attendee can book. */
export interface PassTier {
  id: PassTierId;
  name: string;
  /** Who the pass admits, e.g. "1 Boy + 1 Girl". */
  composition: string;
  /** Price in whole rupees (INR has no minor unit in practice for ticket prices). */
  priceInr: number;
  description: string;
  includes: readonly string[];
  /** Highlighted as the most popular choice. */
  popular?: boolean;
  badge?: string;
}

/** Production elements advertised on the event feature strip. */
export type FeatureId =
  | "anchor"
  | "gorilla"
  | "videographer"
  | "drone"
  | "led-wall"
  | "dj";

export interface Feature {
  id: FeatureId;
  label: string;
  description: string;
}

/** The headline event shown in the hero. */
export interface EventDetails {
  name: string;
  tagline: string;
  /** Human-readable date range, e.g. "11 – 19 October 2026". */
  dates: string;
  /** Daily timing, e.g. "7:00 PM onwards". */
  time: string;
  venue: string;
  /** Locality and city, e.g. "Andheri West, Mumbai". */
  location: string;
  image: ImageSource;
  imageAlt: string;
}

/** A short "what to expect" bullet in the about section. */
export interface Highlight {
  title: string;
  description: string;
}

/** One tile in the gallery. */
export interface GalleryItem {
  id: string;
  src: ImageSource;
  alt: string;
  caption: string;
  tag: string;
}

/** A promo video slot. Videos are attached by the organiser, not invented by the UI. */
export interface PromoVideo {
  id: string;
  title: string;
  description: string;
  platform: "YouTube" | "Instagram" | "WhatsApp";
  /** Optional — populated once the organiser supplies the real video URL. */
  url?: string;
}

export type ContactIcon = "whatsapp" | "phone" | "mail" | "map";

/** A way to reach the organisers. */
export interface ContactChannel {
  id: string;
  label: string;
  value: string;
  description?: string;
  /** Internal route (`/book`), or `tel:` / `mailto:` / `https:` link. */
  href: string;
  external?: boolean;
  icon: ContactIcon;
}
