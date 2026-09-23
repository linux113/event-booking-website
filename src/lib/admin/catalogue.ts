/**
 * The management screens' vocabulary, as a pure module.
 *
 * Same shape as `src/lib/admin/bookings.ts` and `src/lib/admin/operations.ts`: no
 * database, no React, so the form, the route handler and the verification harness
 * can all read the same rules. What lives here is:
 *
 *   1. **Parsing a submitted form** into typed values, with a message per field —
 *      the browser uses it for instant feedback, the route handler runs the same
 *      function on the payload it actually received.
 *   2. **The database's refusal codes**, mapped to the field they belong to and a
 *      sentence a human can act on. The rules themselves are in SQL; this is only
 *      the translation.
 *   3. **The words** the screens use about capacity: seats on sale, seats left,
 *      what "over-committed" means.
 *
 * Nothing here is the last word on validity. `src/lib/booking/validation.ts` makes
 * the same point about the booking wizard, and it is worth repeating: a rule this
 * module cannot check — is this code already used, is this capacity below what has
 * been paid for — is enforced by the database and comes back as a code.
 */

import type {
  AdminNight,
  AdminPassType,
  CatalogueError,
  NightFormErrors,
  NightFormValues,
  PassFormErrors,
  PassFormValues,
} from "@/types/catalogue";

// -----------------------------------------------------------------------------
// Limits, stated once
// -----------------------------------------------------------------------------

/** The same numbers the SQL functions enforce, so the form and the database agree. */
export const PASS_LIMITS = {
  nameMax: 60,
  compositionMax: 80,
  descriptionMax: 240,
  codeMax: 24,
  priceMin: 1,
  priceMax: 500000,
  peopleMin: 1,
  peopleMax: 50,
  maxPerBookingMin: 1,
  maxPerBookingMax: 100,
  minAgeMin: 0,
  minAgeMax: 120,
  sortOrderMax: 9999,
} as const;

export const NIGHT_LIMITS = {
  capacityMin: 1,
  capacityMax: 100000,
  heldMin: 0,
  notesMax: 240,
} as const;

export const NIGHT_STATUS_OPTIONS = [
  { value: "scheduled", label: "Scheduled — on sale" },
  { value: "sold_out", label: "Sold out — stops booking" },
  { value: "cancelled", label: "Cancelled — night is off" },
  { value: "completed", label: "Completed — night has happened" },
] as const;

// -----------------------------------------------------------------------------
// Reading a submitted form
// -----------------------------------------------------------------------------

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
}

/**
 * A whole number from a form control.
 *
 * Deliberately strict about `12abc`: `Number.parseInt` would answer 12 and quietly
 * accept a typo, and a price that silently lost its tail is worse than a form that
 * asks again. `null` means "not a number at all".
 */
function integer(value: unknown): number | null {
  const raw = text(value);

  if (raw === "") {
    return null;
  }

  if (!/^-?\d{1,9}$/.test(raw)) {
    return null;
  }

  return Number(raw);
}

function boolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  const raw = text(value).toLowerCase();

  if (raw === "") {
    return fallback;
  }

  return raw === "true" || raw === "on" || raw === "1" || raw === "yes";
}

/** `HH:MM` from a time input, or null. Seconds are dropped — nothing needs them. */
function clockTime(value: unknown): string | null {
  const raw = text(value);

  if (raw === "") {
    return null;
  }

  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(raw);

  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours > 23 || minutes > 59) {
    return null;
  }

  return `${match[1]}:${match[2]}`;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date — `2026-02-31` is not one, however well formed it looks. */
export function isCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * Read a pass form.
 *
 * Returns the values *and* the errors, because the form is displayed either way: on
 * a refusal the organiser sees what they typed with the offending field marked.
 */
export function parsePassForm(
  input: unknown,
): { values: PassFormValues; errors: PassFormErrors } {
  const raw = (input ?? {}) as Record<string, unknown>;
  const id = text(raw.id) || null;

  const values: PassFormValues = {
    id: /^[0-9a-f-]{36}$/i.test(id ?? "") ? id : null,
    code: text(raw.code),
    name: text(raw.name),
    composition: text(raw.composition),
    description: text(raw.description),
    priceInr: integer(raw.priceInr) ?? Number.NaN,
    numberOfPeople: integer(raw.numberOfPeople) ?? Number.NaN,
    maxPerBooking: integer(raw.maxPerBooking) ?? Number.NaN,
    // A blank field means "no restriction" / "first in the list"; a field with
    // something unreadable in it ("eighteen", "18+") is a typo that must be shown
    // back rather than quietly becoming 0 — an age restriction that silently
    // disappears is worse than a form that asks again.
    minAge: integer(raw.minAge) ?? (text(raw.minAge) === "" ? 0 : Number.NaN),
    sortOrder: integer(raw.sortOrder) ?? (text(raw.sortOrder) === "" ? 0 : Number.NaN),
    isActive: boolean(raw.isActive, true),
  };

  const errors: PassFormErrors = {};

  if (values.name === "") {
    errors.name = "Give the pass a name guests will recognise.";
  } else if (values.name.length > PASS_LIMITS.nameMax) {
    errors.name = `Keep the name under ${PASS_LIMITS.nameMax} characters.`;
  }

  if (values.composition === "") {
    errors.composition = "Say who the pass admits, e.g. \"2 Girls\".";
  } else if (values.composition.length > PASS_LIMITS.compositionMax) {
    errors.composition = `Keep this under ${PASS_LIMITS.compositionMax} characters.`;
  }

  if (values.description.length > PASS_LIMITS.descriptionMax) {
    errors.description = `Keep the description under ${PASS_LIMITS.descriptionMax} characters.`;
  }

  if (values.code !== "" && !/^[A-Za-z0-9 _-]{2,24}$/.test(values.code)) {
    errors.code = "Use letters, numbers, spaces or dashes only (2–24 characters).";
  }

  if (!Number.isInteger(values.priceInr) || values.priceInr < PASS_LIMITS.priceMin) {
    errors.priceInr = "Enter a price in whole rupees — at least ₹1.";
  } else if (values.priceInr > PASS_LIMITS.priceMax) {
    errors.priceInr = `The most a pass can cost here is ₹${PASS_LIMITS.priceMax.toLocaleString("en-IN")}.`;
  }

  if (!Number.isInteger(values.numberOfPeople) || values.numberOfPeople < PASS_LIMITS.peopleMin) {
    errors.numberOfPeople = "A pass has to admit at least one person.";
  } else if (values.numberOfPeople > PASS_LIMITS.peopleMax) {
    errors.numberOfPeople = `That is more than ${PASS_LIMITS.peopleMax} people for one pass.`;
  }

  if (
    !Number.isInteger(values.maxPerBooking) ||
    values.maxPerBooking < PASS_LIMITS.maxPerBookingMin
  ) {
    errors.maxPerBooking = "A guest must be able to buy at least one.";
  } else if (values.maxPerBooking > PASS_LIMITS.maxPerBookingMax) {
    errors.maxPerBooking = `The most per booking is ${PASS_LIMITS.maxPerBookingMax}.`;
  }

  if (
    !Number.isInteger(values.minAge) ||
    values.minAge < PASS_LIMITS.minAgeMin ||
    values.minAge > PASS_LIMITS.minAgeMax
  ) {
    errors.minAge = "Enter an age between 0 and 120 — 0 means no restriction.";
  }

  if (
    !Number.isInteger(values.sortOrder) ||
    values.sortOrder < 0 ||
    values.sortOrder > PASS_LIMITS.sortOrderMax
  ) {
    errors.sortOrder = `Order is a whole number from 0 to ${PASS_LIMITS.sortOrderMax}.`;
  }

  return { values, errors };
}

/** The same, for a night. */
export function parseNightForm(
  input: unknown,
): { values: NightFormValues; errors: NightFormErrors } {
  const raw = (input ?? {}) as Record<string, unknown>;
  const id = text(raw.id);
  const status = text(raw.status);

  const values: NightFormValues = {
    id: /^[0-9a-f-]{36}$/i.test(id) ? id : null,
    date: text(raw.date),
    startTime: text(raw.startTime),
    endTime: text(raw.endTime),
    capacity: integer(raw.capacity) ?? Number.NaN,
    capacityHeld: integer(raw.capacityHeld) ?? 0,
    status: NIGHT_STATUS_OPTIONS.some((option) => option.value === status) ? status : "scheduled",
    bookingOpen: boolean(raw.bookingOpen, true),
    notes: text(raw.notes),
  };

  const errors: NightFormErrors = {};

  if (!isCalendarDate(values.date)) {
    errors.date = "Pick the date of the night.";
  }

  if (!Number.isInteger(values.capacity) || values.capacity < NIGHT_LIMITS.capacityMin) {
    errors.capacity = "Capacity is the seats this night has — at least 1.";
  } else if (values.capacity > NIGHT_LIMITS.capacityMax) {
    errors.capacity = `That is more than ${NIGHT_LIMITS.capacityMax.toLocaleString("en-IN")} seats.`;
  }

  if (
    !Number.isInteger(values.capacityHeld) ||
    values.capacityHeld < NIGHT_LIMITS.heldMin
  ) {
    errors.capacityHeld = "Seats held back cannot be negative.";
  } else if (Number.isInteger(values.capacity) && values.capacityHeld > values.capacity) {
    errors.capacityHeld = "You cannot hold back more seats than the night has.";
  }

  if (values.notes.length > NIGHT_LIMITS.notesMax) {
    errors.notes = `Keep the note under ${NIGHT_LIMITS.notesMax} characters.`;
  }

  const start = clockTime(values.startTime);
  const end = clockTime(values.endTime);

  if (values.startTime !== "" && start === null) {
    errors.startTime = "Use a time like 19:00.";
  }

  if (values.endTime !== "" && end === null) {
    errors.endTime = "Use a time like 23:30.";
  }

  if (start !== null && end !== null && end <= start) {
    errors.endTime = "The night has to end after it starts.";
  }

  return { values, errors };
}

/** True when a parse produced no field errors. */
export function isClean(errors: Record<string, string | undefined>): boolean {
  return Object.values(errors).every((message) => message === undefined);
}

/** The first field with a message, in the order the form reads. */
export function firstFieldError(
  errors: Record<string, string | undefined>,
): { field: string; message: string } | null {
  for (const [field, message] of Object.entries(errors)) {
    if (message) {
      return { field, message };
    }
  }

  return null;
}

// -----------------------------------------------------------------------------
// The database's refusals, in words
// -----------------------------------------------------------------------------

interface RefusalCopy {
  field: string;
  message: string;
  /** True when `detail` carries a floor the message should name. */
  floor?: boolean;
}

/**
 * Every code the two management migrations raise, and what it means to the person
 * who typed it.
 *
 * The codes are the database's; the sentences are the screen's. Keeping them
 * adjacent is the point: a rule added in SQL without a line here shows up as an
 * unexplained red box in the harness run, which is a bug report rather than a
 * silent gap.
 */
export const CATALOGUE_REFUSALS: Record<string, RefusalCopy> = {
  // --- nights -----------------------------------------------------------------
  PT001: { field: "capacity", message: "Capacity has to be at least 1 seat." },
  PT002: { field: "capacityHeld", message: "Seats held back cannot be negative." },
  PT003: { field: "capacityHeld", message: "You cannot hold back more seats than the night has." },
  PT004: {
    field: "capacity",
    message:
      "That is fewer seats than this night has already sold. Raise the capacity, or cancel the night.",
    floor: true,
  },
  PT005: {
    field: "date",
    message:
      "This night already has paid bookings, and their passes carry its date. Cancel those bookings before moving the night.",
  },
  PT006: { field: "date", message: "This event already has a night on that date." },
  PT007: { field: "date", message: "That night no longer exists — reload the page." },
  PT008: { field: "endTime", message: "The night has to end after it starts." },
  PT009: { field: "date", message: "Pick the date of the night." },
  PT010: { field: "status", message: "Pick one of the four night states." },
  PT011: { field: "notes", message: "That note is too long." },

  // --- passes -----------------------------------------------------------------
  PC001: { field: "name", message: "Give the pass a name guests will recognise." },
  PC002: {
    field: "code",
    message: "The code is 2–24 letters, numbers or dashes — it is the short name the ticket desk uses.",
  },
  PC003: { field: "code", message: "This event already has a pass with that code." },
  PC004: { field: "priceInr", message: "Enter a price in whole rupees — at least ₹1." },
  PC005: { field: "numberOfPeople", message: "A pass has to admit at least one person." },
  PC006: { field: "maxPerBooking", message: "A guest must be able to buy at least one." },
  PC007: { field: "minAge", message: "Enter an age between 0 and 120 — 0 means no restriction." },
  PC008: { field: "name", message: "That pass no longer exists — reload the page." },
  PC009: { field: "composition", message: "Say who the pass admits, e.g. \"2 Girls\"." },
  PC010: { field: "name", message: "There is no event to attach a pass to yet." },
  PC011: { field: "sortOrder", message: "Order is a whole number from 0 to 9999." },

  // --- gallery ------------------------------------------------------------------
  PG001: {
    field: "altText",
    message: "Describe the picture in words — guests who cannot see it read this, so it is required.",
  },
  PG002: { field: "title", message: "That title is too long for the gallery." },
  PG003: { field: "description", message: "That description is too long — keep it to a short caption." },
  PG004: { field: "album", message: "That album name is too long." },
  PG005: {
    field: "image",
    message: "That file could not be stored — upload it again from the gallery screen.",
  },
  PG006: { field: "id", message: "That photo is no longer in the gallery — reload the page." },
  PG007: { field: "sortOrder", message: "Order is a whole number from 0 to 9999." },
  PG008: { field: "status", message: "Pick one of the three states: draft, published or archived." },
  PG009: {
    field: "image",
    message: "That image is too small to use. Upload one at least 400 pixels on its short edge.",
  },
  PG010: { field: "image", message: "That file is too big. Images have to be 8 MB or smaller." },
  PG011: { field: "image", message: "That image is already in the gallery — reload the page to see it." },
};

/**
 * Turn a database error into something the form can use.
 *
 * `shape` is what a PostgREST error looks like from the client; a code we do not
 * recognise is reported as a general failure rather than guessed at, so a rule
 * added later fails loudly in a log instead of silently blaming a field.
 */
export function refusalFromDatabase(error: {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}): CatalogueError {
  const code = error.code ?? "";
  const copy = CATALOGUE_REFUSALS[code];

  if (!copy) {
    return {
      kind: "server-error",
      message: "That change could not be saved. Nothing was written — please try again.",
      code: code || undefined,
    };
  }

  const floorValue = copy.floor ? Number(error.details ?? "") : Number.NaN;

  return {
    kind: "refused",
    code,
    field: copy.field,
    message:
      copy.floor && Number.isFinite(floorValue) && floorValue > 0
        ? `${copy.message} At least ${floorValue} seats, counting the ones already paid for.`
        : copy.message,
    floor: Number.isFinite(floorValue) ? floorValue : undefined,
  };
}

// -----------------------------------------------------------------------------
// What the screens say about a night
// -----------------------------------------------------------------------------

/**
 * A night's state in one phrase, for the status column.
 *
 * Reads the same facts the public site does — status, capacity, seats held, seats
 * sold — so the desk and the website never describe the same night differently.
 */
export function nightState(night: Pick<AdminNight, "status" | "bookingOpen" | "isFull" | "overCommitted">): string {
  if (night.status === "cancelled") {
    return "Cancelled";
  }

  if (night.overCommitted) {
    return "Over-committed";
  }

  if (night.status === "completed") {
    return "Finished";
  }

  if (night.isFull) {
    return night.bookingOpen ? "Full" : "Full · booking closed";
  }

  if (!night.bookingOpen) {
    return "Booking closed";
  }

  if (night.status === "sold_out") {
    return "Sold out";
  }

  return "On sale";
}

/** How much of a night is gone, for the capacity bar. Never negative, never over 100. */
export function capacityPercent(night: Pick<AdminNight, "capacity" | "bookedPeople">): number {
  if (night.capacity <= 0) {
    return 0;
  }

  return Math.min(100, Math.max(0, Math.round((night.bookedPeople / night.capacity) * 100)));
}

/** `82 of 1,000 seats left` — and what was held back, when anything was. */
export function capacityCopy(night: AdminNight): string {
  const seats = `${night.seatsAvailable.toLocaleString("en-IN")} of ${night.capacity.toLocaleString("en-IN")} seats left`;

  return night.capacityHeld > 0 ? `${seats} · ${night.capacityHeld.toLocaleString("en-IN")} held back` : seats;
}

/** `18+` / `All ages` for a pass's age restriction. */
export function ageRestrictionCopy(minAge: number): string {
  return minAge > 0 ? `${minAge}+` : "All ages";
}

/** The cheapest / dearest / how many-on-sale line above the pass list. */
export function catalogueSummary(passes: readonly AdminPassType[]): string {
  const onSale = passes.filter((pass) => pass.isActive);
  const prices = onSale.map((pass) => pass.priceInr);

  if (passes.length === 0) {
    return "No pass types yet.";
  }

  if (onSale.length === 0) {
    return `All ${passes.length} pass types are off sale — the booking page will offer nothing.`;
  }

  const range =
    Math.min(...prices) === Math.max(...prices)
      ? `₹${Math.min(...prices)}`
      : `₹${Math.min(...prices)}–₹${Math.max(...prices)}`;

  const hidden = passes.length - onSale.length;

  return `${onSale.length} of ${passes.length} pass types on sale, ${range}${hidden > 0 ? `, ${hidden} off sale` : ""}.`;
}

/** `Sat, 17 Oct 2026` from a night's date, without pulling in the formatter. */
export function nightLabelRange(date: string, startTime: string | null, endTime: string | null): string {
  const time = startTime ? `${startTime.slice(0, 5)}${endTime ? `–${endTime.slice(0, 5)}` : ""}` : "";

  return time ? `${date} · ${time}` : date;
}
