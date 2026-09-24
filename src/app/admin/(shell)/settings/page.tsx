import type { Metadata } from "next";

import { EventBasicsSettingsForm } from "@/components/admin/event-basics-settings-form";
import { EventContactSettingsForm } from "@/components/admin/event-contact-settings-form";
import { EventHeroImageSettings } from "@/components/admin/event-hero-image-settings";
import { SiteContentSettingsForm } from "@/components/admin/site-content-settings-form";
import { ErrorState } from "@/components/ui/error-state";
import { siteConfig } from "@/config/site";
import { siteUrl } from "@/config/env";
import { requirePermission } from "@/lib/auth/guard";
import { can, permissionsFor, ROLE_LABELS } from "@/lib/auth/permissions";
import { getEventSettings } from "@/lib/services/admin";

export const metadata: Metadata = {
  title: "Event settings",
  description: "The event, venue and contact details the public site reads.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Event settings — the selected event row that supplies the public contact block.
 *
 * The contact form is intentionally narrow: it edits the phone, email, WhatsApp,
 * street address, map/social URLs and support hours without exposing unrelated event
 * publishing or booking settings.
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
  const canEdit = can(staff.role, "settings:edit");

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Event settings</h1>
        <p className="text-muted text-sm/6">
          Check the event the site is using, update the homepage hero artwork, and edit its public story — the event
          details, the About Us copy, the gallery heading, the booking FAQs and the contact details. Saved changes
          take effect without a deployment.
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
            <Field label="Venue name" value={event.venueName} />
            <Field label="City" value={[event.city, event.state].filter(Boolean).join(", ")} />
            <Field label="Currency" value={event.currency} />
          </dl>
        ) : (
          <p className="text-muted text-sm/6">
            No event row exists yet. Apply the schema seed (see docs) or create one before the site can show anything.
          </p>
        )}
      </section>

      {event ? (
        <EventHeroImageSettings
          eventId={event.id}
          eventName={event.name}
          canEdit={canEdit}
          initialImageUrl={event.heroImageUrl}
          initialHasImage={event.hasHeroImage}
          initialByteSize={event.heroImageByteSize}
          initialVersion={event.heroImageVersion}
        />
      ) : null}

      {event ? <EventBasicsSettingsForm event={event} canEdit={canEdit} /> : null}

      {event ? <SiteContentSettingsForm event={event} canEdit={canEdit} /> : null}

      {event ? <EventContactSettingsForm event={event} canEdit={canEdit} /> : null}

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
      return "Live: every public page can read it.";
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
