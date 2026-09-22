import type { Metadata } from "next";

import { PassCard } from "@/components/events/pass-card";
import { CheckIcon } from "@/components/icons";
import { PageHero } from "@/components/layout/page-hero";
import { CtaBand } from "@/components/sections/cta-band";
import { Container, Section } from "@/components/ui/container";
import { DemoBadge } from "@/components/ui/demo-badge";
import { SectionHeading } from "@/components/ui/section-heading";
import { demoEvent } from "@/config/event";
import { demoPasses, passPolicies } from "@/config/passes";
import { formatInr } from "@/lib/format";

export const metadata: Metadata = {
  title: "Passes",
  description:
    "Compare Navratri and Dandiya entry passes — duo, couple, trio, squad and family passes, with what each one includes.",
};

export default function PassesPage() {
  const lowestPrice = Math.min(...demoPasses.map((pass) => pass.priceInr));

  return (
    <>
      <PageHero
        eyebrow="Passes"
        title="Entry passes for every group"
        description={`Five pass types for ${demoEvent.name}, from ${formatInr(lowestPrice)}. Each pass admits the group described on the card — prices are per pass, not per person.`}
      >
        <div className="flex flex-wrap gap-2">
          <span className="border-border bg-surface/60 text-muted rounded-full border px-3.5 py-1.5 text-xs font-semibold">
            {demoEvent.dates}
          </span>
          <span className="border-border bg-surface/60 text-muted rounded-full border px-3.5 py-1.5 text-xs font-semibold">
            {demoEvent.venue}, {demoEvent.location}
          </span>
          <span className="border-border bg-surface/60 text-muted rounded-full border px-3.5 py-1.5 text-xs font-semibold">
            {demoEvent.time}
          </span>
        </div>
      </PageHero>

      <Section className="pt-0">
        <Container className="flex flex-col gap-8">
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {demoPasses.map((pass) => (
              <li key={pass.id} className="h-full">
                <PassCard pass={pass} />
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center gap-3">
            <DemoBadge label="Demo prices and inclusions — these come from the database next" />
            <p className="text-muted/80 text-xs">
              Live availability, per-night capacity and sold-out states are added with the booking
              step.
            </p>
          </div>
        </Container>
      </Section>

      <Section className="pt-0">
        <Container className="grid gap-6 lg:grid-cols-2">
          <div className="border-border bg-surface/50 flex flex-col gap-4 rounded-2xl border p-6">
            <SectionHeading
              headingLevel="h2"
              title="What every pass includes"
              className="gap-2"
            />
            <ul className="flex flex-col gap-2.5">
              {[
                "Entry for the night shown on your booking",
                "Access to the dance floor and the family zone",
                "Live dhol, garba raas and DJ sets",
                "Drone, videographer and LED wall production",
                "A QR entry pass you show at the gate",
              ].map((item) => (
                <li key={item} className="text-muted flex items-start gap-2.5 text-sm/6">
                  <CheckIcon className="text-peacock mt-0.5 size-4 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="border-border bg-surface/50 flex flex-col gap-4 rounded-2xl border p-6">
            <SectionHeading headingLevel="h2" title="Good to know" className="gap-2" />
            <ul className="flex flex-col gap-2.5">
              {passPolicies.notes.map((note) => (
                <li key={note} className="text-muted text-sm/6">
                  <span aria-hidden="true" className="text-marigold mr-2">
                    •
                  </span>
                  {note}
                </li>
              ))}
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
        description="Not sure whether your group fits a couple pass or a squad pass? Message us on WhatsApp and we will tell you before you pay."
      />
    </>
  );
}
