import { revalidatePath } from "next/cache";
import type { NextResponse } from "next/server";

import {
  bodyString,
  catalogueError,
  catalogueJson,
  forbidden,
  readCatalogueBody,
  unauthorized,
} from "@/lib/admin/api";
import {
  isCleanEventContactSettings,
  parseEventContactSettings,
} from "@/lib/admin/event-settings";
import { can } from "@/lib/auth/permissions";
import { getStaffMember } from "@/lib/auth/staff";
import { saveEventContactSettings } from "@/lib/services/admin";
import type { EventSettings } from "@/types/event-settings";
import type { CatalogueResult } from "@/types/catalogue";

/**
 * POST /api/admin/settings — save the public contact and venue columns.
 *
 * The admin session and settings capability are checked before reading the body.
 * Values are validated again on the server, then written to the selected event row
 * through the private Prisma/Neon connection.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const staff = await getStaffMember();

  if (!staff) {
    return unauthorized<EventSettings>();
  }

  if (!can(staff.role, "settings:edit")) {
    return forbidden<EventSettings>("Your role can view event settings but cannot change them.");
  }

  const read = await readCatalogueBody(request);
  if (!read.ok) return read.response;

  const action = bodyString(read.body, "action", 20);
  // An omitted action is accepted for the one-form endpoint's first version; the
  // explicit value keeps the API self-describing for future settings sections.
  if (action && action !== "save-contact") {
    return catalogueError<EventSettings>("invalid-input", "Unknown settings action.");
  }

  const parsed = parseEventContactSettings(read.body.settings);
  if (!isCleanEventContactSettings(parsed.errors)) {
    const [field] = Object.keys(parsed.errors) as (keyof typeof parsed.errors)[];
    return catalogueError<EventSettings>(
      "invalid-input",
      field ? parsed.errors[field] ?? "Check the settings." : "Check the settings.",
      { field },
    );
  }

  const result = await saveEventContactSettings(parsed.values);

  if (result.ok) {
    // Public contact details are read by the root layout (header/footer) and by the
    // static contact and event pages. Revalidate the layout tree after the DB write so
    // saved values do not wait for the ISR window or a new deployment.
    revalidatePath("/", "layout");
  }

  return catalogueJson(result);
}

/** A GET is not part of this endpoint: the settings are rendered by the page. */
export async function GET(): Promise<NextResponse> {
  const body: CatalogueResult<EventSettings> = {
    ok: false,
    error: { kind: "invalid-input", message: "Use POST to change event settings." },
  };
  return catalogueJson(body, 405);
}
