import { siteConfig } from "@/config/site";
import { cn } from "@/lib/utils";

type LogoProps = {
  className?: string;
  /** Hide the wordmark and render only the mark, e.g. in tight layouts. */
  showWordmark?: boolean;
};

/**
 * Placeholder brand mark (a diya flame) rendered inline so there is no image
 * request. Swap the SVG for the final brand asset when it exists.
 */
export function Logo({ className, showWordmark = true }: LogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span className="relative flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-marigold via-rani to-peacock shadow-lg shadow-rani/20">
        <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5 text-night">
          <path
            d="M12 3.5c2.4 2.3 4 4.4 4 6.6a4 4 0 1 1-8 0c0-2.2 1.6-4.3 4-6.6Z"
            fill="currentColor"
          />
          <path
            d="M5 17.5h14M7.5 20.5h9"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </span>
      {showWordmark ? (
        <span className="text-foreground text-[1.0625rem] leading-none font-bold tracking-tight">
          {siteConfig.name}
        </span>
      ) : null}
    </span>
  );
}
