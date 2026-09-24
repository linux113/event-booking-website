import type {
  EventContactSettingsErrors,
  EventContactSettingsInput,
  EventContactSettingsValues,
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
