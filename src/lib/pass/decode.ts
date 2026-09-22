import jsQR from "jsqr";

/**
 * Reading a pass out of a camera frame.
 *
 * Pure and browser-safe (the decoder is a WASM-free JavaScript implementation, and
 * this module never touches the network). Two deliberate rules:
 *
 *   1. **Only our own QR codes count.** `tokenFromQrText` accepts a URL that this
 *      site produced — `<site>/verify/<64 hex characters>` — and nothing else. A QR
 *      code pointing at another domain, a text QR code, or a screenshot of a
 *      different event's code is not a pass, and the scanner says so instead of
 *      forwarding a stranger's link to the server.
 *   2. **The browser's answer is a hint, never a fact.** Whatever the camera reads
 *      is only a token; the server re-reads the pass from the database and decides.
 *      A tampered page cannot admit anybody.
 *
 * It deliberately imports nothing but the decoder. `src/lib/pass/links.ts` has the
 * same token shape for server code, but it also reads the site URL from `config/env`
 * — and a client bundle should not be dragging environment plumbing behind it.
 */

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/** True for the 64-lowercase-hex shape the database mints for `qr_token`. */
export function isPassToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

/**
 * The pass token inside a scanned QR payload, or null when the code is not one of
 * ours. Accepts the absolute verification URL (`https://…/verify/<token>`) that
 * `buildVerifyUrl` produces.
 */
export function tokenFromQrText(text: string | null | undefined): string | null {
  if (typeof text !== "string") {
    return null;
  }

  const trimmed = text.trim();

  if (trimmed === "") {
    return null;
  }

  const match = /\/verify\/([0-9a-f]{64})(?:$|[/?#])/.exec(trimmed);

  if (!match) {
    return null;
  }

  return TOKEN_PATTERN.test(match[1]) ? match[1] : null;
}

export interface DecodedFrame {
  /** RGBA pixels, as `ImageData` provides them. */
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Decodes one frame and returns the pass token, or null when the frame holds no
 * readable pass QR code. Called on every animation frame while the camera runs, so
 * "nothing found" is the normal case and must stay cheap.
 */
export function readTokenFromFrame({ data, width, height }: DecodedFrame): string | null {
  if (width <= 0 || height <= 0 || data.length < width * height * 4) {
    return null;
  }

  const found = jsQR(data, width, height, { inversionAttempts: "dontInvert" });

  return found ? tokenFromQrText(found.data) : null;
}
