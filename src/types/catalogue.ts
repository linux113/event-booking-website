/**
 * The management screens' types: one pass type, one night, and the answers the two
 * write endpoints give.
 *
 * The shapes here are the *view* shapes — camelCase, rupees, formatted-ready — so a
 * component never sees a `snake_case` column or a paise figure. The database's own
 * shapes live in `src/types/database.ts`.
 */

// -----------------------------------------------------------------------------
// Pass types
// -----------------------------------------------------------------------------

export interface AdminPassType {
  id: string;
  code: string;
  name: string;
  composition: string;
  description: string | null;
  /** Whole rupees, as the organiser typed it. */
  priceInr: number;
  numberOfPeople: number;
  maxPerBooking: number;
  /** Minimum age in years; 0 means no restriction. */
  minAge: number;
  isActive: boolean;
  sortOrder: number;
  /** What has been sold on this pass, for the "can I change this?" question. */
  bookingsCount: number;
  paidBookings: number;
  passesIssued: number;
  peopleSold: number;
  revenueInr: number;
  updatedAt: string;
}

/**
 * What the pass form sends.
 *
 * Every field is the raw string a form control holds or the number it parsed to:
 * the point of naming them here is that the browser and the server validate the
 * *same* shape, with the database as the final word.
 */
export interface PassFormValues {
  /** Null when the form is creating a pass. */
  id: string | null;
  code: string;
  name: string;
  composition: string;
  description: string;
  priceInr: number;
  numberOfPeople: number;
  maxPerBooking: number;
  minAge: number;
  sortOrder: number;
  isActive: boolean;
}

export type PassFormErrors = Partial<Record<keyof PassFormValues, string>>;

// -----------------------------------------------------------------------------
// Nights
// -----------------------------------------------------------------------------

export interface AdminNight {
  id: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  status: string;
  capacity: number;
  /** Seats withheld from online booking. */
  capacityHeld: number;
  bookingOpen: boolean;
  notes: string | null;
  bookedPeople: number;
  bookedBookings: number;
  passesIssued: number;
  /** `capacity - capacityHeld` — what the organiser put on sale. */
  seatsOnSale: number;
  /** `capacity - capacityHeld - bookedPeople`, floored at zero. */
  seatsAvailable: number;
  /** True when the seats sold plus the seats held exceed the capacity. */
  overCommitted: boolean;
  isFull: boolean;
  updatedAt: string;
}

export interface NightFormValues {
  id: string | null;
  date: string;
  startTime: string;
  endTime: string;
  capacity: number;
  capacityHeld: number;
  status: string;
  bookingOpen: boolean;
  notes: string;
}

export type NightFormErrors = Partial<Record<keyof NightFormValues, string>>;

// -----------------------------------------------------------------------------
// The write endpoints
// -----------------------------------------------------------------------------

/**
 * Why a save was refused, and which control caused it.
 *
 * `field` is what the form highlights; `code` is the database's own error code and
 * is kept so a check can assert the *rule* that fired rather than the prose around
 * it. `floor` carries the numbers some refusals need to be actionable — what the
 * capacity should be raised to, in particular.
 */
export interface CatalogueError {
  kind: "invalid-input" | "not-authorized" | "forbidden" | "not-configured" | "refused" | "server-error";
  message: string;
  /** The form field to highlight, when the refusal belongs to one. */
  field?: string;
  /** The database error code (PT004, PC003, …), for logs and tests. */
  code?: string;
  /** The lowest value the rule will accept, when it has one. */
  floor?: number;
}

export interface CatalogueSuccess<T> {
  ok: true;
  data: T;
}

export interface CatalogueFailure {
  ok: false;
  error: CatalogueError;
}

export type CatalogueResult<T> = CatalogueSuccess<T> | CatalogueFailure;

/** What `POST /api/admin/passes` accepts. */
export type PassAction =
  | { action: "save"; pass: unknown }
  | { action: "toggle"; id: string; isActive: boolean };

/** What `POST /api/admin/dates` accepts. */
export type NightAction =
  | { action: "save"; night: unknown }
  | { action: "capacity"; id: string; capacity: number; capacityHeld: number | null }
  | { action: "booking"; id: string; bookingOpen: boolean };
