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
 * Drafts are excluded from the public gallery query, and their Blob URLs are not
 * returned by the admin list. The project uses one public Blob store, so treat those
 * unlisted URLs as non-sensitive rather than as access-controlled secrets. This route
 * streams preview bytes through the staff session, checked by both the request hook
 * (`gallery:view`) and this handler. Looking at a photograph is not the same permission
 * as publishing one.
 *
 * The response is private and short-lived so an authenticated preview is not retained
 * by a shared cache after the row is unpublished or deleted.
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
