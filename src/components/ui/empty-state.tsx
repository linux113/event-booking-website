import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type EmptyStateProps = {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
};

/**
 * Placeholder shown wherever the real content comes from the database and is not
 * available yet. Used instead of mock/dummy data so the UI never lies.
 */
export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border bg-surface/50 px-6 py-14 text-center",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-12 items-center justify-center rounded-full border border-border bg-surface-raised/60 text-marigold"
      >
        <svg viewBox="0 0 24 24" fill="none" className="size-6">
          <path
            d="M12 3v18M3 12h18"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.35"
          />
          <circle cx="12" cy="12" r="4.25" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </span>
      <div className="flex flex-col gap-2">
        <p className="text-lg font-semibold">{title}</p>
        {description ? <p className="text-muted mx-auto max-w-xl text-sm/6">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
