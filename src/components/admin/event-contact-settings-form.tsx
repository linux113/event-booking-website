"use client";

import { useState, type FormEvent } from "react";

import { useCatalogueSave } from "@/components/admin/use-catalogue-save";
import { Button } from "@/components/ui/button";
import { TextAreaField, TextField } from "@/components/ui/field";
import {
  isCleanEventContactSettings,
  parseEventContactSettings,
} from "@/lib/admin/event-settings";
import type {
  EventContactSettingsErrors,
  EventContactSettingsInput,
  EventSettings,
} from "@/types/event-settings";

function inputFromEvent(event: EventSettings): EventContactSettingsInput {
  return {
    contactPhone: event.contactPhone ?? "",
    contactEmail: event.contactEmail ?? "",
    whatsappNumber: event.whatsappNumber ?? "",
    venueAddress: event.venueAddress ?? "",
    mapsUrl: event.mapsUrl ?? "",
    instagramUrl: event.instagramUrl ?? "",
    facebookUrl: event.facebookUrl ?? "",
    youtubeUrl: event.youtubeUrl ?? "",
    supportHours: event.supportHours.join("\n"),
  };
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted/70 text-[0.6875rem] font-semibold tracking-widest uppercase">{label}</dt>
      <dd className="font-medium break-words">{value || "—"}</dd>
    </div>
  );
}

export function EventContactSettingsForm({
  event,
  canEdit,
}: {
  event: EventSettings;
  canEdit: boolean;
}) {
  const [form, setForm] = useState(() => inputFromEvent(event));
  const [errors, setErrors] = useState<EventContactSettingsErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const save = useCatalogueSave<EventSettings>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setFormError(null);

    const parsed = parseEventContactSettings(form);
    setErrors(parsed.errors);

    if (!isCleanEventContactSettings(parsed.errors)) {
      return;
    }

    const result = await save.send("/api/admin/settings", { action: "save-contact", settings: form });

    if (result.ok) {
      setForm(inputFromEvent(result.data));
      setErrors({});
      setNotice("Public contact and venue details saved. The site now uses these values.");
      return;
    }

    if (result.error.field && result.error.field in form) {
      setErrors((current) => ({
        ...current,
        [result.error.field as keyof EventContactSettingsInput]: result.error.message,
      }));
    } else {
      setFormError(result.error.message);
    }
  }

  if (!canEdit) {
    return (
      <section className="border-border bg-surface/50 flex flex-col gap-4 rounded-2xl border p-5">
        <h2 className="text-sm font-semibold tracking-tight">Public contact and venue</h2>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <ReadOnlyField label="Contact phone" value={event.contactPhone ?? ""} />
          <ReadOnlyField label="Contact email" value={event.contactEmail ?? ""} />
          <ReadOnlyField label="WhatsApp number" value={event.whatsappNumber ?? ""} />
          <ReadOnlyField label="Street address" value={event.venueAddress ?? ""} />
          <ReadOnlyField label="Maps URL" value={event.mapsUrl ?? ""} />
          <ReadOnlyField label="Instagram" value={event.instagramUrl ?? ""} />
          <ReadOnlyField label="Facebook" value={event.facebookUrl ?? ""} />
          <ReadOnlyField label="YouTube" value={event.youtubeUrl ?? ""} />
          <ReadOnlyField label="Support hours" value={event.supportHours.join(" · ")} />
        </dl>
      </section>
    );
  }

  return (
    <section className="border-border bg-surface/50 flex flex-col gap-4 rounded-2xl border p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold tracking-tight">Public contact and venue</h2>
        <p className="text-muted text-sm/6">
          These details build the phone, email, WhatsApp, map and social links across the site. Changes are saved to
          the event shown above and take effect without a code deploy.
        </p>
      </div>

      <form className="flex flex-col gap-4" onSubmit={(submitEvent) => void submit(submitEvent)} noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Phone shown to visitors"
            name="contactPhone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={form.contactPhone}
            onChange={(value) => setForm((current) => ({ ...current, contactPhone: value }))}
            error={errors.contactPhone}
            hint="Printed as entered; the call button uses the phone digits. Leave blank to use the deployment fallback."
          />
          <TextField
            label="Contact email"
            name="contactEmail"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={form.contactEmail}
            onChange={(value) => setForm((current) => ({ ...current, contactEmail: value }))}
            error={errors.contactEmail}
            hint="Used for the site's mailto links. Leave blank to use the deployment fallback."
          />
          <TextField
            label="WhatsApp number"
            name="whatsappNumber"
            type="tel"
            inputMode="tel"
            value={form.whatsappNumber}
            onChange={(value) => setForm((current) => ({ ...current, whatsappNumber: value }))}
            error={errors.whatsappNumber}
            hint="International number. Spaces or a leading + are accepted and stored as digits; blank falls back to the phone, then the deployment setting."
          />
          <TextField
            label="Street address"
            name="venueAddress"
            value={form.venueAddress}
            onChange={(value) => setForm((current) => ({ ...current, venueAddress: value }))}
            error={errors.venueAddress}
            hint={`Venue name, ${event.venueName}, and ${[event.city, event.state].filter(Boolean).join(", ")} are shown separately. Enter only the street or area here.`}
          />
          <TextField
            label="Maps URL"
            name="mapsUrl"
            value={form.mapsUrl}
            onChange={(value) => setForm((current) => ({ ...current, mapsUrl: value }))}
            error={errors.mapsUrl}
            hint="Use a full HTTPS link to the venue pin; leave empty to search the address."
          />
          <TextField
            label="Instagram profile URL"
            name="instagramUrl"
            value={form.instagramUrl}
            onChange={(value) => setForm((current) => ({ ...current, instagramUrl: value }))}
            error={errors.instagramUrl}
            hint="HTTPS link on instagram.com, or leave empty."
          />
          <TextField
            label="Facebook profile URL"
            name="facebookUrl"
            value={form.facebookUrl}
            onChange={(value) => setForm((current) => ({ ...current, facebookUrl: value }))}
            error={errors.facebookUrl}
            hint="HTTPS link on facebook.com or fb.com, or leave empty."
          />
          <TextField
            label="YouTube channel URL"
            name="youtubeUrl"
            value={form.youtubeUrl}
            onChange={(value) => setForm((current) => ({ ...current, youtubeUrl: value }))}
            error={errors.youtubeUrl}
            hint="HTTPS link on youtube.com or youtu.be, or leave empty."
          />
        </div>

        <TextAreaField
          label="Support hours"
          name="supportHours"
          rows={3}
          value={form.supportHours}
          onChange={(value) => setForm((current) => ({ ...current, supportHours: value }))}
          error={errors.supportHours}
          hint="One line per time window, up to six lines. Leave empty to use the site's default hours."
          placeholder={'Monday – Saturday · 10:00 AM – 8:00 PM\nFestival days · 10:00 AM – 11:00 PM'}
          maxLength={1000}
        />

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
            {save.pending ? "Saving…" : "Save contact details"}
          </Button>
          <p className="text-muted text-xs">WhatsApp numbers are stored in international digits-only format.</p>
        </div>
      </form>
    </section>
  );
}
