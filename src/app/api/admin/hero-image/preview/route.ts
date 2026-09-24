import { NextResponse } from "next/server";

import { forbidden, unauthorized } from "@/lib/admin/api";
import { HERO_IMAGE_CONTENT_TYPE } from "@/lib/admin/hero-image";
import { can } from "@/lib/auth/permissions";
import { getStaffMember } from "@/lib/auth/staff";
import { readAdminHeroImage } from "@/lib/services/hero-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Private preview so a draft event image is never exposed through the public route. */
export async function GET(request: Request): Promise<Response> {
  const staff = await getStaffMember();
  if (!staff) return unauthorized();
  if (!can(staff.role, "settings:view")) return forbidden("You cannot open event settings.");

  const eventId = new URL(request.url).searchParams.get("id") ?? "";
  if (!UUID.test(eventId)) {
    return new Response("Not found", { status: 404, headers: { "cache-control": "private, no-store" } });
  }

  const result = await readAdminHeroImage(eventId);
  if (!result.ok) {
    const status = result.error.kind === "not-found" ? 404 : result.error.kind === "not-configured" ? 503 : 500;
    return new Response(status === 404 ? "Not found" : "Hero image unavailable", {
      status,
      headers: { "cache-control": "private, no-store" },
    });
  }

  return new NextResponse(new Uint8Array(result.data.bytes), {
    headers: {
      "content-type": HERO_IMAGE_CONTENT_TYPE,
      "content-length": String(result.data.bytes.byteLength),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
