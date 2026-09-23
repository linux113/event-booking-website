import type { NextResponse } from "next/server";

import { readScanBody, scanJson, scanServiceFailure, scanUnauthorized } from "@/lib/admin/http";
import { getStaffMember } from "@/lib/auth/staff";
import { gateNight } from "@/lib/gate/night";
import { scanPass } from "@/lib/services/check-in";
import type { ScanApiResponse } from "@/types/admin";

/**
 * POST /api/staff/scan — what does this scanned code mean?
 *
 * The body carries one thing the browser actually knows: the token it read from a
 * QR code. Everything else is decided here and in the database:
 *
 *   * **who** is asking — the HTTP-only `gn_admin` session cookie, verified with
 *     `admin_users`. No session, no staff row: 401, and no database call at all.
 *   * **which night** the gate is on — computed from the venue's timezone on the
 *     server (`gateNight()`), never sent by the phone.
 *   * **whether the pass counts** — `scan_pass()` in Postgres, in one transaction.
 *
 * Read-only: this endpoint cannot admit anybody. `POST /api/staff/check-in` does
 * that, and even that only asks the database to try.
 */

export const runtime = "nodejs";

// Never cached: the verdict is a property of this moment.
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse<ScanApiResponse>> {
  const staff = await getStaffMember();

  if (!staff) {
    return scanUnauthorized();
  }


  const body = readScanBody(await request.text());

  if (!body.ok) {
    return body.response;
  }

  const result = await scanPass({
    token: body.token,
    gateDate: gateNight(),
    staffUserId: null,
  });

  if (!result.ok) {
    return scanServiceFailure(result.error);
  }

  return scanJson({ ok: true, result: result.data }, 200);
}
