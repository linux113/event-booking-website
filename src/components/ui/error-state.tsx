import type { Route } from "next";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ServiceError } from "@/lib/services/result";

type ErrorStateProps = {
  error: ServiceError;
  /** Shown above the message, e.g. "Passes unavailable". */
  title?: string;
  /** Recovery action; defaults to nothing so pages can decide. */
  action?: ReactNode;
  className?: string;
};

const TITLES: Record<ServiceError["kind"], string> = {
  "not-configured": "Database not connected",
  "not-found": "We could not find that",
  "query-failed": "Something went wrong",
};

/**
 * Error state for a service failure.
 *
 * Only the service's own message is rendered — never a raw Postgres error — so
 * table names, SQL and connection details cannot leak to visitors.
 */
export function ErrorState({ error, title, action, className }: ErrorStateProps) {
  const isConfiguration = error.kind === "not-configured";

  return (
    <div
      role="status"
      className={cn(
        "border-border bg-surface/60 flex flex-col items-start gap-4 rounded-2xl border p-6 sm:p-8",
        isConfiguration ? "border-marigold/40" : "border-rani/40",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex size-11 items-center justify-center rounded-xl ring-1",
          isConfiguration
            ? "bg-marigold/10 text-marigold ring-marigold/30"
            : "bg-rani/10 text-rani-soft ring-rani/30",
        )}
      >
        <svg viewBox="0 0 24 24" fill="none" className="size-5">
          <path
            d="M12 8v5M12 16.5h.01"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </span>

      <div className="flex flex-col gap-1.5">
        <h2 className="text-lg font-semibold tracking-tight">{title ?? TITLES[error.kind]}</h2>
        <p className="text-muted max-w-xl text-sm/6">{error.message}</p>
      </div>

      {isConfiguration ? (
        <div className="border-border/70 bg-background/40 w-full rounded-xl border p-4">
          <p className="text-muted text-xs font-semibold tracking-widest uppercase">
            Connection checklist
          </p>
          <ol className="text-muted mt-2 flex flex-col gap-1.5 text-sm/6">
            <li>1. Create a Neon project and copy the pooled connection string.</li>
            <li>
              2. Set <code className="text-marigold-soft">DATABASE_URL</code> (see{" "}
              <code className="text-marigold-soft">.env.example</code>).
            </li>
            <li>3. Apply the Neon schema (docs/neon-setup.md), then seed if you use it.</li>
          </ol>
        </div>
      ) : null}

      {action}
    </div>
  );
}

/** Convenience wrapper for pages that want a retry link. */
export function ReloadAction({ href }: { href: Route }) {
  return (
    <Button href={href} variant="secondary" size="sm">
      Try again
    </Button>
  );
}
