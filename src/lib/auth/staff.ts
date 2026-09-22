import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { StaffMember, StaffRole } from "@/types/admin";

/**
 * Who is working the gate.
 *
 * Two separate questions, both answered on the server:
 *
 *   1. **Is anybody signed in?** Supabase Auth session cookies (`@supabase/ssr`),
 *      revalidated with `getUser()` — never trusted from a cookie alone.
 *   2. **Are they allowed to be staff?** The `admin_users` allow-list. Being
 *      "somebody with a Supabase account" is not the same as being event staff, and
 *      the check is made against the database, not against a claim in the token.
 *
 * The allow-list read uses the service-role client on purpose: the scanner must not
 * depend on an RLS policy being written correctly for a self-read, and the answer
 * ("is this user staff?") is exactly the kind of decision that should be made once,
 * in trusted code. The id this returns is what `check_in_pass` re-verifies inside
 * the database, so a bug here still cannot admit anybody.
 */

const STAFF_ROLES: readonly string[] = ["owner", "admin", "manager", "scanner"];

function toStaffMember(row: {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  role: string;
}): StaffMember {
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    fullName: row.full_name,
    displayName: row.full_name?.trim() || row.email,
    role: row.role as StaffRole,
  };
}

/**
 * The staff row behind a Supabase Auth user id, or null when that user is not
 * active staff. Used both by the session helpers and by the sign-in route (to
 * refuse a valid login that belongs to nobody on the allow-list).
 */
export async function findStaffMember(userId: string): Promise<StaffMember | null> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("admin_users")
      .select("id, user_id, email, full_name, role, is_active")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      console.error("[auth] staff lookup failed:", error.message, error.code);

      return null;
    }

    if (!data || data.is_active !== true || !STAFF_ROLES.includes(data.role)) {
      return null;
    }

    return toStaffMember(data);
  } catch (error) {
    // No service-role key (or no Supabase at all): nobody is staff on this
    // deployment, and the scanner says so instead of failing open.
    console.error("[auth] staff lookup unavailable:", error);

    return null;
  }
}

/**
 * The signed-in staff member for the current request, or null.
 *
 * Only callable where cookies are readable — a server component, a route handler
 * or a server action. The proxy uses its own cookie adapter (see `src/proxy.ts`).
 */
export async function getStaffMember(): Promise<StaffMember | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
      return null;
    }

    return await findStaffMember(data.user.id);
  } catch (error) {
    console.error("[auth] session lookup unavailable:", error);

    return null;
  }
}
