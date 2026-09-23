"use client";

import { useMemo, useState } from "react";

import { useCatalogueSave } from "@/components/admin/use-catalogue-save";
import { Button } from "@/components/ui/button";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { PASS_LIMITS, parsePassForm } from "@/lib/admin/catalogue";
import type { AdminPassType } from "@/types/catalogue";

/**
 * The form an organiser actually uses to price a pass.
 *
 * Two kinds of validation meet here, and it is worth being clear about which is
 * which:
 *
 *   * The rules this form can check on its own — a name, a whole-rupee price, an age
 *     between 0 and 120 — run as you type, through `parsePassForm`, which is the same
 *     function the API route runs on the payload it receives. Same module, both
 *     sides: the browser's copy cannot drift from the server's.
 *   * The rules that need the database — is this code already used, is the pass still
 *     there — come back from the server as a code and a sentence, and land under the
 *     field they belong to.
 *
 * Nothing is saved optimistically: the row shown after a save is the row the
 * database returned.
 */

type Draft = {
  code: string;
  name: string;
  composition: string;
  description: string;
  priceInr: string;
  numberOfPeople: string;
  maxPerBooking: string;
  minAge: string;
  sortOrder: string;
  isActive: boolean;
};

function draftFrom(pass: AdminPassType | null, nextSortOrder: number): Draft {
  return {
    code: pass?.code ?? "",
    name: pass?.name ?? "",
    composition: pass?.composition ?? "",
    description: pass?.description ?? "",
    priceInr: pass ? String(pass.priceInr) : "",
    numberOfPeople: pass ? String(pass.numberOfPeople) : "2",
    maxPerBooking: pass ? String(pass.maxPerBooking) : "10",
    minAge: pass ? String(pass.minAge) : "0",
    sortOrder: pass ? String(pass.sortOrder) : String(nextSortOrder),
    isActive: pass?.isActive ?? true,
  };
}

export function PassTypeForm({
  pass,
  nextSortOrder,
  onCancel,
  onSaved,
}: {
  /** The pass being edited, or null when this is a new one. */
  pass: AdminPassType | null;
  nextSortOrder: number;
  onCancel: () => void;
  onSaved: (saved: AdminPassType) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(pass, nextSortOrder));
  const [touched, setTouched] = useState(false);
  const { send, pending, error } = useCatalogueSave<AdminPassType>();

  const parsed = useMemo(
    () =>
      parsePassForm({
        id: pass?.id ?? null,
        code: draft.code,
        name: draft.name,
        composition: draft.composition,
        description: draft.description,
        priceInr: draft.priceInr,
        numberOfPeople: draft.numberOfPeople,
        maxPerBooking: draft.maxPerBooking,
        minAge: draft.minAge,
        sortOrder: draft.sortOrder,
        isActive: draft.isActive,
      }),
    [draft, pass?.id],
  );

  // Field errors are shown after the first submit attempt, and always for the field
  // the server complained about — so a form does not shout at somebody who is still
  // halfway through typing their first pass.
  const showing = touched || Boolean(error?.field);
  const fieldError = (field: keyof Draft) =>
    (showing ? parsed.errors[field as keyof typeof parsed.errors] : undefined) ??
    (error?.field === field ? error.message : undefined);

  const set = (field: keyof Draft, value: string | boolean) =>
    setDraft((current) => ({ ...current, [field]: value }));

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);

    if (!parsed || Object.values(parsed.errors).some(Boolean)) {
      return;
    }

    const result = await send("/api/admin/passes", {
      action: "save",
      pass: {
        id: pass?.id ?? null,
        code: draft.code,
        name: draft.name,
        composition: draft.composition,
        description: draft.description,
        priceInr: draft.priceInr,
        numberOfPeople: draft.numberOfPeople,
        maxPerBooking: draft.maxPerBooking,
        minAge: draft.minAge,
        sortOrder: draft.sortOrder,
        isActive: draft.isActive,
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
      aria-label={pass ? `Edit ${pass.name}` : "Add a pass type"}
      className="border-marigold/40 bg-surface/60 flex flex-col gap-5 rounded-2xl border p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-tight">
          {pass ? `Edit ${pass.name}` : "Add a pass type"}
        </h3>
        {pass ? (
          <p className="text-muted/80 font-mono text-[0.6875rem]">
            {pass.paidBookings > 0
              ? `${pass.paidBookings} paid booking${pass.paidBookings === 1 ? "" : "s"} — the price only applies to new bookings`
              : "Not sold yet"}
          </p>
        ) : null}
      </div>

      {error && !error.field ? (
        <p role="alert" className="border-rani/40 bg-rani/5 text-rani-soft rounded-xl border px-3.5 py-2.5 text-sm">
          {error.message}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Name"
          name="name"
          value={draft.name}
          onChange={(value) => set("name", value)}
          error={fieldError("name")}
          hint="What guests see on the booking page, e.g. Duo Pass."
          placeholder="Duo Pass"
          required
          disabled={pending}
        />

        <TextField
          label="Code"
          name="code"
          value={draft.code}
          onChange={(value) => set("code", value)}
          error={fieldError("code")}
          hint="Short handle the ticket desk quotes. Left blank, it is generated from the name."
          placeholder="girls-2"
          disabled={pending}
        />

        <TextField
          label="Composition"
          name="composition"
          value={draft.composition}
          onChange={(value) => set("composition", value)}
          error={fieldError("composition")}
          hint="Who the pass admits, e.g. “2 Girls”."
          placeholder="2 Girls"
          required
          disabled={pending}
        />

        <TextField
          label="Price (₹)"
          name="priceInr"
          type="number"
          inputMode="numeric"
          min={PASS_LIMITS.priceMin}
          max={PASS_LIMITS.priceMax}
          value={draft.priceInr}
          onChange={(value) => set("priceInr", value)}
          error={fieldError("priceInr")}
          hint={`Whole rupees, from ${PASS_LIMITS.priceMin} to ${PASS_LIMITS.priceMax.toLocaleString("en-IN")}.`}
          placeholder="399"
          required
          disabled={pending}
        />

        <TextField
          label="People per pass"
          name="numberOfPeople"
          type="number"
          inputMode="numeric"
          min={PASS_LIMITS.peopleMin}
          max={PASS_LIMITS.peopleMax}
          value={draft.numberOfPeople}
          onChange={(value) => set("numberOfPeople", value)}
          error={fieldError("numberOfPeople")}
          hint="How many people one pass admits. This is what capacity is counted in."
          required
          disabled={pending}
        />

        <TextField
          label="Maximum per booking"
          name="maxPerBooking"
          type="number"
          inputMode="numeric"
          min={PASS_LIMITS.maxPerBookingMin}
          max={PASS_LIMITS.maxPerBookingMax}
          value={draft.maxPerBooking}
          onChange={(value) => set("maxPerBooking", value)}
          error={fieldError("maxPerBooking")}
          hint="How many of these one guest may buy at a time."
          required
          disabled={pending}
        />

        <TextField
          label="Minimum age"
          name="minAge"
          type="number"
          inputMode="numeric"
          min={PASS_LIMITS.minAgeMin}
          max={PASS_LIMITS.minAgeMax}
          value={draft.minAge}
          onChange={(value) => set("minAge", value)}
          error={fieldError("minAge")}
          hint="0 means no age restriction. Shown on the pass card and checked at the door."
          disabled={pending}
        />

        <TextField
          label="Display order"
          name="sortOrder"
          type="number"
          inputMode="numeric"
          min={0}
          max={PASS_LIMITS.sortOrderMax}
          value={draft.sortOrder}
          onChange={(value) => set("sortOrder", value)}
          error={fieldError("sortOrder")}
          hint="Lowest first, where the passes are listed."
          disabled={pending}
        />

        <TextAreaField
          label="Description"
          name="description"
          value={draft.description}
          onChange={(value) => set("description", value)}
          error={fieldError("description")}
          maxLength={PASS_LIMITS.descriptionMax}
          hint="One or two lines under the pass name."
          placeholder="Entry for two, ideal for a friends’ pair."
          disabled={pending}
          className="sm:col-span-2"
        />

        <SelectField
          label="On sale"
          name="isActive"
          value={draft.isActive ? "true" : "false"}
          onChange={(value) => set("isActive", value === "true")}
          options={[
            { value: "true", label: "On sale — bookable on the website" },
            { value: "false", label: "Off sale — shown as not on sale" },
          ]}
          hint="An off-sale pass keeps its bookings and its history; it just cannot be bought."
          disabled={pending}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending} className="h-11 px-5">
          {pending ? "Saving…" : pass ? "Save changes" : "Create pass type"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending} className="h-11 px-5">
          Cancel
        </Button>
      </div>
    </form>
  );
}
