import type { Route } from "next";
import Link from "next/link";

import { SignOutButton } from "@/components/admin/sign-out-button";
import { Container, Section } from "@/components/ui/container";
import { ROLE_LABELS, sectionsFor } from "@/lib/auth/permissions";
import type { StaffMember } from "@/types/admin";

/**
 * The admin chrome: who is signed in, what they may open, and the way out.
 *
 * Navigation lists every built admin section. Each page still checks the session
 * on the server before reading anything.
 */
export function AdminHeader({ staff }: { staff: StaffMember }) {
  const sections = sectionsFor(staff.role).filter((section) => section.built && section.href);

  return (
    <Section className="pb-0">
      <Container className="max-w-5xl">
        <div className="border-border flex flex-col gap-4 border-b pb-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <p className="text-marigold-soft text-[0.6875rem] font-semibold tracking-[0.22em] uppercase">
                Admin area
              </p>
              <Link href={"/admin" as Route} className="text-xl font-bold tracking-tight hover:underline">
                {staff.displayName}
              </Link>
              <p className="text-muted text-xs">
                {ROLE_LABELS[staff.role]} · {staff.displayName}
              </p>
            </div>

            <SignOutButton />
          </div>

          <nav aria-label="Admin sections">
            <ul className="flex flex-wrap gap-2">
              {sections.map((section) => (
                <li key={section.key}>
                  <Link
                    href={section.href as Route}
                    className="border-border bg-surface/60 text-muted hover:text-foreground hover:bg-surface-raised inline-flex h-9 items-center rounded-full border px-4 text-sm font-semibold tracking-tight transition-colors"
                  >
                    {section.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </Container>
    </Section>
  );
}
