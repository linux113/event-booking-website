import type { NextResponse } from "next/server";

import { noStoreJson } from "@/lib/booking/http";
import type { ScanApiError, ScanApiResponse } from "@/types/admin";

/**
 * The HTTP contract for the gate endpoints.
 *
 * The status codes are chosen so the scanner can tell apart "you are not staff"
 * from "the gate is broken" without parsing prose:
 *
 *   400 invalid-input     the body was not JSON, or carried no token
 *   401 not-authorized    no staff session (or the account is no longer staff)
 *   413 —                 a payload that cannot be a scanned code
 *   503 not-configured    the deployment has no database credentials
 *   500 server-error      anything unexpected
 *
 * Nothing here decides whether a pass is good: the verdict comes from the database
 * and is passed through untouched.
 */

const STATUS_BY_KIND: Record<ScanApiError["kind"], number> = {
  "invalid-input": 400,
  "not-authorized": 401,
  "not-configured": 503,
  "server-error": 500,
};

export function scanJson(body: ScanApiResponse, status: number): NextResponse<ScanApiResponse> {
  return noStoreJson<ScanApiResponse>(body, status);
}

export function scanError(kind: ScanApiError["kind"], message: string): NextResponse<ScanApiResponse> {
  return scanJson({ ok: false, error: { kind, message } }, STATUS_BY_KIND[kind]);
}

/**
 * A service failure (no database, or a failed query) as a response.
 *
 * `not-found` never happens for a scan — a pass that does not exist is a verdict
 * ("invalid"), not an error — so it is folded into the server-error branch.
 */
export function scanServiceFailure(error: { kind: string; message: string }): NextResponse<ScanApiResponse> {
  if (error.kind === "not-configured") {
    return scanError("not-configured", error.message);
  }

  return scanError("server-error", error.message);
}

/** 401: the caller has no staff session. */
export function scanUnauthorized(): NextResponse<ScanApiResponse> {
  return scanError("not-authorized", "Sign in as event staff to scan passes.");
}

/**
 * Reads the (very small) JSON body these routes accept.
 *
 * Returns the trimmed `token`, plus the optional gate label, or an error response
 * the caller can return as-is.
 */
export function readScanBody(
  raw: string,
): { ok: true; token: string; gate: string | null } | { ok: false; response: NextResponse<ScanApiResponse> } {
  if (new TextEncoder().encode(raw).length > 512) {
    return {
      ok: false,
      response: scanJson(
        { ok: false, error: { kind: "invalid-input", message: "That request was too large to be a scanned code." } },
        413,
      ),
    };
  }

  let payload: unknown;

  try {
    payload = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      response: scanError("invalid-input", "Send the scanned code as JSON."),
    };
  }

  if (typeof payload !== "object" || payload === null) {
    return { ok: false, response: scanError("invalid-input", "Send the scanned code as JSON.") };
  }

  const { token, gate } = payload as { token?: unknown; gate?: unknown };

  if (typeof token !== "string" || token.trim() === "") {
    return { ok: false, response: scanError("invalid-input", "No code was scanned.") };
  }

  return {
    ok: true,
    // The token is never validated for shape here: a malformed code is a verdict
    // the scanner must show, not a request error.
    token: token.trim().slice(0, 512),
    gate: typeof gate === "string" ? gate.trim().slice(0, 40) || null : null,
  };
}
