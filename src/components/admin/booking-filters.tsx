import Link from "next/link";

import {
  BOOKING_QUERY_MAX_LENGTH,
  CHECK_IN_STATUS_OPTIONS,
  BOOKING_STATUS_OPTIONS,
  DATE_FROM_LABEL,
  DATE_TO_LABEL,
  EXPORT_MAX_ROWS,
  PAYMENT_STATUS_OPTIONS,
  bookingsExportHref,
  exportScopeNote,
  isFiltered,
  type BookingQuery,
  type FilterOption,
} from "@/lib/admin/bookings";

/**
 * The filter bar above the booking list.
 *
 * A plain `GET` form and nothing else: no state, no effect, no JavaScript required.
 * That is a deliberate choice, not laziness — an operator can bookmark or share the
 * URL of any search (`?payment=paid&checkin=none`), the browser's back button walks
 * through searches, and the page works on the tablet at the gate where a form that
 * needs hydration might not have hydrated yet.
 *
 * The export is a link rather than a button, carrying the *applied* filters. A second
 * submit button inside a form would export whatever was typed but not yet applied,
 * which is exactly the kind of "which filters did this file use?" confusion an export
 * must not create.
 */

const fieldClass =
  "border-border bg-background/60 placeholder:text-muted/50 focus:border-marigold/60 focus:ring-marigold/20 h-10 w-full rounded-xl border px-3 text-sm transition-colors focus:ring-2 focus:outline-none";

const labelClass = "text-muted/80 text-[0.6875rem] font-semibold tracking-widest uppercase";

export function BookingFilters({
  query,
  passOptions,
  exportable,
  total,
  includeContact,
}: {
  query: BookingQuery;
  passOptions: readonly FilterOption[];
  /** False when there is nothing to export — a file of headers helps nobody. */
  exportable: boolean;
  /** How many bookings match the filters right now. */
  total: number;
  /** Whether the export would carry contact details and amounts. */
  includeContact: boolean;
}) {
  return (
    <form
      method="get"
      action="/admin/bookings"
      className="border-border bg-surface/50 flex flex-col gap-4 rounded-2xl border p-4 sm:p-5"
    >
      <div className="flex flex-col gap-2">
        <label htmlFor="booking-query" className={labelClass}>
          Search
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="booking-query"
            name="q"
            defaultValue={query.q}
            type="search"
            autoComplete="off"
            maxLength={BOOKING_QUERY_MAX_LENGTH}
            enterKeyHint="search"
            placeholder="DND202600001, Nisha Rao, 98123 45678, PS-000123, pay_… or order_…"
            className={fieldClass}
          />
          <button
            type="submit"
            className="bg-marigold text-marigold-foreground hover:bg-marigold-soft inline-flex h-10 shrink-0 items-center justify-center rounded-full px-6 text-sm font-semibold tracking-tight transition-colors sm:w-36"
          >
            Apply filters
          </button>
        </div>
        <p className="text-muted text-xs/5">
          One box for everything a guest can give you: the booking reference, their name, the number they booked
          with, a pass ID, or the Razorpay payment or order ID from their receipt.
        </p>
      </div>

      <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <legend className="sr-only">Filters</legend>

        <DateField id="booking-from" name="from" label={DATE_FROM_LABEL} value={query.dateFrom ?? ""} />
        <DateField id="booking-to" name="to" label={DATE_TO_LABEL} value={query.dateTo ?? ""} />
        <SelectField
          id="booking-pass"
          name="pass"
          label="Pass category"
          value={query.passCategoryId ?? ""}
          options={passOptions}
          anyLabel="Any pass"
        />
        <SelectField
          id="booking-payment"
          name="payment"
          label="Payment status"
          value={query.paymentStatus ?? ""}
          options={PAYMENT_STATUS_OPTIONS}
          anyLabel="Any payment status"
        />
        <SelectField
          id="booking-status"
          name="status"
          label="Booking status"
          value={query.bookingStatus ?? ""}
          options={BOOKING_STATUS_OPTIONS}
          anyLabel="Any booking status"
        />
        <SelectField
          id="booking-checkin"
          name="checkin"
          label="Check-in status"
          value={query.checkInStatus ?? ""}
          options={CHECK_IN_STATUS_OPTIONS}
          anyLabel="Any check-in status"
        />

        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-5">
          {isFiltered(query) ? (
            <Link
              href="/admin/bookings"
              className="border-border text-muted hover:text-foreground hover:border-marigold/50 focus-visible:ring-marigold/40 inline-flex h-10 items-center justify-center rounded-full border px-5 text-sm font-semibold tracking-tight transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              Clear filters
            </Link>
          ) : null}

          {exportable ? (
            /*
              A plain anchor, deliberately: this is a file download, not a page in the
              app. `next/link` would prefetch and client-navigate, and the point is to
              hand the browser a CSV to save.
            */
            <a
              href={bookingsExportHref(query)}
              title={exportScopeNote(includeContact, total)}
              className="border-border text-muted hover:text-foreground hover:border-marigold/50 focus-visible:ring-marigold/40 ml-auto inline-flex h-10 items-center justify-center rounded-full border px-5 text-sm font-semibold tracking-tight transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              Download CSV
              <span className="sr-only"> — {exportScopeNote(includeContact, total)}</span>
            </a>
          ) : null}
        </div>
      </fieldset>

      {exportable && total > EXPORT_MAX_ROWS ? (
        <p className="text-muted text-xs/5">
          This search matches {total.toLocaleString("en-IN")} bookings. A download holds the first{" "}
          {EXPORT_MAX_ROWS.toLocaleString("en-IN")} — narrow the filters if you need all of them.
        </p>
      ) : null}
    </form>
  );
}

/** One of the two ends of the night range. */
function DateField({ id, name, label, value }: { id: string; name: string; label: string; value: string }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <input id={id} name={name} type="date" defaultValue={value} className={fieldClass} />
    </div>
  );
}

/**
 * A filter with fixed values.
 *
 * The empty option is "no filter", and it is the default — a list that opens narrowed
 * would hide bookings from whoever did not notice the select was set.
 */
function SelectField({
  id,
  name,
  label,
  value,
  options,
  anyLabel,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  options: readonly FilterOption[];
  anyLabel: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <select id={id} name={name} defaultValue={value} className={`${fieldClass} appearance-none`}>
        <option value="">{anyLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
