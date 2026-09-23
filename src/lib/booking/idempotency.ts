/**
 * Per-attempt booking key.
 *
 * Sent with the booking request and stored on the row (unique index), so a
 * double click, a retry after a timeout or two open tabs can never create two
 * bookings: the second request gets the booking the first one created.
 *
 * Generated in the browser because it must stay the same for one attempt and
 * change for the next booking.
 */
export function createIdempotencyKey(): string {
  const webCrypto = typeof globalThis.crypto === "undefined" ? undefined : globalThis.crypto;

  if (webCrypto && typeof webCrypto.randomUUID === "function") {
    return webCrypto.randomUUID();
  }

  if (webCrypto && typeof webCrypto.getRandomValues === "function") {
    const bytes = webCrypto.getRandomValues(new Uint8Array(16));

    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  // Last resort (very old browser): still unique enough for one checkout attempt.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
