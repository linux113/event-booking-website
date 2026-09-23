import { DateField, FilterActions, FILTER_LABEL_CLASS, FILTER_FIELD_CLASS, SelectField, TextField } from "@/components/admin/filter-fields";
import { BOOKING_QUERY_MAX_LENGTH } from "@/lib/admin/bookings";
import {
  PAYMENT_EVENT_TYPES,
  PAYMENT_OUTCOMES,
  isPaymentFiltered,
  type PaymentQuery,
} from "@/lib/admin/operations";

/**
 * The filter bar above the delivery log.
 *
 * A plain `GET` form, like every other list in the admin area: the filters live in the
 * URL, so a search for "everything Razorpay marked ignored last night" is a link an
 * operator can send to whoever asks about it tomorrow.
 *
 * Event types are offered as a select *and* accepted as free text, because the list is
 * a shortcut rather than a closed set: the gateway can start sending a type this build
 * has never heard of, and the screen must still be able to show it.
 */
export function PaymentFilters({ query, total }: { query: PaymentQuery; total: number }) {
  return (
    <form
      method="get"
      action="/admin/payments"
      className="border-border bg-surface/50 flex flex-col gap-4 rounded-2xl border p-4 sm:p-5"
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <TextField
          id="payment-query"
          name="q"
          label="Search"
          value={query.q}
          maxLength={BOOKING_QUERY_MAX_LENGTH}
          placeholder="order_…, pay_…, evt_…, DND202600001, Nisha Rao"
          hint="A Razorpay order or payment id, an event id, or anything about the booking the delivery belongs to."
        />

        <div className="flex flex-col gap-2">
          <label htmlFor="payment-event" className={FILTER_LABEL_CLASS}>
            Event type
          </label>
          <input
            id="payment-event"
            name="event"
            type="text"
            list="payment-event-types"
            defaultValue={query.eventType ?? ""}
            placeholder="payment.captured"
            autoComplete="off"
            className={FILTER_FIELD_CLASS}
          />
          <datalist id="payment-event-types">
            {PAYMENT_EVENT_TYPES.map((option) => (
              <option key={option.value} value={option.value} />
            ))}
          </datalist>
          <p className="text-muted text-xs/5">
            Free text on purpose: the gateway may send a type this build has never seen, and the log has to be able to
            show it.
          </p>
        </div>
      </div>

      <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <legend className="sr-only">Filters</legend>

        <SelectField
          id="payment-outcome"
          name="outcome"
          label="Outcome"
          value={query.outcome ?? ""}
          options={PAYMENT_OUTCOMES}
          anyLabel="Any outcome"
        />
        <DateField id="payment-from" name="from" label="Delivered from" value={query.from ?? ""} />
        <DateField id="payment-to" name="to" label="Delivered to" value={query.to ?? ""} />
      </fieldset>

      <FilterActions
        clearHref="/admin/payments"
        cleared={isPaymentFiltered(query)}
        exportNote={
          total > 0
            ? `${total} ${total === 1 ? "delivery" : "deliveries"} match these filters. The log is read on screen; a reconciliation file is not offered because the amount the gateway reported is already on every row here.`
            : undefined
        }
      />
    </form>
  );
}
