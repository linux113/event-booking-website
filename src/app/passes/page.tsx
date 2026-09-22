import type { Metadata } from "next";

import { PassCard } from "@/components/events/pass-card";
import { NightList } from "@/components/events/night-list";
import { CheckIcon } from "@/components/icons";
import { PageHero } from "@/components/layout/page-hero";
import { CtaBand } from "@/components/sections/cta-band";
import { Button } from "@/components/ui/button";
import { Container, Section } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { SectionHeading } from "@/components/ui/section-heading";
import { formatDateRange, formatInr } from "@/lib/format";
import { getFeaturedEventBundle } from "@/lib/services/events";

export const metadata: Metadata = {
  title: "Passes",
  description:
    "Compare Navratri and Dandiya entry passes — duo, couple, trio, squad and family passes, with live availability for every night.",
};

// Availability changes as bookings come in, so this page is rendered per request.
export const dynamic = "force-dynamic";

const EVERY_PASS_INCLUDES = [
  "Entry for the night shown on your booking",
  "Access to the dance floor and the family zone",
  "Live dhol, garba raas and DJ sets",
  "A QR entry pass you show at the gate",
] as const;

export default async function PassesPage() {
  const result = await getFeaturedEventBundle();

  if (!result.ok) {
    return (
      <Section>
        <Container>
          <ErrorState error={result.error} title="Passes are unavailable" />
        </Container>
      </Section>
    );
  }

  const bundle = result.data;

  if (!bundle) {
    return (
      <Section>
        <Container>
          <EmptyState
            title="No event published yet"
            description="Passes belong to an event. As soon as an event is published in the database, its passes appear here."
            action={
              <Button href="/" variant="secondary" size="sm">
                Back to home
              </Button>
            }
          />
        </Container>
      </Section>
    );
  }

  const { event, passes, nights } = bundle;
  const bookable = passes.filter((pass) => pass.availability.enabled);
  const lowestPrice = bookable.length ? Math.min(...bookable.map((pass) => pass.priceInr)) : null;
  const openNights = nights.filter((night) => night.isBookable);

  return (
    <>
      <PageHero
        eyebrow="Passes"
        title="Entry passes for every group"
        description={`${passes.length} pass types for ${event.name}${lowestPrice !== null ? `, from ${formatInr(lowestPrice, event.currency)}` : ""}. Each pass admits the group described on the card — prices are per pass, not per person.`}
      >
        <div className="flex flex-wrap gap-2">
          <span className="border-border bg-surface/60 text-muted rounded-full border px-3.5 py-1.5 text-xs font-semibold">
            {formatDateRange(nights.map((night) => night.date)) || "Dates to be announced"}
          </span>
          <span className="border-border bg-surface/60 text-muted rounded-full border px-3.5 py-1.5 text-xs font-semibold">
            {event.venueName}, {event.city}
          </span>
          <span className="border-border bg-surface/60 text-muted rounded-full border px-3.5 py-1.5 text-xs font-semibold">
            {openNights.length} of {nights.length} nights bookable
          </span>
        </div>
      </PageHero>

      <Section className="pt-0">
        <Container className="flex flex-col gap-8">
          {passes.length > 0 ? (
            <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {passes.map((pass) => (
                <li key={pass.id} className="h-full">
                  <PassCard pass={pass} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="No passes on sale"
              description="This event has no pass categories yet. Passes appear here as soon as the organiser publishes them."
            />
          )}

          <div className="flex flex-wrap items-center gap-3">
            <p className="text-muted/80 text-xs">
              Prices and availability are read live from the database.
            </p>
          </div>
        </Container>
      </Section>

      {nights.length > 0 ? (
        <Section className="pt-0">
          <Container className="flex flex-col gap-8">
            <SectionHeading
              eyebrow="Nights"
              title="Availability by night"
              description="Capacity is tracked per night. Nights marked fully booked cannot take more passes."
            />
            <NightList nights={nights} />
          </Container>
        </Section>
      ) : null}

      <Section className="pt-0">
        <Container className="grid gap-6 lg:grid-cols-2">
          <div className="border-border bg-surface/50 flex flex-col gap-4 rounded-2xl border p-6">
            <SectionHeading headingLevel="h2" title="What every pass includes" className="gap-2" />
            <ul className="flex flex-col gap-2.5">
              {EVERY_PASS_INCLUDES.map((item) => (
                <li key={item} className="text-muted flex items-start gap-2.5 text-sm/6">
                  <CheckIcon className="text-peacock mt-0.5 size-4 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="border-border bg-surface/50 flex flex-col gap-4 rounded-2xl border p-6">
            <SectionHeading headingLevel="h2" title="Good to know" className="gap-2" />
            <ul className="flex flex-col gap-2.5 text-sm/6">
              <li className="text-muted">
                <span aria-hidden="true" className="text-marigold mr-2">
                  •
                </span>
                Prices are per pass, not per person.
              </li>
              <li className="text-muted">
                <span aria-hidden="true" className="text-marigold mr-2">
                  •
                </span>
                A pass is valid for the night selected at checkout.
              </li>
              <li className="text-muted">
                <span aria-hidden="true" className="text-marigold mr-2">
                  •
                </span>
                Each pass admits the number of people printed on its category.
              </li>
              <li className="text-muted">
                <span aria-hidden="true" className="text-marigold mr-2">
                  •
                </span>
                Bookings close for a night once its capacity is reached.
              </li>
            </ul>
            <p className="text-muted/80 border-border/70 mt-1 border-t pt-4 text-xs">
              Food and beverage stalls are paid separately at the venue. Entry is subject to the
              organiser&apos;s verification at the gate.
            </p>
          </div>
        </Container>
      </Section>

      <CtaBand
        title="Which pass should you pick?"
        description="Not sure whether your group fits a couple pass or a squad pass? Message the organiser on WhatsApp before you pay."
      />
    </>
  );
}
