import { siteUrl } from "@/config/env";

/**
 * Where a QR code points.
 *
 * The code contains exactly one thing: an absolute verification URL whose path is
 * the pass's 64-character random token. No booking reference, no pass id, no name,
 * no mobile number — so a scanned code cannot leak anything a passer-by could not
 * already read off the ticket, and a screenshot of one pass cannot be turned into
 * a link to another.
 *
 * The URL must be absolute: the code is printed and scanned by a phone camera that
 * has no idea which site it came from.
 */

export function buildVerifyUrl(qrToken: string): string {
  return `${siteUrl}/verify/${qrToken}`;
}

/** The customer-facing pass page for a token (root-relative, for `<Link>`s). */
export function buildPassPath(passId: string, qrToken: string): string {
  return `/pass/${encodeURIComponent(passId)}?t=${encodeURIComponent(qrToken)}`;
}

/** True for a well-formed token: 64 hex characters, the shape the database mints. */
export function isQrToken(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
