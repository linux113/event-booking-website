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
  isCleanEventBasicsSettings,
  isCleanEventContactSettings,
  isCleanSiteContentSettings,
  parseEventBasicsSettings,
  parseEventContactSettings,
  parseSiteContentSettings,
} from "@/lib/admin/event-settings";
import { can } from "@/lib/auth/permissions";
import { getStaffMember } from "@/lib/auth/staff";
import {
  saveEventBasicsSettings,
  saveEventContactSettings,
  saveEventSiteContentSettings,
} from "@/lib/services/admin";
import type { EventSettings } from "@/types/event-settings";
import type { CatalogueResult } from "@/types/catalogue";

/**
 * POST /api/admin/settings — save event settings sections.
 *
 * The admin session and settings capability are checked before reading the body.
 * Values are validated again on the server, then written to the selected event row
 * through the private Prisma/Neon connection. Actions: `save-contact` (the public
 * contact block), `save-basics` (name, tagline, description, venue) and
 * `save-content` (About Us copy, gallery heading, contact-page FAQs).
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

  const action = bodyString(read.body, "action", 20) || "save-contact";
  // An omitted action is accepted for the one-form endpoint's first version; the
  // explicit value keeps the API self-describing for the settings sections.
  if (action !== "save-contact" && action !== "save-basics" && action !== "save-content") {
    return catalogueError<EventSettings>("invalid-input", "Unknown settings action.");
  }

  const result = await save(action, read.body.settings);

  if (result.ok) {
    // Public copy is read by the root layout (header/footer) and by the static
    // event, about, gallery and contact pages. Revalidate the layout tree after
    // the DB write so saved values do not wait for the ISR window.
    revalidatePath("/", "layout");
  }

  return catalogueJson(result);
}

async function save(
  action: "save-contact" | "save-basics" | "save-content",
  body: unknown,
): Promise<CatalogueResult<EventSettings>> {
  if (action === "save-basics") {
    const parsed = parseEventBasicsSettings(body);
    if (!isCleanEventBasicsSettings(parsed.errors)) {
      return invalidInput(parsed.errors);
    }
    return saveEventBasicsSettings(parsed.values);
  }

  if (action === "save-content") {
    const parsed = parseSiteContentSettings(body);
    if (!isCleanSiteContentSettings(parsed.errors)) {
      return invalidInput(parsed.errors);
    }
    return saveEventSiteContentSettings(parsed.values);
  }

  const parsed = parseEventContactSettings(body);
  if (!isCleanEventContactSettings(parsed.errors)) {
    return invalidInput(parsed.errors);
  }
  return saveEventContactSettings(parsed.values);
}

function invalidInput(errors: Record<string, string | undefined>): CatalogueResult<EventSettings> {
  const [field] = Object.keys(errors) as (keyof typeof errors)[];
  return {
    ok: false,
    error: {
      kind: "invalid-input",
      message: (field ? errors[field] : null) ?? "Check the settings.",
      field: field ?? undefined,
    },
  };
}

/** A GET is not part of this endpoint: the settings are rendered by the page. */
export async function GET(): Promise<NextResponse> {
  const body: CatalogueResult<EventSettings> = {
    ok: false,
    error: { kind: "invalid-input", message: "Use POST to change event settings." },
  };
  return catalogueJson(body, 405);
}
