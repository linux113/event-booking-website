import { siteConfig, whatsappLink } from "@/config/site";
import type { ContactChannel } from "@/types";

/**
 * Ways to reach the organisers. Built from `siteConfig.contact` so there is a
 * single place to change the number/email; replace those with live values (and
 * drop the demo badge on the contact page) before launch.
 */
export const contactChannels: readonly ContactChannel[] = [
  {
    id: "whatsapp",
    label: "WhatsApp",
    value: siteConfig.contact.phoneDisplay,
    description: "Fastest reply — usually within a few minutes during festival days.",
    href: whatsappLink(),
    external: true,
    icon: "whatsapp",
  },
  {
    id: "phone",
    label: "Call us",
    value: siteConfig.contact.phoneDisplay,
    description: "Booking help, group passes and lost-pass queries.",
    href: `tel:${siteConfig.contact.phoneDisplay.replace(/\s/g, "")}`,
    icon: "phone",
  },
  {
    id: "email",
    label: "Email",
    value: siteConfig.contact.email,
    description: "Sponsorships, bulk bookings and press enquiries.",
    href: `mailto:${siteConfig.contact.email}`,
    icon: "mail",
  },
  {
    id: "venue",
    label: "Venue",
    value: siteConfig.contact.addressLines.join(", "),
    description: "Gates open one hour before the event start time.",
    href: "https://maps.google.com/?q=My+Village+Garden+Jaipur",
    external: true,
    icon: "map",
  },
] satisfies readonly ContactChannel[];

/** Opening hours shown on the contact page. Demo values. */
export const supportHours = {
  label: "Support hours",
  lines: ["Monday – Saturday · 10:00 AM – 8:00 PM", "Festival days · 10:00 AM – 11:00 PM"],
} as const;
