/**
 * Who may do what.
 *
 * One table, read by the server on every admin request, and nothing else decides
 * access. It is deliberately a plain module with no imports: the guard on the server
 * and the navigation on the dashboard must agree about permissions exactly, and the
 * cheapest way to guarantee that is for both to ask the same function.
 *
 * The roles:
 *
 *   super_admin  Full access, including managing staff accounts and roles.
 *   admin        Bookings, payments, passes, dates, gallery, scanner, settings —
 *                everything operational. Cannot manage staff.
 *   staff        The scanner, check-ins, and a limited booking lookup: enough to
 *                find and admit a guest, with no contact details, amounts or
 *                gateway ids.
 *
 * A permission is a *capability*, not a page. `bookings:view` opens the lookup;
 * `bookings:view_contact` is what decides whether a customer's mobile number,
 * email address and amount may be rendered in it. Keeping those apart is what lets
 * one page serve both roles without the staff view ever being assembled from data
 * it should not have.
 */

export type StaffRole = "super_admin" | "admin" | "staff";

export const STAFF_ROLES: readonly StaffRole[] = ["super_admin", "admin", "staff"];

export type Permission =
  /** Open the booking lookup (staff get the limited columns). */
  | "bookings:view"
  /** See customer contact details, amounts and gateway ids. */
  | "bookings:view_contact"
  | "payments:view"
  | "passes:view"
  | "dates:view"
  | "gallery:view"
  | "scanner:use"
  | "settings:view"
  | "staff:manage";

const PERMISSIONS_BY_ROLE: Record<StaffRole, readonly Permission[]> = {
  super_admin: [
    "bookings:view",
    "bookings:view_contact",
    "payments:view",
    "passes:view",
    "dates:view",
    "gallery:view",
    "scanner:use",
    "settings:view",
    "staff:manage",
  ],
  admin: [
    "bookings:view",
    "bookings:view_contact",
    "payments:view",
    "passes:view",
    "dates:view",
    "gallery:view",
    "scanner:use",
    "settings:view",
  ],
  staff: ["bookings:view", "scanner:use"],
};

/** Human labels, used in the admin UI and in the "no access" message. */
export const ROLE_LABELS: Record<StaffRole, string> = {
  super_admin: "Super admin",
  admin: "Admin",
  staff: "Staff",
};

/**
 * A section of the admin area: what it is called, where it lives, what it needs,
 * and whether it exists yet.
 *
 * `built: false` sections are shown on the dashboard as work still to come rather
 * than as links, so a staff member never clicks into an empty shell. Their
 * permission keys are already defined and enforced by the same guard the built
 * pages use, so the pages cannot arrive later with a wider door than intended.
 */
export interface AdminSection {
  key: string;
  label: string;
  description: string;
  /** `null` for a section that is not routable yet. */
  href: string | null;
  permission: Permission;
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
    description: "Every issued pass, its state and when it was admitted.",
    href: "/admin/passes",
    permission: "passes:view",
    built: true,
  },
  {
    key: "dates",
    label: "Dates & capacity",
    description: "Per-night capacity, how full a night is, and closing a night.",
    href: "/admin/dates",
    permission: "dates:view",
    built: false,
  },
  {
    key: "gallery",
    label: "Gallery",
    description: "Publish, hide and order the photos on the public gallery.",
    href: "/admin/gallery",
    permission: "gallery:view",
    built: false,
  },
  {
    key: "settings",
    label: "Event settings",
    description: "The event, venue, contact details and currency the site reads.",
    href: "/admin/settings",
    permission: "settings:view",
    built: true,
  },
  {
    key: "staff",
    label: "Staff accounts",
    description: "Who can sign in, with which role, and whether they are active.",
    href: "/admin/staff",
    permission: "staff:manage",
    built: true,
  },
];

/** True when this role holds this capability. */
export function can(role: StaffRole, permission: Permission): boolean {
  return PERMISSIONS_BY_ROLE[role]?.includes(permission) ?? false;
}

/** Every capability of a role, in declaration order. */
export function permissionsFor(role: StaffRole): readonly Permission[] {
  return PERMISSIONS_BY_ROLE[role] ?? [];
}

/** The sections this role may open, in dashboard order. */
export function sectionsFor(role: StaffRole): AdminSection[] {
  return ADMIN_SECTIONS.filter((section) => can(role, section.permission));
}

/** The label of the section a permission belongs to (for "no access" messages). */
export function sectionLabelForPermission(permission: Permission): string {
  return ADMIN_SECTIONS.find((section) => section.permission === permission)?.label ?? "That section";
}

/** True for any of the three known roles — used when reading untrusted rows. */
export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === "string" && (STAFF_ROLES as readonly string[]).includes(value);
}
