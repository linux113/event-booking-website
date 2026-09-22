"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { NavItem } from "@/types";

type MobileNavProps = {
  items: readonly NavItem[];
};

export function MobileNav({ items }: MobileNavProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Close the panel when the route changes (link tap) or on Escape.
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  return (
    <div className="md:hidden">
      <Button
        variant="secondary"
        size="sm"
        aria-expanded={isOpen}
        aria-controls="mobile-nav-panel"
        aria-label={isOpen ? "Close menu" : "Open menu"}
        onClick={() => setIsOpen((open) => !open)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5">
          {isOpen ? (
            <path
              d="M6 6l12 12M18 6 6 18"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          ) : (
            <path
              d="M4 7h16M4 12h16M4 17h16"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          )}
        </svg>
      </Button>

      {isOpen ? (
        <div
          id="mobile-nav-panel"
          className="border-border bg-surface absolute inset-x-0 top-full border-b px-5 pt-2 pb-6 shadow-2xl shadow-black/40"
        >
          <nav aria-label="Mobile" className="flex flex-col">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setIsOpen(false)}
                className="text-foreground border-border/60 border-b py-3.5 text-base font-medium last:border-b-0"
              >
                {item.label}
              </Link>
            ))}
            <Button href="/events" className="mt-4 w-full sm:hidden" onClick={() => setIsOpen(false)}>
              Book passes
            </Button>
          </nav>
        </div>
      ) : null}
    </div>
  );
}
