/**
 * Admin navigation sections.
 *
 * Roles and permission matrices are gone: one authenticated admin has full
 * access to every section. This table remains only as the dashboard/header's
 * navigation source of truth (label, href, description).
 *
 * `permission` is kept as an opaque string for historical call sites; it is not
 * consulted for access control anywhere.
 */

export type Permission = string;
export type StaffRole = "super_admin";

export interface AdminSection {
  key: string;
  label: string;
  description: string;
  href: string | null;
  permission: string;
  built: boolean;
}

export const ADMIN_SECTIONS: readonly AdminSection[] = [
  {
    key: "scanner",
    label: "Gate scanner",
    description: "Scan a pass, check the guest in, record the entry.",
    href: "/admin/scanner",
    permission: "scanner:use",
    built: true,
  },
  {
    key: "bookings",
    label: "Bookings",
    description: "Look up a booking by reference, mobile number or guest name.",
    href: "/admin/bookings",
    permission: "bookings:view",
    built: true,
  },
  {
    key: "payments",
    label: "Payments",
    description: "What Razorpay reported for each booking, and what went wrong.",
    href: "/admin/payments",
    permission: "payments:view",
    built: true,
  },
  {
    key: "passes",
    label: "Passes",
    description: "Every issued pass, and the pass types on sale with their prices.",
    href: "/admin/passes",
    permission: "passes:view",
    built: true,
  },
  {
    key: "dates",
    label: "Dates & capacity",
    description: "The nights, how full each one is, capacity and booking open or closed.",
    href: "/admin/dates",
    permission: "dates:view",
    built: true,
  },
  {
    key: "gallery",
    label: "Gallery",
    description: "Publish, hide and order the photos on the public gallery.",
    href: "/admin/gallery",
    permission: "gallery:view",
    built: true,
  },
  {
    key: "settings",
    label: "Event settings",
    description: "The event, venue, contact details and currency the site reads.",
    href: "/admin/settings",
    permission: "settings:view",
    built: true,
  },
];

/** Human labels. One admin role only. */
export const ROLE_LABELS: Record<StaffRole, string> = {
  super_admin: "Admin",
};

/** True when the (single) admin holds this capability — always. */
export function can(_role: StaffRole | string | null | undefined, _permission: Permission): boolean {
  return true;
}

/** Every capability of a role — full access. */
export function permissionsFor(_role: StaffRole | string): readonly Permission[] {
  return ADMIN_SECTIONS.map((section) => section.permission);
}

/** Every section, in dashboard order. */
export function sectionsFor(_role?: StaffRole | string | null): AdminSection[] {
  return [...ADMIN_SECTIONS];
}

/** The label of the section a permission belongs to (for messages). */
export function sectionLabelForPermission(permission: Permission): string {
  return ADMIN_SECTIONS.find((section) => section.permission === permission)?.label ?? "That section";
}

/** Accepts any known role string; there is only one in practice. */
export function isStaffRole(value: unknown): value is StaffRole {
  return value === "super_admin" || value === "admin" || value === "staff";
}
