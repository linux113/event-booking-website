"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { GALLERY_LIMITS, GALLERY_UPLOAD_ACCEPT, formatBytes } from "@/lib/admin/gallery";
import {
  GALLERY_UPLOAD_BATCH_BYTES,
  planGalleryUploadBatches,
} from "@/lib/admin/gallery-upload";
import type { AdminGalleryItem, GalleryUploadOutcome } from "@/types/gallery";

/**
 * The browser-side half of gallery uploads.
 *
 * Every photo above 800 KB is offered as a 2400px WebP at quality 0.85 before it
 * leaves the device. Prepared files are then sent in sequential requests capped at
 * 3.5 MiB of file bytes each, leaving room for multipart overhead under Vercel's
 * serverless request-body limit. The server still decodes and re-encodes every image.
 */
const SHRINK_ABOVE = 800 * 1024;
const CLIENT_FULL_EDGE = GALLERY_LIMITS.fullEdge;
const COMPRESSION_ATTEMPTS = [
  { edge: CLIENT_FULL_EDGE, quality: 0.85 },
  { edge: 2100, quality: 0.78 },
  { edge: 1800, quality: 0.7 },
] as const;

type UploadResponse =
  | { ok: true; data: GalleryUploadOutcome }
  | { ok: false; error: { message: string; kind?: string } };

function renderWebp(bitmap: ImageBitmap, maxEdge: number, quality: number): Promise<Blob | null> {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) return Promise.resolve(null);

  context.drawImage(bitmap, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
}

function asWebpFile(file: File, blob: Blob): File {
  const baseName = file.name.replace(/\.[^.]+$/, "") || "photo";
  return new File([blob], `${baseName}.webp`, { type: "image/webp", lastModified: file.lastModified });
}

/** Shrink a photo when useful, or leave it alone if decoding/encoding is unavailable. */
async function shrinkIfLarge(file: File): Promise<File> {
  if (
    file.size <= SHRINK_ABOVE ||
    typeof createImageBitmap !== "function" ||
    typeof document === "undefined"
  ) {
    return file;
  }

  let bitmap: ImageBitmap | null = null;

  try {
    bitmap = await createImageBitmap(file);
    let best: Blob | null = null;

    for (const attempt of COMPRESSION_ATTEMPTS) {
      const encoded = await renderWebp(bitmap, attempt.edge, attempt.quality);
      if (!encoded) continue;
      if (!best || encoded.size < best.size) best = encoded;

      // The first pass is 2400px / 0.85. Retry smaller only when needed to keep
      // a single image safely inside one server request.
      if (encoded.size <= GALLERY_UPLOAD_BATCH_BYTES && (encoded.size < file.size || file.size > GALLERY_UPLOAD_BATCH_BYTES)) {
        return asWebpFile(file, encoded);
      }
    }

    return best && best.size < file.size ? asWebpFile(file, best) : file;
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}

function emptyOutcome(): GalleryUploadOutcome {
  return { uploaded: [], refused: [] };
}

export function GalleryUploader({
  onUploaded,
  albumSuggestions = [],
  storageConfigured,
}: {
  onUploaded: (items: AdminGalleryItem[]) => void;
  albumSuggestions?: string[];
  storageConfigured: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [album, setAlbum] = useState("");
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<GalleryUploadOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(files: File[]) {
    if (files.length === 0) return;

    setPending(true);
    setError(null);
    setOutcome(null);
    setProgress(`Preparing ${files.length} ${files.length === 1 ? "photo" : "photos"}…`);
    const combined = emptyOutcome();

    try {
      const prepared: File[] = [];

      // Decode one image at a time to avoid holding a whole phone-photo batch in
      // browser memory while canvases are being resized.
      for (const [index, file] of files.entries()) {
        setProgress(`Preparing photo ${index + 1} of ${files.length}…`);
        prepared.push(await shrinkIfLarge(file));
      }

      const plan = planGalleryUploadBatches(prepared);
      combined.refused.push(
        ...plan.oversized.map((file) => ({
          fileName: file.name,
          message: `This photo could not be reduced below ${formatBytes(GALLERY_UPLOAD_BATCH_BYTES)}. Resize it or convert it to WebP, then try again.`,
        })),
      );

      for (const [batchIndex, batch] of plan.batches.entries()) {
        const form = new FormData();
        for (const file of batch) form.append("files", file, file.name);
        if (album.trim()) form.append("album", album.trim());

        setProgress(
          `Uploading batch ${batchIndex + 1} of ${plan.batches.length} (${batch.length} ${batch.length === 1 ? "photo" : "photos"})…`,
        );

        let response: Response;
        try {
          response = await fetch("/api/admin/gallery", {
            method: "POST",
            body: form,
            credentials: "same-origin",
          });
        } catch {
          const message = "The connection dropped before this batch finished. Check the gallery list before retrying.";
          setError(message);
          combined.refused.push(...batch.map((file) => ({ fileName: file.name, message })));
          break;
        }

        let body: UploadResponse | null = null;
        try {
          body = (await response.json()) as UploadResponse;
        } catch {
          // A platform-level 413/502 may return an HTML error page instead of JSON.
        }

        if (!response.ok || !body?.ok) {
          const message =
            body && !body.ok
              ? body.error.message
              : response.status === 413
                ? "This upload batch exceeded the 4 MB server safety limit. Choose fewer or smaller photos and try again."
                : `The upload failed (HTTP ${response.status}). Check the gallery list before retrying.`;
          setError(message);
          combined.refused.push(...batch.map((file) => ({ fileName: file.name, message })));
          break;
        }

        combined.uploaded.push(...body.data.uploaded);
        combined.refused.push(...body.data.refused);
        if (body.data.uploaded.length > 0) onUploaded(body.data.uploaded);
      }

      setOutcome(combined);
      if (combined.uploaded.length > 0) router.refresh();
    } finally {
      if (inputRef.current) inputRef.current.value = "";
      setProgress(null);
      setPending(false);
    }
  }

  return (
    <section className="border-border bg-surface/50 flex flex-col gap-4 rounded-2xl border p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-bold tracking-tight">Add photos</h2>
        <p className="text-muted text-sm/6">
          JPEG, PNG, WebP or AVIF up to {formatBytes(GALLERY_LIMITS.uploadBytes)} each. Photos over 800 KB are resized
          to WebP in your browser and sent in small batches; the server makes a grid thumbnail. Every upload starts as
          a <strong>draft</strong> — nothing shows on the public gallery until you publish it.
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
            disabled={pending || !storageConfigured}
            onChange={(event) => void upload(Array.from(event.target.files ?? []))}
            aria-label="Choose photos to upload"
            className="text-muted file:border-border file:bg-surface-raised file:text-foreground hover:file:border-marigold/50 w-full text-sm file:mr-3 file:h-10 file:cursor-pointer file:rounded-xl file:border file:px-4 file:text-sm file:font-semibold sm:w-auto"
          />

          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={pending || !storageConfigured}
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
              {outcome.uploaded.length} {outcome.uploaded.length === 1 ? "photo" : "photos"} uploaded as drafts. Add
              accessible descriptions, then use Publish on a photo to put it on the site.
            </p>
          ) : null}

          {outcome.refused.length > 0 ? (
            <ul className="border-marigold/40 bg-marigold/5 text-marigold-soft flex flex-col gap-1 rounded-xl border px-3.5 py-2.5 text-sm">
              {outcome.refused.map((refusal, index) => (
                <li key={`${refusal.fileName}-${index}`}>
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
