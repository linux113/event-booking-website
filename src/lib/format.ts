import { siteConfig } from "@/config/site";

/**
 * Format a whole-rupee amount for display, e.g. `399` → `"₹399"`.
 *
 * Uses `Intl.NumberFormat` with the site locale/currency so amounts are grouped
 * correctly and can be localised later without touching components. Kept
 * deliberately non-decimal: Indian event pass prices are whole rupees, and
 * fractional rupees invite rounding bugs in money handling.
 */
export function formatInr(amount: number): string {
  return new Intl.NumberFormat(siteConfig.locale, {
    style: "currency",
    currency: siteConfig.currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}
