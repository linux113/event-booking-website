import type { Route } from "next";

import { DownloadIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DigitalPassSummary } from "@/types/pass";

type PassListProps = {
  passes: DigitalPassSummary[];
  /** Shows the per-pass download links; off when the list is only informational. */
  withDownloads?: boolean;
  className?: string;
};

const STATUS_VARIANT: Record<DigitalPassSummary["displayStatus"], "marigold" | "rani" | "neutral"> = {
  valid: "marigold",
  "checked-in": "neutral",
  cancelled: "rani",
  expired: "neutral",
};

/**
 * The passes of one booking, each with a way into it.
 *
 * Used on the success page and on the live booking status page, so a customer who
 * comes back tomorrow (or opens the link again on another device) finds their
 * passes in exactly the same place. The button hrefs carry the pass's own token —
 * the page they land on re-reads the pass from the database before showing it, so
 * nothing here is trusted on its own, and this component never writes.
 */
export function PassList({ passes, withDownloads = true, className }: PassListProps) {
  if (passes.length === 0) {
    return null;
  }

  return (
    <ul className={cn("flex flex-col gap-3", className)}>
      {passes.map((pass) => {
        const downloadPath = `/pass/${encodeURIComponent(pass.passId)}/download?t=${encodeURIComponent(pass.qrToken)}`;

        return (
          <li
            key={pass.passId}
            className="border-border bg-surface/50 flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-4 sm:p-5"
          >
            <div className="flex min-w-0 flex-col gap-1.5">
              <p className="text-muted/80 text-[0.6875rem] font-semibold tracking-widest uppercase">
                Pass {pass.passNumber} of {pass.passTotal}
              </p>
              <p className="font-mono text-lg font-semibold tracking-wide">{pass.passId}</p>
              <Badge variant={STATUS_VARIANT[pass.displayStatus]} className="w-fit">
                {pass.displayLabel}
              </Badge>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button href={pass.passPath as Route} size="sm">
                Digital pass
              </Button>

              {withDownloads ? (
                <a
                  className={buttonClasses({ variant: "secondary", size: "sm" })}
                  href={downloadPath}
                  download
                >
                  <DownloadIcon className="size-4" aria-hidden="true" />
                  Download
                </a>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
