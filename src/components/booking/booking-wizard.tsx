"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { BookingProgress, type BookingStepDefinition } from "@/components/booking/booking-progress";
import { StepDates } from "@/components/booking/step-dates";
import { StepDetails } from "@/components/booking/step-details";
import { StepPass } from "@/components/booking/step-pass";
import { StepSummary } from "@/components/booking/step-summary";
import { Button } from "@/components/ui/button";
import { createIdempotencyKey } from "@/lib/booking/idempotency";
import { loadRazorpayCheckout, openRazorpayCheckout } from "@/lib/payments/checkout";
import {
  parsePositiveInteger,
  validateMobile,
  validateName,
  validatePeople,
  validateQuantity,
} from "@/lib/booking/validation";
import type { EventNight, EventSummary, PassOption } from "@/types";
import type {
  BookingApiError,
  BookingApiResponse,
  BookingDetailsDraft,
  BookingFieldErrors,
  BookingRequestInput,
  BookingStep,
  CheckoutPaymentResult,
  PaymentOrderApiResponse,
  PaymentOrderView,
  PaymentPhase,
  PaymentStatusApiResponse,
  PaymentVerifyApiResponse,
} from "@/types/booking";

const STEPS: readonly BookingStepDefinition[] = [
  {
    id: 1,
    label: "Night",
    title: "Choose your night",
    description:
      "Availability is read live from the database. Nights that are fully booked, cancelled or finished cannot be selected.",
  },
  {
    id: 2,
    label: "Pass",
    title: "Choose your pass",
    description:
      "Prices come from the database. A pass admits a fixed group and the price is per pass, not per person.",
  },
  {
    id: 3,
    label: "Details",
    title: "Your details",
    description:
      "The lead guest's details are used for the entry register and the booking confirmation.",
  },
  {
    id: 4,
    label: "Review",
    title: "Review and confirm",
    description:
      "Check everything below. The amount is calculated on the server from the database price, then Razorpay Checkout opens for that amount.",
  },
];

type BookingWizardProps = {
  event: EventSummary;
  nights: EventNight[];
  passes: PassOption[];
  /** True when the server holds Razorpay keys, i.e. online payment can be started. */
  paymentsReady: boolean;
  /** `rzp_test_…` → "test", `rzp_live_…` → "live", nothing → null. Test mode is the default. */
  paymentMode: "test" | "live" | null;
};

const EMPTY_DETAILS: BookingDetailsDraft = {
  customerName: "",
  customerMobile: "",
  quantity: "1",
  numberOfPeople: "1",
};

const DETAIL_FIELDS: readonly (keyof BookingFieldErrors)[] = [
  "customerName",
  "customerMobile",
  "quantity",
  "numberOfPeople",
];

/**
 * Four-step checkout: night, pass, details, review — then payment.
 *
 * The browser validates for instant feedback and the server validates again on
 * every request it receives, including the price and the remaining capacity,
 * which only ever come from Postgres. The request carries identifiers and contact
 * details; it never carries an amount.
 *
 * Confirming creates a `pending`/`unpaid` booking and asks the server for a
 * Razorpay order for the amount the database fixed. Checkout opens with that order
 * id, and the payment is only ever accepted after `/api/payment/verify` has
 * checked the gateway signature server-side — the browser's word for it counts for
 * nothing. The customer then lands on /book/status, a server-rendered page that
 * reads the booking back from the database, so a refresh cannot lose the
 * confirmation.
 */
export function BookingWizard({ event, nights, passes, paymentsReady, paymentMode }: BookingWizardProps) {
  const firstBookable = nights.find((night) => night.isBookable)?.id ?? null;
  const onSale = passes.filter((pass) => pass.availability.enabled);
  const initialPass = onSale.length === 1 ? onSale[0] : null;

  const [step, setStep] = useState<BookingStep>(1);
  const [nightId, setNightId] = useState<string | null>(firstBookable);
  const [passId, setPassId] = useState<string | null>(initialPass?.id ?? null);
  const [details, setDetails] = useState<BookingDetailsDraft>(() => ({
    ...EMPTY_DETAILS,
    numberOfPeople: String(initialPass?.numberOfPeople ?? 1),
  }));
  const [peopleEdited, setPeopleEdited] = useState(false);
  const [errors, setErrors] = useState<BookingFieldErrors>({});
  const [phase, setPhase] = useState<PaymentPhase>("editing");
  const [apiError, setApiError] = useState<BookingApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** The order created for this attempt. Reused on retry so one booking keeps one order. */
  const [order, setOrder] = useState<PaymentOrderView | null>(null);

  const router = useRouter();
  const idempotencyKey = useRef<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const isFirstRender = useRef(true);

  // Move focus to the step heading so keyboard and screen-reader users land on
  // the new content instead of staying at the bottom of the previous step.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    headingRef.current?.focus();
  }, [step]);

  const night = nights.find((item) => item.id === nightId) ?? null;
  const pass = passes.find((item) => item.id === passId) ?? null;
  const quantity = parsePositiveInteger(details.quantity);
  const numberOfPeople = parsePositiveInteger(details.numberOfPeople);
  const estimate =
    pass && quantity !== null ? { subtotal: pass.priceInr * quantity, total: pass.priceInr * quantity } : null;
  const isBusy = phase !== "editing";

  function handleNightChange(nextNightId: string) {
    setNightId(nextNightId);
    setErrors((current) => ({ ...current, eventDateId: undefined }));
    setApiError(null);
    setNotice(null);
  }

  function handlePassChange(nextPassId: string) {
    const nextPass = passes.find((item) => item.id === nextPassId) ?? null;
    setPassId(nextPassId);
    setPeopleEdited(false);
    setErrors((current) => ({ ...current, passCategoryId: undefined, numberOfPeople: undefined }));
    setApiError(null);
    setNotice(null);
    // A pass admits a fixed group, so the head count follows the composition.
    setDetails((current) => ({
      ...current,
      numberOfPeople: String((parsePositiveInteger(current.quantity) ?? 1) * (nextPass?.numberOfPeople ?? 1)),
    }));
  }

  function handleDetailChange(field: keyof BookingDetailsDraft, value: string) {
    setApiError(null);
    setErrors((current) => ({ ...current, [field]: undefined }));

    if (field === "numberOfPeople") {
      setPeopleEdited(true);
      setDetails((current) => ({ ...current, numberOfPeople: value }));
      return;
    }

    if (field === "quantity") {
      setDetails((current) => ({
        ...current,
        quantity: value,
        numberOfPeople:
          peopleEdited || !pass
            ? current.numberOfPeople
            : String((parsePositiveInteger(value) ?? 1) * pass.numberOfPeople),
      }));
      return;
    }

    setDetails((current) => ({ ...current, [field]: value }));
  }

  /** Step 3's field validation — the same rules the API runs again. */
  function validateDetails(): BookingFieldErrors {
    const fieldErrors: BookingFieldErrors = {};
    const nameError = validateName(details.customerName);

    if (nameError) {
      fieldErrors.customerName = nameError;
    }

    const mobileError = validateMobile(details.customerMobile);

    if (mobileError) {
      fieldErrors.customerMobile = mobileError;
    }

    const quantityError = validateQuantity(details.quantity, pass?.maxPerBooking ?? 1);

    if (quantityError) {
      fieldErrors.quantity = quantityError;
    }

    const peopleError = validatePeople(details.numberOfPeople, quantity, pass?.numberOfPeople ?? 1);

    if (peopleError) {
      fieldErrors.numberOfPeople = peopleError;
    }

    return fieldErrors;
  }

  function goNext() {
    if (step === 1) {
      if (!night || !night.isBookable) {
        setErrors({ eventDateId: "Choose a night to continue." });
        return;
      }

      setErrors({});
      setStep(2);
      return;
    }

    if (step === 2) {
      if (!pass || !pass.availability.enabled) {
        setErrors({ passCategoryId: "Choose a pass to continue." });
        return;
      }

      setErrors({});
      setStep(3);
      return;
    }

    const fieldErrors = validateDetails();

    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }

    setErrors({});
    setStep(4);
  }

  function goBack() {
    setApiError(null);
    setStep((current) => (current > 1 ? ((current - 1) as BookingStep) : current));
  }

  /** The exact payload the server expects. No amount, ever. */
  function bookingPayload(): BookingRequestInput {
    if (!idempotencyKey.current) {
      idempotencyKey.current = createIdempotencyKey();
    }

    return {
      eventId: event.id,
      eventDateId: night?.id ?? "",
      passCategoryId: pass?.id ?? "",
      customerName: details.customerName.trim(),
      customerMobile: details.customerMobile.trim(),
      quantity: quantity ?? 0,
      numberOfPeople: numberOfPeople ?? 0,
      idempotencyKey: idempotencyKey.current,
    };
  }

  /** Applies a rejected request to the form: field errors jump back to step 3. */
  function applyApiError(error: BookingApiError) {
    setApiError(error);

    if (error.fieldErrors) {
      setErrors(error.fieldErrors);

      if (
        Object.keys(error.fieldErrors).some((field) => DETAIL_FIELDS.includes(field as keyof BookingFieldErrors))
      ) {
        setStep(3);
      }
    }
  }

  /**
   * The confirmation is a URL, not client state: navigating to it means a refresh
   * (or a later visit from the same link) shows the same server-rendered page.
   */
  /**
   * Where a customer goes once the payment is verified: the confirmation page,
   * which lists the issued passes and links each one to its QR code. It reads the
   * same database rows the status page does, so reloading it (or opening it on
   * another device) is idempotent — passes are issued by the database when the
   * payment is confirmed, never by a page being opened.
   */
  function goToSuccess(token: string) {
    // Typed routes want a literal; the token is the only variable part.
    router.push(`/booking/success?token=${encodeURIComponent(token)}` as Route);
  }

  /**
   * The live status page, used while a payment is still unverified (including the
   * no-gateway path, where the booking is simply held for the organiser).
   */
  function goToStatus(token: string) {
    router.push(`/book/status?token=${encodeURIComponent(token)}` as Route);
  }

  /**
   * Asks the server whether this booking is already confirmed. Used when the
   * browser cannot verify a payment itself: the webhook may have confirmed it, and
   * the customer must never be told to pay twice.
   */
  async function isAlreadyConfirmed(token: string): Promise<boolean> {
    try {
      const response = await fetch(`/api/payment/status?token=${encodeURIComponent(token)}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as PaymentStatusApiResponse;

      return payload.ok && payload.booking.status === "confirmed" && payload.booking.paymentStatus === "paid";
    } catch (error) {
      console.error("Booking status lookup failed", error);
      return false;
    }
  }

  /**
   * Deployment without Razorpay keys: fall back to the step-4 behaviour — a
   * pending booking the organiser takes over on WhatsApp. Never a fake payment.
   */
  async function confirmWithoutGateway() {
    setPhase("creating");

    try {
      const response = await fetch("/api/bookings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(bookingPayload()),
      });

      const payload = (await response.json()) as BookingApiResponse;

      if (payload.ok) {
        goToStatus(payload.booking.publicToken);
        return;
      }

      applyApiError(payload.error);
    } catch (error) {
      console.error("Booking request failed", error);
      setApiError({
        kind: "server-error",
        message: "We could not reach the booking server. Check your connection and try again.",
      });
    } finally {
      setPhase("editing");
    }
  }

  /** Creates (or reuses) the pending booking and its Razorpay order. */
  async function requestOrder(): Promise<PaymentOrderView | null> {
    try {
      const response = await fetch("/api/payment/create-order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(bookingPayload()),
      });

      const payload = (await response.json()) as PaymentOrderApiResponse;

      if (payload.ok) {
        return payload.order;
      }

      applyApiError(payload.error);
      return null;
    } catch (error) {
      console.error("Could not create the payment order", error);
      setApiError({
        kind: "server-error",
        message: "We could not start the payment. Check your connection and try again.",
      });
      return null;
    }
  }

  async function openCheckout(currentOrder: PaymentOrderView) {
    setPhase("paying");

    const loaded = await loadRazorpayCheckout();

    if (!loaded) {
      setPhase("editing");
      setNotice(
        "The Razorpay payment window could not be loaded, so no payment was started. Check your connection, or message the organiser to complete this booking.",
      );
      return;
    }

    const opened = openRazorpayCheckout(
      {
        key: currentOrder.keyId,
        amount: currentOrder.amountPaise,
        currency: currentOrder.currency,
        order_id: currentOrder.orderId,
        name: event.name,
        description: currentOrder.description,
        prefill: currentOrder.prefill,
        notes: { booking_reference: currentOrder.booking.reference },
        theme: { color: "#e8a33d" },
        retry: { enabled: true },
        modal: {
          confirm_close: true,
          ondismiss: () => {
            setPhase("editing");
            setNotice(
              `The payment window was closed before the payment completed, so nothing was charged. Your booking ${currentOrder.booking.reference} is still held — you can try again.`,
            );
          },
        },
        handler: (result) => {
          void finishPayment(currentOrder, result);
        },
      },
      (reason) => {
        setPhase("editing");
        setNotice(`${reason} Nothing has been charged — you can try the payment again.`);
      },
    );

    if (!opened) {
      setPhase("editing");
      setNotice("The Razorpay payment window could not be opened. Nothing has been charged.");
    }
  }

  /**
   * Sends the Checkout result to the server. Only the server can turn this into a
   * confirmed booking: it verifies the signature, re-reads the payment from
   * Razorpay, and then lets the database mark the booking paid.
   */
  async function finishPayment(currentOrder: PaymentOrderView, result: CheckoutPaymentResult) {
    setPhase("verifying");
    setNotice(null);

    try {
      const response = await fetch("/api/payment/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(result),
      });

      const payload = (await response.json()) as PaymentVerifyApiResponse;

      if (payload.ok) {
        goToSuccess(payload.payment.booking.publicToken);
        return;
      }

      if (await isAlreadyConfirmed(currentOrder.booking.publicToken)) {
        goToSuccess(currentOrder.booking.publicToken);
        return;
      }

      setPhase("editing");
      setNotice(`${payload.error.message} Nothing has been charged for this website booking.`);
    } catch (error) {
      console.error("Payment verification request failed", error);

      if (await isAlreadyConfirmed(currentOrder.booking.publicToken)) {
        goToSuccess(currentOrder.booking.publicToken);
        return;
      }

      setPhase("editing");
      setNotice(
        `We could not reach our server to confirm the payment, so booking ${currentOrder.booking.reference} is still pending. Check the booking status before paying again.`,
      );
    }
  }

  async function startPayment() {
    if (phase !== "editing" || !night || !pass) {
      return;
    }

    const fieldErrors = validateDetails();

    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      setStep(3);
      return;
    }

    setApiError(null);
    setNotice(null);

    if (!paymentsReady) {
      await confirmWithoutGateway();
      return;
    }

    setPhase("creating");

    // Reuse the order from an earlier attempt: a retry must not create a second
    // order, and therefore never a second booking.
    const currentOrder = order ?? (await requestOrder());

    if (!currentOrder) {
      setPhase("editing");
      return;
    }

    setOrder(currentOrder);
    await openCheckout(currentOrder);
  }

  const current = STEPS[step - 1];
  const canContinue =
    step === 1 ? night !== null && night.isBookable : step === 2 ? Boolean(pass?.availability.enabled) : true;

  return (
    <div className="flex flex-col gap-6">
      <BookingProgress steps={STEPS} current={step} />

      <div className="border-border bg-surface/40 flex flex-col gap-6 rounded-2xl border p-5 sm:p-7">
        <div className="flex flex-col gap-1.5">
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="text-xl font-semibold tracking-tight focus:outline-none"
          >
            {current.title}
          </h2>
          <p className="text-muted text-sm/6">{current.description}</p>
        </div>

        {step === 1 ? (
          <StepDates
            nights={nights}
            value={nightId}
            onChange={handleNightChange}
            error={errors.eventDateId}
            disabled={isBusy}
          />
        ) : null}

        {step === 2 ? (
          <StepPass
            passes={passes}
            value={passId}
            onChange={handlePassChange}
            error={errors.passCategoryId}
            disabled={isBusy}
          />
        ) : null}

        {step === 3 ? (
          <StepDetails
            pass={pass}
            details={details}
            onChange={handleDetailChange}
            errors={errors}
            estimate={estimate}
            currency={event.currency}
            disabled={isBusy}
          />
        ) : null}

        {step === 4 ? (
          <StepSummary
            event={event}
            night={night}
            pass={pass}
            details={details}
            estimate={estimate}
            currency={event.currency}
            phase={phase}
            paymentsReady={paymentsReady}
            paymentMode={paymentMode}
            error={apiError}
            notice={notice}
            onSubmit={startPayment}
            onEdit={setStep}
          />
        ) : null}

        <div className="border-border/70 flex flex-wrap items-center justify-between gap-3 border-t pt-5">
          <Button onClick={goBack} variant="secondary" size="sm" disabled={step === 1 || isBusy}>
            Back
          </Button>

          {step < 4 ? (
            <Button onClick={goNext} size="md" disabled={!canContinue}>
              Continue
            </Button>
          ) : (
            <p className="text-muted text-xs">
              {paymentsReady
                ? "Nothing is charged until you confirm and finish the payment window."
                : "Nothing is charged on this website. Confirming holds this booking for the organiser."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
