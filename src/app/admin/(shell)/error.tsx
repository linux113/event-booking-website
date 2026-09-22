"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

type AdminErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

/**
 * The admin area's error state.
 *
 * Every service returns failures as values, so a page normally renders its own error
 * panel and this boundary is never reached. It exists for the rest: a render bug, or a
 * read that escaped its page's error branch. These are screens somebody checks during
 * an event, so the recovery action is a real one — retry the read without losing the
 * signed-in session — rather than a suggestion to come back later.
 *
 * It lives in the shell, so it catches a failure from any admin page below it and keeps
 * the header (and the way out) on screen.
 *
 * Only the digest is shown. An error message can carry a connection string, a table
 * name or a query, and none of that belongs on a screen that staff may be sharing.
 */
export default function AdminHomeError({ error, reset }: AdminErrorProps) {
  useEffect(() => {
    console.error("[admin] dashboard error", error);
  }, [error]);

  return (
    <div
      role="alert"
      className="border-rani/40 bg-surface/60 flex flex-col items-start gap-4 rounded-2xl border p-6 sm:p-8"
    >
      <span
        aria-hidden="true"
        className="bg-rani/10 text-rani-soft ring-rani/30 flex size-11 items-center justify-center rounded-xl ring-1"
      >
        <svg viewBox="0 0 24 24" fill="none" className="size-5">
          <path d="M12 8v5M12 16.5h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </span>

      <div className="flex flex-col gap-1.5">
        <h2 className="text-lg font-semibold tracking-tight">This screen could not be loaded</h2>
        <p className="text-muted max-w-xl text-sm/6">
          Something went wrong while reading the event&apos;s data. Nothing has been changed — no booking, pass or
          check-in is affected by a failed read. Try again, and if it keeps happening check that the database is
          reachable.
        </p>
        {error.digest ? <p className="text-muted/70 font-mono text-xs">Reference: {error.digest}</p> : null}
      </div>

      <div className="flex flex-wrap gap-3">
        <Button type="button" onClick={reset} size="sm">
          Try again
        </Button>
        <Button href={"/admin/scanner" as const} variant="secondary" size="sm">
          Go to the gate scanner
        </Button>
      </div>
    </div>
  );
}
