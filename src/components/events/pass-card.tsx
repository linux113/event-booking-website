import { CheckIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { passAgeCopy } from "@/lib/event-copy";
import { formatInr } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Route } from "next";
import type { PassOption } from "@/types";

type PassCardProps = {
  pass: PassOption;
  /** Where "Book" leads. The booking flow itself is not implemented yet. */
  bookHref?: Route;
  /** `preview` compacts the card for landing-page grids. */
  variant?: "full" | "preview";
  /** Highlighted as the most popular choice. */
  popular?: boolean;
  className?: string;
};

const PERKS = ["Full-night entry", "Dance floor access", "QR entry pass"] as const;

/**
 * Single pass tier, rendered straight from a `pass_categories` row.
 *
 * A pass the organiser has disabled (`is_active = false`) is shown greyed out
 * with its Book action replaced by a non-interactive "Not on sale" state — the
 * option stays visible so visitors understand it exists but cannot be bought.
 */
export function PassCard({ pass, bookHref = "/book", variant = "full", popular, className }: PassCardProps) {
  const isPreview = variant === "preview";
  const isBookable = pass.availability.enabled;
  const isHighlighted = popular ?? pass.isActive;

  return (
    <article
      className={cn(
        "group border-border bg-surface/70 relative flex h-full flex-col gap-5 rounded-2xl border p-6 transition-colors duration-200",
        isHighlighted && isBookable ? "border-marigold/50 shadow-lg shadow-marigold/10" : null,
        !isBookable && "opacity-60 saturate-50",
        isBookable && !isHighlighted ? "hover:border-violet-soft/40" : null,
        className,
      )}
    >
      {isHighlighted && isBookable ? (
        <div
          aria-hidden="true"
          className="from-marigold via-orange to-rani absolute inset-x-0 top-0 h-0.5 rounded-t-2xl bg-gradient-to-r"
        />
      ) : null}

      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-lg font-semibold tracking-tight">{pass.name}</h3>
          <p className="text-marigold-soft text-sm font-semibold">{pass.composition}</p>
        </div>
        {isBookable ? (
          isHighlighted ? (
            <Badge variant="marigold">Popular</Badge>
          ) : null
        ) : (
          <Badge variant="neutral">Disabled</Badge>
        )}
      </div>

      <p className="flex items-baseline gap-1.5">
        <span className="text-3xl font-bold tracking-tight">{formatInr(pass.priceInr)}</span>
        <span className="text-muted text-sm">/ pass</span>
      </p>

      {!isPreview ? <p className="text-muted text-sm/6">{pass.description}</p> : null}

      <p className="text-muted/90 text-xs font-medium">
        Admits {pass.numberOfPeople} {pass.numberOfPeople === 1 ? "person" : "people"} · up to{" "}
        {pass.maxPerBooking} per booking
        {passAgeCopy(pass) ? ` · ${passAgeCopy(pass)}` : ""}
      </p>

      <ul className={cn("flex flex-col gap-2", isPreview && "text-sm")}>
        {PERKS.map((perk) => (
          <li key={perk} className="text-muted flex items-start gap-2.5 text-sm/6">
            <CheckIcon className="text-peacock mt-0.5 size-4 shrink-0" />
            {perk}
          </li>
        ))}
      </ul>

      <div className="mt-auto flex flex-col gap-2 pt-1">
        {isBookable ? (
          <>
            <Button
              href={bookHref}
              variant={isHighlighted ? "primary" : "secondary"}
              className="w-full"
            >
              Book this pass
            </Button>
            <p className="text-muted/80 text-center text-xs">
              Reserve now — online payment is not live yet.
            </p>
          </>
        ) : (
          <>
            <span
              aria-disabled="true"
              className="border-border bg-surface-raised/40 text-muted inline-flex h-11 w-full cursor-not-allowed items-center justify-center rounded-full border text-sm font-semibold"
            >
              Not on sale
            </span>
            <p className="text-muted/80 text-center text-xs">{pass.availability.reason}</p>
          </>
        )}
      </div>
    </article>
  );
}
