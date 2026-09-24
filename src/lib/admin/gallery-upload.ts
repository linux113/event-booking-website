/**
 * Shared request budgets for the browser uploader and Node route.
 *
 * The binary files are kept below 3.5 MiB; the extra half MiB in the server limit
 * covers multipart boundaries and form fields while staying below Vercel Functions'
 * approximately 4.5 MiB request-body cap.
 */
export const GALLERY_UPLOAD_BATCH_BYTES = Math.floor(3.5 * 1024 * 1024);
export const GALLERY_UPLOAD_REQUEST_BYTES = 4 * 1024 * 1024;
export const GALLERY_UPLOAD_FILES_PER_REQUEST = 40;

export interface SizedGalleryFile {
  name: string;
  size: number;
}

export interface GalleryUploadBatchPlan<T extends SizedGalleryFile> {
  batches: T[][];
  oversized: T[];
}

/** Group prepared files without exceeding the per-request byte or file-count caps. */
export function planGalleryUploadBatches<T extends SizedGalleryFile>(
  files: readonly T[],
  maxBytes = GALLERY_UPLOAD_BATCH_BYTES,
  maxFiles = GALLERY_UPLOAD_FILES_PER_REQUEST,
): GalleryUploadBatchPlan<T> {
  const batches: T[][] = [];
  const oversized: T[] = [];
  let current: T[] = [];
  let currentBytes = 0;

  for (const file of files) {
    if (file.size > maxBytes) {
      oversized.push(file);
      continue;
    }

    if (current.length > 0 && (currentBytes + file.size > maxBytes || current.length >= maxFiles)) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }

    current.push(file);
    currentBytes += file.size;
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return { batches, oversized };
}
