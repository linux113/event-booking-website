import type { Metadata } from "next";

import { ScannerPanel } from "@/components/admin/scanner-panel";
import { ShieldCheckIcon } from "@/components/icons";
import { ErrorState } from "@/components/ui/error-state";
import { isSupabaseConfigured } from "@/config/env";
import { requirePermission } from "@/lib/auth/guard";
import { formatEventDate, formatTimeRange } from "@/lib/format";
import { gateNight } from "@/lib/gate/night";
import { getFeaturedEventBundle } from "@/lib/services/events";

export const metadata: Metadata = {
  title: "Gate scanner",
  description: "Scan a digital pass and check the guest in.",
  robots: { index: false, follow: false },
};

// The gate always needs the live answer, never a cached one.
export const dynamic = "force-dynamic";

/**
 * The gate, in one screen.
 *
 * The page itself is a server component and does the part that must not be in the
 * browser: it checks that this person may work the gate, and works out which night the
 * gate is on (`gateNight()`, the venue's clock — not the phone's). The camera lives in
 * `ScannerPanel`, and everything the panel learns it learns by asking the server.
 *
 * Access is decided by `requirePermission("scanner:use")` before a single row is read:
 * all three roles may work the gate, nobody else gets this far. The proxy sends
 * signed-out visitors to the sign-in screen and the shell layout renders the chrome,
 * but this page checks for itself — a redirect decided in one place is a redirect that
 * can be bypassed.
 */
export default async function ScannerPage() {
  if (!isSupabaseConfigured()) {
    return (
      <ErrorState
        error={{
          kind: "not-configured",
          message:
            "The gate needs the database: staff sign-in and pass checks both read from Supabase. Add the Supabase variables and try again.",
        }}
        title="The scanner is not connected"
      />
    );
  }

  await requirePermission("scanner:use");

  const gateDate = gateNight();

  // The night the gate is working, spelled out: this is the value every scan is
  // checked against, so it is shown rather than assumed. The event read is a nicety
  // (timings, city) — if it fails, the gate still works.
  const bundle = await getFeaturedEventBundle();
  const event = bundle.ok ? (bundle.data?.event ?? null) : null;
  const gateNightRow = bundle.ok
    ? (bundle.data?.nights.find((night) => night.date.slice(0, 10) === gateDate) ?? null)
    : null;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <p className="text-marigold-soft text-xs font-semibold tracking-[0.22em] uppercase">Gate</p>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Pass scanner</h1>
        <p className="text-muted text-sm/6">
          Point the camera at a guest&apos;s pass. The verdict comes from the database, not from this screen.
        </p>
      </div>

      <div className="border-border bg-surface/50 flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex flex-col gap-0.5">
          <p className="text-muted/80 text-[0.6875rem] font-semibold tracking-widest uppercase">Gate night</p>
          <p className="font-semibold">
            {formatEventDate(gateDate)}
            {gateNightRow ? (
              <span className="text-muted font-medium">
                {" "}
                · {formatTimeRange(gateNightRow.startTime, gateNightRow.endTime) ?? "timings to be announced"}
              </span>
            ) : null}
          </p>
        </div>

        <p className="text-muted flex items-start gap-2 text-xs/5 sm:max-w-64">
          <ShieldCheckIcon className="text-peacock mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Decided by the server, in {event ? event.city : "the venue"}&apos;s timezone. A pass for another night is
          refused.
        </p>
      </div>

      <ScannerPanel gateNightLabel={formatEventDate(gateDate)} />

      <div className="border-border bg-surface/50 flex flex-col gap-2.5 rounded-2xl border p-5">
        <h2 className="text-sm font-semibold tracking-tight">How a scan is decided</h2>
        <ul className="text-muted flex flex-col gap-2 text-xs/5">
          <li>
            The camera only reads the code. The token is sent to the server, and the server asks the database — the
            browser never decides that a pass is good.
          </li>
          <li>
            A pass must belong to a confirmed, paid booking, be active and unused, and be for <em>tonight</em>. Anything
            else is refused with a reason.
          </li>
          <li>
            CHECK IN writes the entry once. If two phones scan the same code, the second one is told the pass is already
            used — the database locks the pass row, so exactly one entry is recorded.
          </li>
        </ul>
      </div>
    </div>
  );
}
