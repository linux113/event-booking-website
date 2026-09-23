"use client";

import { useState } from "react";

import { NightForm } from "@/components/admin/night-form";
import { StatusPill, type StatusTone } from "@/components/admin/status-pill";
import { useCatalogueSave } from "@/components/admin/use-catalogue-save";
import { Button, buttonClasses } from "@/components/ui/button";
import { capacityCopy, capacityPercent, nightState } from "@/lib/admin/catalogue";
import { formatEventDate, formatTimeRange } from "@/lib/format";
import type { AdminNight } from "@/types/catalogue";

/**
 * The dates screen: one row per night, and the four decisions an organiser makes
 * about each of them — how many seats it has, how many are held back, whether it is
 * on sale, and whether booking is open.
 *
 * Two controls get their own buttons rather than living only inside the form,
 * because they are the ones used *during* an event, from a phone, minutes before the
 * gate opens:
 *
 *   * **capacity** — "the queue is longer than we thought". Setting it requires only
 *     a number, and the database refuses anything below what has already been paid
 *     for, answering with the floor so the control can say what it should be.
 *   * **booking open/closed** — "we are full, stop selling", without cancelling the
 *     night or touching its status.
 *
 * The seat arithmetic shown here (on sale, left, held) is the same arithmetic the
 * booking path uses; this screen only prints it.
 */
export function NightsPanel({
  nights,
  canEdit,
}: {
  nights: readonly AdminNight[];
  canEdit: boolean;
}) {
  const [rows, setRows] = useState<AdminNight[]>([...nights]);
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [capacityDraft, setCapacityDraft] = useState<Record<string, string>>({});
  const [capacityError, setCapacityError] = useState<Record<string, string>>({});
  const capacity = useCatalogueSave<{ id: string; capacity: number; capacityHeld: number; seatsAvailable: number }>();
  const booking = useCatalogueSave<{ id: string; bookingOpen: boolean; seatsAvailable: number }>();

  const busy = capacity.pending || booking.pending;

  function applySaved(saved: AdminNight) {
    setRows((current) => {
      const exists = current.some((row) => row.id === saved.id);
      const next = exists ? current.map((row) => (row.id === saved.id ? saved : row)) : [...current, saved];

      return next.sort((a, b) => a.date.localeCompare(b.date));
    });
    setEditing(null);
    setCreating(false);
    setNotice(`${formatEventDate(saved.date)} saved.`);
  }

  function patch(id: string, changes: Partial<AdminNight>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...changes } : row)));
  }

  async function saveCapacity(row: AdminNight) {
    const raw = capacityDraft[row.id] ?? String(row.capacity);
    const value = Number(raw);

    setCapacityError((current) => ({ ...current, [row.id]: "" }));
    setNotice(null);

    if (!Number.isInteger(value) || value < 1) {
      setCapacityError((current) => ({ ...current, [row.id]: "Capacity has to be at least 1 seat." }));

      return;
    }

    const result = await capacity.send("/api/admin/dates", {
      action: "capacity",
      id: row.id,
      capacity: value,
      capacityHeld: row.capacityHeld,
    });

    if (result.ok) {
      patch(row.id, {
        capacity: result.data.capacity,
        capacityHeld: result.data.capacityHeld,
        seatsAvailable: result.data.seatsAvailable,
        seatsOnSale: result.data.capacity - result.data.capacityHeld,
        isFull: result.data.seatsAvailable === 0,
        overCommitted: false,
      });
      setCapacityDraft((current) => ({ ...current, [row.id]: String(result.data.capacity) }));
      setNotice(`${formatEventDate(row.date)} now holds ${result.data.capacity} seats — ${result.data.seatsAvailable} left.`);
    } else {
      setCapacityError((current) => ({ ...current, [row.id]: result.error.message }));

      // The refusal carries the lowest capacity the rule will accept; offering it is
      // the difference between an error message and a fix.
      if (typeof result.error.floor === "number" && result.error.floor > 0) {
        setCapacityDraft((current) => ({ ...current, [row.id]: String(result.error.floor) }));
      }
    }
  }

  async function flipBooking(row: AdminNight) {
    setNotice(null);
    const result = await booking.send("/api/admin/dates", {
      action: "booking",
      id: row.id,
      bookingOpen: !row.bookingOpen,
    });

    if (result.ok) {
      patch(row.id, {
        bookingOpen: result.data.bookingOpen,
        seatsAvailable: result.data.seatsAvailable,
      });
      setNotice(
        result.data.bookingOpen
          ? `Booking is open for ${formatEventDate(row.date)}.`
          : `Booking is closed for ${formatEventDate(row.date)} — the night is not cancelled, it just cannot be booked.`,
      );
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-bold tracking-tight">Nights</h2>
          <p className="text-muted text-sm/6">
            {rows.length} {rows.length === 1 ? "night" : "nights"} · capacity is counted in people, from paid bookings
            only
          </p>
        </div>

        {canEdit ? (
          <Button type="button" onClick={() => { setCreating(true); setEditing(null); setNotice(null); }} className="h-11 px-5">
            Add a night
          </Button>
        ) : (
          <p className="text-muted/80 text-xs">Your role can see the nights but not change them.</p>
        )}
      </div>

      {notice ? (
        <p role="status" className="border-peacock/40 bg-peacock/5 text-peacock-soft rounded-xl border px-3.5 py-2.5 text-sm">
          {notice}
        </p>
      ) : null}

      {(capacity.error ?? booking.error) ? (
        <p role="alert" className="border-rani/40 bg-rani/5 text-rani-soft rounded-xl border px-3.5 py-2.5 text-sm">
          {(capacity.error ?? booking.error)?.message}
        </p>
      ) : null}

      {creating ? (
        <NightForm night={null} onCancel={() => setCreating(false)} onSaved={applySaved} />
      ) : null}

      <ul className="flex flex-col gap-3">
        {rows.length === 0 ? (
          <li className="border-border bg-surface/50 text-muted rounded-2xl border px-4 py-8 text-center text-sm">
            No nights yet. A night is what a guest books — add the first one to open the event.
          </li>
        ) : null}

        {rows.map((row) => {
          const percent = capacityPercent(row);
          const state = nightState(row);
          const tone: StatusTone =
            row.status === "cancelled" || row.overCommitted
              ? "stop"
              : row.isFull || !row.bookingOpen
                ? "warn"
                : row.status === "completed"
                  ? "stop"
                  : "go";

          return (
            <li key={row.id} className="border-border bg-surface/50 flex flex-col gap-4 rounded-2xl border p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <p className="font-semibold tracking-tight">{formatEventDate(row.date)}</p>
                  <p className="text-muted text-xs">
                    {[formatTimeRange(row.startTime, row.endTime), row.notes].filter(Boolean).join(" · ") ||
                      "No times set"}
                  </p>
                </div>
                <StatusPill label={state} tone={tone} />
              </div>

              <div className="flex flex-col gap-2">
                <div
                  aria-hidden="true"
                  className="bg-surface-raised/60 h-2 w-full overflow-hidden rounded-full"
                >
                  <div
                    className={percent >= 90 ? "bg-rani h-full" : percent >= 70 ? "bg-marigold h-full" : "bg-peacock h-full"}
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <p className="text-muted text-xs">
                  {capacityCopy(row)} · {row.bookedPeople} paid for across {row.bookedBookings}{" "}
                  {row.bookedBookings === 1 ? "booking" : "bookings"} · {row.passesIssued}{" "}
                  {row.passesIssued === 1 ? "pass" : "passes"} issued
                </p>
              </div>

              {row.overCommitted ? (
                <p className="border-rani/40 bg-rani/5 text-rani-soft rounded-xl border px-3.5 py-2.5 text-xs/5">
                  This night has taken more people than its capacity — usually a booking that paid after it filled up.
                  Raise the capacity to clear it, or leave it and put the note in the register.
                </p>
              ) : null}

              {canEdit ? (
                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-muted/80 text-[0.6875rem] font-semibold tracking-widest uppercase">
                      Capacity
                    </span>
                    <input
                      type="number"
                      min={1}
                      value={capacityDraft[row.id] ?? String(row.capacity)}
                      onChange={(event) =>
                        setCapacityDraft((current) => ({ ...current, [row.id]: event.target.value }))
                      }
                      aria-invalid={capacityError[row.id] ? true : undefined}
                      aria-label={`Capacity for ${formatEventDate(row.date)}`}
                      className="border-border bg-background/60 focus:border-marigold/60 focus:ring-marigold/20 h-9 w-28 rounded-lg border px-3 text-sm tabular-nums focus:ring-2 focus:outline-none"
                    />
                  </label>

                  <button
                    type="button"
                    onClick={() => saveCapacity(row)}
                    disabled={busy}
                    className={buttonClasses({ variant: "secondary", size: "sm", className: "h-9 px-3.5" })}
                  >
                    {capacity.pending ? "Saving…" : "Set capacity"}
                  </button>

                  <button
                    type="button"
                    onClick={() => flipBooking(row)}
                    disabled={busy}
                    className={buttonClasses({
                      variant: "ghost",
                      size: "sm",
                      className: "h-9 px-3.5",
                    })}
                  >
                    {row.bookingOpen ? "Close booking" : "Open booking"}
                  </button>

                  <button
                    type="button"
                    onClick={() => { setEditing(editing === row.id ? null : row.id); setCreating(false); setNotice(null); }}
                    aria-expanded={editing === row.id}
                    className={buttonClasses({ variant: "ghost", size: "sm", className: "h-9 px-3.5" })}
                  >
                    {editing === row.id ? "Close" : "Edit night"}
                  </button>

                  <p className="text-muted/80 text-[0.6875rem]">
                    Capacity cannot go below the {row.bookedPeople} people already paid for.
                  </p>
                </div>
              ) : null}

              {capacityError[row.id] ? (
                <p role="alert" className="text-rani-soft text-xs font-medium">
                  {capacityError[row.id]}
                </p>
              ) : null}

              {editing === row.id && canEdit ? (
                <NightForm night={row} onCancel={() => setEditing(null)} onSaved={applySaved} />
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
