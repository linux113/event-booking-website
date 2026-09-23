import type { NextResponse } from "next/server";

import {
  bodyBoolean,
  bodyString,
  catalogueError,
  catalogueJson,
  forbidden,
  readCatalogueBody,
  unauthorized,
} from "@/lib/admin/api";
import { firstFieldError, isClean, parsePassForm } from "@/lib/admin/catalogue";
import { can } from "@/lib/auth/permissions";
import { getStaffMember } from "@/lib/auth/staff";
import { savePassType, setPassActive } from "@/lib/services/admin-catalogue";
import type { AdminPassType, CatalogueResult } from "@/types/catalogue";

/**
 * POST /api/admin/passes — create a pass type, edit one, or take one off sale.
 *
 * One endpoint with an `action`, because all three are the same form's worth of
 * intent and they share every check: a staff session, the `passes:edit` capability,
 * a JSON body, and a database function that validates on the way in.
 *
 * The order of the checks is deliberate. Identity first (401/403, before the body is
 * read), then shape (400), then the database's own rules (409 with the field and the
 * sentence to show). A form that is merely mistyped never reaches SQL, and a form
 * that passes this file's checks is still refused by SQL if a rule here does not
 * know about — which is the point of having both.
 */

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const staff = await getStaffMember();

  if (!staff) {
    return unauthorized<AdminPassType>();
  }

  if (!can(staff.role, "passes:edit")) {
    return forbidden<AdminPassType>("Your role can see the pass list but cannot change it.");
  }

  const read = await readCatalogueBody(request);

  if (!read.ok) {
    return read.response;
  }

  const action = bodyString(read.body, "action", 20);

  // ---- create / edit ---------------------------------------------------------
  if (action === "save") {
    const { values, errors } = parsePassForm(read.body.pass);

    if (!isClean(errors)) {
      const first = firstFieldError(errors);

      return catalogueError<AdminPassType>("invalid-input", first?.message ?? "Check the form.", {
        field: first?.field,
      });
    }

    const result = await savePassType({
      id: values.id,
      code: values.code,
      name: values.name,
      composition: values.composition,
      description: values.description,
      priceInr: values.priceInr,
      numberOfPeople: values.numberOfPeople,
      maxPerBooking: values.maxPerBooking,
      minAge: values.minAge,
      sortOrder: values.sortOrder,
      isActive: values.isActive,
    });

    return catalogueJson(result);
  }

  // ---- enable / disable ------------------------------------------------------
  if (action === "toggle") {
    const id = bodyString(read.body, "id", 36);

    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return catalogueError<AdminPassType>("invalid-input", "That pass could not be identified.", {
        field: "name",
      });
    }

    const isActive = bodyBoolean(read.body, "isActive", true);
    const result = await setPassActive(id, isActive);

    return catalogueJson<{ id: string; isActive: boolean }>(result);
  }

  return catalogueError<AdminPassType>("invalid-input", "Unknown action.", { field: "name" });
}

/** A GET is not part of this endpoint: the catalogue is rendered by the page. */
export async function GET(): Promise<NextResponse> {
  const body: CatalogueResult<AdminPassType[]> = {
    ok: false,
    error: { kind: "invalid-input", message: "Use POST to change a pass type." },
  };

  return catalogueJson(body, 405);
}
