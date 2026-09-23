import "server-only";

import { cache } from "react";

import type { StaffMember } from "@/types/admin";
import {
  authenticate as attemptAuthenticate,
  getAdminSession as readAdminSession,
  type AdminIdentity,
} from "@/lib/auth/session";

/**
 * Who is signed in to the admin area?
 *
 * One administrator. There is no allow-list table and no role matrix: if the
 * session cookie verifies, this is the admin, and every admin page is theirs.
 */

export type { AdminIdentity };

function toStaffMember(admin: AdminIdentity): StaffMember {
  return {
    id: admin.id,
    email: admin.username,  // AdminIdentity.username holds the admin email
    fullName: null,
    displayName: admin.displayName,
    role: "super_admin",
    lastLoginAt: null,
  };
}

/** The signed-in admin for this request, or null. Memoised per request. */
export const getStaffMember = cache(async (): Promise<StaffMember | null> => {
  const admin = await readAdminSession();
  return admin ? toStaffMember(admin) : null;
});

/** Alias used by newer call sites — same single-admin identity. */
export const getAdmin = getStaffMember;

/**
 * "Is somebody signed in?" for the login screen.
 */
export const getSignedInUser = cache(
  async (): Promise<{ id: string; email: string | null } | null> => {
    const admin = await readAdminSession();
    if (!admin) return null;
    return {
      id: admin.id,
      email: admin.username.includes("@") ? admin.username : null,
    };
  },
);

/** Verifies admin email + password against the environment. Used by the sign-in action. */
export function attemptSignIn(email: string, password: string): AdminIdentity | null {
  return attemptAuthenticate(email, password);
}

/** No-op: there is no staff table to stamp a login time on. */
export async function recordStaffLogin(): Promise<void> {
  // Intentionally empty — single-admin sessions live only in the cookie.
}
