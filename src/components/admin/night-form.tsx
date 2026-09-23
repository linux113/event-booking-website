"use client";

import { useMemo, useState } from "react";

import { useCatalogueSave } from "@/components/admin/use-catalogue-save";
import { Button } from "@/components/ui/button";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { NIGHT_LIMITS, NIGHT_STATUS_OPTIONS, parseNightForm } from "@/lib/admin/catalogue";
import type { AdminNight } from "@/types/catalogue";

/**
 * Add or edit a night.
 *
 * The same two-layer validation as the pass form: the rules this form can check —
 * a real calendar date, capacity of at least one, an end after a start — run through
 * `parseNightForm`, which the API route runs again on what it receives; the rules
 * that need the database (does this event already have that date, is the capacity
 * below what has been paid for) come back as a code and land under the field.
 *
 * The one thing worth pointing out to an organiser is on the seat fields: capacity
 * is the room, and "held back" is the part of it that is not sold online. The two
 * numbers together are what the website offers.
 */

type Draft = {
  date: string;
  startTime: string;
  endTime: string;
  capacity: string;
  capacityHeld: string;
  status: string;
  bookingOpen: boolean;
  notes: string;
};

function draftFrom(night: AdminNight | null): Draft {
  return {
    date: night?.date ?? "",
    // `HH:MM:SS` from Postgres, `HH:MM` for the input.
    startTime: night?.startTime?.slice(0, 5) ?? "19:00",
    endTime: night?.endTime?.slice(0, 5) ?? "23:30",
    capacity: night ? String(night.capacity) : "500",
    capacityHeld: night ? String(night.capacityHeld) : "0",
    status: night?.status ?? "scheduled",
    bookingOpen: night?.bookingOpen ?? true,
    notes: night?.notes ?? "",
  };
}

export function NightForm({
  night,
  onCancel,
  onSaved,
}: {
  night: AdminNight | null;
  onCancel: () => void;
  onSaved: (saved: AdminNight) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(night));
  const [touched, setTouched] = useState(false);
  const { send, pending, error } = useCatalogueSave<AdminNight>();

  const parsed = useMemo(
    () =>
      parseNightForm({
        id: night?.id ?? null,
        date: draft.date,
        startTime: draft.startTime,
        endTime: draft.endTime,
        capacity: draft.capacity,
        capacityHeld: draft.capacityHeld,
        status: draft.status,
        bookingOpen: draft.bookingOpen,
        notes: draft.notes,
      }),
    [draft, night?.id],
  );

  const showing = touched || Boolean(error?.field);
  const fieldError = (field: keyof Draft) =>
    (showing ? parsed.errors[field as keyof typeof parsed.errors] : undefined) ??
    (error?.field === field ? error.message : undefined);

  const set = (field: keyof Draft, value: string | boolean) =>
    setDraft((current) => ({ ...current, [field]: value }));

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);

    if (Object.values(parsed.errors).some(Boolean)) {
      return;
    }

    const result = await send("/api/admin/dates", {
      action: "save",
      night: {
        id: night?.id ?? null,
        date: draft.date,
        startTime: draft.startTime,
        endTime: draft.endTime,
        capacity: draft.capacity,
        capacityHeld: draft.capacityHeld,
        status: draft.status,
        bookingOpen: draft.bookingOpen,
        notes: draft.notes,
      },
    });

    if (result.ok) {
      onSaved(result.data);
    }
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label={night ? `Edit the night on ${night.date}` : "Add a night"}
      className="border-marigold/40 bg-surface/60 flex flex-col gap-5 rounded-2xl border p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-tight">
          {night ? "Edit this night" : "Add a night"}
        </h3>
        {night ? (
          <p className="text-muted/80 text-[0.6875rem]">
            {night.bookedPeople} people already paid for
            {night.bookedPeople > 0 ? " — the date cannot move while their passes are out" : ""}
          </p>
        ) : null}
      </div>

      {error && !error.field ? (
        <p role="alert" className="border-rani/40 bg-rani/5 text-rani-soft rounded-xl border px-3.5 py-2.5 text-sm">
          {error.message}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <TextField
          label="Date"
          name="date"
          type="text"
          value={draft.date}
          onChange={(value) => set("date", value)}
          error={fieldError("date")}
          hint="YYYY-MM-DD, e.g. 2026-10-17. One night per date."
          placeholder="2026-10-17"
          required
          disabled={pending}
        />

        <TextField
          label="Doors / start"
          name="startTime"
          value={draft.startTime}
          onChange={(value) => set("startTime", value)}
          error={fieldError("startTime")}
          hint="24-hour, e.g. 19:00."
          placeholder="19:00"
          disabled={pending}
        />

        <TextField
          label="Ends"
          name="endTime"
          value={draft.endTime}
          onChange={(value) => set("endTime", value)}
          error={fieldError("endTime")}
          hint="When the night finishes, e.g. 23:30."
          placeholder="23:30"
          disabled={pending}
        />

        <TextField
          label="Capacity (people)"
          name="capacity"
          type="number"
          inputMode="numeric"
          min={NIGHT_LIMITS.capacityMin}
          max={NIGHT_LIMITS.capacityMax}
          value={draft.capacity}
          onChange={(value) => set("capacity", value)}
          error={fieldError("capacity")}
          hint="Everything the night holds, held-back seats included."
          required
          disabled={pending}
        />

        <TextField
          label="Seats held back"
          name="capacityHeld"
          type="number"
          inputMode="numeric"
          min={NIGHT_LIMITS.heldMin}
          value={draft.capacityHeld}
          onChange={(value) => set("capacityHeld", value)}
          error={fieldError("capacityHeld")}
          hint="Not sold online: gate sales, sponsors, crew. Capacity minus this is what the website offers."
          disabled={pending}
        />

        <SelectField
          label="Night status"
          name="status"
          value={draft.status}
          onChange={(value) => set("status", value)}
          options={NIGHT_STATUS_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
          hint="Cancelling keeps the bookings and tells guests the night is off."
          disabled={pending}
        />

        <SelectField
          label="Booking"
          name="bookingOpen"
          value={draft.bookingOpen ? "true" : "false"}
          onChange={(value) => set("bookingOpen", value === "true")}
          options={[
            { value: "true", label: "Open — guests can book this night" },
            { value: "false", label: "Closed — no new bookings" },
          ]}
          hint="Closing stops booking without cancelling the night."
          disabled={pending}
        />

        <TextAreaField
          label="Note"
          name="notes"
          value={draft.notes}
          onChange={(value) => set("notes", value)}
          error={fieldError("notes")}
          maxLength={NIGHT_LIMITS.notesMax}
          hint="Internal only — never shown on the website."
          disabled={pending}
          className="sm:col-span-2 lg:col-span-3"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending} className="h-11 px-5">
          {pending ? "Saving…" : night ? "Save night" : "Add night"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending} className="h-11 px-5">
          Cancel
        </Button>
      </div>
    </form>
  );
}
