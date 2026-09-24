import type { SiteContent } from "@/types";

/** Shared event settings shapes used by the admin form and its server endpoints. */
export interface EventSettings {
  id: string;
  name: string;
  slug: string;
  status: string;
  tagline: string | null;
  /** Long-form "About the event" copy shown on the hero and about sections. */
  description: string | null;
  venueName: string;
  venueAddress: string | null;
  city: string;
  state: string | null;
  /** About Us / gallery / FAQ overrides; empty fields mean page defaults. */
  siteContent: SiteContent;
  contactPhone: string | null;
  contactEmail: string | null;
  whatsappNumber: string | null;
  mapsUrl: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  youtubeUrl: string | null;
  supportHours: string[];
  currency: string;
  /** Authenticated preview URL when the database-backed WebP exists (legacy URL otherwise). */
  heroImageUrl: string | null;
  hasHeroImage: boolean;
  heroImageByteSize: number | null;
  heroImageVersion: string;
}

export interface HeroImageSettingsState {
  hasImage: boolean;
  byteSize: number | null;
  version: string;
  previewUrl: string | null;
}

/** Raw string values held by the contact settings form. */
export interface EventContactSettingsInput {
  contactPhone: string;
  contactEmail: string;
  whatsappNumber: string;
  venueAddress: string;
  mapsUrl: string;
  instagramUrl: string;
  facebookUrl: string;
  youtubeUrl: string;
  /** One support-hours entry per line. */
  supportHours: string;
}

/** Normalised values ready to write to the event row. */
export interface EventContactSettingsValues {
  contactPhone: string | null;
  contactEmail: string | null;
  whatsappNumber: string | null;
  venueAddress: string | null;
  mapsUrl: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  youtubeUrl: string | null;
  supportHours: string[];
}

export type EventContactSettingsErrors = Partial<Record<keyof EventContactSettingsInput, string>>;

/** Raw string values held by the "The event" (basics) form. */
export interface EventBasicsSettingsInput {
  name: string;
  slug: string;
  status: string;
  tagline: string;
  description: string;
  venueName: string;
  city: string;
  state: string;
  currency: string;
}

/** Normalised values ready to write to the event row. */
export interface EventBasicsSettingsValues {
  name: string;
  slug: string;
  status: "draft" | "published" | "archived";
  tagline: string | null;
  description: string | null;
  venueName: string;
  city: string;
  state: string | null;
  currency: string;
}

export type EventBasicsSettingsErrors = Partial<Record<keyof EventBasicsSettingsInput, string>>;

/** Raw values held by the site-content form — one About point per line. */
export interface SiteContentSettingsInput {
  aboutTitle: string;
  aboutBody: string;
  aboutPoints: string;
  galleryTitle: string;
  galleryIntro: string;
  /** Fully-typed rows; the FAQ editor manages the array itself. */
  faqs: { question: string; answer: string }[];
}

export type SiteContentSettingsErrors = Partial<
  Record<keyof Omit<SiteContentSettingsInput, "faqs"> | "faqs", string>
>;
