import type { BookingFieldErrors, BookingRequestInput } from "@/types/booking";

/**
 * Booking validation, shared by the browser and the server.
 *
 * The wizard uses these functions to give instant feedback; the API route runs
 * the same rules again on the payload it actually received. Anything that needs
 * the database (the pass category's price, its `max_per_booking`, how many people
 * it admits, remaining capacity) is *not* decided here — `create_pending_booking`
 * re-checks all of it in Postgres.
 */

/** Indian mobile numbers: 10 digits starting 6-9, once the country code is stripped. */
export const MOBILE_PATTERN = /^[6-9]\d{9}$/;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const NAME_MAX = 80;
const EMAIL_MAX = 120;
const IDEMPOTENCY_KEY_MAX = 80;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateName(raw: string): string | null {
  const value = raw.trim();

  if (value.length === 0) {
    return "Enter the full name of the lead guest.";
  }

  if (value.length < 2) {
    return "That name looks too short.";
  }

  if (value.length > NAME_MAX) {
    return `Please keep the name under ${NAME_MAX} characters.`;
  }

  if (!/\p{L}/u.test(value)) {
    return "Enter a name with at least one letter.";
  }

  return null;
}

const REFERRED_BY_MAX = 80;

export function validateReferredBy(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (value.length === 0) return null;

  if (value.length > REFERRED_BY_MAX) {
    return `Please keep the referral name under ${REFERRED_BY_MAX} characters.`;
  }

  return null;
}

/**
 * Normalise an Indian mobile number to `+91XXXXXXXXXX`, or return null when it is
 * not a valid 10-digit mobile. Accepts spaces, dashes, brackets, a `+91`, `91` or
 * leading `0`, so copy-pasted numbers work.
 */
export function normaliseMobile(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, "").replace(/^0+/, "");

  const national =
    digits.length === 12 && digits.startsWith("91")
      ? digits.slice(2)
      : digits.length === 11 && digits.startsWith("91")
        ? digits.slice(2)
        : digits;

  if (!MOBILE_PATTERN.test(national)) {
    return null;
  }

  return `+91${national}`;
}

export function validateMobile(raw: string): string | null {
  if (raw.trim().length === 0) {
    return "Enter a mobile number so the organiser can reach you.";
  }

  if (normaliseMobile(raw) === null) {
    return "Enter a 10-digit Indian mobile number, e.g. 98123 45678.";
  }

  return null;
}

export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateEmail(raw: string): string | null {
  const value = normaliseEmail(raw);

  if (value.length === 0) {
    return "Enter an email address for the booking confirmation.";
  }

  if (value.length > EMAIL_MAX) {
    return `Please keep the email under ${EMAIL_MAX} characters.`;
  }

  if (!EMAIL_PATTERN.test(value)) {
    return "Enter a valid email address, e.g. name@example.com.";
  }

  return null;
}

/** A positive whole number, or null when the text is not one. */
export function parsePositiveInteger(raw: string | number): number | null {
  const value = typeof raw === "number" ? raw : Number(raw.trim());

  if (!Number.isInteger(value) || value < 1) {
    return null;
  }

  return value;
}

/**
 * Quantity: positive integer, and never more than the pass category allows.
 * `maxPerBooking` comes from the database.
 */
export function validateQuantity(raw: string | number, maxPerBooking: number): string | null {
  const value = parsePositiveInteger(raw);

  if (value === null) {
    return "Enter how many passes you want as a whole number (1 or more).";
  }

  if (value > maxPerBooking) {
    return `This pass can be booked up to ${maxPerBooking} at a time. Need more? Message the organiser on WhatsApp.`;
  }

  return null;
}

/**
 * Number of people: positive integer that matches the pass composition —
 * `quantity x people per pass`, because a pass admits a fixed group.
 */
export function validatePeople(
  raw: string | number,
  quantity: number | null,
  peoplePerPass: number,
): string | null {
  const value = parsePositiveInteger(raw);

  if (value === null) {
    return "Enter how many people are attending as a whole number.";
  }

  if (quantity !== null && value !== quantity * peoplePerPass) {
    return `This pass admits ${peoplePerPass} ${peoplePerPass === 1 ? "person" : "people"} each, so ${quantity} ${quantity === 1 ? "pass" : "passes"} must cover ${quantity * peoplePerPass} people.`;
  }

  return null;
}

export type BookingValidationResult =
  | { ok: true; value: BookingRequestInput }
  | {
      ok: false;
      fieldErrors: BookingFieldErrors;
      /** Set when the whole request is unusable (no field to point at). */
      message?: string;
    };

/**
 * Server-side validation of a raw request body.
 *
 * Returns the *normalised* input (trimmed name, `+91` mobile, lower-case email,
 * integer quantity) so the caller never has to sanitise again. Customer email is not collected. Unknown fields —
 * including any price a client might try to inject — are dropped.
 */
export function validateBookingRequest(payload: unknown): BookingValidationResult {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return { ok: false, fieldErrors: {}, message: "Send the booking details as a JSON object." };
  }

  const input = payload as Record<string, unknown>;
  const fieldErrors: BookingFieldErrors = {};

  const eventId = asId(input.eventId);
  const eventDateId = asId(input.eventDateId);
  const passCategoryId = asId(input.passCategoryId);

  if (!eventId) {
    fieldErrors.eventDateId = "Choose a night to book.";
  }

  if (!eventDateId) {
    fieldErrors.eventDateId = "Choose a night to book.";
  }

  if (!passCategoryId) {
    fieldErrors.passCategoryId = "Choose a pass.";
  }

  const customerName = typeof input.customerName === "string" ? input.customerName.trim() : "";
  const nameError = validateName(customerName);

  if (nameError) {
    fieldErrors.customerName = nameError;
  }

  const mobileRaw = typeof input.customerMobile === "string" ? input.customerMobile : "";
  const mobileError = validateMobile(mobileRaw);
  const customerMobile = normaliseMobile(mobileRaw);

  if (mobileError) {
    fieldErrors.customerMobile = mobileError;
  }

  const quantity = parsePositiveInteger(
    typeof input.quantity === "number" || typeof input.quantity === "string" ? input.quantity : "",
  );

  if (quantity === null) {
    fieldErrors.quantity = "Enter how many passes you want as a whole number (1 or more).";
  }

  const numberOfPeople = parsePositiveInteger(
    typeof input.numberOfPeople === "number" || typeof input.numberOfPeople === "string"
      ? input.numberOfPeople
      : "",
  );

  if (numberOfPeople === null) {
    fieldErrors.numberOfPeople = "Enter how many people are attending as a whole number.";
  }

  const referredByRaw = typeof input.referredBy === "string" ? input.referredBy : "";
  const referredByError = validateReferredBy(referredByRaw);
  if (referredByError) {
    fieldErrors.referredBy = referredByError;
  }
  const referredBy = referredByRaw.trim() || null;

  const idempotencyKey =
    typeof input.idempotencyKey === "string" ? input.idempotencyKey.trim() : "";

  // A missing key would let a double submit create two bookings, so the request is
  // rejected rather than silently accepted. It is not a form field, so the failure
  // is reported for the request as a whole.
  const keyUsable = idempotencyKey.length > 0 && idempotencyKey.length <= IDEMPOTENCY_KEY_MAX;

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  if (!keyUsable) {
    return {
      ok: false,
      fieldErrors: {},
      message: "This booking attempt expired. Please reload the page and try again.",
    };
  }

  return {
    ok: true,
    value: {
      eventId: eventId as string,
      eventDateId: eventDateId as string,
      passCategoryId: passCategoryId as string,
      customerName,
      customerMobile: customerMobile as string,
      quantity: quantity as number,
      numberOfPeople: numberOfPeople as number,
      idempotencyKey,
      referredBy,
    },
  };
}

function asId(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value.trim()) ? value.trim() : null;
}
