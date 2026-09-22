import type { NavItem } from "@/types";

/**
 * Static application configuration (branding, navigation, SEO copy).
 *
 * This is *not* event data. Anything that an organiser edits — events, passes,
 * prices, venues — must come from Supabase, never from this file.
 *
 * TODO(branding): replace `name`/`shortName` with the real product name. It is the
 * single source of truth for the header, footer and page metadata.
 */
export const siteConfig = {
  name: "Garba Nights",
  shortName: "Garba Nights",
  tagline: "Navratri & Dandiya event booking",
  description:
    "Discover Navratri and Dandiya events, reserve your passes and pay securely online. Built for organisers and dancers across India.",
  locale: "en-IN",
  currency: "INR",
  nav: [
    { label: "Events", href: "/events" },
    { label: "How it works", href: "/#how-it-works" },
  ] satisfies readonly NavItem[],
  footerNav: [
    { label: "Home", href: "/" },
    { label: "Events", href: "/events" },
    { label: "How it works", href: "/#how-it-works" },
  ] satisfies readonly NavItem[],
} as const;

export type SiteConfig = typeof siteConfig;
