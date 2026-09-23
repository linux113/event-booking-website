import type { Metadata, Route } from "next";
import { redirect } from "next/navigation";

import { SignInForm } from "@/components/admin/sign-in-form";
import { Container, Section } from "@/components/ui/container";
import { getSignedInUser, getStaffMember } from "@/lib/auth/staff";

export const metadata: Metadata = {
  title: "Administrator sign-in",
  description: "Sign-in for the event booking administrator.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type AdminLoginPageProps = {
  searchParams: Promise<{ next?: string | string[] }>;
};

/** Admin paths only, so a crafted link cannot redirect off-site. */
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
 *   1. **Already signed in** → straight through to the page they came for.
 *   2. **Signed out** → the administrator form.
 */
export default async function AdminLoginPage({ searchParams }: AdminLoginPageProps) {
  const params = await searchParams;
  const next = safeNext(params.next);

  const admin = await getStaffMember();

  if (admin) {
    redirect(next as Route);
  }

  // Kept for parity with older call sites; always null for a signed-out visitor.
  await getSignedInUser();

  return (
    <Section className="min-h-[70vh] py-16">
      <Container className="max-w-md">
        <div className="border-border bg-surface/50 flex flex-col gap-6 rounded-2xl border p-6 sm:p-8">
          <div className="flex flex-col gap-2">
            <p className="text-marigold-soft text-xs font-semibold tracking-[0.22em] uppercase">Administration</p>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Sign in</h1>
            <p className="text-muted text-sm/6">
              Full access to bookings, payments, passes, the gate scanner and settings. Sign in with the administrator
              email and password configured for this deployment.
            </p>
          </div>

          <SignInForm next={next} />
        </div>

        <p className="text-muted/80 mt-6 text-center text-xs/5">
          Sessions are HTTP-only cookies; credentials live only on the server.
        </p>
      </Container>
    </Section>
  );
}
