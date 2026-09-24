import type { NavItem } from "@/types";

/**
 * Static application configuration: branding, navigation and SEO copy.
 *
 * This is *not* event data. Anything an organiser edits — the event's contact number,
 * WhatsApp number, email, venue address, map link, social profiles and support hours —
 * is a column on the `events` row, and is read through `src/lib/contact.ts`. The values
 * below are the deployment-level **fallback** for a site whose event row does not carry
 * them yet; the database always wins. Keep this file to branding and defaults, and put
 * real contact details in the database.
 *
 * Link building lives in `src/lib/contact.ts` too — this file holds no URLs a visitor
 * follows.
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
  name: "Sanwariya Seth Events",
  shortName: "Sanwariya Seth Events",
  tagline: "Navratri & Dandiya event booking",
  description:
    "Discover Navratri and Dandiya events, reserve your passes and pay securely online. Built for organisers and dancers across India.",
  locale: "en-IN",
  currency: "INR",

  /**
   * The clock the venue runs on.
   *
   * A night is a calendar date, and "is this pass for tonight?" has to be answered
   * somewhere. That answer comes from here and nowhere else: the server computes
   * the gate night in this timezone and hands it to the database, which refuses any
   * pass dated for another night. When the product runs events in more than one
   * region this becomes a column on `events`.
   */
  timezone: "Asia/Kolkata",

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
   * Fallback contact handles, used only where the event row has no value of its own.
   * Keep these aligned with the organiser's published contact details.
   */
  contact: {
    /** International format, digits only — used to build wa.me links. */
    whatsappNumber: "919358535894",
    phoneDisplay: "+91 9358535894",
    email: "savriyasethevents@gmail.com",
    addressLines: ["My Village Garden", "Ajmer Road, Jaipur, Rajasthan"],
    /** Up to six lines, e.g. "Monday – Saturday · 10:00 AM – 8:00 PM". */
    supportHours: ["Monday – Saturday · 10:00 AM – 8:00 PM", "Festival days · 10:00 AM – 11:00 PM"],
  },

  /** Fallback social profiles, replaced by the event's own URLs when it has them. */
  socials: [
    { label: "Instagram", href: "https://instagram.com/", icon: "instagram" },
    { label: "Facebook", href: "https://facebook.com/", icon: "facebook" },
    { label: "YouTube", href: "https://youtube.com/", icon: "youtube" },
  ] as const,
} as const;

export type SiteConfig = typeof siteConfig;

