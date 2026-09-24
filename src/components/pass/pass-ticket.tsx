import { CalendarIcon, ClockIcon, MapPinIcon } from "@/components/icons";
import { qrPathData } from "@/lib/pass/qr";
import { formatEventDate, formatInr, formatTimeRange } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DigitalPassTicket } from "@/types/pass";

type PassTicketProps = {
  ticket: DigitalPassTicket;
  className?: string;
};

/**
 * The pass itself, drawn to look like something you would be handed at the gate.
 *
 * Deliberately light-on-paper rather than dark like the rest of the site: a pass is
 * read in a queue at night, screenshotted, shown to a scanner and printed, and a
 * paper-coloured ticket is legible in all four. It is also the only part of the
 * page that survives printing (see the `@media print` block in globals.css).
 *
 * The QR code is drawn inline from the pass's own verification URL — no image
 * request, no third-party QR service, and nothing on it but the token.
 */
export function PassTicket({ ticket, className }: PassTicketProps) {
  const { pass } = ticket;
  const { path, size } = qrPathData(pass.verifyUrl);
  const timeRange = formatTimeRange(ticket.startTime, ticket.endTime);

  const statusTone: Record<typeof pass.displayStatus, string> = {
    valid: "bg-[#e6f7f2] text-[#0b7d68] ring-[#b7e8dd]",
    "checked-in": "bg-[#ecebff] text-[#4038b5] ring-[#cdc9f7]",
    cancelled: "bg-[#fdecec] text-[#b3261e] ring-[#f6c9c7]",
    expired: "bg-[#f3f1f8] text-[#6b628f] ring-[#e0dbee]",
  };

  const facts: Array<{ label: string; value: string; icon?: "calendar" | "clock" | "pin" }> = [
    { label: "Pass ID", value: pass.passId },
    { label: "Customer", value: ticket.customerName },
    { label: "Pass", value: [ticket.passName, ticket.passComposition].filter(Boolean).join(" · ") },
    { label: "Date", value: formatEventDate(pass.validDate), icon: "calendar" },
    ...(timeRange ? [{ label: "Time", value: timeRange, icon: "clock" as const }] : []),
    ...(ticket.referredBy ? [{ label: "Referred by", value: ticket.referredBy }] : []),
    { label: "Payment", value: ticket.paymentStatus.toUpperCase() },
  ];

  return (
    <article
      className={cn(
        "pass-ticket relative overflow-hidden rounded-3xl bg-white text-[#191233] shadow-2xl shadow-black/40 ring-1 ring-black/10",
        className,
      )}
    >
      <div aria-hidden="true" className="h-2.5 w-full bg-marigold" />

      <div className="flex flex-col gap-6 p-6 sm:p-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-[0.22em] text-[#6b628f] uppercase">
              Digital pass
            </p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-balance">{ticket.eventName}</h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[#5b5382]">
              <MapPinIcon className="size-4 shrink-0 text-[#8c84b5]" aria-hidden="true" />
              <span>
                {ticket.venueName}, {ticket.city}
              </span>
            </p>
          </div>

          <span
            className={cn(
              "inline-flex items-center rounded-full px-3 py-1 text-xs font-bold tracking-[0.14em] uppercase ring-1",
              statusTone[pass.displayStatus],
            )}
          >
            {pass.displayLabel}
          </span>
        </header>

        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <dl className="grid min-w-0 flex-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            {facts.map((fact) => (
              <div key={fact.label} className="min-w-0">
                <dt className="text-[10px] font-semibold tracking-[0.16em] text-[#8c84b5] uppercase">
                  {fact.label}
                </dt>
                <dd className="mt-1 flex items-baseline gap-1.5 text-[15px] font-semibold break-words">
                  {fact.icon === "calendar" ? (
                    <CalendarIcon className="size-4 shrink-0 self-center text-[#8c84b5]" aria-hidden="true" />
                  ) : null}
                  {fact.icon === "clock" ? (
                    <ClockIcon className="size-4 shrink-0 self-center text-[#8c84b5]" aria-hidden="true" />
                  ) : null}
                  <span>{fact.value}</span>
                </dd>
              </div>
            ))}
          </dl>

          <div className="flex shrink-0 flex-col items-center gap-2 self-center sm:self-start">
            <div className="rounded-2xl bg-white p-3 ring-1 ring-[#ded7f0]">
              {/* The code is geometry, so it stays sharp on screen, on paper and in the
                  downloaded file — and it encodes only the pass's verification link. */}
              <svg
                viewBox={`0 0 ${size} ${size}`}
                shapeRendering="crispEdges"
                role="img"
                aria-label={`QR code that verifies pass ${pass.passId}`}
                className="size-40 text-[#191233] sm:size-44"
              >
                <path d={path} fill="currentColor" />
              </svg>
            </div>
            <p className="text-[10px] font-semibold tracking-[0.18em] text-[#8c84b5] uppercase">
              Scan at the gate
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-[#ded7f0] px-6 py-4 text-xs text-[#6b628f] sm:px-8">
        <span>
          Booking <span className="font-semibold text-[#191233]">{ticket.bookingReference}</span>
          {" · "}
          Pass {pass.passNumber} of {pass.passTotal}
        </span>
        <span className="font-semibold text-[#191233]">
          {formatInr(ticket.totalAmount, ticket.currency)} paid
        </span>
      </div>
    </article>
  );
}
