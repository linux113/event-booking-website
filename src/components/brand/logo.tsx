import Image from "next/image";

import logoMark from "@/assets/brand/logo-mark.png";
import { siteConfig } from "@/config/site";
import { cn } from "@/lib/utils";

type LogoProps = {
  className?: string;
  /** Hide the wordmark and render only the mark, e.g. in tight layouts. */
  showWordmark?: boolean;
};

/**
 * Brand lockup: circular "Savariya Event" mark (black/gold Krishna emblem)
 * plus the site wordmark. The mark is a static import so it is fingerprinted
 * by the bundler; the alt text names the brand even when the wordmark is hidden.
 */
export function Logo({ className, showWordmark = true }: LogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <Image
        src={logoMark}
        alt={`${siteConfig.name} logo`}
        width={36}
        height={36}
        priority
        className="size-9 h-auto w-auto shrink-0 rounded-full"
      />
      {showWordmark ? (
        <span className="text-foreground text-[1.0625rem] leading-none font-bold tracking-tight">
          {siteConfig.name}
        </span>
      ) : null}
    </span>
  );
}
