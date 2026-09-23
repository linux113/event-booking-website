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
import { firstFieldError, isClean, parseNightForm } from "@/lib/admin/catalogue";
import { can } from "@/lib/auth/permissions";
import { getStaffMember } from "@/lib/auth/staff";
import { saveNight, setNightBookingOpen, setNightCapacity } from "@/lib/services/admin-catalogue";
import type { AdminNight, CatalogueResult } from "@/types/catalogue";

/**
 * POST /api/admin/dates — add a night, edit one, set its capacity, or open/close it.
 *
 * The same three layers as the pass endpoint: session, capability, then the
 * database's own rules. `capacity` and `booking` are separate actions from `save`
 * because they are the two controls an organiser reaches for *during* an event, from
 * a phone, and neither should be able to carry a whole form's worth of changes with
 * it — a capacity change cannot silently rewrite the date, and closing booking
 * cannot quietly alter the price of a seat.
 */

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const staff = await getStaffMember();

  if (!staff) {
    return unauthorized<AdminNight>();
  }

  if (!can(staff.role, "dates:edit")) {
    return forbidden<AdminNight>("Your role can see the nights but cannot change them.");
  }

  const read = await readCatalogueBody(request);

  if (!read.ok) {
    return read.response;
  }

  const action = bodyString(read.body, "action", 20);

  // ---- add / edit a night ----------------------------------------------------
  if (action === "save") {
    const { values, errors } = parseNightForm(read.body.night);

    if (!isClean(errors)) {
      const first = firstFieldError(errors);

      return catalogueError<AdminNight>("invalid-input", first?.message ?? "Check the form.", {
        field: first?.field,
      });
    }

    const result = await saveNight({
      id: values.id,
      date: values.date,
      startTime: values.startTime === "" ? null : values.startTime,
      endTime: values.endTime === "" ? null : values.endTime,
      capacity: values.capacity,
      capacityHeld: values.capacityHeld,
      status: values.status,
      bookingOpen: values.bookingOpen,
      notes: values.notes,
    });

    return catalogueJson(result);
  }

  // ---- capacity --------------------------------------------------------------
  if (action === "capacity") {
    const id = bodyString(read.body, "id", 36);

    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return catalogueError<AdminNight>("invalid-input", "That night could not be identified.", {
        field: "capacity",
      });
    }

    const capacity = Number(read.body.capacity);
    const held = read.body.capacityHeld === null || read.body.capacityHeld === undefined
      ? null
      : Number(read.body.capacityHeld);

    if (!Number.isInteger(capacity) || capacity < 1) {
      return catalogueError<AdminNight>("invalid-input", "Capacity has to be at least 1 seat.", {
        field: "capacity",
        code: "PT001",
      });
    }

    if (held !== null && (!Number.isInteger(held) || held < 0)) {
      return catalogueError<AdminNight>("invalid-input", "Seats held back cannot be negative.", {
        field: "capacityHeld",
        code: "PT002",
      });
    }

    const result = await setNightCapacity(id, capacity, held);

    return catalogueJson(result);
  }

  // ---- open / close booking --------------------------------------------------
  if (action === "booking") {
    const id = bodyString(read.body, "id", 36);

    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return catalogueError<AdminNight>("invalid-input", "That night could not be identified.", {
        field: "date",
      });
    }

    const result = await setNightBookingOpen(id, bodyBoolean(read.body, "bookingOpen", true));

    return catalogueJson(result);
  }

  return catalogueError<AdminNight>("invalid-input", "Unknown action.", { field: "date" });
}

/** A GET is not part of this endpoint: the nights are rendered by the page. */
export async function GET(): Promise<NextResponse> {
  const body: CatalogueResult<AdminNight[]> = {
    ok: false,
    error: { kind: "invalid-input", message: "Use POST to change a night." },
  };

  return catalogueJson(body, 405);
}
