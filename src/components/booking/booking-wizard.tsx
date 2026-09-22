"use client";

import { useEffect, useRef, useState } from "react";

import { BookingProgress, type BookingStepDefinition } from "@/components/booking/booking-progress";
import { BookingSuccess } from "@/components/booking/booking-success";
import { StepDates } from "@/components/booking/step-dates";
import { StepDetails } from "@/components/booking/step-details";
import { StepPass } from "@/components/booking/step-pass";
import { StepSummary } from "@/components/booking/step-summary";
import { Button } from "@/components/ui/button";
import { createIdempotencyKey } from "@/lib/booking/idempotency";
import {
  parsePositiveInteger,
  validateEmail,
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
  BookingStep,
  CreatedBooking,
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
      "Check everything below. The price is recalculated on the server from the database, then the booking is created.",
  },
];

type BookingWizardProps = {
  event: EventSummary;
  nights: EventNight[];
  passes: PassOption[];
};

const EMPTY_DETAILS: BookingDetailsDraft = {
  customerName: "",
  customerMobile: "",
  customerEmail: "",
  quantity: "1",
  numberOfPeople: "1",
};

const DETAIL_FIELDS: readonly (keyof BookingFieldErrors)[] = [
  "customerName",
  "customerMobile",
  "customerEmail",
  "quantity",
  "numberOfPeople",
];

/**
 * Four-step checkout: night, pass, details, review.
 *
 * The browser validates for instant feedback, and the server validates the same
 * rules again on the payload it receives — including the price, the pass limits
 * and the remaining capacity, which are only ever decided in Postgres. The
 * request carries identifiers and contact details; it never carries an amount.
 *
 * A booking is created `pending` / `unpaid`. Payment is not implemented yet, so
 * nothing here claims a booking is paid.
 */
export function BookingWizard({ event, nights, passes }: BookingWizardProps) {
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
  const [status, setStatus] = useState<"editing" | "submitting">("editing");
  const [apiError, setApiError] = useState<BookingApiError | null>(null);
  const [booking, setBooking] = useState<CreatedBooking | null>(null);

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

  function handleNightChange(nextNightId: string) {
    setNightId(nextNightId);
    setErrors((current) => ({ ...current, eventDateId: undefined }));
    setApiError(null);
  }

  function handlePassChange(nextPassId: string) {
    const nextPass = passes.find((item) => item.id === nextPassId) ?? null;
    setPassId(nextPassId);
    setPeopleEdited(false);
    setErrors((current) => ({ ...current, passCategoryId: undefined, numberOfPeople: undefined }));
    setApiError(null);
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

    const emailError = validateEmail(details.customerEmail);

    if (emailError) {
      fieldErrors.customerEmail = emailError;
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

  async function submit() {
    if (status === "submitting" || !night || !pass) {
      return;
    }

    const fieldErrors = validateDetails();

    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      setStep(3);
      return;
    }

    if (!idempotencyKey.current) {
      idempotencyKey.current = createIdempotencyKey();
    }

    setStatus("submitting");
    setApiError(null);

    try {
      const response = await fetch("/api/bookings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          eventId: event.id,
          eventDateId: night.id,
          passCategoryId: pass.id,
          customerName: details.customerName.trim(),
          customerMobile: details.customerMobile.trim(),
          customerEmail: details.customerEmail.trim(),
          quantity,
          numberOfPeople,
          idempotencyKey: idempotencyKey.current,
        }),
      });

      const payload = (await response.json()) as BookingApiResponse;

      if (payload.ok) {
        setBooking(payload.booking);
        return;
      }

      setApiError(payload.error);

      if (payload.error.fieldErrors) {
        setErrors(payload.error.fieldErrors);

        if (Object.keys(payload.error.fieldErrors).some((field) => DETAIL_FIELDS.includes(field as keyof BookingFieldErrors))) {
          setStep(3);
        }
      }
    } catch (error) {
      console.error("Booking request failed", error);
      setApiError({
        kind: "server-error",
        message: "We could not reach the booking server. Check your connection and try again.",
      });
    } finally {
      setStatus("editing");
    }
  }

  function startOver() {
    idempotencyKey.current = null;
    setBooking(null);
    setStep(1);
    setPassId(initialPass?.id ?? null);
    setDetails({ ...EMPTY_DETAILS, numberOfPeople: String(initialPass?.numberOfPeople ?? 1) });
    setPeopleEdited(false);
    setErrors({});
    setApiError(null);
  }

  if (booking) {
    return <BookingSuccess booking={booking} event={event} onStartOver={startOver} />;
  }

  const current = STEPS[step - 1];
  const canContinue = step === 1 ? night !== null && night.isBookable : step === 2 ? Boolean(pass?.availability.enabled) : true;

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
            disabled={status === "submitting"}
          />
        ) : null}

        {step === 2 ? (
          <StepPass
            passes={passes}
            value={passId}
            onChange={handlePassChange}
            error={errors.passCategoryId}
            disabled={status === "submitting"}
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
            disabled={status === "submitting"}
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
            status={status}
            error={apiError}
            onSubmit={submit}
            onEdit={setStep}
          />
        ) : null}

        <div className="border-border/70 flex flex-wrap items-center justify-between gap-3 border-t pt-5">
          <Button onClick={goBack} variant="secondary" size="sm" disabled={step === 1 || status === "submitting"}>
            Back
          </Button>

          {step < 4 ? (
            <Button onClick={goNext} size="md" disabled={!canContinue}>
              Continue
            </Button>
          ) : (
            <p className="text-muted text-xs">
              Nothing is created until you confirm the booking on this step.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
