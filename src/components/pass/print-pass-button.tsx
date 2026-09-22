"use client";

import { PrinterIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";

/**
 * Print pass.
 *
 * Opening the browser's print dialog is a browser action, so exactly one small
 * client component exists for it; the page around it stays server-rendered. What
 * prints is controlled by the `@media print` rules in globals.css — the ticket
 * survives, the site chrome and buttons do not.
 */
export function PrintPassButton({ className }: { className?: string }) {
  return (
    <Button variant="secondary" className={className} onClick={() => window.print()}>
      <PrinterIcon className="size-4" aria-hidden="true" />
      Print pass
    </Button>
  );
}
