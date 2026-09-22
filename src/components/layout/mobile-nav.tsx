"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { CloseIcon, MenuIcon } from "@/components/icons";
import { WhatsAppButton } from "@/components/layout/whatsapp-button";
import { Button } from "@/components/ui/button";
import type { NavItem } from "@/types";

type MobileNavProps = {
  items: readonly NavItem[];
};

/**
 * Hamburger menu for <lg screens.
 *
 * The panel closes on an explicit user action — tapping a link or pressing
 * Escape — instead of reacting to route changes in an effect, which would cause
 * a cascading render. The panel is also scroll-bounded so long menus stay usable
 * on small screens.
 */
export function MobileNav({ items }: MobileNavProps) {
  const [isOpen, setIsOpen] = useState(false);

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

  function closeMenu() {
    setIsOpen(false);
  }

  return (
    <div className="lg:hidden">
      <Button
        variant="secondary"
        size="sm"
        aria-expanded={isOpen}
        aria-controls="mobile-nav-panel"
        aria-label={isOpen ? "Close menu" : "Open menu"}
        onClick={() => setIsOpen((open) => !open)}
        className="size-9 px-0"
      >
        {isOpen ? <CloseIcon className="size-5" /> : <MenuIcon className="size-5" />}
      </Button>

      {isOpen ? (
        <div
          id="mobile-nav-panel"
          className="border-border bg-surface/98 absolute inset-x-0 top-full max-h-[calc(100dvh-4rem)] overflow-y-auto border-b px-5 pt-3 pb-6 shadow-2xl shadow-black/50 backdrop-blur-xl"
        >
          <nav aria-label="Mobile" className="flex flex-col">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={closeMenu}
                className="text-foreground border-border/50 border-b py-3.5 text-base font-medium last:border-b-0"
              >
                {item.label}
              </Link>
            ))}
            <Link
              href="/book"
              onClick={closeMenu}
              className="text-foreground border-border/50 border-b py-3.5 text-base font-medium md:hidden"
            >
              Book Now
            </Link>
          </nav>

          <div className="mt-4 flex flex-col gap-2.5">
            <Button href="/passes" className="w-full" onClick={closeMenu}>
              View Passes
            </Button>
            <WhatsAppButton variant="full" className="w-full" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
