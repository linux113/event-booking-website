import type { NavItem } from "@/types";

/**
 * Static application configuration: branding, navigation, SEO copy and the
 * contact/social handles used by the header and footer.
 *
 * This is *not* event data. Anything an organiser edits — events, passes,
 * prices, venues, gallery photos — lives in `src/config/*` only as clearly
 * marked demo content today, and moves to Supabase next.
 */

/**
 * Single switch that documents which content is still demo data.
 * Rendered in the UI wherever demo values are shown, so the site never
 * presents placeholder content as if it were live.
 */
export const contentStatus = {
  isDemoContent: true,
  notice: "Demo content — these values will be loaded from the database.",
} as const;

export const siteConfig = {
  name: "Garba Nights",
  shortName: "Garba Nights",
  tagline: "Navratri & Dandiya event booking",
  description:
    "Discover Navratri and Dandiya events, reserve your passes and pay securely online. Built for organisers and dancers across India.",
  locale: "en-IN",
  currency: "INR",

  nav: [
    { label: "Home", href: "/" },
    { label: "About", href: "/about" },
    { label: "Passes", href: "/passes" },
    { label: "Gallery", href: "/gallery" },
    { label: "Contact", href: "/contact" },
  ] satisfies readonly NavItem[],

  footerNav: [
    { label: "Home", href: "/" },
    { label: "About", href: "/about" },
    { label: "Passes", href: "/passes" },
    { label: "Book Now", href: "/book" },
    { label: "Gallery", href: "/gallery" },
    { label: "Events", href: "/events" },
    { label: "Contact", href: "/contact" },
  ] satisfies readonly NavItem[],

  /**
   * Contact handles. Placeholders — replace with the real lines before launch
   * and delete `isDemoContent` above for those values.
   */
  contact: {
    /** International format, digits only — used to build wa.me links. */
    whatsappNumber: "919000000000",
    phoneDisplay: "+91 90000 00000",
    email: "hello@example.com",
    addressLines: ["My Village Garden", "Ajmer Road, Jaipur, Rajasthan"],
  },

  socials: [
    { label: "Instagram", href: "https://instagram.com/", icon: "instagram" },
    { label: "Facebook", href: "https://facebook.com/", icon: "facebook" },
    { label: "YouTube", href: "https://youtube.com/", icon: "youtube" },
  ] as const,
} as const;

export type SiteConfig = typeof siteConfig;

/**
 * `wa.me` deep link with a prefilled enquiry message.
 *
 * `number` overrides the site-level fallback, so an event's own contact number
 * from the database is used when it exists.
 */
export function whatsappLink(
  message = "Hi! I'd like to know more about the Navratri event passes.",
  number: string = siteConfig.contact.whatsappNumber,
): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}
