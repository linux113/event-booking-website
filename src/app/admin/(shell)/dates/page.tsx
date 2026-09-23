import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";

import { NightsPanel } from "@/components/admin/nights-panel";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { requirePermission } from "@/lib/auth/guard";
import { can } from "@/lib/auth/permissions";
import { listAdminNights } from "@/lib/services/admin-catalogue";

export const metadata: Metadata = {
  title: "Dates & capacity",
  description: "The event's nights: capacity, seats held back, and whether booking is open.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Dates & capacity — the nights the event runs on, and what each one can hold.
 *
 * This is the screen where the two rules the event lives by are stated in numbers:
 * **capacity is the room** (everything the night holds, including seats withheld from
 * online sale), and **availability is what is left** (capacity − seats held back −
 * people who have paid). Both are computed in the database, from the same paid-only
 * rule the booking path uses, so this page cannot promise a seat that
 * `create_pending_booking` would refuse.
 *
 * The page reads; every change goes through `/api/admin/dates`, which re-validates
 * and calls the narrow SQL functions. That split is what makes the two rules
 * enforced rather than merely displayed: the database refuses to move a night's date
 * once somebody has paid for it, and refuses any capacity that would take seats away
 * from people who already have them — the control on this page can only report that
 * refusal, with the number the organiser has to reach.
 *
 * Guarded by `dates:view`; only a role with `dates:edit` (admin and super admin) is
 * offered the controls at all.
 */
export default async function AdminDatesPage() {
  const staff = await requirePermission("dates:view");
  const result = await listAdminNights();

  if (!result.ok) {
    return (
      <ErrorState
        error={{
          kind: result.error.kind === "not-configured" ? "not-configured" : "query-failed",
          message: result.error.message,
        }}
        title="The event's nights are unavailable"
      />
    );
  }

  const nights = result.data;
  const canEdit = can(staff.role, "dates:edit");
  const totalCapacity = nights.reduce((sum, night) => sum + night.capacity, 0);
  const totalHeld = nights.reduce((sum, night) => sum + night.capacityHeld, 0);
  const totalAvailable = nights.reduce((sum, night) => sum + night.seatsAvailable, 0);
  const onSale = nights.filter((night) => night.status === "scheduled" && night.bookingOpen && !night.isFull).length;

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Dates &amp; capacity</h1>
        <p className="text-muted text-sm/6">
          Every night of the event, what it holds and what is left. Capacity is counted in people, and only paid
          bookings take a seat — a checkout somebody abandoned does not hold one.
          {canEdit ? "" : " Your role can see this but not change it."}
        </p>
      </div>

      <dl className="border-border bg-surface/50 grid gap-4 rounded-2xl border p-5 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Nights" value={String(nights.length)} hint={`${onSale} open for booking right now`} />
        <Stat label="Seats across all nights" value={totalCapacity.toLocaleString("en-IN")} hint="Everything the run holds" />
        <Stat
          label="Held back from online sale"
          value={totalHeld.toLocaleString("en-IN")}
          hint="Gate sales, sponsors, crew — not bookable on the website"
        />
        <Stat
          label="Left to sell"
          value={totalAvailable.toLocaleString("en-IN")}
          hint="Capacity − held back − people already paid for"
          tone={totalAvailable > 0 ? "positive" : "attention"}
        />
      </dl>

      {nights.length === 0 ? (
        <EmptyState
          title="No nights yet"
          description={
            <>
              A night is what a guest books.{" "}
              <Link href={"/admin/dates" as Route} className="text-marigold-soft font-semibold hover:underline">
                Add the first one
              </Link>{" "}
              to open the event — the booking page will offer nothing until then.
            </>
          }
        />
      ) : null}

      <NightsPanel nights={nights} canEdit={canEdit} />
    </>
  );
}

function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "default" | "positive" | "attention";
}) {
  const toneClass =
    tone === "positive"
      ? "border-peacock/40 bg-peacock/10"
      : tone === "attention"
        ? "border-marigold/35 bg-marigold/[0.07]"
        : "border-border bg-surface/50";

  return (
    <div className={`flex flex-col gap-1 rounded-2xl border p-4 ${toneClass}`}>
      <dt className="text-muted/80 text-[0.6875rem] font-semibold tracking-widest uppercase">{label}</dt>
      <dd className="flex flex-col gap-1">
        <span className="text-2xl font-bold tracking-tight tabular-nums">{value}</span>
        <span className="text-muted text-xs/5">{hint}</span>
      </dd>
    </div>
  );
}
