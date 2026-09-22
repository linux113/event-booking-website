import { siteConfig, whatsappLink } from "@/config/site";
import type { ContactChannel, EventSummary } from "@/types";

/**
 * Contact channels for the site.
 *
 * Event-level details (phone, email, venue) come from the database and win when
 * present; the site-level values in `siteConfig.contact` are only a fallback for
 * enquiries that are not tied to one event. Channels with no real value are
 * omitted entirely rather than rendered as placeholders.
 */
export function buildContactChannels(event?: EventSummary): ContactChannel[] {
  const phone = event?.contactPhone ?? null;
  const email = event?.contactEmail ?? null;
  const channels: ContactChannel[] = [];

  const whatsappNumber = phone?.replace(/[^0-9]/g, "") ?? siteConfig.contact.whatsappNumber;

  if (whatsappNumber) {
    channels.push({
      id: "whatsapp",
      label: "WhatsApp",
      value: phone ?? siteConfig.contact.phoneDisplay,
      description: "Fastest reply — usually within a few minutes during festival days.",
      href: whatsappLink(undefined, whatsappNumber),
      external: true,
      icon: "whatsapp",
    });
  }

  if (phone) {
    channels.push({
      id: "phone",
      label: "Call us",
      value: phone,
      description: "Booking help, group passes and lost-pass queries.",
      href: `tel:${phone.replace(/\s/g, "")}`,
      icon: "phone",
    });
  }

  if (email) {
    channels.push({
      id: "email",
      label: "Email",
      value: email,
      description: "Sponsorships, bulk bookings and press enquiries.",
      href: `mailto:${email}`,
      icon: "mail",
    });
  }

  if (event) {
    channels.push({
      id: "venue",
      label: "Venue",
      value: [event.venueName, event.city].filter(Boolean).join(", "),
      description: event.venueAddress ?? "Gates open one hour before the event start time.",
      href:
        event.mapsUrl ??
        `https://maps.google.com/?q=${encodeURIComponent(
          [event.venueName, event.city].filter(Boolean).join(", "),
        )}`,
      external: true,
      icon: "map",
    });
  }

  return channels;
}

/** Opening hours shown on the contact page. */
export const supportHours = {
  label: "Support hours",
  lines: ["Monday – Saturday · 10:00 AM – 8:00 PM", "Festival days · 10:00 AM – 11:00 PM"],
} as const;
