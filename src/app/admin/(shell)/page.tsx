import type { Metadata, Route } from "next";
import Link from "next/link";

import { getDashboardStats } from "@/lib/services/admin";
import { deniedMessage, requireStaff } from "@/lib/auth/guard";
import { can, ROLE_LABELS, sectionsFor } from "@/lib/auth/permissions";
import { formatEventDate, formatTimestamp } from "@/lib/format";
import { gateNight } from "@/lib/gate/night";

export const metadata: Metadata = {
  title: "Staff area",
  description: "The staff area: gate scanner, booking lookup and event operations.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type AdminHomeProps = {
  searchParams: Promise<{ denied?: string | string[] }>;
};

/**
 * The way in, and the map of the admin area.
 *
 * Two jobs: tell a staff member what is happening *tonight* (the number that changes
 * during an event), and show exactly which sections their role may open. The numbers
 * come from `admin_dashboard_stats()`, counted in the database — the dashboard never
 * pulls bookings into Node to add them up.
 *
 * A `?denied=` parameter is how a refused page sends somebody here, with the reason
 * spelled out. It is not a security event (nothing was disclosed), so it is a plain
 * explanation rather than an error.
 */
export default async function AdminHomePage({ searchParams }: AdminHomeProps) {
  const staff = await requireStaff();
  const params = await searchParams;
  const denied = Array.isArray(params.denied) ? params.denied[0] : params.denied;
  const message = deniedMessage(denied);

  const today = gateNight();
  const statsResult = await getDashboardStats(today);
  const stats = statsResult.ok ? statsResult.data : null;

  const sections = sectionsFor(staff.role);
  const built = sections.filter((section) => section.built && section.href);
  const planned = sections.filter((section) => !section.built);

  // What is on screen depends on the role, and it is decided here rather than by
  // hiding elements with CSS. A staff member's page carries the two numbers a person
  // at a door needs; sales figures, gallery state and how many colleagues there are
  // belong to the roles that manage them.
  const showOperations = can(staff.role, "payments:view");

  const tonight = showOperations
    ? [
        { label: "Checked in tonight", value: stats?.check_ins_today, hint: formatEventDate(today) },
        { label: "Passes not yet used", value: stats?.passes_active, hint: "Issued, valid, still to come" },
        {
          label: "Paid bookings",
          value: stats?.bookings_paid,
          hint: `${stats?.people_admitted ?? 0} people admitted`,
        },
        { label: "Nights still open", value: stats?.nights_upcoming, hint: "Scheduled, today or later" },
      ]
    : [
        { label: "Checked in tonight", value: stats?.check_ins_today, hint: formatEventDate(today) },
        { label: "Passes not yet used", value: stats?.passes_active, hint: "Still to come through the gate" },
      ];

  return (
    <>
      {message ? (
        <p
          role="alert"
          className="border-marigold/40 bg-marigold/10 text-marigold-soft rounded-2xl border px-4 py-3 text-sm/6"
        >
          {message} Ask a super admin if you need access.
        </p>
      ) : null}

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {staff.role === "staff" ? "Your shift" : `${ROLE_LABELS[staff.role]} overview`}
        </h1>
        <p className="text-muted text-sm/6">
          Signed in as {staff.displayName}
          {staff.lastLoginAt ? ` · last signed in ${formatTimestamp(staff.lastLoginAt)}` : null}
        </p>
      </div>

      {statsResult.ok === false && statsResult.error.kind === "not-configured" ? (
        <p className="border-border bg-surface/50 text-muted rounded-2xl border px-4 py-3 text-sm/6">
          {statsResult.error.message}
        </p>
      ) : (
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {tonight.map((item) => (
            <div key={item.label} className="border-border bg-surface/50 flex flex-col gap-1 rounded-2xl border p-4">
              <dt className="text-muted/80 text-[0.6875rem] font-semibold tracking-widest uppercase">{item.label}</dt>
              <dd className="text-2xl font-bold tracking-tight">
                {item.value ?? "—"}
              </dd>
              <p className="text-muted text-xs">{item.hint}</p>
            </div>
          ))}
        </dl>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold tracking-tight">What you can open</h2>

        <ul className="grid gap-3 sm:grid-cols-2">
          {built.map((section) => (
            <li key={section.key}>
              <Link
                href={section.href as Route}
                className="border-border bg-surface/50 hover:border-marigold/40 hover:bg-surface-raised/60 flex h-full flex-col gap-1.5 rounded-2xl border p-4 transition-colors"
              >
                <span className="font-semibold tracking-tight">{section.label}</span>
                <span className="text-muted text-xs/5">{section.description}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {planned.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold tracking-tight">Arriving in the next step</h2>
          <p className="text-muted text-xs/5">
            These sections are part of the admin area&apos;s permission model already — your role&apos;s access to them
            is decided by the same check that guards everything above — but the screens themselves are built next.
          </p>

          <ul className="grid gap-3 sm:grid-cols-2">
            {planned.map((section) => (
              <li
                key={section.key}
                className="border-border/60 bg-surface/30 flex h-full flex-col gap-1.5 rounded-2xl border border-dashed p-4"
              >
                <span className="text-muted font-semibold tracking-tight">{section.label}</span>
                <span className="text-muted/80 text-xs/5">{section.description}</span>
                <span className="text-marigold-soft mt-1 text-[0.6875rem] font-semibold tracking-widest uppercase">
                  Not built yet
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {stats && showOperations ? (
        <section className="border-border bg-surface/40 flex flex-col gap-2 rounded-2xl border p-4">
          <h2 className="text-sm font-semibold tracking-tight">Behind the scenes</h2>
          <dl className="text-muted grid gap-x-6 gap-y-1.5 text-xs/5 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label="Bookings, all time" value={stats.bookings_total} />
            <Fact label="Awaiting payment" value={stats.bookings_pending} />
            <Fact label="Refunded" value={stats.bookings_refunded} />
            <Fact label="Passes issued" value={stats.passes_issued} />
            <Fact label="Passes used" value={stats.passes_used} />
            <Fact label="Nights in the calendar" value={stats.nights_total} />
            {can(staff.role, "gallery:view") ? (
              <Fact
                label="Gallery published / draft"
                value={`${stats.gallery_published} / ${stats.gallery_draft}`}
              />
            ) : null}
            {can(staff.role, "staff:manage") ? (
              <>
                <Fact label="Active staff accounts" value={stats.staff_active} />
                <Fact label="Staff accounts in total" value={stats.staff_total} />
              </>
            ) : null}
          </dl>
          {!can(staff.role, "staff:manage") ? (
            <p className="text-muted/80 text-xs/5">
              Staff numbers are on the staff accounts page, which a super admin keeps.
            </p>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

function Fact({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-border/50 border-b py-1 last:border-b-0">
      <dt>{label}</dt>
      <dd className="text-foreground font-semibold">{value}</dd>
    </div>
  );
}
