import type { Metadata } from "next";

import { ErrorState } from "@/components/ui/error-state";
import { requirePermission } from "@/lib/auth/guard";
import { can, permissionsFor, ROLE_LABELS } from "@/lib/auth/permissions";
import { siteConfig } from "@/config/site";
import { siteUrl } from "@/config/env";
import { getEventSettings } from "@/lib/services/admin";

export const metadata: Metadata = {
  title: "Event settings",
  description: "The event, venue and contact details the public site reads.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Event settings — what the public site is actually built from.
 *
 * Read-only in this step, and honest about it: the values shown are the live rows
 * from the database, and editing them (publishing an event, changing a price, taking
 * a night off sale) is the admin dashboard work that follows. Showing the values
 * first is deliberate — it is how an organiser checks what customers are seeing
 * right now, and it can be verified against the public pages.
 *
 * Guarded by `settings:view`: admins and super admins. A staff member who types this
 * URL is redirected to the dashboard with an explanation rather than a blank page.
 */
export default async function SettingsPage() {
  const staff = await requirePermission("settings:view");
  const result = await getEventSettings();

  if (!result.ok) {
    return (
      <ErrorState
        error={{
          kind: result.error.kind === "not-configured" ? "not-configured" : "query-failed",
          message: result.error.message,
        }}
        title="Settings are unavailable"
      />
    );
  }

  const event = result.data;

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Event settings</h1>
        <p className="text-muted text-sm/6">
          The rows the public pages read. Editing arrives in the next step — changing a value here means changing the
          database, which is why it is not a text box on a web form yet.
        </p>
      </div>

      <section className="border-border bg-surface/50 flex flex-col gap-4 rounded-2xl border p-5">
        <h2 className="text-sm font-semibold tracking-tight">The event</h2>

        {event ? (
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Field label="Name" value={event.name} />
            <Field label="Slug" value={event.slug} />
            <Field label="Status" value={event.status.toUpperCase()} hint={statusHint(event.status)} />
            <Field label="Tagline" value={event.tagline ?? "—"} />
            <Field label="Venue" value={[event.venueName, event.venueAddress].filter(Boolean).join(", ")} />
            <Field label="City" value={[event.city, event.state].filter(Boolean).join(", ")} />
            <Field label="Contact phone" value={event.contactPhone ?? "—"} />
            <Field label="Contact email" value={event.contactEmail ?? "—"} />
            <Field
              label="WhatsApp number"
              value={event.whatsappNumber ?? "—"}
              hint="Digits only, no plus — the site's click-to-chat links. Falls back to the phone number."
            />
            <Field label="Instagram" value={event.instagramUrl ?? "—"} />
            <Field label="Facebook" value={event.facebookUrl ?? "—"} />
            <Field label="YouTube" value={event.youtubeUrl ?? "—"} />
            <Field
              label="Support hours"
              value={event.supportHours.length > 0 ? event.supportHours.join(" · ") : "—"}
              hint="Shown on /contact and in the footer"
            />
            <Field label="Currency" value={event.currency} />
          </dl>
        ) : (
          <p className="text-muted text-sm/6">
            No event row exists yet. Apply the schema seed (see docs) or create one
            before the site can show anything.
          </p>
        )}
      </section>

      <section className="border-border bg-surface/50 flex flex-col gap-4 rounded-2xl border p-5">
        <h2 className="text-sm font-semibold tracking-tight">Deployment</h2>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <Field label="Brand name" value={siteConfig.name} hint="src/config/site.ts" />
          <Field label="Public site URL" value={siteUrl} hint="NEXT_PUBLIC_SITE_URL — the base of every QR code" />
          <Field label="Venue timezone" value={siteConfig.timezone} hint="What “tonight” means at the gate" />
          <Field label="Currency" value={siteConfig.currency} />
        </dl>
      </section>

      <section className="border-border bg-surface/50 flex flex-col gap-4 rounded-2xl border p-5">
        <h2 className="text-sm font-semibold tracking-tight">Your access</h2>
        <p className="text-muted text-sm/6">
          You are signed in as the administrator ({ROLE_LABELS[staff.role]}). Everything below is enforced by the server
          on every request, and the database enforces the parts that matter most.
        </p>
        <ul className="text-muted grid gap-1.5 text-xs/5 sm:grid-cols-2">
          <li className="font-semibold text-foreground sm:col-span-2">
            {permissionsFor(staff.role).length} capabilities granted to this role
          </li>
          <li className="sm:col-span-2">
            Full access: bookings, payments, passes, dates, gallery and settings. No separate staff accounts.
          </li>
        </ul>
      </section>
    </>
  );
}

function statusHint(status: string): string {
  switch (status) {
    case "published":
      return "Live: every page can read it.";
    case "draft":
      return "Hidden from the public site.";
    case "archived":
      return "Kept for history, not bookable.";
    default:
      return "";
  }
}

function Field({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted/70 text-[0.6875rem] font-semibold tracking-widest uppercase">{label}</dt>
      <dd className="font-medium break-words">{value}</dd>
      {hint ? <p className="text-muted/80 text-[0.6875rem]">{hint}</p> : null}
    </div>
  );
}
