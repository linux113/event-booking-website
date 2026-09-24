import type { EventNight, PassOption } from "@/types";

/**
 * The words the site uses about a night or a pass, in one place.
 *
 * Three surfaces describe the same night to a visitor — the landing-page night
 * list, the booking wizard's night selector, and the summary under it — and they
 * must not disagree: a night that says "Booking closed" on one page and
 * "Available" on the next is worse than saying nothing. So the rules for what a
 * night is and what to call it live here, as pure functions over the view model.
 *
 * They are deliberately free of JSX and of the database: a night's numbers arrive
 * already counted (`EventNight`), and this file only decides how to say them.
 */

/**
 * Seats actually offered online: capacity minus the ones the organiser held back
 * for the gate, sponsors or crew, which are never sold on the website.
 */
export function seatsOnSale(night: Pick<EventNight, "capacity" | "capacityHeld">): number {
  return Math.max(night.capacity - night.capacityHeld, 0);
}

/** The shortest true description of a night's state, for a badge or a label. */
export function nightStateLabel(night: EventNight): string {
  if (night.isFullyBooked) {
    return "Fully booked";
  }

  if (night.status === "cancelled") {
    return "Cancelled";
  }

  if (night.status === "completed") {
    return "Finished";
  }

  if (!night.isBookingOpen) {
    return "Booking closed";
  }

  return "Available";
}

/**
 * The capacity line under a night's date, or null when printing numbers would
 * mislead: a cancelled or finished night keeps its capacity in the database, and
 * "1500 of 1500 places left" next to "Cancelled" reads as availability.
 */
export function nightAvailabilityCopy(night: EventNight): string | null {
  if (night.isFullyBooked) {
    return "No passes left for this night";
  }

  if (night.status === "cancelled" || night.status === "completed") {
    return null;
  }

  if (!night.isBookingOpen) {
    return "Booking is closed for this night";
  }

  const onSale = seatsOnSale(night);
  const line = `${night.remaining} of ${onSale} places left`;

  // Say where the rest went: an organiser holding seats back is the difference
  // between "400 capacity" and "350 you can book", and a visitor comparing the two
  // deserves the sentence rather than a discrepancy.
  return night.capacityHeld > 0 ? `${line} · ${night.capacityHeld} held for the gate` : line;
}

/** Why a night cannot be selected, phrased for a label next to a disabled input. */
export function nightUnavailableReason(night: EventNight): string {
  if (night.isBookable) {
    return "Select this night";
  }

  if (night.isFullyBooked || night.status === "cancelled" || night.status === "completed" || !night.isBookingOpen) {
    return nightStateLabel(night);
  }

  return "Unavailable";
}

/**
 * The age restriction on a pass, or null when there is none. Zero means "no
 * restriction" in the database, so it is never rendered as "0+".
 */
export function passAgeCopy(pass: Pick<PassOption, "minAge">): string | null {
  if (!pass.minAge || pass.minAge <= 0) {
    return null;
  }

  return `${pass.minAge}+ only`;
}

// -----------------------------------------------------------------------------
// Availability tiers — the legend on the date & time screen
// -----------------------------------------------------------------------------

/**
 * Coarse availability state of a night, for the coloured dots on the date
 * picker and the legend above it. `nightStateLabel` stays the *word* a badge
 * uses; the tier is the *colour*, so a night says the same thing on both.
 */
export type NightAvailabilityTier = "available" | "filling-fast" | "sold-out" | "closed";

export const NIGHT_AVAILABILITY_TIER_ORDER: readonly NightAvailabilityTier[] = [
  "available",
  "filling-fast",
  "sold-out",
  "closed",
] as const;

/** Label shown in the legend next to each tier's dot. */
export function nightAvailabilityTierLabel(tier: NightAvailabilityTier): string {
  switch (tier) {
    case "available":
      return "Available";
    case "filling-fast":
      return "Filling fast";
    case "sold-out":
      return "Sold out";
    case "closed":
      return "Booking closed";
  }
}

/**
 * A hint of urgency. A night is "filling fast" once at most a fifth of its
 * online-sale seats remain — drawn from the same `remaining` count the rest of
 * the site shows, so the dot and the numbers never disagree.
 */
export function nightAvailabilityTier(night: EventNight): NightAvailabilityTier {
  if (night.isFullyBooked) {
    return "sold-out";
  }

  if (!night.isBookable) {
    return "closed";
  }

  const onSale = seatsOnSale(night);

  if (onSale > 0 && night.remaining <= Math.max(1, Math.floor(onSale / 5))) {
    return "filling-fast";
  }

  return "available";
}
