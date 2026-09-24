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
      viewBox="0 0 448 512"
      fill="currentColor"
      aria-hidden="true"
      className={className ?? "size-5"}
      {...props}
    >
      <path d="M380.9 97.1C339 55.1 283.2 32 223.9 32 101.5 32 2 131.5 2 254c0 39.1 10.2 77.3 29.6 110.9L0 480l118.4-31.1c32.6 17.8 69.4 27.2 105.4 27.2h.1c122.4 0 222-99.6 222-222 0-59.3-23.1-115-65-157zM223.9 438.7c-32.9 0-65.1-8.8-93.2-25.5l-6.7-4-70.3 18.4 18.8-68.5-4.4-7c-18.6-29.6-28.4-63.8-28.4-98.9 0-102.3 83.3-185.6 185.7-185.6 49.6 0 96.3 19.3 131.3 54.4 35.1 35.1 54.4 81.7 54.3 131.4 0 102.3-83.3 185.7-185.6 185.7zm101.9-138.9c-5.6-2.8-33.1-16.3-38.2-18.2-5.1-1.9-8.8-2.8-12.5 2.8s-14.4 18.2-17.7 21.9c-3.3 3.7-6.5 4.2-12.1 1.4-32.9-16.4-54.5-29.3-76.3-66.4-5.7-9.8 5.7-9.1 16.4-30.3 1.8-3.7.9-6.9-.5-9.7s-12.5-30.1-17.1-41.2c-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2s-9.7 1.4-14.8 6.9c-5.1 5.6-19.4 19-19.4 46.3s19.9 53.6 22.7 57.3c2.8 3.7 39.1 59.7 94.8 83.7 35.2 15.2 49 16.5 66.5 13.9 10.7-1.6 33.1-13.5 37.8-26.5 4.6-13 4.6-24.1 3.2-26.5-1.3-2.4-5-3.8-10.6-6.6z" />
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
