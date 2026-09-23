"use client";

import { useState } from "react";

import { PassTypeForm } from "@/components/admin/pass-type-form";
import { useCatalogueSave } from "@/components/admin/use-catalogue-save";
import { Button, buttonClasses } from "@/components/ui/button";
import { StatusPill } from "@/components/admin/status-pill";
import { ageRestrictionCopy, catalogueSummary } from "@/lib/admin/catalogue";
import { cn } from "@/lib/utils";
import type { AdminPassType } from "@/types/catalogue";

/**
 * The pass catalogue: what is on sale, at what price, for how many people — and the
 * one place an organiser changes any of it.
 *
 * The table is arranged the way the decision is made: what guests see (name,
 * composition, price), what the door needs (people per pass, age restriction), what
 * the accountant asks (how many sold, how much taken), and then the two controls
 * that belong to the row — edit, and on/off sale.
 *
 * **Nothing is deleted.** A pass that has been sold is the record of what was sold,
 * so taking it off sale is the operation, and it is a one-line change that cannot
 * rewrite the price or the composition on its way past. The counts in the row are
 * there to make that decision informed: a pass with paid bookings is not a mistake
 * to tidy away.
 *
 * The rows come from the server, and after every write the page re-reads them; the
 * local state below exists only so a save feels immediate, and it is replaced by the
 * database's own answer rather than by what was typed.
 */
export function PassTypesPanel({
  passes,
  canEdit,
}: {
  passes: readonly AdminPassType[];
  /** False for a role that may read the list but not change it. */
  canEdit: boolean;
}) {
  const [rows, setRows] = useState<AdminPassType[]>([...passes]);
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const toggle = useCatalogueSave<{ id: string; isActive: boolean }>();

  const nextSortOrder = rows.reduce((highest, row) => Math.max(highest, row.sortOrder), 0) + 1;

  function applySaved(saved: AdminPassType) {
    setRows((current) => {
      const exists = current.some((row) => row.id === saved.id);

      const next = exists ? current.map((row) => (row.id === saved.id ? saved : row)) : [...current, saved];

      return next.sort((a, b) => a.sortOrder - b.sortOrder || a.priceInr - b.priceInr);
    });
    setEditing(null);
    setCreating(false);
    setNotice(`${saved.name} saved.`);
  }

  async function flip(row: AdminPassType) {
    setNotice(null);
    const result = await toggle.send("/api/admin/passes", {
      action: "toggle",
      id: row.id,
      isActive: !row.isActive,
    });

    if (result.ok) {
      setRows((current) =>
        current.map((entry) => (entry.id === row.id ? { ...entry, isActive: result.data.isActive } : entry)),
      );
      setNotice(
        result.data.isActive
          ? `${row.name} is on sale again.`
          : `${row.name} is off sale — existing bookings and passes are untouched.`,
      );
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-bold tracking-tight">Pass types</h2>
          <p className="text-muted text-sm/6">{catalogueSummary(rows)}</p>
        </div>

        {canEdit ? (
          <Button
            type="button"
            onClick={() => {
              setCreating(true);
              setEditing(null);
              setNotice(null);
            }}
            disabled={creating}
            className="h-11 px-5"
          >
            Add a pass type
          </Button>
        ) : (
          <p className="text-muted/80 text-xs">
            Your role can see what is on sale but not change it.
          </p>
        )}
      </div>

      {notice ? (
        <p role="status" className="border-peacock/40 bg-peacock/5 text-peacock-soft rounded-xl border px-3.5 py-2.5 text-sm">
          {notice}
        </p>
      ) : null}

      {toggle.error ? (
        <p role="alert" className="border-rani/40 bg-rani/5 text-rani-soft rounded-xl border px-3.5 py-2.5 text-sm">
          {toggle.error.message}
        </p>
      ) : null}

      {creating ? (
        <PassTypeForm
          pass={null}
          nextSortOrder={nextSortOrder}
          onCancel={() => setCreating(false)}
          onSaved={applySaved}
        />
      ) : null}

      <div className="border-border bg-surface/50 overflow-hidden rounded-2xl border">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">
              Every pass type for the event, with its price, its composition, its age restriction and what has been
              sold on it.
            </caption>
            <thead>
              <tr className="text-muted/80 bg-surface-raised/40 text-[0.6875rem] font-semibold tracking-widest uppercase">
                <th scope="col" className="border-border/60 border-b px-4 py-2.5">
                  Pass
                </th>
                <th scope="col" className="border-border/60 border-b px-4 py-2.5 text-right">
                  Price
                </th>
                <th scope="col" className="border-border/60 hidden border-b px-4 py-2.5 md:table-cell">
                  Admits
                </th>
                <th scope="col" className="border-border/60 hidden border-b px-4 py-2.5 lg:table-cell">
                  Age
                </th>
                <th scope="col" className="border-border/60 hidden border-b px-4 py-2.5 xl:table-cell">
                  Sold
                </th>
                <th scope="col" className="border-border/60 border-b px-4 py-2.5">
                  On sale
                </th>
                {canEdit ? (
                  <th scope="col" className="border-border/60 border-b px-4 py-2.5 text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={canEdit ? 7 : 6} className="text-muted px-4 py-8 text-center text-sm">
                    No pass types yet. A pass type is what guests buy — add the first one to put the event on sale.
                  </td>
                </tr>
              ) : null}

              {rows.map((row) => (
                <tr key={row.id} className="border-border/60 border-b last:border-b-0">
                  <td className="px-4 py-3 align-top">
                    <p className="font-semibold tracking-tight">{row.name}</p>
                    <p className="text-marigold-soft text-xs font-semibold">{row.composition}</p>
                    <p className="text-muted/70 mt-0.5 font-mono text-[0.6875rem]">{row.code}</p>
                    {row.description ? (
                      <p className="text-muted mt-1 max-w-md text-xs/5">{row.description}</p>
                    ) : null}
                  </td>

                  <td className="px-4 py-3 text-right align-top font-semibold whitespace-nowrap tabular-nums">
                    ₹{row.priceInr.toLocaleString("en-IN")}
                  </td>

                  <td className="hidden px-4 py-3 align-top text-xs md:table-cell">
                    <p>
                      {row.numberOfPeople} {row.numberOfPeople === 1 ? "person" : "people"}
                    </p>
                    <p className="text-muted/80 mt-0.5">up to {row.maxPerBooking} per booking</p>
                  </td>

                  <td className="text-muted hidden px-4 py-3 align-top text-xs md:table-cell lg:table-cell">
                    {ageRestrictionCopy(row.minAge)}
                  </td>

                  <td className="text-muted hidden px-4 py-3 align-top text-xs xl:table-cell">
                    <p>
                      {row.passesIssued} {row.passesIssued === 1 ? "pass" : "passes"} issued
                    </p>
                    <p className="mt-0.5">
                      {row.paidBookings} paid {row.paidBookings === 1 ? "booking" : "bookings"} · ₹
                      {row.revenueInr.toLocaleString("en-IN")}
                    </p>
                  </td>

                  <td className="px-4 py-3 align-top">
                    <StatusPill label={row.isActive ? "on sale" : "off sale"} tone={row.isActive ? "go" : "warn"} />
                  </td>

                  {canEdit ? (
                    <td className="px-4 py-3 text-right align-top whitespace-nowrap">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(editing === row.id ? null : row.id);
                            setCreating(false);
                            setNotice(null);
                          }}
                          aria-expanded={editing === row.id}
                          className={buttonClasses({
                            variant: "secondary",
                            size: "sm",
                            className: "h-9 px-3.5",
                          })}
                        >
                          {editing === row.id ? "Close" : "Edit"}
                        </button>
                        <button
                          type="button"
                          onClick={() => flip(row)}
                          disabled={toggle.pending}
                          className={buttonClasses({
                            variant: "ghost",
                            size: "sm",
                            className: cn("h-9 px-3.5", row.isActive && "text-rani-soft"),
                          })}
                        >
                          {row.isActive ? "Take off sale" : "Put on sale"}
                        </button>
                      </div>
                    </td>
                  ) : null}

                  {editing === row.id && canEdit ? (
                    <td colSpan={canEdit ? 7 : 6} className="border-border/60 border-b px-4 pt-1 pb-5">
                      <PassTypeForm
                        pass={row}
                        nextSortOrder={nextSortOrder}
                        onCancel={() => setEditing(null)}
                        onSaved={applySaved}
                      />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-muted/80 text-xs/5">
        Prices are whole rupees and live in the database: the booking page, the order amount and the receipt all read
        this row, so a change here is what the next guest pays. A pass with bookings on it cannot be deleted — take it
        off sale, and the passes already sold stay valid.
      </p>
    </div>
  );
}
