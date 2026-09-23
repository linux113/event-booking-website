"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { GALLERY_LIMITS, GALLERY_UPLOAD_ACCEPT, formatBytes } from "@/lib/admin/gallery";
import type { AdminGalleryItem, GalleryUploadOutcome } from "@/types/gallery";

/**
 * Choosing photographs, and getting them into storage.
 *
 * Three things this control does that a bare file input would not:
 *
 *   1. **It shrinks the picture in the browser first, when that is worth doing.** A
 *      modern phone camera produces 4–8 MB JPEGs, and a deployment behind a hosting
 *      platform refuses request bodies over a few megabytes. Anything over
 *      {@link SHRINK_ABOVE} is drawn to a canvas at 2400 px on the long edge and sent
 *      as WebP, which typically cuts a night's upload tenfold before it leaves the
 *      phone. The server *still* re-encodes every file it receives — the browser is
 *      an optimisation, never the authority.
 *   2. **It uploads in one request.** `FormData` with every chosen file, so a batch
 *      arrives together and one failure does not cancel the rest: the endpoint answers
 *      with what it took and what it refused, per file name.
 *   3. **It reports what happened, file by file,** then refreshes the page so the
 *      list is the database's, not the browser's idea of it. Every upload lands as a
 *      draft — nothing appears on the public gallery until somebody publishes it.
 */

/** Bytes above which the browser resizes before uploading. */
const SHRINK_ABOVE = 2.5 * 1024 * 1024;

/** The long edge the browser scales to, matching what the server stores. */
const CLIENT_FULL_EDGE = GALLERY_LIMITS.fullEdge;

/**
 * Downscale one file, if the browser can and it is worth it.
 *
 * Returns the original file whenever anything is unavailable or fails: a browser
 * without `createImageBitmap` should still be able to upload, just less efficiently.
 */
async function shrinkIfLarge(file: File): Promise<File> {
  if (file.size <= SHRINK_ABOVE || typeof createImageBitmap !== "function" || typeof document === "undefined") {
    return file;
  }

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, CLIENT_FULL_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");

    if (!context) {
      return file;
    }

    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.85));

    if (!blob || blob.size >= file.size) {
      return file;
    }

    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".webp", { type: "image/webp" });
  } catch {
    return file;
  }
}

export function GalleryUploader({
  onUploaded,
  albumSuggestions = [],
}: {
  onUploaded: (items: AdminGalleryItem[]) => void;
  albumSuggestions?: string[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [album, setAlbum] = useState("");
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<GalleryUploadOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(files: File[]) {
    if (files.length === 0) {
      return;
    }

    setPending(true);
    setError(null);
    setOutcome(null);
    setProgress(`Preparing ${files.length} ${files.length === 1 ? "photo" : "photos"}…`);

    try {
      const prepared = await Promise.all(files.map(shrinkIfLarge));
      const form = new FormData();

      for (const file of prepared) {
        form.append("files", file, file.name);
      }

      if (album.trim()) {
        form.append("album", album.trim());
      }

      setProgress(`Uploading ${prepared.length} ${prepared.length === 1 ? "photo" : "photos"}…`);

      const response = await fetch("/api/admin/gallery", {
        method: "POST",
        body: form,
        credentials: "same-origin",
      });
      const body = (await response.json()) as
        | { ok: true; data: GalleryUploadOutcome }
        | { ok: false; error: { message: string } };

      if (!body.ok) {
        setError(body.error.message);

        return;
      }

      setOutcome(body.data);
      onUploaded(body.data.uploaded);

      if (inputRef.current) {
        inputRef.current.value = "";
      }

      // The page is a server component reading live rows: ask for them again so the
      // counts, the running order and the storage sizes are the database's.
      router.refresh();
    } catch {
      setError("The connection dropped before the upload finished. Check the list before trying again.");
    } finally {
      setProgress(null);
      setPending(false);
    }
  }

  return (
    <section className="border-border bg-surface/50 flex flex-col gap-4 rounded-2xl border p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-bold tracking-tight">Add photos</h2>
        <p className="text-muted text-sm/6">
          JPEG, PNG, WebP or AVIF up to {formatBytes(GALLERY_LIMITS.uploadBytes)} each. Every photo is resized and
          converted to WebP on the server, a thumbnail is made for the grid, and it arrives as a <strong>draft</strong>{" "}
          — nothing shows on the public gallery until you publish it.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-1.5 sm:w-64">
          <span className="text-muted/80 text-[0.6875rem] font-semibold tracking-widest uppercase">
            Album (optional)
          </span>
          <input
            type="text"
            value={album}
            onChange={(event) => setAlbum(event.target.value)}
            list={albumSuggestions.length > 0 ? "gallery-albums" : undefined}
            placeholder="Night 1"
            className="border-border bg-background/60 focus:border-marigold/60 focus:ring-marigold/20 h-11 rounded-xl border px-3.5 text-sm focus:ring-2 focus:outline-none"
          />
          {albumSuggestions.length > 0 ? (
            <datalist id="gallery-albums">
              {albumSuggestions.map((suggestion) => (
                <option key={suggestion} value={suggestion} />
              ))}
            </datalist>
          ) : null}
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={GALLERY_UPLOAD_ACCEPT}
            disabled={pending}
            onChange={(event) => void upload(Array.from(event.target.files ?? []))}
            aria-label="Choose photos to upload"
            className="text-muted file:border-border file:bg-surface-raised file:text-foreground hover:file:border-marigold/50 w-full text-sm file:mr-3 file:h-10 file:cursor-pointer file:rounded-xl file:border file:px-4 file:text-sm file:font-semibold sm:w-auto"
          />

          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => inputRef.current?.click()}
            className="h-10"
          >
            {pending ? "Working…" : "Choose files"}
          </Button>
        </div>
      </div>

      {progress ? (
        <p role="status" className="text-muted text-sm">
          {progress}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="border-rani/40 bg-rani/5 text-rani-soft rounded-xl border px-3.5 py-2.5 text-sm">
          {error}
        </p>
      ) : null}

      {outcome ? (
        <div className="flex flex-col gap-2" role="status">
          {outcome.uploaded.length > 0 ? (
            <p className="border-peacock/40 bg-peacock/5 text-peacock-soft rounded-xl border px-3.5 py-2.5 text-sm">
              {outcome.uploaded.length} {outcome.uploaded.length === 1 ? "photo" : "photos"} uploaded as drafts. Give
              each one a description for screen readers, then publish it.
            </p>
          ) : null}

          {outcome.refused.length > 0 ? (
            <ul className="border-marigold/40 bg-marigold/5 text-marigold-soft flex flex-col gap-1 rounded-xl border px-3.5 py-2.5 text-sm">
              {outcome.refused.map((refusal) => (
                <li key={refusal.fileName}>
                  <span className="font-semibold">{refusal.fileName}</span> — {refusal.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
