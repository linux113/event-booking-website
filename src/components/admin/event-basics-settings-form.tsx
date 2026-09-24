"use client";

import { useState, type FormEvent } from "react";

import { useCatalogueSave } from "@/components/admin/use-catalogue-save";
import { Button } from "@/components/ui/button";
import { TextAreaField, TextField } from "@/components/ui/field";
import {
  isCleanEventBasicsSettings,
  parseEventBasicsSettings,
} from "@/lib/admin/event-settings";
import type {
  EventBasicsSettingsErrors,
  EventBasicsSettingsInput,
  EventSettings,
} from "@/types/event-settings";

function inputFromEvent(event: EventSettings): EventBasicsSettingsInput {
  return {
    name: event.name,
    tagline: event.tagline ?? "",
    description: event.description ?? "",
    venueName: event.venueName,
    city: event.city,
    state: event.state ?? "",
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

/**
 * "About the event" editor: the name, tagline and description the hero and the
 * About sections print, plus the venue names. The street address and the map
 * link stay with the contact form below.
 */
export function EventBasicsSettingsForm({
  event,
  canEdit,
}: {
  event: EventSettings;
  canEdit: boolean;
}) {
  const [form, setForm] = useState(() => inputFromEvent(event));
  const [errors, setErrors] = useState<EventBasicsSettingsErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const save = useCatalogueSave<EventSettings>();

  async function submit(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    setNotice(null);
    setFormError(null);

    const parsed = parseEventBasicsSettings(form);
    setErrors(parsed.errors);

    if (!isCleanEventBasicsSettings(parsed.errors)) {
      return;
    }

    const result = await save.send("/api/admin/settings", { action: "save-basics", settings: form });

    if (result.ok) {
      setForm(inputFromEvent(result.data));
      setErrors({});
      setNotice("Event details saved. The hero and About sections now use these values.");
      return;
    }

    if (result.error.field && result.error.field in form) {
      setErrors((current) => ({
        ...current,
        [result.error.field as keyof EventBasicsSettingsInput]: result.error.message,
      }));
    } else {
      setFormError(result.error.message);
    }
  }

  if (!canEdit) {
    return (
      <section className="border-border bg-surface/50 flex flex-col gap-4 rounded-2xl border p-5">
        <h2 className="text-sm font-semibold tracking-tight">About the event</h2>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <ReadOnlyField label="Event name" value={event.name} />
          <ReadOnlyField label="Tagline" value={event.tagline ?? ""} />
          <ReadOnlyField label="Description" value={event.description ?? ""} />
          <ReadOnlyField label="Venue name" value={event.venueName} />
          <ReadOnlyField label="City" value={event.city} />
          <ReadOnlyField label="State" value={event.state ?? ""} />
        </dl>
      </section>
    );
  }

  return (
    <section className="border-border bg-surface/50 flex flex-col gap-4 rounded-2xl border p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold tracking-tight">About the event</h2>
        <p className="text-muted text-sm/6">
          The name and tagline headline the homepage hero; the description is the &ldquo;About the event&rdquo; text
          next to the artwork on the homepage and on the About page. Saved changes go live without a deployment.
        </p>
      </div>

      <form className="flex flex-col gap-4" onSubmit={(submitEvent) => void submit(submitEvent)} noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Event name"
            name="name"
            autoComplete="off"
            value={form.name}
            onChange={(value) => setForm((current) => ({ ...current, name: value }))}
            error={errors.name}
            hint="Shown everywhere the event is named — the hero, page titles and passes."
          />
          <TextField
            label="Tagline"
            name="tagline"
            autoComplete="off"
            value={form.tagline}
            onChange={(value) => setForm((current) => ({ ...current, tagline: value }))}
            error={errors.tagline}
            hint="One line under the event name, and the About-heading on the homepage."
          />
        </div>

        <TextAreaField
          label="Description — “About the event”"
          name="description"
          rows={4}
          value={form.description}
          onChange={(value) => setForm((current) => ({ ...current, description: value }))}
          error={errors.description}
          hint="The paragraph visitors read on the homepage and About page to know what the event is."
          maxLength={2000}
        />

        <div className="grid gap-4 sm:grid-cols-3">
          <TextField
            label="Venue name"
            name="venueName"
            autoComplete="off"
            value={form.venueName}
            onChange={(value) => setForm((current) => ({ ...current, venueName: value }))}
            error={errors.venueName}
            hint="The venue block on every page uses this with the city."
          />
          <TextField
            label="City"
            name="city"
            autoComplete="off"
            value={form.city}
            onChange={(value) => setForm((current) => ({ ...current, city: value }))}
            error={errors.city}
          />
          <TextField
            label="State"
            name="state"
            autoComplete="off"
            value={form.state}
            onChange={(value) => setForm((current) => ({ ...current, state: value }))}
            error={errors.state}
          />
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
            {save.pending ? "Saving…" : "Save event details"}
          </Button>
          <p className="text-muted text-xs">Blank tagline/description fields hide those lines on the public site.</p>
        </div>
      </form>
    </section>
  );
}
