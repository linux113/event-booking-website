import { CheckIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatInr } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Route } from "next";
import type { PassTier } from "@/types";

type PassCardProps = {
  pass: PassTier;
  /** Where "Book" leads. The booking flow itself is not implemented yet. */
  bookHref?: Route;
  /** `preview` compacts the card for landing-page grids. */
  variant?: "full" | "preview";
  className?: string;
};

/**
 * Single pass tier. Presentational: the tier data (composition, price, included
 * benefits) is passed in, so the same card serves the home page and `/passes`
 * with different data sources later.
 */
export function PassCard({ pass, bookHref = "/book", variant = "full", className }: PassCardProps) {
  const isPreview = variant === "preview";

  return (
    <article
      className={cn(
        "group border-border bg-surface/70 relative flex h-full flex-col gap-5 rounded-2xl border p-6 transition-colors duration-200",
        pass.popular
          ? "border-marigold/50 shadow-lg shadow-marigold/10"
          : "hover:border-violet-soft/40",
        className,
      )}
    >
      {pass.popular ? (
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
        {pass.badge ? <Badge variant={pass.popular ? "marigold" : "rani"}>{pass.badge}</Badge> : null}
      </div>

      <p className="flex items-baseline gap-1.5">
        <span className="text-3xl font-bold tracking-tight">{formatInr(pass.priceInr)}</span>
        <span className="text-muted text-sm">/ pass</span>
      </p>

      {!isPreview ? <p className="text-muted text-sm/6">{pass.description}</p> : null}

      <ul className={cn("flex flex-col gap-2", isPreview && "text-sm")}>
        {pass.includes.map((item) => (
          <li key={item} className="text-muted flex items-start gap-2.5 text-sm/6">
            <CheckIcon className="text-peacock mt-0.5 size-4 shrink-0" />
            {item}
          </li>
        ))}
      </ul>

      <div className="mt-auto flex flex-col gap-2 pt-1">
        <Button href={bookHref} variant={pass.popular ? "primary" : "secondary"} className="w-full">
          Book this pass
        </Button>
        <p className="text-muted/80 text-center text-xs">
          Booking opens with the Razorpay checkout in a later step.
        </p>
      </div>
    </article>
  );
}
