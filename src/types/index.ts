import type { Route } from "next";

/**
 * Shared application types.
 *
 * Domain types (Event, PassTier, Booking, Payment…) are intentionally absent for now:
 * they will be derived from the Supabase schema in a later step so the UI and the
 * database cannot drift apart.
 */

/** A single navigation link rendered in the header, footer or mobile menu. */
export interface NavItem {
  label: string;
  /**
   * Application route. Next.js generates this union from the files in `src/app`
   * (see `next typegen`), so a typo in a link is a type error at build time.
   */
  href: Route;
}
