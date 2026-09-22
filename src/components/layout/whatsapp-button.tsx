import { WhatsAppIcon } from "@/components/icons";
import { whatsappLink } from "@/config/site";
import { cn } from "@/lib/utils";

type WhatsAppButtonProps = {
  /** Prefilled enquiry message. */
  message?: string;
  /** `default` shows the label on ≥sm screens, `icon` is icon-only, `full` always shows it. */
  variant?: "default" | "icon" | "full";
  size?: "sm" | "md" | "lg";
  className?: string;
  label?: string;
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
 * WhatsApp enquiry link. Renders a real `wa.me` deep link built from
 * `siteConfig.contact.whatsappNumber` — the number and prefilled message are the
 * only things that need changing to go live.
 */
export function WhatsAppButton({
  message,
  variant = "default",
  size = "md",
  className,
  label = "WhatsApp",
}: WhatsAppButtonProps) {
  const isIconOnly = variant === "icon";
  const showLabelAlways = variant === "full";

  return (
    <a
      href={whatsappLink(message)}
      target="_blank"
      rel="noopener noreferrer"
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
