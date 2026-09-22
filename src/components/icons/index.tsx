import type { ReactElement, SVGProps } from "react";

/**
 * Inline icon set.
 *
 * All icons are original 24×24 stroke drawings built for this project — no icon
 * font, no third-party logo artwork besides the standard social/WhatsApp glyphs
 * (which are drawn to match the rest of the set). They inherit `currentColor`
 * and are hidden from assistive tech by default; pass `aria-hidden={false}` plus
 * a `<title>` when an icon carries meaning on its own.
 */

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-5"
      {...props}
    >
      {children}
    </svg>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </Icon>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5V12l3 2" />
    </Icon>
  );
}

export function MapPinIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m5 12.5 4.5 4.5L19 7" />
    </Icon>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5" />
      <path d="M4 17v1.5A2.5 2.5 0 0 0 6.5 21h11A2.5 2.5 0 0 0 20 18.5V17" />
    </Icon>
  );
}

export function PrinterIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 9V4h10v5" />
      <rect x="3" y="9" width="18" height="7" rx="2.5" />
      <path d="M7 16h10v5H7z" />
    </Icon>
  );
}

export function ShieldCheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6l7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </Icon>
  );
}

export function QrCodeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <path d="M14 14h3v3h-3zM20 14v.01M14 20v.01M17.5 20.5h3.5V17" />
    </Icon>
  );
}

export function SparkleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.5 13.6 9 19 10.5 13.6 12 12 17.5 10.4 12 5 10.5 10.4 9 12 3.5Z" />
      <path d="M18.5 16.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2Z" />
    </Icon>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M10.5 9.2v5.6l4.5-2.8-4.5-2.8Z" fill="currentColor" />
    </Icon>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Icon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Icon>
  );
}

export function WhatsAppIcon({ className, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className ?? "size-5"}
      {...props}
    >
      <path d="M12.04 2C6.6 2 2.2 6.4 2.2 11.84a9.7 9.7 0 0 0 1.34 4.94L2 22l5.36-1.4a9.8 9.8 0 0 0 4.68 1.2h.01c5.43 0 9.84-4.4 9.84-9.84A9.72 9.72 0 0 0 12.04 2Zm0 1.8c4.42 0 8.02 3.6 8.02 8.04a8.02 8.02 0 0 1-8.02 8.02h-.01a8 8 0 0 1-4.06-1.11l-.29-.17-3.02.79.8-2.95-.19-.3a7.94 7.94 0 0 1-1.22-4.28c0-4.43 3.6-8.03 8.04-8.03Zm-2.4 3.9c-.2 0-.5.07-.76.36-.26.29-.99.97-.99 2.36 0 1.39 1.01 2.73 1.15 2.92.14.19 1.97 3.1 4.9 4.23 2.44.95 2.94.76 3.47.71.53-.05 1.71-.7 1.95-1.37.24-.68.24-1.25.17-1.37-.07-.12-.26-.19-.55-.33-.29-.15-1.7-.84-1.97-.94-.26-.1-.45-.14-.64.15-.19.29-.74.94-.9 1.13-.17.19-.34.21-.62.07-.29-.14-1.2-.44-2.29-1.41-.85-.75-1.42-1.68-1.58-1.97-.17-.29-.02-.44.12-.59.13-.13.29-.34.43-.51.14-.17.19-.29.29-.48.1-.19.05-.36-.02-.5-.07-.15-.63-1.56-.87-2.13-.19-.46-.39-.47-.55-.48l-.5-.01Z" />
    </svg>
  );
}

export function PhoneIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6.5 3.5h3l1.5 4-2 1.4a11.5 11.5 0 0 0 5.6 5.6l1.4-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2Z" />
    </Icon>
  );
}

export function MailIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="m4 7 8 5.5L20 7" />
    </Icon>
  );
}

export function AnchorRoleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3M8.5 21h7" />
    </Icon>
  );
}

export function GorillaMaskIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 9c0-1.9 1.5-3.4 3.4-3.4h8.2c1.9 0 3.4 1.5 3.4 3.4v4.3c0 3.3-2.7 6-6 6h-3c-3.3 0-6-2.7-6-6V9Z" />
      <circle cx="9.3" cy="11" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="14.7" cy="11" r="1.1" fill="currentColor" stroke="none" />
      <path d="M10.4 15.2c1 .8 2.2.8 3.2 0" />
    </Icon>
  );
}

export function CameraIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="6.5" width="12.5" height="11" rx="3" />
      <path d="m15.5 11 5-2.8v7.6l-5-2.8V11Z" />
      <circle cx="8" cy="12" r="2.2" />
    </Icon>
  );
}

export function DroneIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="9" y="9" width="6" height="6" rx="1.6" />
      <path d="M9 9 6 6M15 9l3-3M9 15l-3 3M15 15l3 3" />
      <circle cx="4.8" cy="4.8" r="2" />
      <circle cx="19.2" cy="4.8" r="2" />
      <circle cx="4.8" cy="19.2" r="2" />
      <circle cx="19.2" cy="19.2" r="2" />
    </Icon>
  );
}

export function LedWallIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2.5" y="4.5" width="19" height="12" rx="2.5" />
      <path d="M8 20h8M12 16.5V20M6 8.5h4M6 12h8" />
    </Icon>
  );
}

export function UsersIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3.5 19.5a5.5 5.5 0 0 1 11 0M16 6.2a3 3 0 0 1 0 5.6M17.5 19.5a5.4 5.4 0 0 0-1.6-3.8" />
    </Icon>
  );
}

export function SparkIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.5 13.6 9 19 10.5 13.6 12 12 17.5 10.4 12 5 10.5 10.4 9 12 3.5Z" />
    </Icon>
  );
}

export function DjIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 13a8 8 0 0 1 16 0" />
      <path d="M4 13v3.5a2 2 0 0 0 2 2h1V13H4ZM20 13v3.5a2 2 0 0 1-2 2h-1V13h3Z" />
      <circle cx="12" cy="13" r="2.4" />
    </Icon>
  );
}

export function DiyaIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.5c2.3 2.2 3.8 4.2 3.8 6.3a3.8 3.8 0 1 1-7.6 0c0-2.1 1.5-4.1 3.8-6.3Z" />
      <path d="M5 17.5h14M7.5 20.5h9" />
    </Icon>
  );
}

export function InstagramIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17" cy="7" r="1" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function FacebookIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <path d="M14.8 8.5h-1.3a2 2 0 0 0-2 2v8" />
      <path d="M9.8 12.6h4.6" />
    </Icon>
  );
}

export function YouTubeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
      <path d="M10.5 9.5v5l4.5-2.5-4.5-2.5Z" fill="currentColor" />
    </Icon>
  );
}

/**
 * Icon per `event_features.code`. The codes live in the database, so this is a
 * lookup with a fallback — an organiser can add a feature row with a new code
 * and the UI still renders it.
 */
export const featureIcons: Record<string, (props: SVGProps<SVGSVGElement>) => ReactElement> = {
  anchor: AnchorRoleIcon,
  gorilla: GorillaMaskIcon,
  videographer: CameraIcon,
  drone: DroneIcon,
  "led-wall": LedWallIcon,
  dj: DjIcon,
};

export function getFeatureIcon(code: string) {
  return featureIcons[code] ?? SparkIcon;
}

export const contactIcons = {
  whatsapp: WhatsAppIcon,
  phone: PhoneIcon,
  mail: MailIcon,
  map: MapPinIcon,
} as const;

export const socialIcons = {
  instagram: InstagramIcon,
  facebook: FacebookIcon,
  youtube: YouTubeIcon,
} as const;
