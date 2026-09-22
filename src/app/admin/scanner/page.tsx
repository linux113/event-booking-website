import type { Metadata, Route } from "next";
import { redirect } from "next/navigation";

import { ScannerPanel } from "@/components/admin/scanner-panel";
import { SignOutButton } from "@/components/admin/sign-out-button";
import { ShieldCheckIcon } from "@/components/icons";
import { Container, Section } from "@/components/ui/container";
import { ErrorState } from "@/components/ui/error-state";
import { isSupabaseConfigured } from "@/config/env";
import { getStaffMember } from "@/lib/auth/staff";
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
 * browser: it resolves the session to a staff row and works out which night the gate
 * is on (`gateNight()`, the venue's clock — not the phone's). The camera lives in
 * `ScannerPanel`, and everything it learns it learns by asking the server.
 *
 * A visitor without a staff session never gets this far: the proxy sends them to the
 * sign-in screen, and this page checks again before rendering anything, because a
 * redirect decided in one place is a redirect that can be bypassed.
 */
export default async function ScannerPage() {
  if (!isSupabaseConfigured()) {
    return (
      <Section className="py-16">
        <Container className="max-w-2xl">
          <ErrorState
            error={{
              kind: "not-configured",
              message:
                "The gate needs the database: staff sign-in and pass checks both read from Supabase. Add the Supabase variables and try again.",
            }}
            title="The scanner is not connected"
          />
        </Container>
      </Section>
    );
  }

  const staff = await getStaffMember();

  if (!staff) {
    redirect("/admin/login?next=/admin/scanner" as Route);
  }

  const gateDate = gateNight();

  // The night the gate is working, spelled out. This is the value every scan is
  // checked against, so it is shown rather than assumed. The event read is a nicety
  // (timings, city): if it fails, the gate still works.
  const bundle = await getFeaturedEventBundle();
  const event = bundle.ok ? (bundle.data?.event ?? null) : null;
  const gateNightRow = bundle.ok ? (bundle.data?.nights.find((night) => night.date.slice(0, 10) === gateDate) ?? null) : null;

  return (
    <>
      <Section className="pb-0">
        <Container className="max-w-2xl">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-col gap-2">
              <p className="text-marigold-soft text-xs font-semibold tracking-[0.22em] uppercase">Gate</p>
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Pass scanner</h1>
              <p className="text-muted text-sm/6">
                Signed in as <span className="text-foreground font-semibold">{staff.displayName}</span>
                <span className="text-muted/70"> · {staff.role}</span>
              </p>
            </div>

            <SignOutButton />
          </div>
        </Container>
      </Section>

      <Section className="pt-8">
        <Container className="max-w-2xl flex flex-col gap-5">
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
                The camera only reads the code. The token is sent to the server, and the server asks the database —
                the browser never decides that a pass is good.
              </li>
              <li>
                A pass must belong to a confirmed, paid booking, be active and unused, and be for <em>tonight</em>.
                Anything else is refused with a reason.
              </li>
              <li>
                CHECK IN writes the entry once. If two phones scan the same code, the second one is told the pass is
                already used — the database locks the pass row, so exactly one entry is recorded.
              </li>
            </ul>
          </div>
        </Container>
      </Section>
    </>
  );
}
