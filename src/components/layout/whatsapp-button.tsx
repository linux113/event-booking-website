import type { MouseEventHandler } from "react";

import { WhatsAppIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

type WhatsAppButtonProps = {
  /**
   * The `wa.me` link to open, built by `whatsappHref()` in `src/lib/contact.ts` from
   * the event's own number. **Null hides the button** — an event with no WhatsApp
   * number published gets no chat button rather than a link that goes nowhere.
   */
  href: string | null;
  /** `default` shows the label on ≥sm screens, `icon` is icon-only, `full` always shows it. */
  variant?: "default" | "icon" | "full";
  size?: "sm" | "md" | "lg";
  className?: string;
  label?: string;
  /** Fired when the link is followed — the mobile menu uses it to close itself. */
  onClick?: MouseEventHandler<HTMLAnchorElement>;
};

const sizeStyles = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-5 text-sm sm:text-base",
  lg: "h-12 px-6 text-base",
} as const;

const iconOnlySize = {
  sm: "size-9",
  md: "size-11",
  lg: "size-12",
} as const;

/**
 * WhatsApp enquiry link.
 *
 * A plain anchor to `https://wa.me/…`, which is what makes it work on both platforms:
 * on a phone the WhatsApp app claims the link and opens the chat with the message
 * prefilled, and on a desktop it opens WhatsApp Web (or WhatsApp's own prompt) with the
 * same message. No app scheme, no SDK and no JavaScript — one href that behaves
 * everywhere, including when scripts fail to load.
 *
 * The number and the message are never written here: they come from the event row
 * through `src/lib/contact.ts`, so the site has one WhatsApp number and one opening
 * sentence rather than one per button.
 */
export function WhatsAppButton({
  href,
  variant = "default",
  size = "md",
  className,
  label = "WhatsApp",
  onClick,
}: WhatsAppButtonProps) {
  if (!href) {
    return null;
  }

  const isIconOnly = variant === "icon";
  const showLabelAlways = variant === "full";

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      aria-label={isIconOnly ? `Chat with us on ${label}` : undefined}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-[#25d366]/35 bg-[#25d366]/12 font-semibold tracking-tight text-[#7ff0ab] transition-colors duration-200 hover:bg-[#25d366]/22 hover:text-[#b6ffd0]",
        isIconOnly ? iconOnlySize[size] : sizeStyles[size],
        className,
      )}
    >
      <WhatsAppIcon className={cn(isIconOnly ? "size-5" : "size-[1.125rem]")} />
      {isIconOnly ? null : (
        <span className={cn(showLabelAlways ? "inline" : "hidden sm:inline")}>{label}</span>
      )}
    </a>
  );
}
