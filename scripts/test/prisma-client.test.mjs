// Does the generated Prisma client actually talk to a PostgreSQL, read this
// schema, call these SQL functions, and respect these constraints?
//
//   node scripts/test/prisma-client.test.mjs
//
// Prisma's client is generated TypeScript that imports its own files without
// extensions, so Node needs the same resolver hook the rest of the verification
// scripts use. `register` has to run before the client is imported, which is why
// the imports below are dynamic.
import { register } from "node:module";
import { PrismaPg } from "@prisma/adapter-pg";
import { startPostgres, REPO_ROOT } from "./postgres-server.mjs";

register("./ts-alias-loader.mjs", import.meta.url);
const { PrismaClient } = await import("../../src/generated/prisma/client.ts");

const pg = await startPostgres({ seed: true });
console.log(`postgres listening on 127.0.0.1:${pg.port}`);
// `max: 1`: PGlite's socket server is a single in-process PostgreSQL, and the
// pool's habit of opening and closing connections makes it drop them. One
// connection, used for the whole test, is also what the assertions want — they
// are about SQL, not about concurrency.
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: pg.connectionString, max: 1 }) });

let pass = 0, fail = 0;
const check = (label, ok, detail = "") => { ok ? pass++ : fail++; console.log(`  ${ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${label}${detail ? " — " + detail : ""}`); };

// 1 · plain CRUD through the generated client, on the mapped names
const event = await prisma.event.findFirst({ include: { passCategories: true, dates: true } });
check("Event.findFirst reads the event", event?.slug === "navratri-2026-jaipur", `${event?.name} (${event?.slug})`);
// The seed leaves the image columns empty, so this proves the mapping itself:
// write the *column*, read the *field*.
await pg.db.query(`update public.events set hero_image_url = $1 where id = $2`, ["https://blob.example/hero.webp", event.id]);
const relisted = await prisma.event.findUnique({ where: { id: event.id }, select: { bannerUrl: true } });
check("Event.bannerUrl reads the hero_image_url column", relisted?.bannerUrl === "https://blob.example/hero.webp", String(relisted?.bannerUrl));
check("relationship include works (passes + nights)", event?.passCategories.length === 5 && event?.dates.length === 9, `${event?.passCategories.length} passes, ${event?.dates.length} nights`);

const couple = await prisma.passCategory.findFirst({ where: { code: { equals: "couple", mode: "insensitive" } } });
check("PassCategory.price reads price_inr and peoplePerPass reads number_of_people",
  typeof couple?.price === "number" && couple.price > 0 && couple?.peoplePerPass >= 1,
  `₹${couple?.price} for ${couple?.peoplePerPass} people`);
check("generated column status is readable", couple?.status === "active", String(couple?.status));

const night = await prisma.eventDate.findFirst({ orderBy: { eventDate: "asc" } });
check("generated column availableCapacity is readable", night?.availableCapacity === night?.capacity - night?.capacityHeld, `capacity ${night?.capacity}, held ${night?.capacityHeld} → ${night?.availableCapacity}`);

// 2 · the booking flow over $queryRaw — the SQL functions the app depends on
const [row] = await prisma.$queryRaw`
  select * from public.create_pending_booking(
    ${event.id}::uuid, ${night.id}::uuid, ${couple.id}::uuid,
    ${"Riya Sharma"}::text, ${"9876543210"}::text, ${1}::integer, ${2}::integer, ${"prisma-test-1"}::text)`;
check("create_pending_booking works through Prisma ($queryRaw)", row?.booking_status === "pending" && row?.total_amount === couple.price * 1, `${row?.booking_reference} ₹${row?.total_amount} for ${row?.quantity} × ${row?.pass_name}`);

await prisma.$executeRaw`select public.attach_razorpay_order(${row.booking_uuid}::uuid, ${"order_prisma_1"}::text)`;
// The amount is what the database computed, in paise — exactly what the app must send.
await prisma.$queryRaw`select * from public.confirm_booking_payment(${"order_prisma_1"}::text, ${"pay_prisma_1"}::text, ${row.total_amount * 100}::integer)`;
const passes = await prisma.digitalPass.findMany({ where: { bookingId: row.booking_uuid } });
check("payment → exactly one pass", passes.length === 1, `${passes[0]?.passId} ${passes[0]?.status}`);
check("pass token is 64 hex characters", /^[0-9a-f]{64}$/.test(passes[0]?.qrToken ?? ""));

const [verdict] = await prisma.$queryRaw`select * from public.scan_pass(${passes[0].qrToken}::text, ${"2026-10-11"}::date)`;
check("scan_pass works through Prisma — no staff id", verdict?.outcome === "valid", `${verdict?.outcome} / admitted_by=${verdict?.staff_name}`);

// 3 · writes through the client honour DB constraints
const checked = await prisma.digitalPass.update({ where: { id: passes[0].id }, data: { status: "used", checkedIn: true, checkedInAt: new Date() } });
check("update through the client works", checked.checkedIn === true);
const ins = await prisma.checkIn.create({ data: { digitalPassId: passes[0].id, eventDateId: night.id, bookingId: row.booking_uuid, gate: "Gate 1" } });
check("check_ins insert through the client works", Boolean(ins.id));
// 4 · gallery rows retain both Blob URLs, stay private as drafts, publish and delete
const galleryId = crypto.randomUUID();
const fullUrl = `https://store.public.blob.vercel-storage.com/gallery/${galleryId}/full.webp`;
const thumbnailUrl = `https://store.public.blob.vercel-storage.com/gallery/${galleryId}/thumb.webp`;
const galleryItem = await prisma.galleryItem.create({
  data: {
    id: galleryId,
    eventId: event.id,
    mediaType: "image",
    storagePath: `gallery/${galleryId}/full.webp`,
    thumbnailPath: `gallery/${galleryId}/thumb.webp`,
    url: fullUrl,
    thumbnailUrl,
    title: "Test gallery image",
    altText: "A festival stage with lights",
    width: 2400,
    height: 1600,
    byteSize: 123456,
    sortOrder: 0,
    status: "draft",
  },
});
check("gallery upload metadata stores both full and thumbnail Blob URLs", galleryItem.url === fullUrl && galleryItem.thumbnailUrl === thumbnailUrl);
const draftPublicRows = await prisma.$queryRaw`select id from public.gallery where status = 'published'`;
check("draft gallery rows are excluded from the public status query", !draftPublicRows.some((item) => item.id === galleryId));
await prisma.galleryItem.update({ where: { id: galleryId }, data: { status: "published" } });
const publicGalleryItem = await prisma.$queryRaw`
  select url, thumbnail_url from public.gallery where id = ${galleryId}::uuid and status = 'published'
`;
check("publishing exposes the image and thumbnail URLs", publicGalleryItem[0]?.url === fullUrl && publicGalleryItem[0]?.thumbnail_url === thumbnailUrl);
await prisma.galleryItem.delete({ where: { id: galleryId } });
check("deleting removes the gallery row", await prisma.galleryItem.findUnique({ where: { id: galleryId } }) === null);

try {
  await prisma.checkIn.create({ data: { digitalPassId: passes[0].id, eventDateId: night.id, bookingId: row.booking_uuid } });
  check("a second check-in is refused by unique(digital_pass_id)", false, "ALLOWED — the guarantee is gone");
} catch (e) {
  check("a second check-in is refused by unique(digital_pass_id)", String(e.code) === "P2002" || /unique/i.test(String(e.message)), String(e.code ?? e.message).slice(0, 60));
}

// 5 · the database refuses to write a generated column
//
// Run on the in-process handle rather than through Prisma: this is a property of
// the schema, and a failed statement is allowed to take Prisma's single pooled
// connection down with it.
try {
  await pg.db.query(
    `insert into public.pass_categories (event_id, code, name, composition, price_inr, number_of_people, status)
     values ($1, 'x', 'X', 'x', 1, 1, 'active')`,
    [event.id],
  );
  check("the database refuses a write to the generated status column", false, "ALLOWED — generated column was writable");
} catch (e) {
  check("the database refuses a write to the generated status column", /generated|non-DEFAULT/i.test(String(e.message)), String(e.message).split("\n")[0].slice(0, 64));
}

await prisma.$disconnect();
await pg.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
