import type { NextResponse } from "next/server";

import { readScanBody, scanError, scanJson, scanServiceFailure, scanUnauthorized } from "@/lib/admin/http";
import { getStaffMember } from "@/lib/auth/staff";
import { can } from "@/lib/auth/permissions";
import { gateNight } from "@/lib/gate/night";
import { checkInPass } from "@/lib/services/check-in";
import type { ScanApiResponse } from "@/types/admin";

/**
 * POST /api/staff/check-in — admit the guest holding this pass.
 *
 * The same request shape as `/api/staff/scan`, the same staff check, and one
 * difference: this one can change a pass. It calls `check_in_pass()`, which locks
 * the pass row, re-checks every condition, compare-and-swaps
 * `checked_in = false and status = 'active'` and writes the `check_ins` row — all
 * in one transaction.
 *
 * That is what makes two phones scanning the same code safe: one of them updates a
 * row, the other is told the pass is already used. **This endpoint cannot be talked
 * into admitting anybody**: it passes a token and an identity, and the database
 * answers.
 */

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse<ScanApiResponse>> {
  const staff = await getStaffMember();

  if (!staff) {
    return scanUnauthorized();
  }

  if (!can(staff.role, "scanner:use")) {
    // 403, not 401: the session is perfectly good, this role simply cannot work the
    // gate. The request hook refuses this too — this is the second lock.
    return scanError("forbidden", "Your role cannot check passes in.");
  }

  const body = readScanBody(await request.text());

  if (!body.ok) {
    return body.response;
  }

  const result = await checkInPass({
    token: body.token,
    gateDate: gateNight(),
    staffUserId: staff.userId,
    gate: body.gate,
  });

  if (!result.ok) {
    return scanServiceFailure(result.error);
  }

  return scanJson({ ok: true, result: result.data }, 200);
}
