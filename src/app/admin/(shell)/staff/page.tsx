import type { Metadata } from "next";

import { ErrorState } from "@/components/ui/error-state";
import { requirePermission } from "@/lib/auth/guard";
import { formatTimestamp } from "@/lib/format";
import { listStaffAccounts } from "@/lib/services/admin";

export const metadata: Metadata = {
  title: "Staff accounts",
  description: "Who can sign in to the staff area, with which role.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Staff accounts — the super admin's list of who may sign in, and as what.
 *
 * This is the page that makes the third role mean something: it is guarded by
 * `staff:manage`, which only `super_admin` holds, so an admin (let alone a staff
 * member) is redirected away from it.
 *
 * Read-only on purpose. Creating a staff member is two deliberate steps — a Supabase
 * Auth user, then a row on the `admin_users` allow-list — and changing a role is a
 * database write with real consequences (including, for a super admin, the ability
 * to remove their own access). A page that edits roles deserves guard rails this step
 * has not built, so it shows the truth and leaves the writing for later.
 */
export default async function StaffPage() {
  const viewer = await requirePermission("staff:manage");
  const result = await listStaffAccounts();

  if (!result.ok) {
    return (
      <ErrorState
        error={{
          kind: result.error.kind === "not-configured" ? "not-configured" : "query-failed",
          message: result.error.message,
        }}
        title="The staff list is unavailable"
      />
    );
  }

  const accounts = result.data;
  const active = accounts.filter((account) => account.isActive).length;

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Staff accounts</h1>
        <p className="text-muted text-sm/6">
          {accounts.length} {accounts.length === 1 ? "account" : "accounts"}, {active} active. Signing in requires a
          Supabase Auth user <em>and</em> a row here: an account that is not on this list cannot reach any admin page,
          whatever its password.
        </p>
      </div>

      <ul className="flex flex-col gap-3">
        {accounts.map((account) => (
          <li
            key={account.id}
            className="border-border bg-surface/50 flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex flex-col gap-0.5">
              <p className="font-semibold tracking-tight">
                {account.fullName?.trim() || account.email}
                {account.userId === viewer.userId ? (
                  <span className="text-muted/80 ml-2 text-xs font-medium">(you)</span>
                ) : null}
              </p>
              <p className="text-muted text-xs">{account.email}</p>
              <p className="text-muted/80 text-[0.6875rem]">
                Added {formatTimestamp(account.createdAt)}
                {account.lastLoginAt ? ` · last signed in ${formatTimestamp(account.lastLoginAt)}` : " · never signed in"}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[0.6875rem] font-semibold tracking-widest uppercase ${
                  account.role === "super_admin"
                    ? "border-marigold/40 bg-marigold/10 text-marigold-soft"
                    : "border-border bg-surface-raised/60 text-muted"
                }`}
              >
                {account.roleLabel}
              </span>
              <span
                className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[0.6875rem] font-semibold tracking-widest uppercase ${
                  account.isActive
                    ? "border-peacock/40 bg-peacock/10 text-peacock-soft"
                    : "border-rani/40 bg-rani/10 text-rani-soft"
                }`}
              >
                {account.isActive ? "Active" : "Suspended"}
              </span>
            </div>
          </li>
        ))}
      </ul>

      <section className="border-border bg-surface/40 flex flex-col gap-2 rounded-2xl border p-4">
        <h2 className="text-sm font-semibold tracking-tight">Adding somebody</h2>
        <ol className="text-muted list-decimal space-y-1 pl-5 text-xs/5">
          <li>
            Create the user in Supabase → <strong>Authentication → Users</strong> (email and password, or an invite).
          </li>
          <li>
            Copy their user id and add the allow-list row with the role they need — <code className="font-mono">staff</code>{" "}
            for gate work, <code className="font-mono">admin</code> for operations,{" "}
            <code className="font-mono">super_admin</code> only for somebody who manages staff.
          </li>
          <li>Deactivating is setting <code className="font-mono">is_active = false</code>: they keep the account and lose the access, immediately.</li>
        </ol>
        <p className="text-muted/80 text-xs/5">
          The full SQL is in <code className="font-mono">supabase/README.md</code>.
        </p>
      </section>
    </>
  );
}
