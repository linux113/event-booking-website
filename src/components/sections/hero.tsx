import Image from "next/image";
import type { ReactNode } from "react";

import { CalendarIcon, ClockIcon, DiyaIcon, MapPinIcon, SparkleIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Container, Section } from "@/components/ui/container";
import { DemoBadge } from "@/components/ui/demo-badge";
import { demoEvent } from "@/config/event";
import { siteConfig } from "@/config/site";

/**
 * Festival hero: banner artwork, event name, dates, venue, location and the two
 * primary calls to action. Values come from `demoEvent` today and from the
 * `events` table in the Supabase step.
 */
export function Hero() {
  return (
    <Section className="relative overflow-hidden pt-12 sm:pt-16 lg:pt-20">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="bg-navy-soft/35 absolute -top-32 -left-24 size-[30rem] rounded-full blur-3xl" />
        <div className="bg-violet/25 absolute top-10 right-0 size-[26rem] rounded-full blur-3xl" />
        <div className="bg-rani/20 absolute -bottom-24 left-1/3 size-[24rem] rounded-full blur-3xl" />
      </div>

      <Container>
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14">
          <div className="flex flex-col items-start gap-6">
            <span className="border-marigold/35 bg-marigold/10 text-marigold-soft inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold tracking-wide uppercase">
              <SparkleIcon className="size-3.5" />
              Navratri 2026 season
            </span>

            <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl lg:text-[3.4rem] lg:leading-[1.05]">
              <span className="from-marigold via-orange-soft to-rani bg-gradient-to-r bg-clip-text text-transparent">
                {demoEvent.name}
              </span>
            </h1>

            <p className="text-muted max-w-xl text-base/7 sm:text-lg/8">
              {demoEvent.tagline}. {siteConfig.tagline} — nine nights of garba, dandiya and
              non-stop beats.
            </p>

            <dl className="border-border/70 bg-surface/60 grid w-full max-w-xl gap-px overflow-hidden rounded-2xl border sm:grid-cols-3">
              <HeroFact
                icon={<CalendarIcon className="text-marigold size-[1.15rem]" />}
                label="Dates"
                value={demoEvent.dates}
              />
              <HeroFact
                icon={<ClockIcon className="text-marigold size-[1.15rem]" />}
                label="Timing"
                value={demoEvent.time}
              />
              <HeroFact
                icon={<MapPinIcon className="text-marigold size-[1.15rem]" />}
                label="Venue"
                value={`${demoEvent.venue}, ${demoEvent.location}`}
              />
            </dl>

            <div className="flex w-full flex-col gap-3 sm:flex-row">
              <Button href="/book" size="lg" className="w-full sm:w-auto">
                Book Now
              </Button>
              <Button href="/passes" variant="secondary" size="lg" className="w-full sm:w-auto">
                View Passes
              </Button>
            </div>

            <DemoBadge />
          </div>

          <div className="relative">
            <div className="border-border relative aspect-4/3 overflow-hidden rounded-3xl border shadow-2xl shadow-black/50 sm:aspect-16/10 lg:aspect-4/3">
              <Image
                src={demoEvent.image}
                alt={demoEvent.imageAlt}
                fill
                priority
                sizes="(max-width: 1024px) 100vw, 45vw"
                className="object-cover"
              />
              <div
                aria-hidden="true"
                className="from-night/85 absolute inset-0 bg-gradient-to-t via-transparent to-transparent"
              />

              <div className="absolute inset-x-4 bottom-4 flex flex-wrap items-center gap-2">
                <span className="bg-night/70 text-marigold-soft rounded-full px-3 py-1 text-xs font-semibold backdrop-blur">
                  {demoEvent.dates}
                </span>
                <span className="bg-night/70 text-foreground/90 rounded-full px-3 py-1 text-xs font-semibold backdrop-blur">
                  {demoEvent.location}
                </span>
              </div>
            </div>

            {/* Decorative floating diya, hidden from assistive tech. */}
            <div
              aria-hidden="true"
              className="border-marigold/30 bg-night/85 absolute -top-4 -right-3 hidden size-16 items-center justify-center rounded-2xl border shadow-xl backdrop-blur lg:flex motion-safe:animate-float"
            >
              <DiyaIcon className="text-marigold size-8" />
            </div>
          </div>
        </div>
      </Container>
    </Section>
  );
}

type HeroFactProps = {
  icon: ReactNode;
  label: string;
  value: string;
};

function HeroFact({ icon, label, value }: HeroFactProps) {
  return (
    <div className="bg-surface/80 flex items-start gap-3 p-4">
      <span className="mt-0.5">{icon}</span>
      <div className="flex flex-col gap-0.5">
        <dt className="text-muted/80 text-[0.6875rem] font-semibold tracking-widest uppercase">
          {label}
        </dt>
        <dd className="text-sm font-semibold text-balance">{value}</dd>
      </div>
    </div>
  );
}
