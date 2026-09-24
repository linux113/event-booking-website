import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";

register("./ts-alias-loader.mjs", import.meta.url);
const {
  isCleanEventBasicsSettings,
  isCleanEventContactSettings,
  isCleanSiteContentSettings,
  parseEventBasicsSettings,
  parseEventContactSettings,
  parseSiteContentSettings,
} = await import("../../src/lib/admin/event-settings.ts");
const { buildContactChannels, buildSiteContact } = await import("../../src/lib/contact.ts");
const { parseSiteContentJson } = await import("../../src/lib/site-content.ts");

let passed = 0;
function check(label, assertion) {
  assertion();
  passed += 1;
  console.log(`  ✓ ${label}`);
}

const valid = {
  contactPhone: "+91 9358535894",
  contactEmail: "savriyasethevents@gmail.com",
  whatsappNumber: "+91 93585 35894",
  venueAddress: "Ajmer Road",
  mapsUrl: "https://maps.google.com/?q=My+Village+Garden+Jaipur",
  instagramUrl: "https://www.instagram.com/savriyasethevents",
  facebookUrl: "https://www.facebook.com/savriyasethevents",
  youtubeUrl: "https://youtu.be/dQw4w9WgXcQ",
  supportHours: "Monday – Saturday · 10:00 AM – 8:00 PM\nFestival days · 10:00 AM – 11:00 PM",
};

const parsed = parseEventContactSettings(valid);
check("real public contact details validate and WhatsApp is stored as digits", () => {
  assert.equal(isCleanEventContactSettings(parsed.errors), true);
  assert.equal(parsed.values.contactPhone, "+91 9358535894");
  assert.equal(parsed.values.contactEmail, "savriyasethevents@gmail.com");
  assert.equal(parsed.values.whatsappNumber, "919358535894");
});

check("deployment fallbacks generate the requested phone, email and WhatsApp links", () => {
  const contact = buildSiteContact(null);
  assert.equal(contact.phone, "+91 9358535894");
  assert.equal(contact.phoneHref, "tel:919358535894");
  assert.equal(contact.email, "savriyasethevents@gmail.com");
  assert.equal(contact.emailHref, "mailto:savriyasethevents@gmail.com");
  assert.ok(contact.whatsappHref?.startsWith("https://wa.me/919358535894?text="));
  const channels = buildContactChannels(null);
  assert.equal(channels.find((channel) => channel.id === "phone")?.href, "tel:919358535894");
  assert.equal(channels.find((channel) => channel.id === "email")?.href, "mailto:savriyasethevents@gmail.com");
  assert.ok(channels.find((channel) => channel.id === "whatsapp")?.href.startsWith("https://wa.me/919358535894?text="));
});

check("the event row wins and venue lines do not repeat the venue name", () => {
  const contact = buildSiteContact({
    id: "event-id",
    slug: "navratri-2026-jaipur",
    name: "Garba Night",
    tagline: null,
    description: null,
    venueName: "My Village Garden",
    venueAddress: "Ajmer Road",
    city: "Jaipur",
    state: "Rajasthan",
    mapsUrl: "https://maps.google.com/?q=My+Village+Garden+Jaipur",
    heroImageUrl: null,
    contactPhone: "+91 8000000000",
    contactEmail: "live@example.in",
    whatsappNumber: "918000000000",
    instagramUrl: null,
    facebookUrl: null,
    youtubeUrl: null,
    supportHours: [],
    currency: "INR",
  });
  assert.equal(contact.phone, "+91 8000000000");
  assert.equal(contact.email, "live@example.in");
  assert.ok(contact.whatsappHref?.startsWith("https://wa.me/918000000000?text="));
  assert.deepEqual(contact.addressLines, ["My Village Garden", "Ajmer Road", "Jaipur, Rajasthan"]);
});

check("optional links and hours can be cleared", () => {
  const empty = parseEventContactSettings({
    ...valid,
    mapsUrl: "",
    instagramUrl: "",
    facebookUrl: "",
    youtubeUrl: "",
    supportHours: "",
  });
  assert.equal(isCleanEventContactSettings(empty.errors), true);
  assert.equal(empty.values.mapsUrl, null);
  assert.deepEqual(empty.values.supportHours, []);
});

check("email and phone shapes are validated", () => {
  const invalid = parseEventContactSettings({ ...valid, contactEmail: "not-an-email", contactPhone: "call me" });
  assert.ok(invalid.errors.contactEmail);
  assert.ok(invalid.errors.contactPhone);

  const misplacedPlus = parseEventContactSettings({ ...valid, contactPhone: "91+9358535894" });
  assert.ok(misplacedPlus.errors.contactPhone);
});

check("WhatsApp accepts formatted input but refuses an invalid international number", () => {
  const invalid = parseEventContactSettings({ ...valid, whatsappNumber: "+0 123" });
  assert.ok(invalid.errors.whatsappNumber);
});

check("social links must use their own HTTPS platform and are canonicalized", () => {
  const invalid = parseEventContactSettings({ ...valid, instagramUrl: "https://instagram.com.evil.example/" });
  assert.ok(invalid.errors.instagramUrl);

  const normalized = parseEventContactSettings({ ...valid, instagramUrl: "HTTPS://WWW.Instagram.com/savriya" });
  assert.equal(normalized.errors.instagramUrl, undefined);
  assert.equal(normalized.values.instagramUrl, "https://www.instagram.com/savriya");
});

check("maps links require HTTPS and support hours are capped at six lines", () => {
  const invalid = parseEventContactSettings({
    ...valid,
    mapsUrl: "javascript:alert(1)",
    supportHours: "1\n2\n3\n4\n5\n6\n7",
  });
  assert.ok(invalid.errors.mapsUrl);
  assert.ok(invalid.errors.supportHours);
});

check("event basics validate: required fields present, optional copy can be blanked", () => {
  const real = parseEventBasicsSettings({
    name: "Garba Night ×9",
    slug: "navratri-2026-jaipur",
    status: "published",
    tagline: "Jaipur's largest Navratri celebration",
    description: "Nine nights of garba, dandiya raas and live music.",
    venueName: "My Village Garden",
    city: "Jaipur",
    state: "Rajasthan",
    currency: "INR",
  });
  assert.equal(isCleanEventBasicsSettings(real.errors), true);
  assert.equal(real.values.state, "Rajasthan");

  const missing = parseEventBasicsSettings({ name: "  ", slug: "", status: "", venueName: "", city: "", currency: "" });
  assert.ok(missing.errors.name);
  assert.ok(missing.errors.slug);
  assert.ok(missing.errors.status);
  assert.ok(missing.errors.venueName);
  assert.ok(missing.errors.city);
  assert.ok(missing.errors.currency);

  const optionalBlank = parseEventBasicsSettings({
    name: "Garba Night ×9",
    slug: "navratri-2026-jaipur",
    status: "draft",
    venueName: "MV Garden",
    city: "Jaipur",
    currency: "INR",
  });
  assert.equal(isCleanEventBasicsSettings(optionalBlank.errors), true);
  assert.equal(optionalBlank.values.tagline, null);
  assert.equal(optionalBlank.values.description, null);
  assert.equal(optionalBlank.values.state, null);
});

check("event basics validate slug, status and currency", () => {
  const real = parseEventBasicsSettings({
    name: "Garba Night",
    slug: "navratri-2026-jaipur",
    status: "published",
    venueName: "My Village Garden",
    city: "Jaipur",
    currency: "inr",
  });
  assert.equal(isCleanEventBasicsSettings(real.errors), true);
  assert.equal(real.values.currency, "INR");

  const badSlug = parseEventBasicsSettings({ name: "X", slug: "Bad Slug!", status: "published", venueName: "V", city: "C", currency: "INR" });
  assert.ok(badSlug.errors.slug);

  const badStatus = parseEventBasicsSettings({ name: "X", slug: "ok-slug", status: "live", venueName: "V", city: "C", currency: "INR" });
  assert.ok(badStatus.errors.status);

  const badCurrency = parseEventBasicsSettings({ name: "X", slug: "ok-slug", status: "draft", venueName: "V", city: "C", currency: "IN" });
  assert.ok(badCurrency.errors.currency);
});

check("site content validates lengths, splits one checklist point per line and keeps filled FAQs", () => {
  const parsed = parseSiteContentSettings({
    aboutTitle: "Our festival",
    aboutBody: "Nine nights with live dhol.",
    aboutPoints: "Family zone\nMedical desk\n\nQR entry",
    galleryTitle: "Our dance floor",
    galleryIntro: "Photos from every night.",
    faqs: [
      { question: "Can children join?", answer: "Yes, with a family pass." },
      { question: "", answer: "" },
    ],
  });
  assert.equal(isCleanSiteContentSettings(parsed.errors), true);
  assert.deepEqual(parsed.values.aboutPoints, ["Family zone", "Medical desk", "QR entry"]);
  assert.deepEqual(parsed.values.faqs, [{ question: "Can children join?", answer: "Yes, with a family pass." }]);

  const invalid = parseSiteContentSettings({ faqs: [{ question: "Only a question", answer: "" }] });
  assert.ok(invalid.errors.faqs);

  const tooLong = parseSiteContentSettings({ faqs: Array.from({ length: 7 }, (_, i) => ({ question: `Q${i}`, answer: "A" })) });
  assert.ok(tooLong.errors.faqs);

  const tooManyPoints = parseSiteContentSettings({ aboutPoints: "1\n2\n3\n4\n5\n6\n7" });
  assert.ok(tooManyPoints.errors.aboutPoints);
});

check("site content reading is tolerant: bad jsonb collapses to page defaults", () => {
  assert.deepEqual(parseSiteContentJson(null), {
    aboutTitle: null,
    aboutBody: null,
    aboutPoints: [],
    galleryTitle: null,
    galleryIntro: null,
    faqs: [],
  });

  const mixed = parseSiteContentJson({
    aboutTitle: "Saved title",
    aboutPoints: [" A ", 42, "B"],
    faqs: [{ question: "Q", answer: "A" }, { question: "only" }, "junk"],
    galleryIntro: 12,
  });
  assert.equal(mixed.aboutTitle, "Saved title");
  assert.deepEqual(mixed.aboutPoints, ["A", "B"]);
  assert.deepEqual(mixed.faqs, [{ question: "Q", answer: "A" }]);
  assert.equal(mixed.galleryIntro, null);
});

check("the WhatsApp button uses the recognizable filled brand mark", () => {
  const icons = readFileSync(new URL("../../src/components/icons/index.tsx", import.meta.url), "utf8");
  assert.match(icons, /export function WhatsAppIcon[\s\S]*?viewBox="0 0 448 512"[\s\S]*?fill="currentColor"[\s\S]*?M380\.9 97\.1/);
});

console.log(`\n${passed} passed, 0 failed`);
