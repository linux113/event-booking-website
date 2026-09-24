"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type ChangeEvent } from "react";

import { DiyaIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  adminHeroImagePreviewUrl,
  formatHeroImageBytes,
  HERO_IMAGE_MAX_SOURCE_BYTES,
  HERO_IMAGE_MAX_UPLOAD_BYTES,
  HERO_IMAGE_UPLOAD_ACCEPT,
} from "@/lib/admin/hero-image";
import type { CatalogueResult } from "@/types/catalogue";
import type { HeroImageSettingsState } from "@/types/event-settings";

type HeroImageApiResponse = CatalogueResult<HeroImageSettingsState>;

const BROWSER_ENCODINGS = [
  { edge: 2200, quality: 0.84 },
  { edge: 1900, quality: 0.78 },
  { edge: 1600, quality: 0.72 },
] as const;

function renderWebp(bitmap: ImageBitmap, edge: number, quality: number): Promise<Blob | null> {
  const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) return Promise.resolve(null);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
}

/** Reduce large phone photos before they meet Vercel's function request ceiling. */
async function prepareBrowserUpload(file: File): Promise<File> {
  if (file.size <= HERO_IMAGE_MAX_UPLOAD_BYTES) return file;
  if (file.size > HERO_IMAGE_MAX_SOURCE_BYTES) {
    throw new Error(`Choose a source image under ${formatHeroImageBytes(HERO_IMAGE_MAX_SOURCE_BYTES)}.`);
  }
  if (typeof createImageBitmap !== "function") {
    throw new Error("This browser cannot resize the image. Choose a smaller photo and try again.");
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    if (bitmap.width * bitmap.height > 40_000_000) {
      throw new Error("That image has too many pixels to resize in this browser. Choose a smaller photo.");
    }

    let smallest: Blob | null = null;
    for (const attempt of BROWSER_ENCODINGS) {
      const blob = await renderWebp(bitmap, attempt.edge, attempt.quality);
      if (!blob) continue;
      if (!smallest || blob.size < smallest.size) smallest = blob;
      if (blob.size <= HERO_IMAGE_MAX_UPLOAD_BYTES && blob.size < file.size) {
        const extension = blob.type === "image/webp" ? ".webp" : ".png";
        const baseName = file.name.replace(/\.[^.]+$/, "") || "homepage-hero";
        return new File([blob], `${baseName}${extension}`, { type: blob.type || "image/webp" });
      }
    }

    if (smallest && smallest.size <= HERO_IMAGE_MAX_UPLOAD_BYTES) {
      const extension = smallest.type === "image/webp" ? ".webp" : ".png";
      const baseName = file.name.replace(/\.[^.]+$/, "") || "homepage-hero";
      return new File([smallest], `${baseName}${extension}`, { type: smallest.type || "image/webp" });
    }

    throw new Error("That photo could not be reduced below the upload limit. Resize it and try again.");
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("That photo could not be prepared for upload. Try another image.");
  } finally {
    bitmap?.close();
  }
}

export function EventHeroImageSettings({
  eventId,
  eventName,
  canEdit,
  initialImageUrl,
  initialHasImage,
  initialByteSize,
  initialVersion,
}: {
  eventId: string;
  eventName: string;
  canEdit: boolean;
  initialImageUrl: string | null;
  initialHasImage: boolean;
  initialByteSize: number | null;
  initialVersion: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [image, setImage] = useState<HeroImageSettingsState>(() => ({
    hasImage: initialHasImage,
    byteSize: initialByteSize,
    version: initialVersion,
    previewUrl: initialHasImage
      ? initialImageUrl ?? adminHeroImagePreviewUrl(eventId, initialVersion)
      : null,
  }));
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function sendRequest(request: RequestInit, successMessage: string) {
    setPending(true);
    setError(null);
    setNotice(null);
    setProgress(request.body instanceof FormData ? "Optimizing and saving the image…" : "Removing the image…");

    try {
      const response = await fetch("/api/admin/hero-image", {
        ...request,
        credentials: "same-origin",
      });
      let body: HeroImageApiResponse | null = null;
      try {
        body = (await response.json()) as HeroImageApiResponse;
      } catch {
        // A platform-level 413/500 may return an HTML error document.
      }

      if (!response.ok || !body?.ok) {
        setError(
          body && !body.ok
            ? body.error.message
            : response.status === 413
              ? "The upload is larger than this deployment accepts. Choose a smaller photo and try again."
              : `The image could not be saved (HTTP ${response.status}). Try again.`,
        );
        return;
      }

      setImage(body.data);
      setNotice(successMessage);
      router.refresh();
    } catch {
      setError("The connection dropped before the image was saved. Check the preview before retrying.");
    } finally {
      setPending(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function upload(file: File) {
    setPending(true);
    setError(null);
    setNotice(null);
    setProgress("Preparing the image…");

    try {
      const prepared = await prepareBrowserUpload(file);
      const form = new FormData();
      form.append("file", prepared, prepared.name);
      await sendRequest({ method: "POST", body: form }, "Homepage hero image saved. The public homepage is refreshed.");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "That image could not be prepared.");
    } finally {
      setPending(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (file) void upload(file);
  }

  function remove() {
    void sendRequest(
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "remove" }),
      },
      "Custom hero removed. The homepage will show its built-in diya artwork again.",
    );
  }

  return (
    <section className="border-border bg-surface/50 flex flex-col gap-4 rounded-2xl border p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold tracking-tight">Homepage hero image</h2>
        <p className="text-muted text-sm/6">
          This is the single image beside <strong>Book Now</strong> on the homepage. It is separate from Gallery and
          stored as an optimized WebP in Neon; it does not use Vercel Blob.
        </p>
      </div>

      <div className="grid items-start gap-5 sm:grid-cols-[minmax(0,1.1fr)_minmax(15rem,0.9fr)]">
        <div className="border-border bg-background/60 relative aspect-[16/10] overflow-hidden rounded-2xl border">
          {image.previewUrl ? (
            <Image
              src={image.previewUrl}
              alt={`${eventName} homepage hero preview`}
              fill
              sizes="(max-width: 640px) 100vw, 50vw"
              className="object-cover"
              unoptimized
            />
          ) : (
            <div className="from-navy via-surface to-[#2a1055] absolute inset-0 flex items-center justify-center bg-gradient-to-br">
              <div
                aria-hidden="true"
                className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(247,183,49,0.25),transparent_55%)]"
              />
              <DiyaIcon className="text-marigold/35 relative size-24" />
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold">
            {image.hasImage ? "Custom hero artwork is active" : "Built-in diya artwork is active"}
          </p>
          <p className="text-muted text-xs/5">
            {image.hasImage
              ? image.byteSize !== null
                ? `Optimized WebP · ${formatHeroImageBytes(image.byteSize)} in Neon`
                : "A legacy hero is active. Replace it to save an optimized WebP in Neon."
              : "Upload a landscape photo to replace the built-in artwork. Removing it restores the diya design."}
          </p>

          {canEdit ? (
            <>
              <input
                ref={inputRef}
                id={inputId}
                type="file"
                accept={HERO_IMAGE_UPLOAD_ACCEPT}
                onChange={onFileChange}
                disabled={pending}
                aria-label="Choose homepage hero image"
                className="sr-only"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={image.hasImage ? "secondary" : "primary"}
                  size="sm"
                  disabled={pending}
                  onClick={() => inputRef.current?.click()}
                >
                  {pending ? "Working…" : image.hasImage ? "Replace image" : "Upload image"}
                </Button>
                {image.hasImage ? (
                  <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={remove}>
                    Remove and restore diya
                  </Button>
                ) : null}
              </div>
              <p className="text-muted/80 text-xs/5">
                JPEG, PNG, WebP or AVIF. Large photos are resized before upload, then converted and stripped of metadata
                on the server. The stored WebP is limited to 2 MiB.
              </p>
            </>
          ) : (
            <p className="text-muted text-xs/5">You have read-only access to the homepage artwork.</p>
          )}
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
      {notice ? (
        <p role="status" className="border-peacock/40 bg-peacock/5 text-peacock-soft rounded-xl border px-3.5 py-2.5 text-sm">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
