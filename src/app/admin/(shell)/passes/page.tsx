import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";

import { FilterActions, DateField, SelectField, TextField } from "@/components/admin/filter-fields";
import { PassTable } from "@/components/admin/passes-table";
import { PassTypesPanel } from "@/components/admin/pass-types-panel";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import {
  BOOKING_QUERY_MAX_LENGTH,
  pageSummary,
  pageWindow,
  type SearchParamsInput,
} from "@/lib/admin/bookings";
import {
  PASS_CHECK_IN_OPTIONS,
  PASS_STATUS_OPTIONS,
  isPassFiltered,
  parsePassQuery,
  passesExportHref,
  operationsPageCount,
  passesHref,
} from "@/lib/admin/operations";
import { requirePermission } from "@/lib/auth/guard";
import { can } from "@/lib/auth/permissions";
import { formatInr, formatTimestamp } from "@/lib/format";
import { listPassTypes } from "@/lib/services/admin-catalogue";
import { getEventNights } from "@/lib/services/admin-events";
import { getPassesSnapshot } from "@/lib/services/admin-operations";

export const metadata: Metadata = {
  title: "Passes",
  description: "Every issued pass, where it is and whether it has been admitted.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type PassesPageProps = {
  searchParams: Promise<SearchParamsInput>;
};

/** One parameter as a string, whether it arrived once or several times. */
function firstValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

/**
 * Passes — two jobs on one route, because both are about the same noun.
 *
 * **Pass types** (`?view=types`) is the catalogue: what is on sale, at what price, for
 * how many people, with what age restriction — and the form that creates, edits or
 * retires one. It is the screen the organiser uses before the event, and the only
 * place a price is set.
 *
 * **Issued passes** is the door list: one pass per row, searchable by anything a guest
 * can quote, filterable by night and by whether it has been admitted. It is the
 * default view, because it is the one that gets looked at in a hurry.
 *
 * They are tabs rather than two routes because a pass type and the passes issued from
 * it are the same thing at different moments.
 *
 * The QR token is not on this page and cannot be asked for — `admin_pass_list` does
 * not select it, and the catalogue has no such column. A list of live credentials
 * sitting behind a shared tablet is exactly what the token is not for; a pass is
 * admitted by scanning it, not by reading it out.
 *
 * The night filter on the door list is a select of the event's own nights rather than
 * a date field, because "which night" is the only question anybody asks at a table,
 * and a night has an id, a label and a capacity — the dates are not the operator's
 * vocabulary, the nights are.
 *
 * Guarded by `passes:view`; the forms inside are only offered to a role holding
 * `passes:edit`, and the endpoint behind them checks that again for itself.
 */
export default async function PassesPage({ searchParams }: PassesPageProps) {
  const staff = await requirePermission("passes:view");
  const raw = await searchParams;
  const viewingTypes = firstValue(raw.view) === "types";
  const query = parsePassQuery(raw);

  // Only the view that was asked for is read. A tab that costs a query it does not
  // need is a tab an organiser pays for on a phone at a venue with poor signal.
  const [nights, catalogue] = await Promise.all([getEventNights(), listPassTypes()]);

  const canEdit = can(staff.role, "passes:edit");
  const passTypes = catalogue.ok ? catalogue.data : [];

  // ---- the catalogue -----------------------------------------------------------
  if (viewingTypes) {
    return (
      <>
        <PassHeading view="types" />

        <PassTabs view="types" passTypeCount={catalogue.ok ? passTypes.length : null} />

        {catalogue.ok ? (
          <PassTypesPanel passes={passTypes} canEdit={canEdit} />
        ) : (
          <ErrorState
            error={{
              kind: catalogue.error.kind === "not-configured" ? "not-configured" : "query-failed",
              message: catalogue.error.message,
            }}
            title="The pass catalogue is unavailable"
          />
        )}

        {canEdit ? null : (
          <p className="text-muted/80 text-xs/5">
            Your role can see what is on sale, but only an admin or a super admin can change a price, a limit or a
            composition.
          </p>
        )}
      </>
    );
  }

  const snapshot = await getPassesSnapshot(query, staff.role);

  if (!snapshot.ok) {
    return (
      <>
        <PassHeading view="issued" />
        <PassTabs view="issued" passTypeCount={catalogue.ok ? passTypes.length : null} />

        <ErrorState
          error={{
            kind: snapshot.error.kind === "not-configured" ? "not-configured" : "query-failed",
            message: snapshot.error.message,
          }}
          title="The pass list is unavailable"
        />
      </>
    );
  }

  // ---- the door list -----------------------------------------------------------
  const { summary, list, includeContact } = snapshot.data;
  const summaryLine = pageSummary(list.page, list.pageSize, list.total);
  const filtering = isPassFiltered(query);
  const pages = operationsPageCount(list.total);
  const nightOptions = nights.ok
    ? nights.data.map((night) => ({ value: night.id, label: night.label }))
    : [];

  return (
    <>
      <PassHeading view="issued" includeContact={includeContact} />

      <PassTabs view="issued" passTypeCount={catalogue.ok ? passTypes.length : null} />

      {summary ? (
        <section className="border-border bg-surface/50 flex flex-col gap-4 rounded-2xl border p-5">
          <h2 className="text-sm font-semibold tracking-tight">At a glance</h2>

          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Passes issued"
              value={String(summary.passes_issued)}
              hint={`Across ${summary.bookings_with_passes} ${summary.bookings_with_passes === 1 ? "booking" : "bookings"}`}
            />
            <Stat
              label="Admitted"
              value={String(summary.checked_in_total)}
              hint={`${summary.checked_in_today} tonight · ${summary.gates_used} ${summary.gates_used === 1 ? "gate" : "gates"} in use`}
              tone="positive"
            />
            <Stat
              label="Still to come"
              value={String(summary.passes_active)}
              hint="Active passes that have not been admitted"
              tone={summary.passes_active > 0 ? "attention" : "default"}
            />
            <Stat
              label="Not usable"
              value={String(summary.passes_cancelled + summary.passes_expired)}
              hint={`${summary.passes_cancelled} cancelled · ${summary.passes_expired} expired`}
            />
          </dl>

          <dl className="text-muted grid gap-x-6 gap-y-1.5 text-xs/5 sm:grid-cols-2 lg:grid-cols-3">
            {includeContact ? (
              <Fact
                label="Paid bookings holding passes"
                value={summary.passes_revenue === null ? "—" : formatInr(summary.passes_revenue)}
              />
            ) : (
              <Fact label="Paid bookings holding passes" value="Amounts are hidden for your role" />
            )}
            <Fact label="Used passes" value={String(summary.passes_used)} />
            <Fact
              label="Last entry"
              value={summary.last_check_in_at ? formatTimestamp(summary.last_check_in_at) : "Nobody yet"}
            />
          </dl>
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <form
          method="get"
          action="/admin/passes"
          className="border-border bg-surface/50 flex flex-col gap-4 rounded-2xl border p-4 sm:p-5"
        >
          <TextField
            id="pass-query"
            name="q"
            label="Search"
            value={query.q}
            maxLength={BOOKING_QUERY_MAX_LENGTH}
            placeholder="PS-000123, DND202600001, Nisha Rao, 98123 45678"
            hint="A pass ID, a booking reference, the guest's name, or the number they booked with — anything a guest can read out."
          />

          <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <legend className="sr-only">Filters</legend>

            <SelectField
              id="pass-night"
              name="night"
              label="Night"
              value={query.eventDateId ?? ""}
              options={nightOptions}
              anyLabel="Every night"
            />
            <SelectField
              id="pass-status"
              name="status"
              label="Pass status"
              value={query.status ?? ""}
              options={PASS_STATUS_OPTIONS}
              anyLabel="Any pass status"
            />
            <SelectField
              id="pass-checkin"
              name="checkin"
              label="Entry"
              value={query.checkIn ?? ""}
              options={PASS_CHECK_IN_OPTIONS}
              anyLabel="Admitted or not"
            />
            <DateField id="pass-from" name="from" label="Valid from" value={query.from ?? ""} />
            <DateField id="pass-to" name="to" label="Valid to" value={query.to ?? ""} />

            <div className="flex items-end sm:col-span-2 lg:col-span-4">
              <FilterActions
                clearHref="/admin/passes"
                cleared={filtering}
                exportHref={list.total > 0 ? passesExportHref(query) : undefined}
                exportLabel="Download door list"
                exportNote={
                  list.total > 0
                    ? `${list.total} ${list.total === 1 ? "pass" : "passes"} match these filters. The door list holds the same rows as this page's filters, up to 5,000 of them, as a CSV.`
                    : undefined
                }
              />
            </div>
          </fieldset>
        </form>

        {list.rows.length === 0 ? (
          filtering ? (
            <EmptyState
              title="No passes match these filters"
              description={
                <>
                  Nothing in the pass list matches the current search and filters.{" "}
                  <Link href={"/admin/passes" as Route} className="text-marigold-soft font-semibold hover:underline">
                    Clear them
                  </Link>{" "}
                  to see every pass.
                </>
              }
            />
          ) : list.total > 0 ? (
            <EmptyState
              title="That page is past the end of the list"
              description={
                <>
                  The list holds {list.total} {list.total === 1 ? "pass" : "passes"} over {pages}{" "}
                  {pages === 1 ? "page" : "pages"}, so this one is empty.{" "}
                  <Link href={"/admin/passes" as Route} className="text-marigold-soft font-semibold hover:underline">
                    Back to the first page
                  </Link>
                  .
                </>
              }
            />
          ) : (
            <EmptyState
              title="No passes issued yet"
              description="A pass is created the moment a payment is verified, so the first one will appear here as soon as the first guest pays."
            />
          )
        ) : (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-muted text-xs">{summaryLine ?? `${list.rows.length} passes`}</p>
              <p className="text-muted/80 text-[0.6875rem] font-semibold tracking-wider uppercase">
                Page {list.page} of {pages}
              </p>
            </div>

            <PassTable rows={list.rows} includeContact={includeContact} />

            {pages > 1 ? (
              <nav aria-label="Pass list pages" className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-muted text-xs">
                  Page {list.page} of {pages}
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {list.page > 1 ? (
                    <Link
                      href={passesHref(query, { page: list.page - 1 }) as Route}
                      rel="prev"
                      className="border-border text-muted hover:text-foreground hover:border-marigold/50 inline-flex h-9 items-center justify-center rounded-lg border px-3 text-sm font-semibold transition-colors"
                    >
                      Prev
                    </Link>
                  ) : null}
                  {pageWindow(list.page, pages).map((number) => (
                    <Link
                      key={number}
                      href={passesHref(query, { page: number }) as Route}
                      aria-current={number === list.page ? "page" : undefined}
                      className={
                        number === list.page
                          ? "border-marigold/50 bg-marigold/10 text-marigold-soft inline-flex h-9 min-w-9 items-center justify-center rounded-lg border px-2.5 text-sm font-semibold"
                          : "border-border text-muted hover:text-foreground hover:border-marigold/50 inline-flex h-9 min-w-9 items-center justify-center rounded-lg border px-2.5 text-sm font-semibold transition-colors"
                      }
                    >
                      {number}
                    </Link>
                  ))}
                  {list.page < pages ? (
                    <Link
                      href={passesHref(query, { page: list.page + 1 }) as Route}
                      rel="next"
                      className="border-border text-muted hover:text-foreground hover:border-marigold/50 inline-flex h-9 items-center justify-center rounded-lg border px-3 text-sm font-semibold transition-colors"
                    >
                      Next
                    </Link>
                  ) : null}
                </div>
              </nav>
            ) : null}
          </>
        )}

        <p className="text-muted/70 text-xs/5">
          The door list CSV holds the rows matching the filters above, in the same order as this list, up to 5,000 per
          download. Pass tokens are never included — a pass is admitted by scanning it, not by reading it out.
        </p>

        {!nights.ok ? (
          <p className="border-marigold/40 bg-marigold/5 text-marigold-soft rounded-2xl border px-4 py-3 text-xs/5">
            The event&apos;s nights could not be loaded, so the night filter is empty — the rest of the list is
            unaffected.
          </p>
        ) : null}
      </section>
    </>
  );
}

/**
 * The page's heading, which differs by view because the two screens answer different
 * questions — and because the sentence naming what a staff role cannot see only
 * applies to one of them.
 */
function PassHeading({ view, includeContact = true }: { view: "issued" | "types"; includeContact?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Passes</h1>
      <p className="text-muted text-sm/6">
        {view === "types"
          ? "What is on sale: the pass types, their prices, who each one admits and how many have been sold."
          : "Every pass issued for the event: which ticket is which, who it belongs to, and whether it has been admitted. Search by pass ID, booking reference, guest name or mobile number."}
        {view === "issued" && !includeContact ? " Contact details and amounts are hidden for your role." : ""}
      </p>
    </div>
  );
}

/** The two views as links, so either one is a URL that can be bookmarked or sent. */
function PassTabs({ view, passTypeCount }: { view: "issued" | "types"; passTypeCount: number | null }) {
  const active = "bg-marigold/15 text-marigold-soft border-marigold/40 inline-flex h-9 items-center rounded-full border px-4 text-sm font-semibold";
  const idle = "text-muted hover:text-foreground inline-flex h-9 items-center rounded-full px-4 text-sm font-semibold transition-colors";

  return (
    <div className="border-border bg-surface/40 inline-flex w-fit flex-wrap gap-1 rounded-full border p-1">
      <Link
        href={"/admin/passes" as Route}
        aria-current={view === "issued" ? "page" : undefined}
        className={view === "issued" ? active : idle}
      >
        Issued passes
      </Link>
      <Link
        href={"/admin/passes?view=types" as Route}
        aria-current={view === "types" ? "page" : undefined}
        className={view === "types" ? active : idle}
      >
        Pass types{passTypeCount === null ? "" : ` (${passTypeCount})`}
      </Link>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "default" | "positive" | "attention";
}) {
  const toneClass =
    tone === "positive"
      ? "border-peacock/40 bg-peacock/10"
      : tone === "attention"
        ? "border-marigold/35 bg-marigold/[0.07]"
        : "border-border bg-surface/50";

  return (
    <div className={`flex flex-col gap-1 rounded-2xl border p-4 ${toneClass}`}>
      <dt className="text-muted/80 text-[0.6875rem] font-semibold tracking-widest uppercase">{label}</dt>
      <dd className="flex flex-col gap-1">
        <span className="text-2xl font-bold tracking-tight tabular-nums">{value}</span>
        <span className="text-muted text-xs/5">{hint}</span>
      </dd>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted/70 text-[0.6875rem] font-semibold tracking-widest uppercase">{label}</dt>
      <dd className="text-foreground font-medium break-words">{value}</dd>
    </div>
  );
}
