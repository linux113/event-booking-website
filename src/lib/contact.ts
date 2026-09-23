import { siteConfig } from "@/config/site";
import type { ContactChannel, EventSummary } from "@/types";

/**
 * Every link the site offers to reach the organiser.
 *
 * There is one rule in this module, and it is the reason the module exists: **the
 * contact details are data, and the links derived from them are built in one place.**
 * The event row in the database is the first source — `whatsapp_number`,
 * `contact_phone`, `contact_email`, the venue columns, `maps_url`, the three social
 * URLs and `support_hours`. `siteConfig` holds the deployment-level fallback, used only
 * when the event row does not carry a value, so a fresh install still shows the
 * organiser's configured number instead of nothing.
 *
 * Components therefore never spell a `wa.me`, `tel:`, `mailto:` or Maps URL, and never
 * contain a phone number: they take a `SiteContact` (or an event) and render it. Adding
 * a number to the event record updates the header, the footer, the contact page, the
 * booking pages and every enquiry button at once.
 *
 * Nothing here touches the network or the database: it is a pure mapping, so the same
 * functions can be exercised without a browser.
 */

/**
 * What every click-to-chat link opens with.
 *
 * One sentence, in one place: what customers send the organiser is a product decision,
 * not a copy detail repeated per button.
 */
export const WHATSAPP_MESSAGE = "Hello, I need help with Navratri Dandiya booking.";

/** The three profiles an event can publish. */
export const SOCIAL_PLATFORMS = ["instagram", "facebook", "youtube"] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export interface SocialLink {
  id: SocialPlatform;
  /** Human label — also the icon key in `src/components/icons`. */
  label: string;
  href: string;
}

/** Everything a page or the site chrome needs to let somebody reach the organiser. */
export interface SiteContact {
  /** `https://wa.me/<digits>?text=<message>`, or null when no number is published. */
  whatsappHref: string | null;
  /** The digits the link opens, so any other message can be built from them. */
  whatsappNumber: string | null;
  phone: string | null;
  phoneHref: string | null;
  email: string | null;
  emailHref: string | null;
  /** Venue name, street address and "city, state" — one per line, empty ones dropped. */
  addressLines: string[];
  /** `event.maps_url`, or a Google Maps search built from the address. */
  mapsHref: string | null;
  socials: SocialLink[];
  supportHours: string[];
}

/** No event and no fallback configured: the chrome renders without contact links. */
export const EMPTY_CONTACT: SiteContact = {
  whatsappHref: null,
  whatsappNumber: null,
  phone: null,
  phoneHref: null,
  email: null,
  emailHref: null,
  addressLines: [],
  mapsHref: null,
  socials: [],
  supportHours: [],
};

/** Digits only — the form `wa.me` and `tel:` links need. */
export function digitsOnly(value: string | null | undefined): string {
  return (value ?? "").replace(/[^0-9]/g, "");
}

/**
 * The WhatsApp number this event uses.
 *
 * The dedicated `whatsapp_number` column wins; when it is empty the digits of the
 * contact phone are used, because an event that publishes only one number should still
 * get a working chat link. Only when the row carries neither does the site-level
 * fallback from `siteConfig` apply.
 */
export function whatsappNumberFor(event?: EventSummary | null): string | null {
  const own = digitsOnly(event?.whatsappNumber);

  if (own.length >= 10) {
    return own;
  }

  const phone = digitsOnly(event?.contactPhone);

  if (phone.length >= 10) {
    return phone;
  }

  const fallback = digitsOnly(siteConfig.contact.whatsappNumber);

  return fallback.length >= 10 ? fallback : null;
}

/**
 * The enquiry message, optionally signed with a booking reference.
 *
 * The sentence customers open with is always `WHATSAPP_MESSAGE`; a reference is the one
 * thing worth appending, because it saves the organiser asking who is on the line.
 */
export function whatsappMessage(reference?: string | null): string {
  const trimmed = (reference ?? "").trim();

  return trimmed ? `${WHATSAPP_MESSAGE} My booking reference is ${trimmed}.` : WHATSAPP_MESSAGE;
}

/**
 * A `wa.me` link with the message prefilled.
 *
 * Works on a phone (the WhatsApp app takes the link over) and on a desktop (WhatsApp
 * Web opens, or WhatsApp's own prompt does), which is why the site uses `wa.me` rather
 * than an app-scheme URL: one href, both platforms.
 */
export function whatsappChatUrl(number: string | null | undefined, message: string = WHATSAPP_MESSAGE): string | null {
  const digits = digitsOnly(number);

  if (digits.length < 10) {
    return null;
  }

  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

/** The same link, for a caller that has the event rather than a number. */
export function whatsappHref(event?: EventSummary | null, message: string = WHATSAPP_MESSAGE): string | null {
  return whatsappChatUrl(whatsappNumberFor(event), message);
}

/** `tel:` link, or null when there is no number to dial. */
export function telHref(phone: string | null | undefined): string | null {
  const digits = digitsOnly(phone);

  return digits.length >= 6 ? `tel:${digits}` : null;
}

/** `mailto:` link, or null when there is no address (or it is clearly not one). */
export function mailHref(email: string | null | undefined): string | null {
  const address = (email ?? "").trim();

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ? `mailto:${address}` : null;
}

/**
 * Where the venue is on a map.
 *
 * The stored `maps_url` wins — an organiser who pasted a precise pin should get that
 * pin. Otherwise the address is searched, which lands on the venue rather than on a
 * blank map.
 */
export function mapsHrefFor(
  event?: EventSummary | null,
  addressLines: string[] = [],
): string | null {
  const stored = (event?.mapsUrl ?? "").trim();

  if (stored) {
    return stored;
  }

  const query = addressLines.join(", ").trim();

  return query ? `https://maps.google.com/?q=${encodeURIComponent(query)}` : null;
}

/** The address as it should be printed: venue, street, then "city, state". */
export function addressLinesFor(event?: EventSummary | null): string[] {
  const cityLine = [event?.city, event?.state].filter(Boolean).join(", ");

  const eventLines = [event?.venueName ?? "", event?.venueAddress ?? "", cityLine]
    .map((line) => line.trim())
    .filter(Boolean);

  const lines =
    eventLines.length > 0 ? eventLines : siteConfig.contact.addressLines.map((line) => line.trim()).filter(Boolean);

  return lines.filter((line, index) => lines.indexOf(line) === index);
}

/** The profiles this event actually publishes, in the order the site shows them. */
export function socialLinksFor(event?: EventSummary | null): SocialLink[] {
  const eventLinks: SocialLink[] = SOCIAL_PLATFORMS.map((id) => ({
    id,
    label: id === "youtube" ? "YouTube" : `${id.charAt(0).toUpperCase()}${id.slice(1)}`,
    href:
      (id === "instagram" ? event?.instagramUrl : id === "facebook" ? event?.facebookUrl : event?.youtubeUrl)?.trim() ??
      "",
  })).filter((link) => link.href.length > 0);

  if (eventLinks.length > 0) {
    return eventLinks;
  }

  return siteConfig.socials.map((social) => ({
    id: social.icon,
    label: social.label,
    href: social.href,
  }));
}

/** Everything above, assembled once so no component has to remember the pieces. */
export function buildSiteContact(event?: EventSummary | null): SiteContact {
  const phone = event?.contactPhone?.trim() || siteConfig.contact.phoneDisplay;
  const email = event?.contactEmail?.trim() || siteConfig.contact.email;
  const whatsappNumber = whatsappNumberFor(event);
  const addressLines = addressLinesFor(event);
  const hours = (event?.supportHours ?? []).map((line) => line.trim()).filter(Boolean);

  return {
    whatsappHref: whatsappChatUrl(whatsappNumber),
    whatsappNumber,
    phone: phone || null,
    phoneHref: telHref(phone || whatsappNumber),
    email: email || null,
    emailHref: mailHref(email),
    addressLines,
    mapsHref: mapsHrefFor(event, addressLines),
    socials: socialLinksFor(event),
    supportHours: hours.length > 0 ? hours : [...siteConfig.contact.supportHours],
  };
}

/**
 * The contact cards on `/contact` and the home page's contact preview.
 *
 * A channel with no value is omitted rather than rendered as a placeholder, so the page
 * never shows a link that goes nowhere — and never shows a number the organiser did not
 * publish.
 */
export function buildContactChannels(event?: EventSummary | null): ContactChannel[] {
  const contact = buildSiteContact(event);
  const channels: ContactChannel[] = [];

  if (contact.whatsappHref && contact.whatsappNumber) {
    channels.push({
      id: "whatsapp",
      label: "WhatsApp",
      value: contact.phone ?? `+${contact.whatsappNumber}`,
      description: "Fastest reply — usually within a few minutes during festival days.",
      href: contact.whatsappHref,
      external: true,
      icon: "whatsapp",
    });
  }

  if (contact.phone && contact.phoneHref) {
    channels.push({
      id: "phone",
      label: "Call us",
      value: contact.phone,
      description: "Booking help, group passes and lost-pass queries.",
      href: contact.phoneHref,
      icon: "phone",
    });
  }

  if (contact.email && contact.emailHref) {
    channels.push({
      id: "email",
      label: "Email",
      value: contact.email,
      description: "Sponsorships, bulk bookings and press enquiries.",
      href: contact.emailHref,
      icon: "mail",
    });
  }

  if (contact.mapsHref && event) {
    channels.push({
      id: "venue",
      label: "Venue",
      value: [event.venueName, event.city].filter(Boolean).join(", "),
      description: event.venueAddress ?? "Gates open an hour before the event starts.",
      href: contact.mapsHref,
      external: true,
      icon: "map",
    });
  }

  return channels;
}
