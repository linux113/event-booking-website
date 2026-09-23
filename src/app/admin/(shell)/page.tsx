import type { Metadata, Route } from "next";
import Link from "next/link";

import { siteConfig } from "@/config/site";
import { DailyBarChart } from "@/components/admin/bar-chart";
import { PassBreakdownChart } from "@/components/admin/pass-breakdown-chart";
import { RecentBookingsTable } from "@/components/admin/recent-bookings-table";
import { StatCard, StatGrid, type StatTone } from "@/components/admin/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { deniedMessage, requireStaff } from "@/lib/auth/guard";
import { can, ROLE_LABELS, sectionsFor } from "@/lib/auth/permissions";
import { formatEventDate, formatInr, formatTimestamp } from "@/lib/format";
import { getDashboardSnapshot, type DashboardStats } from "@/lib/services/admin";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Live bookings, revenue, gate activity and capacity for the event.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type AdminHomeProps = {
  searchParams: Promise<{ denied?: string | string[] }>;
};

/**
 * The dashboard.
 *
 * Every figure on this page is counted by Postgres, in the four functions in the
 * step-9 migration, and every one of them is requested with the *role's* capabilities
 * attached:
 *
 *   * `p_include_revenue` — false without `payments:view`, and the database then
 *     returns NULL for each money column rather than a number to hide;
 *   * `p_include_contact` — false for a contact-less query, so a limited session
 *     never receives a guest's mobile number or amount in the first place.
 *
 * That is why this page does not add anything up, filter anything out, or blank a
 * figure before rendering: a number that should not be seen never arrives. The role
 * does change the *layout* too — a staff member's dashboard is the operational half
 * of this one, because a door does not need a sales chart — but the difference is a
 * consequence of the data, not a substitute for guarding it.
 *
 * The page has three states and each one is honest about itself: real numbers from
 * the database, a named error when the read fails (with the shape of the error, not a
 * stack trace), or an empty state when the schema has not been applied yet. It never
 * falls back to placeholder figures.
 */
export default async function AdminHomePage({ searchParams }: AdminHomeProps) {
  const staff = await requireStaff();
  const params = await searchParams;
  const denied = Array.isArray(params.denied) ? params.denied[0] : params.denied;
  const message = deniedMessage(denied);

  const result = await getDashboardSnapshot();
  const dashboard = result.ok ? result.data : null;

  const sections = sectionsFor();
  const built = sections.filter((section) => section.built && section.href);
  const planned = sections.filter((section) => !section.built);

  const deniedBanner = message ? (
    <p role="alert" className="border-marigold/40 bg-marigold/10 text-marigold-soft rounded-2xl border px-4 py-3 text-sm/6">
      {message} Reload the page; if it continues, sign out and in again.
    </p>
  ) : null;

  const heading = (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
        {`${ROLE_LABELS[staff.role]} dashboard`}
      </h1>
      <p className="text-muted text-sm/6">
        Signed in as {staff.displayName}
        {dashboard ? (
          <>
            {" · "}
            tonight is {formatEventDate(dashboard.today)} at the venue
          </>
        ) : null}
        {dashboard && !dashboard.includeRevenue ? " · revenue figures are for admins" : null}
      </p>
    </div>
  );

  if (!result.ok) {
    return (
      <>
        {deniedBanner}
        {heading}
        <ErrorState
          error={result.error}
          title="The dashboard is unavailable"
          action={
            <p className="text-muted text-xs/5">
              The numbers come straight from the database. Nothing on this page has been estimated or cached.
            </p>
          }
        />
      </>
    );
  }

  if (!dashboard) {
    return (
      <>
        {deniedBanner}
        {heading}
        <EmptyState
          title="There is nothing to count yet"
          description="This dashboard reads its numbers from Postgres. Apply the schema (docs/neon-setup.md) and reload."
        />
      </>
    );
  }

  const { stats, series, breakdown, recent, includeRevenue, includeContact, timezone, windowDays } = dashboard;
  // The currency is the event's, read from the bookings themselves rather than assumed:
  // a dashboard in rupees against a booking in another currency would be a lie.
  const currency = recent[0]?.currency ?? siteConfig.currency;
  const money = (value: number | null) => (value === null ? null : formatInr(value, currency));
  const withheld = "Visible to admins";

  type DashboardCard = {
    label: string;
    value: string | null;
    hint: string;
    tone?: StatTone;
    withheldNote?: string;
  };

  // The eight statistics the dashboard is built around. Staff keep the operational
  // half: everything a door needs, nothing about money.
  const bookingCards: DashboardCard[] = [
    {
      label: "Total bookings",
      value: String(stats.bookings_total),
      hint: `${stats.bookings_confirmed} confirmed · ${stats.bookings_pending} awaiting payment`,
    },
    {
      label: "Confirmed bookings",
      value: String(stats.bookings_confirmed),
      hint: "Payment verified and passes issued",
      tone: "positive" as const,
    },
    {
      label: "Pending payments",
      value: String(stats.bookings_pending),
      hint: stats.bookings_pending > 0 ? "Checkout started, no verified payment yet" : "Nothing waiting on a payment",
      tone: stats.bookings_pending > 0 ? ("attention" as const) : ("default" as const),
    },
    {
      label: "Today's bookings",
      value: String(stats.bookings_today),
      hint: formatEventDate(stats.tonight_date ?? dashboard.today),
    },
  ];

  const moneyCards: DashboardCard[] = [
    {
      label: "Total revenue",
      value: money(stats.revenue_total),
      hint:
        stats.revenue_refunded !== null && stats.revenue_refunded > 0
          ? `${formatInr(stats.revenue_refunded, currency)} refunded — refunds stop counting`
          : "Paid bookings only, refunds excluded",
      withheldNote: withheld,
    },
    {
      label: "Today's revenue",
      value: money(stats.revenue_today),
      hint: `Taken on ${formatEventDate(dashboard.today)}`,
      withheldNote: withheld,
    },
  ];

  const operationalCards: DashboardCard[] = [
    {
      label: "Checked-in visitors",
      value: String(stats.check_ins_total),
      hint: `${stats.check_ins_today} tonight · ${stats.people_paid} people on paid bookings`,
    },
    {
      label: "Available capacity",
      value: String(stats.capacity_available),
      hint:
        stats.nights_upcoming > 0
          ? `${stats.capacity_taken} of ${stats.capacity_total} places taken across ${stats.nights_upcoming} nights still to come`
          : "No nights still to come on the calendar",
      tone:
        stats.capacity_total > 0 && stats.capacity_available === 0 ? ("attention" as const) : ("default" as const),
    },
  ];

  const cards: DashboardCard[] = [...bookingCards, ...moneyCards, ...operationalCards];
  const windowLabel = `The last ${windowDays} days, ending ${formatEventDate(dashboard.today)} — the venue's own days in ${timezone}.`;

  return (
    <>
      {deniedBanner}
      {heading}

      <StatGrid>
        {cards.map((card) => (
          <StatCard
            key={card.label}
            label={card.label}
            value={card.value}
            hint={card.hint}
            tone={card.tone}
            withheldNote={card.withheldNote}
          />
        ))}
      </StatGrid>

      <div className="grid gap-3 lg:grid-cols-2">
        <DailyBarChart
          id="bookings-by-date"
          title="Bookings by date"
          description="Bookings placed each day, with the part of them already confirmed."
          points={series.map((point) => ({
            day: point.day,
            value: point.bookings ?? 0,
            secondary: point.confirmed ?? 0,
          }))}
          formatValue={(value) => String(value)}
          primaryLabel="Bookings"
          secondaryLabel="Confirmed"
          tone="rani"
          footer={windowLabel}
        />

        <DailyBarChart
          id="revenue-by-date"
          title="Revenue by date"
          description="Money taken each day, counted when the payment was verified."
          points={series.map((point) => ({ day: point.day, value: point.revenue ?? 0 }))}
          formatValue={(value) => formatInr(value, currency)}
          primaryLabel="Revenue"
          tone="marigold"
          withheldNote={
            includeRevenue
              ? undefined
              : "Revenue is counted per day in the database and only returned to roles with access to payments."
          }
          footer={windowLabel}
        />

        <PassBreakdownChart
          items={breakdown.map((row) => ({
            id: row.pass_category_id,
            name: row.pass_name,
            composition: row.pass_composition,
            price: row.price_inr,
            isActive: row.is_active,
            bookings: row.bookings,
            paidBookings: row.paid_bookings,
            passesIssued: row.passes_issued,
            people: row.people,
            revenue: row.revenue,
            currency,
          }))}
          includeRevenue={includeRevenue}
          description="Every pass category, biggest first, with the share of bookings each one holds."
          withheldNote={withheld.toLowerCase()}
        />

        <TonightPanel stats={stats} today={dashboard.today} />
      </div>

      <RecentBookingsTable rows={recent} includeContact={includeContact} currency={currency} limit={recent.length || 8} />

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
            These sections are planned; every built section above is available to the administrator.
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

      {can(staff.role, "payments:view") ? (
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
                <Fact label="Active staff accounts" value={stats.staff_active ?? 0} />
                <Fact label="Staff accounts in total" value={stats.staff_total ?? 0} />
              </>
            ) : null}
          </dl>
          <p className="text-muted/80 text-xs/5">
            One administrator account; no separate staff accounts.
          </p>
        </section>
      ) : null}

      <p className="text-muted/70 text-xs/5">
        Counted in the database at {formatTimestamp(new Date().toISOString())} — every figure above is a live query,
        not a cached summary.
      </p>
    </>
  );
}

/**
 * Tonight, at a glance.
 *
 * The one panel that answers the question somebody actually asks on the night: is
 * there a night tonight, how full is it, and has the door started? A night that is not
 * in the calendar says so, rather than showing an empty capacity bar as if the venue
 * were empty.
 */
function TonightPanel({ stats, today }: { stats: DashboardStats; today: string }) {
  const hasNight = stats.tonight_date !== null;

  return (
    <section className="border-border bg-surface/50 flex flex-col gap-4 rounded-2xl border p-4 sm:p-5">
      <header className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold tracking-tight">Tonight</h3>
        <p className="text-muted text-xs/5">{formatEventDate(today)} — the night the gate is working.</p>
      </header>

      {hasNight ? (
        <div className="flex flex-col gap-2">
          <div className="border-border/50 bg-background/40 h-3 w-full overflow-hidden rounded-full border">
            <span
              aria-hidden="true"
              style={{
                width: `${stats.tonight_capacity > 0 ? Math.min(100, (stats.tonight_taken / stats.tonight_capacity) * 100) : 0}%`,
              }}
              className="from-marigold to-rani block h-full rounded-full bg-gradient-to-r"
            />
          </div>
          <p className="text-muted text-xs">
            {stats.tonight_taken} of {stats.tonight_capacity} places taken ·{" "}
            <span className="text-foreground font-semibold">{stats.tonight_available} left</span>
          </p>
        </div>
      ) : (
        <p className="text-muted border-border/70 bg-background/40 rounded-xl border px-4 py-6 text-sm/6">
          No event night is scheduled for tonight.{" "}
          {stats.nights_upcoming > 0
            ? `${stats.nights_upcoming} ${stats.nights_upcoming === 1 ? "night is" : "nights are"} still to come on the calendar.`
            : "The calendar has no upcoming nights left."}
        </p>
      )}

      {/* The gate numbers stay on the panel whether or not there is a night in the
          calendar: at a door, "how many have been through" is worth knowing even on a
          dark evening, and a staff member should not lose them to a scheduling gap. */}
      <dl className="text-muted grid gap-2 text-xs/5 sm:grid-cols-2">
        <Fact label="Checked in tonight" value={stats.check_ins_today} />
        <Fact label="Passes not yet used" value={stats.passes_active} />
        <Fact label="Passes issued in total" value={stats.passes_issued} />
        <Fact label="Passes through the gate" value={stats.passes_used} />
      </dl>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="border-border/50 flex items-baseline justify-between gap-3 border-b py-1 last:border-b-0">
      <dt>{label}</dt>
      <dd className="text-foreground font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
