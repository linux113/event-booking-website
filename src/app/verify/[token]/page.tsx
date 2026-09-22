import type { Metadata } from "next";
import type { ReactNode } from "react";

import {
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  CloseIcon,
  MapPinIcon,
  QrCodeIcon,
  ShieldCheckIcon,
} from "@/components/icons";
import { Container, Section } from "@/components/ui/container";
import { ErrorState } from "@/components/ui/error-state";
import { formatEventDate, formatTimeRange, formatTimestamp } from "@/lib/format";
import { getDigitalPassByToken } from "@/lib/services/passes";
import { isQrToken } from "@/lib/pass/links";
import type { DigitalPassTicket, PassDisplayStatus } from "@/types/pass";

export const metadata: Metadata = {
  title: "Pass verification",
  description: "The gate view of a digital pass: the result of scanning its QR code.",
  // A scanned pass URL carries a secret; it must never appear in a search index.
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type VerifyPageProps = {
  params: Promise<{ token: string }>;
};

type Verdict = {
  headline: string;
  instruction: string;
  allowed: boolean;
  tone: "go" | "stop" | "warn";
};

/**
 * What the QR code opens: /verify/<64-character token>.
 *
 * The page is read-only, and deliberately so. It answers one question — is this
 * pass valid tonight? — from the database, and it cannot mark a pass as used:
 * burning a pass requires an authenticated organiser action (the admin dashboard
 * step), which is why no check-in button exists here. An unauthenticated page that
 * could consume passes would be a way to spoil a stranger's ticket.
 *
 * A token that is unknown, malformed, cancelled, expired or already scanned gets a
 * clear "do not admit" answer, with the reason, on the first screen — the person
 * holding the phone is standing in a queue at night, not reading fine print.
 */
export default async function VerifyPassPage({ params }: VerifyPageProps) {
  const { token } = await params;

  if (!isQrToken(token)) {
    return (
      <GateFrame>
        <VerdictPanel verdict={NOT_A_PASS} />
      </GateFrame>
    );
  }

  const result = await getDigitalPassByToken(token);

  if (!result.ok) {
    return (
      <GateFrame>
        <ErrorState
          error={{
            kind: result.error.kind === "not-configured" ? "not-configured" : "query-failed",
            message: result.error.message,
          }}
          title="Pass verification is unavailable"
        />
      </GateFrame>
    );
  }

  if (!result.data) {
    return (
      <GateFrame>
        <VerdictPanel verdict={NOT_A_PASS} />
      </GateFrame>
    );
  }

  const ticket = result.data;

  return (
    <GateFrame>
      <PassVerdict ticket={ticket} />

      <dl className="border-border bg-surface/50 divide-border/60 grid divide-y rounded-2xl border sm:grid-cols-2 sm:divide-y-0">
        <Fact label="Pass ID" value={ticket.pass.passId} />
        <Fact
          label="Night"
          value={[
            formatEventDate(ticket.pass.validDate),
            formatTimeRange(ticket.startTime, ticket.endTime),
          ]
            .filter(Boolean)
            .join(" · ")}
          icon="calendar"
        />
        <Fact label="Guest" value={ticket.customerName} />
        <Fact label="Pass" value={`${ticket.passName}${ticket.passComposition ? ` — ${ticket.passComposition}` : ""}`} />
        <Fact label="Booking" value={ticket.bookingReference} />
        <Fact label="Pass number" value={`${ticket.pass.passNumber} of ${ticket.pass.passTotal}`} />
        <Fact label="Venue" value={`${ticket.venueName}, ${ticket.city}`} icon="pin" />
        <Fact label="Payment" value={ticket.paymentStatus.toUpperCase()} />
      </dl>

      <div className="border-border bg-surface/50 flex flex-col gap-3 rounded-2xl border p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <ShieldCheckIcon className="text-peacock size-4" aria-hidden="true" />
          How to read this screen
        </h2>
        <ul className="text-muted flex flex-col gap-2.5 text-sm/6">
          <li className="flex items-start gap-2.5">
            <QrCodeIcon className="text-marigold mt-0.5 size-4 shrink-0" aria-hidden="true" />
            The code inside each pass is unique to that pass. The same pass cannot be admitted twice — the second
            scan reports that it has already been checked in.
          </li>
          <li className="flex items-start gap-2.5">
            <CalendarIcon className="text-marigold mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Check the night above against the night you are admitting for, then admit {ticket.pass.passTotal === 1 ? "" : "only "}
            the guest this pass is for.
          </li>
          <li className="flex items-start gap-2.5">
            <ClockIcon className="text-marigold mt-0.5 size-4 shrink-0" aria-hidden="true" />
            A pass for the wrong night, or for a refunded booking, shows as EXPIRED or CANCELLED and must not be
            admitted.
          </li>
        </ul>
      </div>
    </GateFrame>
  );
}

/** The one-line verdict for this pass, from the state the database reports. */
function PassVerdict({ ticket }: { ticket: DigitalPassTicket }) {
  const status = ticket.pass.displayStatus;

  const verdicts: Record<PassDisplayStatus, Verdict> = {
    valid: {
      headline: "Valid pass",
      instruction: `Admit ${ticket.customerName} — this pass covers ${formatEventDate(ticket.pass.validDate)}.`,
      allowed: true,
      tone: "go",
    },
    "checked-in": {
      headline: "Already checked in",
      instruction: ticket.pass.checkedInAt
        ? `This pass was scanned at ${formatTimestamp(ticket.pass.checkedInAt)}. One code admits one guest once — do not admit it again unless a supervisor approves.`
        : "This pass has already been used. One code admits one guest once — do not admit it again unless a supervisor approves.",
      allowed: false,
      tone: "warn",
    },
    cancelled: {
      headline: "Cancelled pass",
      instruction: "The booking behind this pass was cancelled or refunded. Do not admit this guest.",
      allowed: false,
      tone: "stop",
    },
    expired: {
      headline: "Expired pass",
      instruction: `This pass was for ${formatEventDate(ticket.pass.validDate)}. It is not valid tonight — do not admit it.`,
      allowed: false,
      tone: "stop",
    },
  };

  return <VerdictPanel verdict={verdicts[status]} />;
}

const NOT_A_PASS: Verdict = {
  headline: "Not a valid pass",
  instruction:
    "This code does not match any pass for this event. It may be a different event's pass, an edited screenshot, or an old code. Do not admit it — ask the guest for their booking confirmation and send them to the ticket desk.",
  allowed: false,
  tone: "stop",
};

function VerdictPanel({ verdict }: { verdict: Verdict }) {
  const tones = {
    go: "border-peacock/50 bg-peacock/10",
    warn: "border-marigold/50 bg-marigold/8",
    stop: "border-rani/50 bg-rani/10",
  } as const;

  const iconTones = {
    go: "bg-peacock/15 text-peacock",
    warn: "bg-marigold/15 text-marigold",
    stop: "bg-rani/15 text-rani-soft",
  } as const;

  const textTones = {
    go: "text-peacock-soft",
    warn: "text-marigold-soft",
    stop: "text-rani-soft",
  } as const;

  return (
    <div
      role="status"
      className={`flex flex-col gap-3 rounded-2xl border p-6 ${tones[verdict.tone]}`}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${iconTones[verdict.tone]}`}
        >
          {verdict.allowed ? <CheckIcon className="size-6" /> : <CloseIcon className="size-6" />}
        </span>
        <p className={`text-2xl font-bold tracking-tight ${textTones[verdict.tone]}`}>{verdict.headline}</p>
      </div>
      <p className="text-foreground text-sm/6 font-medium">{verdict.instruction}</p>
    </div>
  );
}

function Fact({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: "calendar" | "pin";
}) {
  return (
    <div className="flex flex-col gap-0.5 p-5">
      <dt className="text-muted/80 text-[0.6875rem] font-semibold tracking-widest uppercase">{label}</dt>
      <dd className="flex items-center gap-2 font-semibold">
        {icon === "calendar" ? <CalendarIcon className="text-marigold size-4 shrink-0" aria-hidden="true" /> : null}
        {icon === "pin" ? <MapPinIcon className="text-marigold size-4 shrink-0" aria-hidden="true" /> : null}
        <span>{value}</span>
      </dd>
    </div>
  );
}

function GateFrame({ children }: { children: ReactNode }) {
  return (
    <>
      <Section className="pb-0">
        <Container className="max-w-2xl">
          <p className="text-marigold-soft text-xs font-semibold tracking-[0.22em] uppercase">Gate check</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Pass verification</h1>
          <p className="text-muted mt-3 text-sm/6">
            Scanned at the entrance. This page reads the pass from the database — it never changes it.
          </p>
        </Container>
      </Section>

      <Section className="pt-8">
        <Container className="max-w-2xl flex flex-col gap-5">{children}</Container>
      </Section>
    </>
  );
}
