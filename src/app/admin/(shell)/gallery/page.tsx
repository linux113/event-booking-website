import type { Metadata } from "next";

import { GalleryPanel } from "@/components/admin/gallery-panel";
import { ErrorState } from "@/components/ui/error-state";
import { requirePermission } from "@/lib/auth/guard";
import { can } from "@/lib/auth/permissions";
import { listGalleryItems } from "@/lib/services/gallery-admin";

export const metadata: Metadata = {
  title: "Gallery",
  description: "Upload, describe, order and publish the photos on the public gallery.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Gallery management — the screen behind the public gallery page.
 *
 * What it is responsible for, in one line: **the public gallery shows published rows
 * and nothing else.** An upload arrives as a draft in a private bucket, the
 * description that makes it accessible is written here, the running order is decided
 * here, and only then is it published — at which point the file is moved into the
 * public bucket. Disabling a photo reverses all of it.
 *
 * Two things this page deliberately does *not* do:
 *
 *   * It never deletes a row on its own — deletion is asked for, per photo, with a
 *     second click, and it removes the stored files too.
 *   * It never hands the browser a public URL for a draft. The thumbnails come through
 *     `/api/admin/gallery/preview`, which is a staff-only route, because a draft's
 *     object is not publicly reachable and a signed URL would be a working address for
 *     an unpublished photograph.
 *
 * Guarded by `gallery:view`; only a role with `gallery:edit` (admin and super admin)
 * is offered the controls.
 */
export default async function AdminGalleryPage() {
  const staff = await requirePermission("gallery:view");
  const result = await listGalleryItems();

  if (!result.ok) {
    return (
      <ErrorState
        error={{
          kind: result.error.kind === "not-configured" ? "not-configured" : "query-failed",
          message: result.error.message,
        }}
        title="The gallery is unavailable"
      />
    );
  }

  const canEdit = can(staff.role, "gallery:edit");

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Gallery</h1>
        <p className="text-muted text-sm/6">
          The photos on the public gallery, in the order they appear. Uploads are resized and converted to WebP, and
          every photo starts as a draft in private storage — publishing is what puts it on the site and moves the file
          to public storage.
          {canEdit ? "" : " Your role can see this but not change it."}
        </p>
      </div>

      <GalleryPanel items={result.data} canEdit={canEdit} />
    </>
  );
}
