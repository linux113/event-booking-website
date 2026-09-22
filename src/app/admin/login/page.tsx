import type { Metadata, Route } from "next";
import { redirect } from "next/navigation";

import { SignInForm } from "@/components/admin/sign-in-form";
import { Container, Section } from "@/components/ui/container";
import { getStaffMember } from "@/lib/auth/staff";

export const metadata: Metadata = {
  title: "Staff sign-in",
  description: "Sign-in for event staff: scan and check in passes at the gate.",
  // Staff pages are never indexed.
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type StaffLoginPageProps = {
  searchParams: Promise<{ next?: string | string[] }>;
};

/**
 * The way in for staff.
 *
 * Being signed in is not the same as being staff, so this page asks the database
 * (through `getStaffMember`, which checks the `admin_users` allow-list) and only
 * then sends the visitor on to the scanner. Someone who is signed in but not on the
 * list sees the sign-in form with an explanation, not a redirect loop.
 */
export default async function StaffLoginPage({ searchParams }: StaffLoginPageProps) {
  const params = await searchParams;
  const requested = Array.isArray(params.next) ? params.next[0] : params.next;
  const next = requested?.startsWith("/") && !requested.startsWith("//") ? requested : "/admin/scanner";

  const staff = await getStaffMember();

  if (staff) {
    redirect(next as Route);
  }

  return (
    <Section className="min-h-[70vh] py-16">
      <Container className="max-w-md">
        <div className="border-border bg-surface/50 flex flex-col gap-6 rounded-2xl border p-6 sm:p-8">
          <div className="flex flex-col gap-2">
            <p className="text-marigold-soft text-xs font-semibold tracking-[0.22em] uppercase">Event staff</p>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Sign in to the gate</h1>
            <p className="text-muted text-sm/6">
              The scanner is for event staff only. Sign in with the email address and password your organiser set up
              for you, then point a phone at the guest&apos;s pass.
            </p>
          </div>

          <SignInForm next={next} />
        </div>

        <p className="text-muted/80 mt-6 text-center text-xs/5">
          Scanning is a staff action: every check-in is recorded against the signed-in account.
        </p>
      </Container>
    </Section>
  );
}
