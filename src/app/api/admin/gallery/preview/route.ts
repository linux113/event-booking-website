import { NextResponse } from "next/server";

import { catalogueError, forbidden, unauthorized } from "@/lib/admin/api";
import { can } from "@/lib/auth/permissions";
import { getStaffMember } from "@/lib/auth/staff";
import { readGalleryPreview } from "@/lib/services/gallery-admin";

/**
 * GET /api/admin/gallery/preview?id=<uuid>&variant=thumb|full
 *
 * The bytes of one photograph, for the staff screen.
 *
 * It exists because a draft lives in a private bucket: there is no public URL to put
 * in an `<img>`, and handing the browser a signed URL would put a working address for
 * an unpublished photograph into the page source. So the file comes through the staff
 * session instead, which is checked twice — by the request hook (`gallery:view`) and
 * again here. Only the `gallery:view` capability is needed: looking at a photograph
 * is not the same permission as publishing one.
 *
 * The response is never cached by a shared cache: a private photograph must not
 * survive anywhere after it is unpublished.
 */

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request): Promise<Response> {
  const staff = await getStaffMember();

  if (!staff) {
    return unauthorized();
  }

  if (!can(staff.role, "gallery:view")) {
    return forbidden("You cannot open the gallery.");
  }

  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";
  const variant = url.searchParams.get("variant") === "full" ? "full" : "thumb";

  if (!UUID.test(id)) {
    return catalogueError("invalid-input", "That photograph could not be identified.", { field: "file" });
  }

  const preview = await readGalleryPreview(id, variant);

  if (!preview.ok) {
    return catalogueError("refused", preview.error.message, { field: "file" });
  }

  return new NextResponse(new Uint8Array(preview.data.bytes), {
    headers: {
      "content-type": preview.data.contentType,
      "content-length": String(preview.data.bytes.byteLength),
      "cache-control": `private, max-age=${preview.data.maxAge}`,
    },
  });
}
