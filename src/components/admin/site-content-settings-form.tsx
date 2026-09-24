"use client";

import { useState, type FormEvent } from "react";

import { useCatalogueSave } from "@/components/admin/use-catalogue-save";
import { Button } from "@/components/ui/button";
import { PlusIcon, CloseIcon } from "@/components/icons";
import { TextAreaField, TextField } from "@/components/ui/field";
import {
  isCleanSiteContentSettings,
  parseSiteContentSettings,
} from "@/lib/admin/event-settings";
import { SITE_CONTENT_LIMITS, emptySiteContent } from "@/lib/site-content";
import type { SiteContent } from "@/types";
import type {
  EventSettings,
  SiteContentSettingsErrors,
  SiteContentSettingsInput,
} from "@/types/event-settings";

const EMPTY_FAQ = { question: "", answer: "" };

function inputFromSiteContent(content: SiteContent): SiteContentSettingsInput {
  return {
    aboutTitle: content.aboutTitle ?? "",
    aboutBody: content.aboutBody ?? "",
    aboutPoints: content.aboutPoints.join("\n"),
    galleryTitle: content.galleryTitle ?? "",
    galleryIntro: content.galleryIntro ?? "",
    faqs: content.faqs.map((faq) => ({ question: faq.question, answer: faq.answer })),
  };
}

function ReadOnlySection({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted/70 text-[0.6875rem] font-semibold tracking-widest uppercase">{label}</dt>
      <dd className="font-medium break-words whitespace-pre-line">{value || "Site default"}</dd>
    </div>
  );
}

/**
 * Editable public copy: the About Us story, the gallery heading and the
 * "Questions before booking" FAQs. Leaving a field blank stores nothing, so
 * the public page goes back to its built-in default text — the organiser can
 * never accidentally blank the site.
 */
export function SiteContentSettingsForm({
  event,
  canEdit,
}: {
  event: EventSettings;
  canEdit: boolean;
}) {
  const [form, setForm] = useState(() => inputFromSiteContent(event.siteContent));
  const [errors, setErrors] = useState<SiteContentSettingsErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const save = useCatalogueSave<EventSettings>();

  function setFaq(index: number, patch: Partial<typeof EMPTY_FAQ>) {
    setForm((current) => ({
      ...current,
      faqs: current.faqs.map((faq, i) => (i === index ? { ...faq, ...patch } : faq)),
    }));
  }

  function removeFaq(index: number) {
    setForm((current) => ({ ...current, faqs: current.faqs.filter((_, i) => i !== index) }));
  }

  function addFaq() {
    setForm((current) =>
      current.faqs.length >= SITE_CONTENT_LIMITS.faqsMax
        ? current
        : { ...current, faqs: [...current.faqs, { ...EMPTY_FAQ }] },
    );
  }

  async function submit(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    setNotice(null);
    setFormError(null);

    const parsed = parseSiteContentSettings(form);
    setErrors(parsed.errors);

    if (!isCleanSiteContentSettings(parsed.errors)) {
      return;
    }

    const result = await save.send("/api/admin/settings", { action: "save-content", settings: form });

    if (result.ok) {
      setForm(inputFromSiteContent(result.data.siteContent));
      setErrors({});
      setNotice("Site content saved. The About, Gallery and Contact pages now use this copy.");
      return;
    }

    if (result.error.field && (result.error.field in form || result.error.field === "faqs")) {
      setErrors((current) => ({
        ...current,
        [result.error.field as keyof SiteContentSettingsErrors]: result.error.message,
      }));
    } else {
      setFormError(result.error.message);
    }
  }

  if (!canEdit) {
    return (
      <section className="border-border bg-surface/50 flex flex-col gap-4 rounded-2xl border p-5">
        <h2 className="text-sm font-semibold tracking-tight">About Us, gallery and FAQs</h2>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <ReadOnlySection label="About Us title" value={event.siteContent.aboutTitle ?? ""} />
          <ReadOnlySection label="About Us text" value={event.siteContent.aboutBody ?? ""} />
          <ReadOnlySection label="About Us checklist" value={event.siteContent.aboutPoints.join("\n")} />
          <ReadOnlySection label="Gallery title" value={event.siteContent.galleryTitle ?? ""} />
          <ReadOnlySection label="Gallery intro" value={event.siteContent.galleryIntro ?? ""} />
          <ReadOnlySection
            label="FAQs"
            value={event.siteContent.faqs.map((faq) => `${faq.question}\n${faq.answer}`).join("\n\n")}
          />
        </dl>
      </section>
    );
  }

  return (
    <section className="border-border bg-surface/50 flex flex-col gap-4 rounded-2xl border p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold tracking-tight">About Us, gallery and FAQs</h2>
        <p className="text-muted text-sm/6">
          Edit the story on the About page, the heading on the gallery and the “Questions before booking” section on
          the contact page. Leave any field blank to show the site&apos;s original default text — nothing disappears.
        </p>
      </div>

      <form className="flex flex-col gap-5" onSubmit={(submitEvent) => void submit(submitEvent)} noValidate>
        <div className="flex flex-col gap-4">
          <p className="text-muted/70 border-border border-t pt-4 text-xs font-semibold tracking-widest uppercase">
            About Us page
          </p>
          <TextField
            label="About Us title"
            name="aboutTitle"
            autoComplete="off"
            value={form.aboutTitle}
            onChange={(value) => setForm((current) => ({ ...current, aboutTitle: value }))}
            error={errors.aboutTitle}
            hint={
              "Blank shows the default: “[N] nights of garba, dandiya and live music” (max " +
              `${SITE_CONTENT_LIMITS.aboutTitle} characters)`
            }
          />
          <TextAreaField
            label="About Us text"
            name="aboutBody"
            rows={5}
            value={form.aboutBody}
            onChange={(value) => setForm((current) => ({ ...current, aboutBody: value }))}
            error={errors.aboutBody}
            hint="Blank shows the default dhol, garba-raas and dandiya description."
            maxLength={SITE_CONTENT_LIMITS.aboutBody}
          />
          <TextAreaField
            label="About Us checklist"
            name="aboutPoints"
            rows={4}
            value={form.aboutPoints}
            onChange={(value) => setForm((current) => ({ ...current, aboutPoints: value }))}
            error={errors.aboutPoints}
            hint={`One point per line, up to ${SITE_CONTENT_LIMITS.aboutPointsMax}. Blank shows the default three points (family zone, medical desk, QR entry).`}
          />
        </div>

        <div className="flex flex-col gap-4">
          <p className="text-muted/70 border-border border-t pt-4 text-xs font-semibold tracking-widest uppercase">
            Gallery
          </p>
          <TextField
            label="Gallery title"
            name="galleryTitle"
            autoComplete="off"
            value={form.galleryTitle}
            onChange={(value) => setForm((current) => ({ ...current, galleryTitle: value }))}
            error={errors.galleryTitle}
            hint={
              "Blank shows “Moments from the dance floor” / “Nights we are still talking about” (max " +
              `${SITE_CONTENT_LIMITS.galleryTitle} characters)`
            }
          />
          <TextAreaField
            label="Gallery intro"
            name="galleryIntro"
            rows={2}
            value={form.galleryIntro}
            onChange={(value) => setForm((current) => ({ ...current, galleryIntro: value }))}
            error={errors.galleryIntro}
            hint="Blank shows the default “published by the organiser” noting-under-the-title text."
            maxLength={SITE_CONTENT_LIMITS.galleryIntro}
          />
        </div>

        <div className="flex flex-col gap-4">
          <p className="text-muted/70 border-border border-t pt-4 text-xs font-semibold tracking-widest uppercase">
            Questions before booking
          </p>

          {form.faqs.length === 0 ? (
            <p className="text-muted text-sm/6">
              The contact page currently shows the default four questions (partner for garba, family section, QR
              entry, corporate groups). Add rows here to write your own instead.
            </p>
          ) : null}

          {form.faqs.map((faq, index) => (
            <div
              key={`faq-${index}`}
              className="border-border/70 bg-surface/60 relative flex flex-col gap-3 rounded-xl border p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-muted/80 text-xs font-semibold tracking-widest uppercase">
                  Question {index + 1}
                </p>
                <button
                  type="button"
                  onClick={() => removeFaq(index)}
                  className="text-muted hover:text-rani-soft inline-flex items-center gap-1 text-xs font-semibold"
                  aria-label={`Remove question ${index + 1}`}
                >
                  <CloseIcon className="size-3.5" />
                  Remove
                </button>
              </div>
              <TextField
                label="Question"
                name={`faq-question-${index}`}
                value={faq.question}
                onChange={(value) => setFaq(index, { question: value })}
              />
              <TextAreaField
                label="Answer"
                name={`faq-answer-${index}`}
                rows={2}
                value={faq.answer}
                onChange={(value) => setFaq(index, { answer: value })}
                maxLength={SITE_CONTENT_LIMITS.faqAnswer}
              />
            </div>
          ))}

          {errors.faqs ? (
            <p role="alert" className="text-rani-soft text-sm">
              {errors.faqs}
            </p>
          ) : null}

          <div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={addFaq}
              disabled={form.faqs.length >= SITE_CONTENT_LIMITS.faqsMax}
            >
              <PlusIcon className="size-4" />
              Add a question
            </Button>
          </div>
        </div>

        {formError ? (
          <p role="alert" className="border-rani/40 bg-rani/5 text-rani-soft rounded-xl border px-3.5 py-2.5 text-sm">
            {formError}
          </p>
        ) : null}

        {notice ? (
          <p role="status" className="border-peacock/40 bg-peacock/5 text-peacock-soft rounded-xl border px-3.5 py-2.5 text-sm">
            {notice}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={save.pending} className="h-11 px-5">
            {save.pending ? "Saving…" : "Save site content"}
          </Button>
          <p className="text-muted text-xs">
            Empty fields fall back to the original site text, so nothing on the public pages ever goes blank.
          </p>
        </div>
      </form>
    </section>
  );
}
