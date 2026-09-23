import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Route } from "next";

import { can, sectionLabelForPermission, type Permission } from "@/lib/auth/permissions";
import { getStaffMember } from "@/lib/auth/staff";
import type { StaffMember } from "@/types/admin";

/**
 * The authorization gate every admin page and admin API route goes through.
 *
 * There is one rule and it is not negotiable: **a page calls this before it reads
 * anything sensitive.** Not the layout, not the navigation, not a client component —
 * the page, on the server, on every request. A layout-level check is a convenience
 * for the visitor; it is not a security boundary, because a route can be reached
 * without its layout running first.
 *
 * Two different "no"s, on purpose:
 *
 *   * **Not signed in** → `redirect("/admin/login?next=<where they were going>")`.
 *     That is the requirement, and it is also what a person expects.
 *   * **Signed in, but this role may not be here** → `redirect("/admin?denied=<what>")`.
 *     Sending them to the sign-in screen would be a loop — they *are* signed in, so
 *     the sign-in screen would send them straight back to the page that refused
 *     them. The dashboard explains what happened and offers what they can reach.
 *
 * Both answers are redirects that contain no data: an unauthorised visitor never
 * receives a rendered admin page, not even an empty one.
 */

/** Where to send somebody who is not signed in, remembering where they were going. */
async function signInUrl(): Promise<string> {
  const headerList = await headers();
  // Set by the proxy for the request in flight; falls back to the admin home.
  const path = headerList.get("x-admin-path") ?? "/admin";

  return `/admin/login?next=${encodeURIComponent(path.startsWith("/admin") ? path : "/admin")}`;
}

/** A signed-in staff member, or a redirect to the sign-in screen. */
export async function requireStaff(): Promise<StaffMember> {
  const staff = await getStaffMember();

  if (!staff) {
    redirect((await signInUrl()) as Route);
  }

  return staff;
}

/**
 * A signed-in staff member who holds this capability, or a redirect.
 *
 * `requirePermission` is the only function an admin page should use for access
 * control: it answers "may this person be here?" and hands back the identity the
 * page needs for everything else.
 */
export async function requirePermission(permission: Permission): Promise<StaffMember> {
  const staff = await requireStaff();

  if (!can(staff.role, permission)) {
    redirect(`/admin?denied=${encodeURIComponent(permission)}` as Route);
  }

  return staff;
}

/** The message the dashboard shows after a `requirePermission` refusal. */
export function deniedMessage(denied: string | null | undefined): string | null {
  if (!denied) {
    return null;
  }

  const label = sectionLabelForPermission(denied as Permission);

  return `${label} is not available to your role.`;
}
