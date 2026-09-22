import type { Metadata } from "next";
import Image from "next/image";

import { CheckIcon } from "@/components/icons";
import { PageHero } from "@/components/layout/page-hero";
import { CtaBand } from "@/components/sections/cta-band";
import { FeatureStrip } from "@/components/sections/feature-strip";
import { Card } from "@/components/ui/card";
import { Container, Section } from "@/components/ui/container";
import { DemoBadge } from "@/components/ui/demo-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeading } from "@/components/ui/section-heading";
import heroImage from "@/assets/images/hero-festival.jpg";
import { demoHighlights } from "@/config/event";

export const metadata: Metadata = {
  title: "About",
  description:
    "About our Navratri and Dandiya festival — the venue, the production, the safety arrangements and what a night looks like.",
};

const organisationPoints = [
  "Marshalled dance floor with a dedicated family zone",
  "Medical desk and trained floor staff on every night",
  "Digital QR entry passes with capacity checks at the gate",
] as const;

export default function AboutPage() {
  return (
    <>
      <PageHero
        eyebrow="About"
        title="A Navratri festival run like a production"
        description="Who we are, what a night looks like, and what is included with your pass. Organisation details are demo content until the organiser profile is stored in the database."
      />

      <Section className="pt-0">
        <Container className="grid items-start gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="flex flex-col gap-6">
            <SectionHeading
              title="Nine nights of garba, dandiya and live music"
              description="We host a full Navratri season: live dhol and garba raas rounds early in the evening, dandiya circles after that, and a Bollywood set to close. Traditional garba does not need a partner; dandiya rounds are organised by the floor marshals so nobody is left standing at the edge."
            />

            <p className="text-muted text-sm/7">
              Our stage is built with a large LED backdrop, a truss lighting rig and a
              professional sound system sized for the ground, with separate zones for families and
              for the main dance floor so groups can pick the pace they want.
            </p>

            <ul className="flex flex-col gap-3">
              {organisationPoints.map((point) => (
                <li key={point} className="flex items-start gap-3 text-sm/6">
                  <span className="bg-peacock/15 text-peacock mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full">
                    <CheckIcon className="size-3.5" />
                  </span>
                  <span className="text-muted">{point}</span>
                </li>
              ))}
            </ul>

            <DemoBadge label="Demo copy — organiser details move to the database next" />
          </div>

          <div className="border-border relative aspect-4/3 overflow-hidden rounded-3xl border shadow-2xl shadow-black/40">
            <Image
              src={heroImage}
              alt="Illustration of a decorated Navratri stage with marigold garlands, lanterns and dandiya sticks"
              fill
              sizes="(max-width: 1024px) 100vw, 45vw"
              className="object-cover"
            />
          </div>
        </Container>
      </Section>

      <FeatureStrip />

      <Section className="pt-0">
        <Container className="flex flex-col gap-10">
          <SectionHeading
            eyebrow="Highlights"
            title="What to expect on the night"
            description="These highlights will be attached to each event record so different events can advertise different experiences."
          />

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {demoHighlights.map((highlight) => (
              <Card key={highlight.title} className="flex flex-col gap-2 p-5">
                <h3 className="text-base font-semibold tracking-tight">{highlight.title}</h3>
                <p className="text-muted text-sm/6">{highlight.description}</p>
              </Card>
            ))}
          </div>
        </Container>
      </Section>

      <Section className="pt-0">
        <Container className="flex flex-col gap-8">
          <SectionHeading
            eyebrow="The team"
            title="Organiser profiles"
            description="Profiles are shown once they exist in the database — no invented team members, testimonials or past-event claims."
          />

          <EmptyState
            title="Organiser profiles not published yet"
            description="This section will list the people behind the festival with their roles and contact details, sourced from the organiser table."
          />
        </Container>
      </Section>

      <CtaBand
        title="Come for one night or all nine"
        description="Passes are per night. Compare the pass options and pick what suits your group."
      />
    </>
  );
}
