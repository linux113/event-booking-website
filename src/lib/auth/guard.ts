import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Route } from "next";

import { getStaffMember } from "@/lib/auth/staff";
import type { StaffMember } from "@/types/admin";

/**
 * The authorization gate every admin page and admin API route goes through.
 *
 * There is one rule: **a page calls this before it reads anything sensitive.**
 * Not the layout alone — the page, on the server, on every request.
 *
 * One authenticated admin → full access. There are no per-section permissions;
 * `requirePermission` remains as a thin alias so call sites keep working.
 */

/** Where to send somebody who is not signed in, remembering where they were going. */
async function signInUrl(): Promise<string> {
  const headerList = await headers();
  const path = headerList.get("x-admin-path") ?? "/admin";

  return `/admin/login?next=${encodeURIComponent(path.startsWith("/admin") ? path : "/admin")}`;
}

/** A signed-in admin, or a redirect to the sign-in screen. */
export async function requireStaff(): Promise<StaffMember> {
  const admin = await getStaffMember();

  if (!admin) {
    redirect((await signInUrl()) as Route);
  }

  return admin;
}

/** Alias: any authenticated admin holds every capability. */
export async function requireAdmin(): Promise<StaffMember> {
  return requireStaff();
}

/**
 * Historical name kept so existing page imports compile. The single admin always
 * passes; the permission argument is ignored.
 */
export async function requirePermission(_permission: string): Promise<StaffMember> {
  return requireStaff();
}

/** No longer produced — there is no per-section denial for a full-access admin. */
export function deniedMessage(_denied: string | null | undefined): string | null {
  return null;
}
