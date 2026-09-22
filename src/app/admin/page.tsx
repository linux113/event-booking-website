import type { Metadata, Route } from "next";
import { redirect } from "next/navigation";

import { getStaffMember } from "@/lib/auth/staff";

export const metadata: Metadata = {
  title: "Staff area",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * `/admin` is a signpost, not a page.
 *
 * There is exactly one staff tool today (the gate scanner), so this route exists to
 * answer one question and get out of the way: signed-in staff go to the scanner,
 * everybody else goes to the sign-in screen. When more staff surfaces exist (the
 * dashboard step), this becomes their index.
 */
export default async function AdminIndexPage() {
  const staff = await getStaffMember();

  if (!staff) {
    redirect("/admin/login");
  }

  redirect("/admin/scanner" as Route);
}
