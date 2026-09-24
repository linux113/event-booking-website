import { SITE_CONTENT_LIMITS } from "@/lib/site-content";
import type { SiteContent } from "@/types";
import type {
  EventBasicsSettingsErrors,
  EventBasicsSettingsInput,
  EventBasicsSettingsValues,
  EventContactSettingsErrors,
  EventContactSettingsInput,
  EventContactSettingsValues,
  SiteContentSettingsErrors,
  SiteContentSettingsInput,
} from "@/types/event-settings";

const LIMITS = {
  phone: 30,
  email: 254,
  whatsapp: 24,
  venueAddress: 240,
  url: 500,
  supportHours: 6,
  supportHourLine: 160,
} as const;

const BASICS_LIMITS = {
  name: 120,
  slug: 80,
  tagline: 240,
  description: 2000,
  venueName: 120,
  city: 120,
  state: 120,
  currency: 3,
} as const;

export const EVENT_STATUSES = ["draft", "published", "archived"] as const;

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function hasTooManyCharacters(value: string, limit: number): boolean {
  return value.length > limit;
}

function parseHttpsUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

function isPlatformUrl(value: string, domains: readonly string[]): boolean {
  if (!value) return true;
  const url = parseHttpsUrl(value);
  if (!url) return false;

  const hostname = url.hostname.toLowerCase();
  return domains.some((domain) => {
    if (hostname === domain) return true;
    const suffix = `.${domain}`;
    const subdomain = hostname.endsWith(suffix) ? hostname.slice(0, -suffix.length) : "";
    return /^[a-z0-9-]+$/.test(subdomain);
  });
}

function canonicalHttpsUrl(value: string): string | null {
  if (!value) return null;
  return parseHttpsUrl(value)?.toString() ?? value;
}

/**
 * Parse and validate the values that affect public contact links.
 *
 * The same parser runs in the browser for quick feedback and again on the server;
 * database constraints remain the final check for WhatsApp digits, social domains,
 * and the support-hours count.
 */
export function parseEventContactSettings(
  input: unknown,
): { values: EventContactSettingsValues; errors: EventContactSettingsErrors } {
  const source = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const raw: EventContactSettingsInput = {
    contactPhone: asString(source.contactPhone),
    contactEmail: asString(source.contactEmail),
    whatsappNumber: asString(source.whatsappNumber),
    venueAddress: asString(source.venueAddress),
    mapsUrl: asString(source.mapsUrl),
    instagramUrl: asString(source.instagramUrl),
    facebookUrl: asString(source.facebookUrl),
    youtubeUrl: asString(source.youtubeUrl),
    supportHours: asString(source.supportHours),
  };
  const errors: EventContactSettingsErrors = {};

  if (hasTooManyCharacters(raw.contactPhone, LIMITS.phone)) {
    errors.contactPhone = `Keep the phone number under ${LIMITS.phone} characters.`;
  } else if (raw.contactPhone && !/^\+?[()\d\s.-]+$/.test(raw.contactPhone)) {
    errors.contactPhone = "Use digits, spaces, +, parentheses, dots or hyphens only.";
  } else if (raw.contactPhone && raw.contactPhone.replace(/\D/g, "").length < 6) {
    errors.contactPhone = "Enter a phone number with at least 6 digits.";
  } else if (raw.contactPhone && raw.contactPhone.replace(/\D/g, "").length > 15) {
    errors.contactPhone = "Enter no more than 15 digits, including the country code.";
  }

  if (hasTooManyCharacters(raw.contactEmail, LIMITS.email)) {
    errors.contactEmail = `Keep the email address under ${LIMITS.email} characters.`;
  } else if (raw.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.contactEmail)) {
    errors.contactEmail = "Enter a valid email address, or leave it empty.";
  }

  if (hasTooManyCharacters(raw.whatsappNumber, LIMITS.whatsapp)) {
    errors.whatsappNumber = `Keep the WhatsApp number under ${LIMITS.whatsapp} characters.`;
  } else if (raw.whatsappNumber && !/^\+?[\d\s().-]+$/.test(raw.whatsappNumber)) {
    errors.whatsappNumber = "Use a phone number only — no letters or links.";
  }

  const whatsappDigits = raw.whatsappNumber.replace(/\D/g, "");
  if (raw.whatsappNumber && !errors.whatsappNumber && !/^[1-9]\d{9,14}$/.test(whatsappDigits)) {
    errors.whatsappNumber = "Use 10–15 international digits, including the country code, with no leading zero.";
  }

  if (hasTooManyCharacters(raw.venueAddress, LIMITS.venueAddress)) {
    errors.venueAddress = `Keep the street address under ${LIMITS.venueAddress} characters.`;
  }

  if (hasTooManyCharacters(raw.mapsUrl, LIMITS.url)) {
    errors.mapsUrl = `Keep the map link under ${LIMITS.url} characters.`;
  } else if (raw.mapsUrl && !parseHttpsUrl(raw.mapsUrl)) {
    errors.mapsUrl = "Enter a complete HTTPS map link.";
  }

  const socials = [
    { key: "instagramUrl", value: raw.instagramUrl, domains: ["instagram.com"] },
    { key: "facebookUrl", value: raw.facebookUrl, domains: ["facebook.com", "fb.com"] },
    { key: "youtubeUrl", value: raw.youtubeUrl, domains: ["youtube.com", "youtu.be"] },
  ] as const;

  for (const social of socials) {
    if (hasTooManyCharacters(social.value, LIMITS.url)) {
      errors[social.key] = `Keep the profile link under ${LIMITS.url} characters.`;
    } else if (!isPlatformUrl(social.value, social.domains)) {
      errors[social.key] = `Enter an HTTPS ${social.key.replace("Url", "")} link, or leave it empty.`;
    }
  }

  const supportHours = raw.supportHours
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (supportHours.length > LIMITS.supportHours) {
    errors.supportHours = `Use no more than ${LIMITS.supportHours} lines of support hours.`;
  } else if (supportHours.some((line) => line.length > LIMITS.supportHourLine)) {
    errors.supportHours = `Keep each support-hours line under ${LIMITS.supportHourLine} characters.`;
  }

  const values: EventContactSettingsValues = {
    contactPhone: raw.contactPhone || null,
    contactEmail: raw.contactEmail || null,
    // Accept a readable phone format in the admin control but store the schema's
    // canonical digits-only international value for wa.me.
    whatsappNumber: whatsappDigits || null,
    venueAddress: raw.venueAddress || null,
    mapsUrl: canonicalHttpsUrl(raw.mapsUrl),
    instagramUrl: canonicalHttpsUrl(raw.instagramUrl),
    facebookUrl: canonicalHttpsUrl(raw.facebookUrl),
    youtubeUrl: canonicalHttpsUrl(raw.youtubeUrl),
    supportHours,
  };

  return { values, errors };
}

export function isCleanEventContactSettings(errors: EventContactSettingsErrors): boolean {
  return Object.keys(errors).length === 0;
}

// -----------------------------------------------------------------------------
// About the event (name, tagline, description, venue names)
// -----------------------------------------------------------------------------

/**
 * Parse and validate the event basics. Name, venue name and city are required:
 * the public pages have no fallback for them. Empty optional fields are stored
 * as null so the built-in copy (e.g. the section headings) reappears.
 */
export function parseEventBasicsSettings(
  input: unknown,
): { values: EventBasicsSettingsValues; errors: EventBasicsSettingsErrors } {
  const source = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const raw: EventBasicsSettingsInput = {
    name: asString(source.name),
    slug: asString(source.slug),
    status: asString(source.status),
    tagline: asString(source.tagline),
    description: asString(source.description),
    venueName: asString(source.venueName),
    city: asString(source.city),
    state: asString(source.state),
    currency: asString(source.currency).toUpperCase(),
  };
  const errors: EventBasicsSettingsErrors = {};

  if (!raw.name) {
    errors.name = "Enter the event name.";
  } else if (hasTooManyCharacters(raw.name, BASICS_LIMITS.name)) {
    errors.name = `Keep the event name under ${BASICS_LIMITS.name} characters.`;
  }

  if (!raw.slug) {
    errors.slug = "Enter the event slug.";
  } else if (hasTooManyCharacters(raw.slug, BASICS_LIMITS.slug)) {
    errors.slug = `Keep the slug under ${BASICS_LIMITS.slug} characters.`;
  } else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw.slug)) {
    errors.slug = "Use lowercase letters, numbers and single hyphens, e.g. navratri-2026-jaipur.";
  }

  if (!EVENT_STATUSES.includes(raw.status as (typeof EVENT_STATUSES)[number])) {
    errors.status = "Choose draft, published or archived.";
  }

  if (hasTooManyCharacters(raw.tagline, BASICS_LIMITS.tagline)) {
    errors.tagline = `Keep the tagline under ${BASICS_LIMITS.tagline} characters.`;
  }

  if (hasTooManyCharacters(raw.description, BASICS_LIMITS.description)) {
    errors.description = `Keep the description under ${BASICS_LIMITS.description} characters.`;
  }

  if (!raw.venueName) {
    errors.venueName = "Enter the venue name.";
  } else if (hasTooManyCharacters(raw.venueName, BASICS_LIMITS.venueName)) {
    errors.venueName = `Keep the venue name under ${BASICS_LIMITS.venueName} characters.`;
  }

  if (!raw.city) {
    errors.city = "Enter the city.";
  } else if (hasTooManyCharacters(raw.city, BASICS_LIMITS.city)) {
    errors.city = `Keep the city under ${BASICS_LIMITS.city} characters.`;
  }

  if (hasTooManyCharacters(raw.state, BASICS_LIMITS.state)) {
    errors.state = `Keep the state under ${BASICS_LIMITS.state} characters.`;
  }

  if (raw.currency.length !== BASICS_LIMITS.currency || !/^[A-Z]{3}$/.test(raw.currency)) {
    errors.currency = `Use the 3-letter currency code, e.g. INR.`;
  }

  const values: EventBasicsSettingsValues = {
    name: raw.name,
    slug: raw.slug,
    status: raw.status as EventBasicsSettingsValues["status"],
    tagline: raw.tagline || null,
    description: raw.description || null,
    venueName: raw.venueName,
    city: raw.city,
    state: raw.state || null,
    currency: raw.currency,
  };

  return { values, errors };
}

export function isCleanEventBasicsSettings(errors: EventBasicsSettingsErrors): boolean {
  return Object.keys(errors).length === 0;
}

// -----------------------------------------------------------------------------
// Site content (About Us, gallery heading, contact-page FAQs)
// -----------------------------------------------------------------------------

/**
 * Parse and validate the organiser-edited public copy. Empty fields are
 * stored as null/empty: the public pages then fall back to their built-in
 * default copy, so clearing a field restores the original text.
 */
export function parseSiteContentSettings(
  input: unknown,
): { values: SiteContent; errors: SiteContentSettingsErrors } {
  const source = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const rawFaqs = Array.isArray(source.faqs) ? source.faqs : [];
  const raw: SiteContentSettingsInput = {
    aboutTitle: asString(source.aboutTitle),
    aboutBody: asString(source.aboutBody),
    aboutPoints: asString(source.aboutPoints),
    galleryTitle: asString(source.galleryTitle),
    galleryIntro: asString(source.galleryIntro),
    faqs: rawFaqs
      .map((row) => {
        const record = (typeof row === "object" && row !== null ? row : {}) as Record<string, unknown>;
        return { question: asString(record.question), answer: asString(record.answer) };
      })
      .filter((row) => row.question || row.answer),
  };
  const errors: SiteContentSettingsErrors = {};

  if (hasTooManyCharacters(raw.aboutTitle, SITE_CONTENT_LIMITS.aboutTitle)) {
    errors.aboutTitle = `Keep the About Us title under ${SITE_CONTENT_LIMITS.aboutTitle} characters.`;
  }
  if (hasTooManyCharacters(raw.aboutBody, SITE_CONTENT_LIMITS.aboutBody)) {
    errors.aboutBody = `Keep the About Us text under ${SITE_CONTENT_LIMITS.aboutBody} characters.`;
  }
  if (hasTooManyCharacters(raw.galleryTitle, SITE_CONTENT_LIMITS.galleryTitle)) {
    errors.galleryTitle = `Keep the gallery title under ${SITE_CONTENT_LIMITS.galleryTitle} characters.`;
  }
  if (hasTooManyCharacters(raw.galleryIntro, SITE_CONTENT_LIMITS.galleryIntro)) {
    errors.galleryIntro = `Keep the gallery intro under ${SITE_CONTENT_LIMITS.galleryIntro} characters.`;
  }

  const aboutPoints = raw.aboutPoints
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (aboutPoints.length > SITE_CONTENT_LIMITS.aboutPointsMax) {
    errors.aboutPoints = `Use no more than ${SITE_CONTENT_LIMITS.aboutPointsMax} checklist points.`;
  } else if (aboutPoints.some((line) => line.length > SITE_CONTENT_LIMITS.aboutPointLength)) {
    errors.aboutPoints = `Keep each checklist point under ${SITE_CONTENT_LIMITS.aboutPointLength} characters.`;
  }

  if (raw.faqs.length > SITE_CONTENT_LIMITS.faqsMax) {
    errors.faqs = `Use no more than ${SITE_CONTENT_LIMITS.faqsMax} questions.`;
  } else if (raw.faqs.some((faq) => !(faq.question && faq.answer))) {
    errors.faqs = "Every question needs both the question and its answer — or remove the empty row.";
  } else if (raw.faqs.some((faq) => faq.question.length > SITE_CONTENT_LIMITS.faqQuestion)) {
    errors.faqs = `Keep each question under ${SITE_CONTENT_LIMITS.faqQuestion} characters.`;
  } else if (raw.faqs.some((faq) => faq.answer.length > SITE_CONTENT_LIMITS.faqAnswer)) {
    errors.faqs = `Keep each answer under ${SITE_CONTENT_LIMITS.faqAnswer} characters.`;
  }

  const values: SiteContent = {
    aboutTitle: raw.aboutTitle || null,
    aboutBody: raw.aboutBody || null,
    aboutPoints,
    galleryTitle: raw.galleryTitle || null,
    galleryIntro: raw.galleryIntro || null,
    faqs: raw.faqs.slice(0, SITE_CONTENT_LIMITS.faqsMax),
  };

  return { values, errors };
}

export function isCleanSiteContentSettings(errors: SiteContentSettingsErrors): boolean {
  return Object.keys(errors).length === 0;
}
