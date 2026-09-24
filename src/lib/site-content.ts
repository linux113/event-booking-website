import type { EventFaq, SiteContent } from "@/types";

/**
 * Site-content limits and the tolerant reader for the event row's
 * `site_content` jsonb.
 *
 * The column stores only what the organiser has typed; every page resolves
 * `null`/empty to its built-in default copy. Reading is deliberately tolerant —
 * a wrong type in one key must never blank the public site, because a page of
 * copy is optional dressing, never data integrity — while *saving* is strict
 * (`src/lib/admin/event-settings.ts` validates before the write).
 */

export const SITE_CONTENT_LIMITS = {
  aboutTitle: 160,
  aboutBody: 3000,
  aboutPointsMax: 6,
  aboutPointLength: 200,
  galleryTitle: 160,
  galleryIntro: 400,
  faqsMax: 6,
  faqQuestion: 200,
  faqAnswer: 600,
} as const;

/** An empty override set: every page falls back to its built-in copy. */
export function emptySiteContent(): SiteContent {
  return {
    aboutTitle: null,
    aboutBody: null,
    aboutPoints: [],
    galleryTitle: null,
    galleryIntro: null,
    faqs: [],
  };
}

function asNullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asTextList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, max);
}

function asFaq(value: unknown): EventFaq | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const question = typeof record.question === "string" ? record.question.trim() : "";
  const answer = typeof record.answer === "string" ? record.answer.trim() : "";
  return question && answer ? { question, answer } : null;
}

/**
 * Read the raw jsonb into a `SiteContent`. Anything that is not the expected
 * shape collapses to the empty override set — the public pages then show their
 * default copy instead of an error.
 */
export function parseSiteContentJson(value: unknown): SiteContent {
  const empty = emptySiteContent();
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return empty;
  }

  const record = value as Record<string, unknown>;
  const faqs = (Array.isArray(record.faqs) ? record.faqs : [])
    .map(asFaq)
    .filter((faq): faq is EventFaq => faq !== null)
    .slice(0, SITE_CONTENT_LIMITS.faqsMax);

  return {
    aboutTitle: asNullableText(record.aboutTitle),
    aboutBody: asNullableText(record.aboutBody),
    aboutPoints: asTextList(record.aboutPoints, SITE_CONTENT_LIMITS.aboutPointsMax),
    galleryTitle: asNullableText(record.galleryTitle),
    galleryIntro: asNullableText(record.galleryIntro),
    faqs,
  };
}

/** Serialise a validated override set for the jsonb write. */
export function siteContentToJson(content: SiteContent): string {
  return JSON.stringify(content);
}
