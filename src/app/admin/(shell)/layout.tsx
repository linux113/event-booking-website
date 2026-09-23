import { AdminHeader } from "@/components/admin/admin-header";
import { Container, Section } from "@/components/ui/container";
import { requireStaff } from "@/lib/auth/guard";

/**
 * The shell around every signed-in admin page.
 *
 * It calls `requireStaff()` once, so a visitor with no admin session never sees any
 * admin chrome — they are redirected before a single admin route renders.
 *
 * It is *not* the access control for the pages inside it, and it is important not to
 * mistake one for the other: each page asks `requirePermission()` for the capability
 * it actually needs, because a layout is a rendering convenience and a page can be
 * requested without it. The layout answers "is somebody signed in?"; the pages answer
 * "may this person be here?".
 *
 * The reverse case — a signed-in staff member with no permission for a page they
 * typed the URL for — is also a page-level decision: `requirePermission` sends them
 * to the dashboard with an explanation. The header only ever links to pages the
 * current role can open.
 */
export default async function AdminShellLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();

  return (
    <>
      <AdminHeader staff={staff} />

      <Section className="pt-8">
        <Container className="max-w-5xl flex flex-col gap-6">{children}</Container>
      </Section>
    </>
  );
}
