import type { PassTier } from "@/types";

/**
 * ⚠️ DEMO CONTENT — prices and pass composition are placeholders.
 *
 * In the Supabase step these become rows in a `pass_tiers` table (linked to an
 * event) and are fetched per event, including live availability. The UI already
 * consumes `PassTier[]`, so only the data source changes.
 */
export const demoPasses: readonly PassTier[] = [
  {
    id: "girls-2",
    name: "Duo Pass",
    composition: "2 Girls",
    priceInr: 399,
    description: "Entry for two, ideal for a friends' pair.",
    includes: ["Full-night entry", "Dance floor access", "QR entry pass"],
  },
  {
    id: "couple",
    name: "Couple Pass",
    composition: "1 Boy + 1 Girl",
    priceInr: 499,
    description: "The most-booked pass, priced for a couple entering together.",
    includes: ["Full-night entry", "Dance floor access", "QR entry pass"],
    popular: true,
    badge: "Most popular",
  },
  {
    id: "boy-2-girls",
    name: "Trio Pass",
    composition: "1 Boy + 2 Girls",
    priceInr: 599,
    description: "Entry for three, so the group stays together on the floor.",
    includes: ["Full-night entry", "Dance floor access", "QR entry pass"],
  },
  {
    id: "girls-4",
    name: "Squad Pass",
    composition: "4 Girls",
    priceInr: 799,
    description: "Best value for a group of four friends.",
    includes: ["Full-night entry", "Dance floor access", "QR entry pass", "Group photo slot"],
    badge: "Best value",
  },
  {
    id: "family",
    name: "Family Pass",
    composition: "Family",
    priceInr: 1099,
    description: "One pass for the whole family — children are welcome.",
    includes: ["Full-night entry", "Family seating zone", "QR entry pass"],
  },
] satisfies readonly PassTier[];

/**
 * Rules the booking step will enforce in the database. Stated here so the UI copy
 * and the future schema agree.
 */
export const passPolicies = {
  notes: [
    "Prices are per pass, not per person.",
    "Passes are for a single night of the festival unless stated otherwise.",
    "Entry closes for new bookings once an event night reaches its venue capacity.",
  ],
} as const;
