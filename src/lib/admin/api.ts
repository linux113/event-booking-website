import type { NextResponse } from "next/server";

import { noStoreJson } from "@/lib/booking/http";
import type { CatalogueError, CatalogueResult } from "@/types/catalogue";

/**
 * The HTTP contract for the two management endpoints.
 *
 * They answer JSON and, unlike the pages, they never redirect: a form that has been
 * submitted wants to know what happened to it, not to be sent somewhere.
 *
 *   400 invalid-input     the payload failed validation, or was not JSON
 *   401 not-authorized    no admin session
 *   403 forbidden         the session is fine; this action is not allowed
 *   409 refused           the database refused the change (a rule, not a bug)
 *   503 not-configured    the deployment has no database credentials
 *   500 server-error      anything unexpected
 *
 * The 409/400 split matters to the UI: a 409 carries the field to highlight and the
 * sentence to show, while a 400 means the payload was not a form at all.
 */

const STATUS_BY_KIND: Record<CatalogueError["kind"], number> = {
  "invalid-input": 400,
  "not-authorized": 401,
  forbidden: 403,
  "not-configured": 503,
  refused: 409,
  "server-error": 500,
};

export function catalogueJson<T>(body: CatalogueResult<T>, status?: number): NextResponse {
  return noStoreJson(body, status ?? (body.ok ? 200 : STATUS_BY_KIND[body.error.kind]));
}

export function catalogueError<T>(
  kind: CatalogueError["kind"],
  message: string,
  extra: Partial<CatalogueError> = {},
): NextResponse {
  return catalogueJson<T>({ ok: false, error: { kind, message, ...extra } });
}

/** The two failures every management endpoint shares. */
export function unauthorized<T>(): NextResponse {
  return catalogueError<T>("not-authorized", "Sign in as the event admin to change this.");
}

export function forbidden<T>(message: string): NextResponse {
  return catalogueError<T>("forbidden", message);
}

/**
 * Read a JSON body, with a size ceiling.
 *
 * The forms these endpoints accept are a few hundred bytes; anything larger is not
 * a form. Reading with a limit means a browser cannot make the server parse a novel.
 */
export async function readCatalogueBody(
  request: Request,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: NextResponse }> {
  const raw = await request.text();

  if (new TextEncoder().encode(raw).length > 8192) {
    return {
      ok: false,
      response: catalogueError("invalid-input", "That request was too large to be a form."),
    };
  }

  let payload: unknown;

  try {
    payload = JSON.parse(raw);
  } catch {
    return { ok: false, response: catalogueError("invalid-input", "Send the form as JSON.") };
  }

  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return { ok: false, response: catalogueError("invalid-input", "Send the form as JSON.") };
  }

  return { ok: true, body: payload as Record<string, unknown> };
}

/** A string field from a payload, trimmed and length-capped. */
export function bodyString(body: Record<string, unknown>, key: string, max = 200): string {
  const value = body[key];

  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** A boolean field, with an explicit fallback. */
export function bodyBoolean(body: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = body[key];

  if (typeof value === "boolean") {
    return value;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return fallback;
}
