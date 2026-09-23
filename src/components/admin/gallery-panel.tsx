"use client";

import { useState } from "react";

import { GalleryItemCard } from "@/components/admin/gallery-item-card";
import { GalleryUploader } from "@/components/admin/gallery-uploader";
import { formatBytes, gallerySummary } from "@/lib/admin/gallery";
import type { AdminGalleryItem } from "@/types/gallery";

/**
 * The gallery screen's body: what is published, what is waiting, and the controls.
 *
 * The list is the running order the public grid will show — drafts and archives
 * included, each labelled — so moving a photo up here moves it up there. Two details
 * are deliberate:
 *
 *   * **A draft is only ever published on purpose.** Uploads land as drafts; the
 *     public page reads `status = 'published'` and nothing else, so nothing an
 *     organiser has not looked at can appear on the site.
 *   * **The database's copy wins.** Every action posts and then takes the row the
 *     server sent back — the saved record, or the refusal with the field to fix — and
 *     the save hook refreshes the page behind it. So the list shows what was stored,
 *     never what the browser hoped had been.
 */
export function GalleryPanel({
  items,
  canEdit,
}: {
  items: readonly AdminGalleryItem[];
  canEdit: boolean;
}) {
  const [rows, setRows] = useState<AdminGalleryItem[]>([...items]);
  const [notice, setNotice] = useState<string | null>(null);

  const summary = gallerySummary(rows);
  const albums = Array.from(new Set(rows.map((row) => row.album).filter((album): album is string => Boolean(album))));

  function upsert(item: AdminGalleryItem) {
    setRows((current) => {
      const exists = current.some((row) => row.id === item.id);
      const next = exists ? current.map((row) => (row.id === item.id ? item : row)) : [...current, item];

      return next.sort((left, right) => left.sortOrder - right.sortOrder || left.createdAt.localeCompare(right.createdAt));
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-muted text-sm/6">
        {summary.total} {summary.total === 1 ? "photo" : "photos"} ·{" "}
        <span className="text-peacock-soft font-semibold">{summary.published} live</span> ·{" "}
        <span className="text-marigold-soft font-semibold">{summary.drafts} draft</span>
        {summary.archived > 0 ? ` · ${summary.archived} archived` : ""} · {formatBytes(summary.bytes)} of stored images
      </p>

      {notice ? (
        <p role="status" className="border-peacock/40 bg-peacock/5 text-peacock-soft rounded-xl border px-3.5 py-2.5 text-sm">
          {notice}
        </p>
      ) : null}

      {canEdit ? (
        <GalleryUploader
          albumSuggestions={albums}
          onUploaded={(uploaded) => {
            for (const item of uploaded) {
              upsert(item);
            }
          }}
        />
      ) : null}

      <ul className="flex flex-col gap-3">
        {rows.length === 0 ? (
          <li className="border-border bg-surface/50 text-muted rounded-2xl border px-4 py-8 text-center text-sm">
            No photos yet. Upload the first ones above — they arrive as drafts, and nothing is public until you publish
            it.
          </li>
        ) : null}

        {rows.map((item, index) => (
          <GalleryItemCard
            key={item.id}
            item={item}
            index={index}
            total={rows.length}
            canEdit={canEdit}
            onSaved={upsert}
            onRemoved={(id) => setRows((current) => current.filter((row) => row.id !== id))}
            onNotice={setNotice}
          />
        ))}
      </ul>
    </div>
  );
}
