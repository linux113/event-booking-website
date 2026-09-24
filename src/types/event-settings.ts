/** Shared event settings shapes used by the admin form and its server endpoints. */
export interface EventSettings {
  id: string;
  name: string;
  slug: string;
  status: string;
  tagline: string | null;
  venueName: string;
  venueAddress: string | null;
  city: string;
  state: string | null;
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
