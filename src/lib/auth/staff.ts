import "server-only";

import { cache } from "react";

import { isStaffRole, type StaffRole } from "@/lib/auth/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { StaffMember } from "@/types/admin";

/**
 * Who is working, and what may they touch?
 *
 * Two separate questions, both answered on the server, and neither answered by the
 * browser:
 *
 *   1. **Is anybody signed in?** Supabase Auth session cookies (`@supabase/ssr`),
 *      revalidated with `getUser()` — never trusted from a cookie alone.
 *   2. **Are they allowed to be staff?** The `admin_users` allow-list. Being
 *      "somebody with a Supabase account" is not the same as being event staff, and
 *      the check is made against the database, not against a claim in the token.
 *
 * The allow-list read uses the service-role client on purpose: the answer ("is this
 * user staff?") is an authorisation decision made once, in trusted code, and it must
 * not depend on an RLS policy being written correctly for a self-read. The id this
 * returns is what `check_in_pass()` re-verifies inside the database, so a bug even
 * here cannot admit anybody.
 *
 * `getStaffMember` is wrapped in React's `cache()`: a layout and the page inside it
 * both need it during one request, and this makes that one round trip rather than
 * two, without any request-scoped globals.
 */

type StaffRow = {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
  last_login_at: string | null;
};

function toStaffMember(row: StaffRow): StaffMember {
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    fullName: row.full_name,
    displayName: row.full_name?.trim() || row.email,
    role: row.role as StaffRole,
    lastLoginAt: row.last_login_at,
  };
}

/**
 * The staff row behind a Supabase Auth user id, or null when that user is not
 * active staff. A row whose role is not one of the three known roles is refused as
 * well: an old or hand-edited value must not resolve to *some* access.
 */
export async function findStaffMember(userId: string): Promise<StaffMember | null> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("admin_users")
      .select("id, user_id, email, full_name, role, is_active, last_login_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      console.error("[auth] staff lookup failed:", error.message, error.code);

      return null;
    }

    if (!data || data.is_active !== true || !isStaffRole(data.role)) {
      return null;
    }

    return toStaffMember(data);
  } catch (error) {
    // No service-role key (or no Supabase at all): nobody is staff on this
    // deployment, and the admin area says so instead of failing open.
    console.error("[auth] staff lookup unavailable:", error);

    return null;
  }
}

/** The signed-in Supabase user, without asking whether they are staff. */
export interface SignedInUser {
  id: string;
  email: string | null;
}

/**
 * The session's user, or null.
 *
 * Used by the sign-in screen to tell "not signed in" apart from "signed in as
 * somebody who is not staff" — the second case deserves an explanation rather than
 * a login form that will refuse them again.
 */
export const getSignedInUser = cache(async (): Promise<SignedInUser | null> => {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
      return null;
    }

    return { id: data.user.id, email: data.user.email ?? null };
  } catch (error) {
    console.error("[auth] session lookup unavailable:", error);

    return null;
  }
});

/** The signed-in staff member for the current request, or null. */
export const getStaffMember = cache(async (): Promise<StaffMember | null> => {
  const user = await getSignedInUser();

  if (!user) {
    return null;
  }

  return findStaffMember(user.id);
});

/**
 * Note that somebody signed in.
 *
 * Written with the service role because `admin_users` is not writable by the user
 * themself, and it is deliberately best-effort: a failure to record a timestamp must
 * never keep a staff member out of the gate. This is the only write the app makes to
 * the allow-list.
 */
export async function recordStaffLogin(staffUserId: string): Promise<void> {
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("admin_users")
      .update({ last_login_at: new Date().toISOString() })
      .eq("user_id", staffUserId);

    if (error) {
      console.error("[auth] could not record the sign-in:", error.message, error.code);
    }
  } catch (error) {
    console.error("[auth] could not record the sign-in:", error);
  }
}
