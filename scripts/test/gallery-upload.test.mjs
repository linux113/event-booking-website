import assert from "node:assert/strict";
import { register } from "node:module";
import { BlobAccessError, BlobStoreNotFoundError } from "@vercel/blob";

register("./ts-alias-loader.mjs", import.meta.url);
const {
  GALLERY_UPLOAD_BATCH_BYTES,
  GALLERY_UPLOAD_FILES_PER_REQUEST,
  GALLERY_UPLOAD_REQUEST_BYTES,
  planGalleryUploadBatches,
} = await import("../../src/lib/admin/gallery-upload.ts");
const { toGalleryItem } = await import("../../src/lib/services/mappers.ts");
const { storageFailureMessage } = await import("../../src/lib/gallery/storage-errors.ts");

let passed = 0;
function check(label, assertion) {
  assertion();
  passed += 1;
  console.log(`  ✓ ${label}`);
}

check("the browser's file-byte budget stays below the route and platform safety limit", () => {
  assert.ok(GALLERY_UPLOAD_BATCH_BYTES < GALLERY_UPLOAD_REQUEST_BYTES);
  assert.equal(GALLERY_UPLOAD_REQUEST_BYTES, 4 * 1024 * 1024);
});

check("Vercel Blob access errors explain the token and environment setup", () => {
  const message = storageFailureMessage(new BlobAccessError(), "store");
  assert.match(message, /BLOB_READ_WRITE_TOKEN/);
  assert.match(message, /Production/);
  assert.match(message, /Preview/);
});

check("a missing Blob store also gives actionable setup guidance", () => {
  const message = storageFailureMessage(new BlobStoreNotFoundError(), "read");
  assert.match(message, /Blob store/);
  assert.match(message, /BLOB_READ_WRITE_TOKEN/);
  assert.match(message, /could not be read/);
});

check("batches respect both the byte and file-count limits, preserving order", () => {
  const files = [
    { name: "a.jpg", size: 6 },
    { name: "b.jpg", size: 4 },
    { name: "c.jpg", size: 3 },
    { name: "d.jpg", size: 2 },
    { name: "e.jpg", size: 1 },
  ];
  const { batches, oversized } = planGalleryUploadBatches(files, 10, 2);
  assert.deepEqual(batches.map((batch) => batch.map((file) => file.name)), [["a.jpg", "b.jpg"], ["c.jpg", "d.jpg"], ["e.jpg"]]);
  assert.deepEqual(oversized, []);
});

check("a single file larger than the request budget is returned for a local refusal", () => {
  const file = { name: "too-large.webp", size: 11 };
  const plan = planGalleryUploadBatches([file], 10);
  assert.deepEqual(plan.batches, []);
  assert.deepEqual(plan.oversized, [file]);
});

check("a published Blob row resolves both stored image URLs for the public grid", () => {
  const item = toGalleryItem({
    id: "gallery-item",
    url: "https://store.public.blob.vercel-storage.com/gallery/gallery-item/full.webp",
    thumbnail_url: "https://store.public.blob.vercel-storage.com/gallery/gallery-item/thumb.webp",
    storage_path: "gallery/gallery-item/full.webp",
    thumbnail_path: "gallery/gallery-item/thumb.webp",
    alt_text: "Dancers beneath stage lights",
    title: "Festival night",
    album: "Night 1",
    media_type: "image",
    width: 2400,
    height: 1600,
  });
  assert.equal(item?.src, "https://store.public.blob.vercel-storage.com/gallery/gallery-item/full.webp");
  assert.equal(item?.thumbnailSrc, "https://store.public.blob.vercel-storage.com/gallery/gallery-item/thumb.webp");
});

check("relative storage keys without a public Blob URL are not exposed", () => {
  const item = toGalleryItem({
    id: "draft-item",
    url: null,
    thumbnail_url: null,
    storage_path: "gallery/draft-item/full.webp",
    thumbnail_path: "gallery/draft-item/thumb.webp",
    alt_text: "Draft",
    title: "Draft",
    album: null,
    media_type: "image",
    width: 2400,
    height: 1600,
  });
  assert.equal(item, null);
});

check("more than 40 small files are split into separate requests", () => {
  const files = Array.from({ length: GALLERY_UPLOAD_FILES_PER_REQUEST + 1 }, (_, index) => ({
    name: `${index}.jpg`,
    size: 1,
  }));
  const { batches } = planGalleryUploadBatches(files, 1024, GALLERY_UPLOAD_FILES_PER_REQUEST);
  assert.deepEqual(batches.map((batch) => batch.length), [GALLERY_UPLOAD_FILES_PER_REQUEST, 1]);
});

console.log(`\n${passed} passed, 0 failed`);
