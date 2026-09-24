import type { Metadata } from "next";

import { GalleryPanel } from "@/components/admin/gallery-panel";
import { ErrorState } from "@/components/ui/error-state";
import { isBlobConfigured } from "@/config/env";
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
 * Gallery management — the public page shows published rows and nothing else.
 * Uploads arrive as drafts in the connected Blob store. Publishing flips the row's
 * status; the public URL is exposed only while the row is published.
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
  const storageConfigured = isBlobConfigured();

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Gallery</h1>
        <p className="text-muted text-sm/6">
          The photos on the public gallery, in the order they appear. Uploads are resized and converted to WebP, then
          start as drafts. Use Publish on a photo to make it visible on the site.
          {canEdit ? "" : " Your role can see this but not change it."}
        </p>
      </div>

      <GalleryPanel
        items={result.data}
        canEdit={canEdit}
        storageConfigured={storageConfigured}
      />
    </>
  );
}
