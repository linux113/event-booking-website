"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Container, Section } from "@/components/ui/container";

type RouteErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

/**
 * Route-level error boundary.
 *
 * The services never throw — each page handles its own failure state — so this
 * catches the unexpected: a render bug, or a read that escaped a page's error
 * branch. Anything caught here is logged to the console for monitoring, while the
 * visitor gets a recovery action instead of a stack trace. Only the digest is
 * shown, never an error message that could leak SQL or connection details.
 *
 * Lives in `src/app/`, so it covers every route below it.
 */
export default function RouteError({ error, reset }: RouteErrorProps) {
  useEffect(() => {
    console.error("Unhandled route error", error);
  }, [error]);

  return (
    <Section>
      <Container>
        <div
          role="alert"
          className="border-rani/40 bg-surface/60 flex flex-col items-start gap-4 rounded-2xl border p-6 sm:p-8"
        >
          <span
            aria-hidden="true"
            className="bg-rani/10 text-rani-soft ring-rani/30 flex size-11 items-center justify-center rounded-xl ring-1"
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
            <h1 className="text-lg font-semibold tracking-tight">Something went wrong</h1>
            <p className="text-muted max-w-xl text-sm/6">
              This page could not be loaded. Trying again usually fixes a hiccup on the way to
              the database — if it keeps happening, message the organiser on WhatsApp.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button onClick={reset} variant="primary" size="sm">
              Try again
            </Button>
            <Button href="/" variant="secondary" size="sm">
              Back to home
            </Button>
          </div>

          {error.digest ? (
            <p className="text-muted/70 font-mono text-xs">Reference: {error.digest}</p>
          ) : null}
        </div>
      </Container>
    </Section>
  );
}
