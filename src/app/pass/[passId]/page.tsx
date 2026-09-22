import type { Metadata } from "next";
import type { ReactNode } from "react";

import { DownloadIcon, QrCodeIcon, ShieldCheckIcon, UsersIcon } from "@/components/icons";
import { PassTicket } from "@/components/pass/pass-ticket";
import { PrintPassButton } from "@/components/pass/print-pass-button";
import { Button, buttonClasses } from "@/components/ui/button";
import { Container, Section } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { formatEventDate } from "@/lib/format";
import { getDigitalPassByToken } from "@/lib/services/passes";
import type { DigitalPassTicket } from "@/types/pass";

export const metadata: Metadata = {
  title: "Digital pass",
  description: "Your digital entry pass, with the QR code that is scanned at the gate.",
  // A pass link is personal and contains a secret: never indexed, never shared.
  robots: { index: false, follow: false },
};

// Never cached: a pass that has just been scanned, cancelled or expired must say so.
export const dynamic = "force-dynamic";

type PassPageProps = {
  params: Promise<{ passId: string }>;
  searchParams: Promise<{ t?: string | string[] }>;
};

/**
 * The customer's pass, at /pass/<pass id>?t=<qr token>.
 *
 * The path segment is what a human reads and what appears in the URL bar; the
 * token in the query string is the credential, and it is the only thing the
 * database is asked about. That means a pass id alone reveals nothing (the id is
 * not a secret), and a shared screenshot of one pass does not open another.
 *
 * Nothing here writes: opening or refreshing this page cannot mint, reissue or
 * invalidate a pass. Passes are created once, by the database, when a payment is
 * verified.
 */
export default async function PassPage({ params, searchParams }: PassPageProps) {
  const [{ passId }, query] = await Promise.all([params, searchParams]);
  const token = Array.isArray(query.t) ? query.t[0] : query.t;

  if (!token) {
    return (
      <PassFallback>
        <EmptyState
          title="This pass link is incomplete"
          description="Open the pass from your confirmation page — the link needs the code that came with it."
          action={
            <Button href="/book/status" size="sm" variant="secondary">
              Find my booking
            </Button>
          }
        />
      </PassFallback>
    );
  }

  const result = await getDigitalPassByToken(token);

  if (!result.ok) {
    return (
      <PassFallback>
        <ErrorState
          error={{
            kind: result.error.kind === "not-configured" ? "not-configured" : "query-failed",
            message: result.error.message,
          }}
          title="This pass is unavailable right now"
        />
      </PassFallback>
    );
  }

  if (!result.data) {
    return (
      <PassFallback>
        <EmptyState
          title="We could not find that pass"
          description="The link may be incomplete, or the pass may belong to a different booking. Open the pass again from your confirmation, or start a new booking."
          action={
            <Button href="/passes" size="sm" variant="secondary">
              See available passes
            </Button>
          }
        />
      </PassFallback>
    );
  }

  const ticket = result.data;
  // The token is the credential and decides which pass this is; the segment is the
  // label in the address bar, so the links below keep the shape the customer opened.
  const downloadPath = `/pass/${encodeURIComponent(passId)}/download?t=${encodeURIComponent(ticket.pass.qrToken)}`;
  const qrPath = `${downloadPath}&format=png`;

  return (
    <>
      <Section className="no-print pb-0">
        <Container className="max-w-3xl">
          <p className="text-marigold-soft text-xs font-semibold tracking-[0.22em] uppercase">Your pass</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            Show this at the gate
          </h1>
          <p className="text-muted mt-3 max-w-2xl text-sm/6 sm:text-base/7">
            {ticket.eventName} · {formatEventDate(ticket.pass.validDate)}. One QR code per guest — keep it on your
            phone, or print it if that is easier at the entrance.
          </p>
        </Container>
      </Section>

      <Section className="pt-8">
        <Container className="max-w-3xl">
          <PassNotice ticket={ticket} />

          <PassTicket ticket={ticket} />

          <div className="no-print mt-6 flex flex-wrap items-center gap-3">
            <a className={buttonClasses({ variant: "primary" })} href={downloadPath} download>
              <DownloadIcon className="size-4" aria-hidden="true" />
              Download pass
            </a>
            <PrintPassButton />
            <a className={buttonClasses({ variant: "ghost", size: "sm" })} href={qrPath} download>
              <QrCodeIcon className="size-4" aria-hidden="true" />
              Save just the QR
            </a>
          </div>

          <div className="no-print border-border bg-surface/50 mt-8 flex flex-col gap-3 rounded-2xl border p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
              <ShieldCheckIcon className="text-peacock size-4" aria-hidden="true" />
              How the gate checks this pass
            </h2>
            <ul className="text-muted flex flex-col gap-2.5 text-sm/6">
              <li className="flex items-start gap-2.5">
                <QrCodeIcon className="text-marigold mt-0.5 size-4 shrink-0" aria-hidden="true" />
                The QR code holds a single private code for this pass — no name, no phone number, no email. Our
                staff scan it, and the gate screen confirms the pass is valid for the night.
              </li>
              <li className="flex items-start gap-2.5">
                <UsersIcon className="text-marigold mt-0.5 size-4 shrink-0" aria-hidden="true" />
                Booking {ticket.bookingReference} has {ticket.pass.passTotal}{" "}
                {ticket.pass.passTotal === 1 ? "pass" : "passes"} in total; this is pass {ticket.pass.passNumber}.
                Each guest needs their own.
              </li>
              <li className="flex items-start gap-2.5">
                <ShieldCheckIcon className="text-marigold mt-0.5 size-4 shrink-0" aria-hidden="true" />
                The pass stays valid until it is scanned on {formatEventDate(ticket.pass.validDate)}. After that it
                shows as checked in.
              </li>
            </ul>
          </div>
        </Container>
      </Section>
    </>
  );
}

/**
 * A one-line explanation above the ticket whenever the pass is not scannable.
 *
 * The database decides; the page only reports. A cancelled pass is still shown in
 * full (the customer asked for it) but never looks valid.
 */
function PassNotice({ ticket }: { ticket: DigitalPassTicket }) {
  const status = ticket.pass.displayStatus;

  if (status === "valid") {
    return null;
  }

  const message =
    status === "checked-in"
      ? "This pass has already been scanned at the gate — it admits one guest once."
      : status === "cancelled"
        ? "The booking behind this pass was cancelled or refunded, so the pass is no longer valid at the gate."
        : "This pass was for a night that has already passed, so it can no longer be scanned.";

  const tone =
    status === "cancelled"
      ? "border-rani/40 bg-rani/10 text-rani-soft"
      : status === "checked-in"
        ? "border-peacock/40 bg-peacock/10 text-peacock-soft"
        : "border-border bg-surface/60 text-muted";

  return (
    <p className={`no-print mb-5 rounded-2xl border px-5 py-4 text-sm/6 font-medium ${tone}`}>{message}</p>
  );
}

function PassFallback({ children }: { children: ReactNode }) {
  return (
    <Section>
      <Container className="max-w-2xl">{children}</Container>
    </Section>
  );
}
