"use client";

import Image from "next/image";
import { useState } from "react";

import { StatusPill, type StatusTone } from "@/components/admin/status-pill";
import { useCatalogueSave } from "@/components/admin/use-catalogue-save";
import { buttonClasses } from "@/components/ui/button";
import {
  GALLERY_LIMITS,
  formatBytes,
  formatDimensions,
  galleryStatusHint,
  galleryStatusLabel,
} from "@/lib/admin/gallery";
import type { AdminGalleryItem, GalleryStatus } from "@/types/gallery";

/**
 * One photograph, and everything an organiser can do to it.
 *
 * The card is built around the order the work actually happens in: look at the photo,
 * write the words that make it accessible, put it where it belongs in the running
 * order, then publish it. So the description field sits open, and "publish" is the
 * last thing offered — with the state of the photo always spelled out in words rather
 * than only in colour, because "is this live?" is the question this screen exists to
 * answer.
 *
 * The picture itself is loaded from `/api/admin/gallery/preview` through the staff
 * session. Drafts stay out of public gallery queries and their Blob URLs are not shown
 * by the admin list; `next/image`'s optimiser cannot reach this authorised route either,
 * hence `unoptimized`, with the grid-sized thumbnail asked for directly.
 */

const TONES: Record<GalleryStatus, StatusTone> = {
  published: "go",
  draft: "warn",
  archived: "stop",
};

export function GalleryItemCard({
  item,
  index,
  total,
  canEdit,
  onSaved,
  onRemoved,
  onNotice,
}: {
  item: AdminGalleryItem;
  index: number;
  total: number;
  canEdit: boolean;
  onSaved: (item: AdminGalleryItem) => void;
  onRemoved: (id: string) => void;
  onNotice: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [draft, setDraft] = useState({
    title: item.title ?? "",
    description: item.description ?? "",
    altText: item.altText,
    album: item.album ?? "",
    capturedOn: item.capturedOn ?? "",
    sortOrder: String(item.sortOrder),
  });
  const [fieldError, setFieldError] = useState<{ field?: string; message: string } | null>(null);

  const save = useCatalogueSave<AdminGalleryItem>();
  const status = useCatalogueSave<{ id: string; status: GalleryStatus; moved: boolean }>();
  const move = useCatalogueSave<{ id: string; sortOrder: number; moved: boolean }>();
  const remove = useCatalogueSave<{ id: string; filesDeleted: number; filesToDelete: number }>();

  const pending = save.pending || status.pending || move.pending || remove.pending;
  const previewSrc = `/api/admin/gallery/preview?id=${item.id}&variant=thumb`;

  async function submit() {
    setFieldError(null);

    const result = await save.send("/api/admin/gallery", {
      action: "save",
      item: { ...draft, id: item.id },
    });

    if (result.ok) {
      onSaved(result.data);
      setDraft({
        title: result.data.title ?? "",
        description: result.data.description ?? "",
        altText: result.data.altText,
        album: result.data.album ?? "",
        capturedOn: result.data.capturedOn ?? "",
        sortOrder: String(result.data.sortOrder),
      });
      onNotice(`Saved “${result.data.title ?? result.data.altText}”.`);
    } else {
      setFieldError({ field: result.error.field, message: result.error.message });
    }
  }

  async function setStatus(next: GalleryStatus) {
    setFieldError(null);
    const result = await status.send("/api/admin/gallery", { action: "status", id: item.id, status: next });

    if (result.ok) {
      onSaved({ ...item, status: result.data.status, isPublic: result.data.status === "published" });
      onNotice(
        next === "published"
          ? `“${item.title ?? item.altText}” is now live on the public gallery.`
          : `“${item.title ?? item.altText}” is no longer visible to visitors.`,
      );
    } else {
      setFieldError({ message: result.error.message });
    }
  }

  async function shift(direction: "up" | "down") {
    setFieldError(null);
    const result = await move.send("/api/admin/gallery", { action: "move", id: item.id, direction });

    if (result.ok && result.data.moved) {
      onNotice(`Moved “${item.title ?? item.altText}” ${direction}.`);
    } else if (result.ok) {
      onNotice(direction === "up" ? "That is already the first photo." : "That is already the last photo.");
    } else {
      setFieldError({ message: result.error.message });
    }
  }

  async function destroy() {
    setFieldError(null);
    const result = await remove.send("/api/admin/gallery", { action: "delete", id: item.id });

    if (result.ok) {
      onRemoved(item.id);
      const label = `“${item.title ?? item.altText}”`;
      onNotice(
        result.data.filesToDelete === 0 || result.data.filesDeleted === result.data.filesToDelete
          ? `Deleted ${label} from the gallery${result.data.filesDeleted > 0 ? ` and removed its ${result.data.filesDeleted} stored files` : ""}.`
          : `Removed ${label} from the public gallery, but Blob cleanup did not complete. Check the Vercel Blob connection and Function logs.`,
      );
    } else {
      setFieldError({ message: result.error.message });
      setConfirming(false);
    }
  }

  const width = item.width ?? 4;
  const height = item.height ?? 3;

  return (
    <li className="border-border bg-surface/50 flex flex-col gap-4 rounded-2xl border p-4 sm:flex-row sm:gap-5 sm:p-5">
      <div className="bg-background/60 relative aspect-4/3 w-full shrink-0 overflow-hidden rounded-xl sm:w-56">
        <Image
          src={previewSrc}
          alt={item.altText}
          width={width}
          height={height}
          // The endpoint already returns the grid-sized file, and the optimiser
          // cannot follow a session-protected URL.
          unoptimized
          loading="lazy"
          sizes="(max-width: 640px) 100vw, 224px"
          onError={() => setPreviewError(true)}
          className="h-full w-full object-cover"
        />
        {previewError ? (
          <p role="alert" className="bg-night/90 text-marigold-soft absolute inset-x-2 bottom-2 rounded-lg px-2.5 py-2 text-xs/5">
            Preview unavailable. Check the Neon connection and the Vercel Blob store/token for this environment, then reload.
            Function logs and setup steps are in <code>docs/gallery-upload-troubleshooting.md</code>.
          </p>
        ) : null}
        <span className="bg-night/80 absolute top-2 left-2 rounded-full px-2 py-0.5 text-[0.625rem] font-semibold tracking-widest text-white uppercase tabular-nums">
          {index + 1} / {total}
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="truncate font-semibold tracking-tight">{item.title ?? "Untitled photo"}</p>
            <p className="text-muted truncate text-xs">
              {[
                item.album,
                formatDimensions(item.width, item.height),
                formatBytes(item.byteSize),
                item.capturedOn,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <StatusPill label={galleryStatusLabel(item.status)} tone={TONES[item.status]} />
        </div>

        <p className="text-muted text-xs/5">{galleryStatusHint(item.status)}</p>

        {!canEdit ? (
          <p className="text-muted/80 text-xs">Your role can see the gallery but not change it.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              className={buttonClasses({ variant: "secondary", size: "sm", className: "h-9 px-3.5" })}
            >
              {open ? "Close" : "Edit details"}
            </button>

            <button
              type="button"
              onClick={() => void shift("up")}
              disabled={pending || index === 0}
              className={buttonClasses({ variant: "ghost", size: "sm", className: "h-9 px-3" })}
            >
              ↑ Move up
            </button>

            <button
              type="button"
              onClick={() => void shift("down")}
              disabled={pending || index === total - 1}
              className={buttonClasses({ variant: "ghost", size: "sm", className: "h-9 px-3" })}
            >
              ↓ Move down
            </button>

            {item.status === "published" ? (
              <button
                type="button"
                onClick={() => void setStatus("draft")}
                disabled={pending}
                className={buttonClasses({ variant: "ghost", size: "sm", className: "h-9 px-3.5" })}
              >
                Disable (hide)
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void setStatus("published")}
                disabled={pending}
                className={buttonClasses({ variant: "secondary", size: "sm", className: "h-9 px-3.5" })}
              >
                {status.pending ? "Publishing…" : "Publish"}
              </button>
            )}

            {item.status !== "archived" ? (
              <button
                type="button"
                onClick={() => void setStatus("archived")}
                disabled={pending}
                className={buttonClasses({ variant: "ghost", size: "sm", className: "h-9 px-3.5" })}
              >
                Archive
              </button>
            ) : null}

            {confirming ? (
              <span className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void destroy()}
                  disabled={pending}
                  className={buttonClasses({ variant: "ghost", size: "sm", className: "text-rani-soft h-9 px-3.5" })}
                >
                  {remove.pending ? "Deleting…" : "Yes, delete for good"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className={buttonClasses({ variant: "ghost", size: "sm", className: "h-9 px-3" })}
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className={buttonClasses({ variant: "ghost", size: "sm", className: "text-rani-soft h-9 px-3.5" })}
              >
                Delete
              </button>
            )}
          </div>
        )}

        {open && canEdit ? (
          <form
            className="border-border/70 mt-1 flex flex-col gap-3 border-t pt-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <LabelledInput
                label="Title"
                value={draft.title}
                maxLength={GALLERY_LIMITS.titleMax}
                onChange={(value) => setDraft((current) => ({ ...current, title: value }))}
                error={fieldError?.field === "title" ? fieldError.message : undefined}
              />
              <LabelledInput
                label="Album"
                value={draft.album}
                maxLength={GALLERY_LIMITS.albumMax}
                onChange={(value) => setDraft((current) => ({ ...current, album: value }))}
                error={fieldError?.field === "album" ? fieldError.message : undefined}
              />
            </div>

            <LabelledInput
              label="Description (optional)"
              value={draft.description}
              maxLength={GALLERY_LIMITS.descriptionMax}
              onChange={(value) => setDraft((current) => ({ ...current, description: value }))}
              error={fieldError?.field === "description" ? fieldError.message : undefined}
            />

            <LabelledInput
              label="Describe the photo for screen readers"
              value={draft.altText}
              maxLength={GALLERY_LIMITS.altTextMax}
              required
              hint="Read aloud instead of the picture. Say what is happening, e.g. “Dancers in a circle under blue stage light”."
              onChange={(value) => setDraft((current) => ({ ...current, altText: value }))}
              error={fieldError?.field === "altText" ? fieldError.message : undefined}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <LabelledInput
                label="Taken on (optional)"
                type="date"
                value={draft.capturedOn}
                onChange={(value) => setDraft((current) => ({ ...current, capturedOn: value }))}
                error={fieldError?.field === "capturedOn" ? fieldError.message : undefined}
              />
              <LabelledInput
                label="Order"
                type="number"
                min={0}
                max={GALLERY_LIMITS.sortOrderMax}
                value={draft.sortOrder}
                hint="Lower numbers come first. The arrows above are usually quicker."
                onChange={(value) => setDraft((current) => ({ ...current, sortOrder: value }))}
                error={fieldError?.field === "sortOrder" ? fieldError.message : undefined}
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={pending}
                className={buttonClasses({ variant: "primary", size: "sm", className: "h-10 px-4" })}
              >
                {save.pending ? "Saving…" : "Save details"}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className={buttonClasses({ variant: "ghost", size: "sm", className: "h-10 px-3.5" })}
              >
                Done
              </button>
            </div>
          </form>
        ) : null}

        {fieldError && !open ? (
          <p role="alert" className="text-rani-soft text-xs font-medium">
            {fieldError.message}
          </p>
        ) : null}
      </div>
    </li>
  );
}

/** A labelled input in the house style, with the message wired to the field. */
function LabelledInput({
  label,
  value,
  onChange,
  type = "text",
  hint,
  error,
  required,
  maxLength,
  min,
  max,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "number" | "date";
  hint?: string;
  error?: string;
  required?: boolean;
  maxLength?: number;
  min?: number;
  max?: number;
}) {
  const id = `gallery-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-muted/80 text-[0.6875rem] font-semibold tracking-widest uppercase">
        {label}
        {required ? (
          <span aria-hidden="true" className="text-marigold ml-1">
            *
          </span>
        ) : null}
      </label>

      <input
        id={id}
        type={type}
        value={value}
        min={min}
        max={max}
        maxLength={maxLength}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className="border-border bg-background/60 focus:border-marigold/60 focus:ring-marigold/20 h-10 w-full rounded-xl border px-3 text-sm focus:ring-2 focus:outline-none"
      />

      {error ? (
        <p id={`${id}-error`} className="text-rani-soft text-xs font-medium">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-muted/80 text-xs/5">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
