import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import sharp from "sharp";

register("./ts-alias-loader.mjs", import.meta.url);
const rules = await import("../../src/lib/admin/hero-image.ts");
const { prepareHeroImage } = await import("../../src/lib/hero-image/prepare.ts");
const { toEventSummary } = await import("../../src/lib/services/mappers.ts");

let passed = 0;
async function check(label, assertion) {
  await assertion();
  passed += 1;
  console.log(`  ✓ ${label}`);
}

await check("request, upload and Neon bytea limits leave safe multipart headroom", () => {
  assert.ok(rules.HERO_IMAGE_MAX_STORED_BYTES < rules.HERO_IMAGE_MAX_UPLOAD_BYTES);
  assert.ok(rules.HERO_IMAGE_MAX_UPLOAD_BYTES < rules.HERO_IMAGE_MAX_REQUEST_BYTES);
  assert.equal(rules.HERO_IMAGE_MAX_STORED_BYTES, 2 * 1024 * 1024);
});

await check("only JPEG, PNG, WebP and AVIF uploads are accepted", () => {
  for (const type of rules.HERO_IMAGE_ALLOWED_TYPES) assert.equal(rules.isAcceptedHeroImageType(type), true);
  for (const type of ["image/svg+xml", "image/gif", "text/html", "application/octet-stream"]) {
    assert.equal(rules.isAcceptedHeroImageType(type), false);
  }
});

const jpeg = await sharp({
  create: { width: 1200, height: 800, channels: 3, background: { r: 177, g: 53, b: 102 } },
})
  .jpeg({ quality: 95 })
  .toBuffer();

await check("a supported JPEG is re-encoded as an optimized WebP", async () => {
  const result = await prepareHeroImage({ bytes: jpeg, contentType: "image/jpeg" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const metadata = await sharp(result.image.data).metadata();
  assert.equal(result.image.contentType, "image/webp");
  assert.equal(metadata.format, "webp");
  assert.ok(result.image.byteSize <= rules.HERO_IMAGE_MAX_STORED_BYTES);
  assert.ok(result.image.byteSize < jpeg.byteLength);
  assert.equal(metadata.exif, undefined);
});

await check("EXIF orientation is applied and the stored WebP has no source metadata", async () => {
  const oriented = await sharp({
    create: { width: 800, height: 500, channels: 3, background: { r: 12, g: 80, b: 112 } },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const result = await prepareHeroImage({ bytes: oriented, contentType: "image/jpeg" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const metadata = await sharp(result.image.data).metadata();
  assert.deepEqual([metadata.width, metadata.height], [500, 800]);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.orientation, undefined);
});

await check("large images are resized to the configured maximum edge", async () => {
  const large = await sharp({
    create: { width: 3200, height: 1800, channels: 3, background: { r: 30, g: 35, b: 66 } },
  })
    .jpeg({ quality: 95 })
    .toBuffer();
  const result = await prepareHeroImage({ bytes: large, contentType: "image/jpeg" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(Math.max(result.image.width, result.image.height) <= rules.HERO_IMAGE_MAX_EDGE);
});

await check("malformed, undersized and over-limit images are refused before reaching Neon", async () => {
  const malformed = await prepareHeroImage({ bytes: Buffer.from([0, 1, 2, 3, 4]), contentType: "image/jpeg" });
  assert.equal(malformed.ok, false);
  if (!malformed.ok) assert.match(malformed.error.message, /could not be read/i);

  const small = await sharp({
    create: { width: 200, height: 180, channels: 3, background: { r: 90, g: 60, b: 20 } },
  })
    .jpeg()
    .toBuffer();
  const tooSmall = await prepareHeroImage({ bytes: small, contentType: "image/jpeg" });
  assert.equal(tooSmall.ok, false);
  if (!tooSmall.ok) assert.match(tooSmall.error.message, /shortest side/i);

  const tooLarge = await prepareHeroImage({
    bytes: Buffer.alloc(rules.HERO_IMAGE_MAX_UPLOAD_BYTES + 1),
    contentType: "image/jpeg",
  });
  assert.equal(tooLarge.ok, false);
  if (!tooLarge.ok) assert.match(tooLarge.error.message, /too large/i);
});

await check("versioned public/admin routes are mapped without selecting bytea on page reads", () => {
  const publicUrl = rules.publicHeroImageUrl("event-id", "7");
  assert.equal(publicUrl, "/api/hero-image/event-id?v=7");
  assert.equal(
    rules.adminHeroImagePreviewUrl("event-id", "7"),
    "/api/admin/hero-image/preview?id=event-id&v=7",
  );
  assert.ok(!publicUrl.startsWith("data:"));

  const event = {
    id: "event-id",
    slug: "garba-night",
    name: "Garba Night",
    name_hindi: null,
    tagline: null,
    description: null,
    description_hindi: null,
    venue_name: "Garden",
    venue_hindi: null,
    venue_address: null,
    city: "Jaipur",
    state: null,
    maps_url: null,
    hero_image_url: null,
    hero_image_data_present: true,
    hero_image_version: "7",
    logo_url: null,
    contact_phone: null,
    contact_email: null,
    whatsapp_number: null,
    instagram_url: null,
    facebook_url: null,
    youtube_url: null,
    support_hours: [],
    currency: "INR",
    status: "published",
    start_date: null,
    end_date: null,
    created_at: "2026-09-24T00:00:00.000Z",
    updated_at: "2026-09-24T00:00:00.000Z",
  };
  assert.equal(toEventSummary(event).heroImageUrl, publicUrl);
  assert.equal(
    toEventSummary({ ...event, hero_image_data_present: false, hero_image_url: "https://legacy.example/hero.webp" })
      .heroImageUrl,
    "https://legacy.example/hero.webp",
  );

  const eventService = readFileSync(new URL("../../src/lib/services/events.ts", import.meta.url), "utf8");
  assert.match(eventService, /hero_image_data is not null/);
  assert.doesNotMatch(eventService, /select\s+\*\s+from public\.events/i);
  assert.doesNotMatch(eventService, /hero_image_data\s*,/i);
});

console.log(`\n${passed} passed, 0 failed`);
