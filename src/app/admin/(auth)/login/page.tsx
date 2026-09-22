import type { Metadata, Route } from "next";
import { redirect } from "next/navigation";

import { SignInForm } from "@/components/admin/sign-in-form";
import { SignOutButton } from "@/components/admin/sign-out-button";
import { Container, Section } from "@/components/ui/container";
import { getSignedInUser, getStaffMember } from "@/lib/auth/staff";

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

/** Admin paths only, so a crafted link cannot redirect a staff member off-site. */
function safeNext(value: string | string[] | undefined): string {
  const requested = Array.isArray(value) ? value[0] : value;

  if (!requested || !requested.startsWith("/admin") || requested.startsWith("//")) {
    return "/admin";
  }

  return requested;
}

/**
 * The way in.
 *
 * Three states, and they are all honest about what is happening:
 *
 *   1. **Signed in as staff** → straight through to the page they came for. Being
 *      signed in is checked against the `admin_users` allow-list, not just the
 *      session, so this cannot loop: only somebody with a role is sent onward.
 *   2. **Signed in, but not staff** → an explanation and a way out. A Supabase
 *      account is not a staff account; signing in again would only produce the same
 *      refusal, so the page does not pretend otherwise.
 *   3. **Signed out** → the form.
 *
 * This page is inside the `(auth)` route group, so it renders without the admin
 * chrome — there is nothing to navigate to yet, and the shell would otherwise show
 * a signed-out visitor a header full of links they cannot open.
 */
export default async function StaffLoginPage({ searchParams }: StaffLoginPageProps) {
  const params = await searchParams;
  const next = safeNext(params.next);

  const staff = await getStaffMember();

  if (staff) {
    redirect(next as Route);
  }

  const user = await getSignedInUser();

  return (
    <Section className="min-h-[70vh] py-16">
      <Container className="max-w-md">
        <div className="border-border bg-surface/50 flex flex-col gap-6 rounded-2xl border p-6 sm:p-8">
          <div className="flex flex-col gap-2">
            <p className="text-marigold-soft text-xs font-semibold tracking-[0.22em] uppercase">Event staff</p>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Sign in to the staff area</h1>
            <p className="text-muted text-sm/6">
              The admin area is for event staff only. Sign in with the email address and password your organiser set up
              for you.
            </p>
          </div>

          {user ? (
            <div
              role="alert"
              className="border-marigold/40 bg-marigold/10 flex flex-col gap-3 rounded-xl border px-3.5 py-3"
            >
              <p className="text-marigold-soft text-sm/6 font-semibold">Not a staff account</p>
              <p className="text-foreground text-sm/6">
                You are signed in as <span className="font-semibold">{user.email ?? "your account"}</span>, but that
                account is not on this event&apos;s staff list, so it cannot open any admin page. A different account
                will work — sign out first, then use the staff email you were given.
              </p>
              <div>
                <SignOutButton />
              </div>
            </div>
          ) : (
            <SignInForm next={next} />
          )}
        </div>

        <p className="text-muted/80 mt-6 text-center text-xs/5">
          Every check-in and every staff page is recorded against the signed-in account.
        </p>
      </Container>
    </Section>
  );
}
