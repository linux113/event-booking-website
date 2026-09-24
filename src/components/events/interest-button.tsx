"use client";

import { useCallback, useSyncExternalStore } from "react";

import { HeartIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

type InterestButtonProps = {
  /** Stable key the toggle is remembered against, e.g. the event id. */
  eventId: string;
  /** Event name, used for accessible labelling. */
  eventName: string;
  className?: string;
};

const storageKey = (eventId: string) => `sanwariya.interested.${eventId}`;

/**
 * One change broadcaster per event: localStorage does not notify the tab that
 * wrote it, so the toggle announces its own write through this target and every
 * pill on the page re-reads the stored value.
 */
const changeTargets = new Map<string, EventTarget>();

function targetFor(eventId: string): EventTarget {
  let target = changeTargets.get(eventId);

  if (!target) {
    target = new EventTarget();
    changeTargets.set(eventId, target);
  }

  return target;
}

function readStored(eventId: string): boolean {
  try {
    return window.localStorage.getItem(storageKey(eventId)) === "1";
  } catch {
    return false;
  }
}

function writeStored(eventId: string, interested: boolean): void {
  try {
    if (interested) {
      window.localStorage.setItem(storageKey(eventId), "1");
    } else {
      window.localStorage.removeItem(storageKey(eventId));
    }
  } catch {
    // Private mode or a full quota: the tap is not a reason for an error.
  }
}

/**
 * "Interested?" pill from the event details screen.
 *
 * Interest is a lightweight personal mark, not a booking and not a count: tapping
 * remembers the choice in this browser (localStorage) and flips the pill to its
 * filled state. Nothing is sent anywhere, so the pill never shows a fake number.
 * The stored value is read through `useSyncExternalStore` — the server snapshot
 * is the resting state, so server and first client render always match.
 */
export function InterestButton({ eventId, eventName, className }: InterestButtonProps) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const target = targetFor(eventId);

      target.addEventListener("change", onChange);

      return () => target.removeEventListener("change", onChange);
    },
    [eventId],
  );

  const getSnapshot = useCallback(() => readStored(eventId), [eventId]);

  const interested = useSyncExternalStore<boolean>(subscribe, getSnapshot, () => false);

  function toggle() {
    writeStored(eventId, !interested);
    targetFor(eventId).dispatchEvent(new Event("change"));
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={interested}
      aria-label={
        interested
          ? `You marked ${eventName} as interesting — tap to remove the mark`
          : `Mark ${eventName} as interesting`
      }
      className={cn(
        "inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold tracking-tight transition-colors duration-200",
        interested
          ? "border-rani/50 bg-rani/15 text-rani-soft"
          : "border-border bg-night/70 text-foreground hover:border-rani/40 hover:text-rani-soft",
        className,
      )}
    >
      <HeartIcon filled={interested} className="size-4" />
      {interested ? "Interested" : "Interested?"}
    </button>
  );
}
