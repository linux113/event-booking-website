import Image from "next/image";
import type { ReactNode } from "react";

import { CalendarIcon, ClockIcon, DiyaIcon, MapPinIcon, SparkleIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Container, Section } from "@/components/ui/container";
import { formatDateRange, formatTimeRange } from "@/lib/format";
import { siteConfig } from "@/config/site";
import type { EventBundle } from "@/types";

type HeroProps = {
  bundle: EventBundle;
};

/**
 * Festival hero, rendered entirely from the database: event record, its nights
 * and its passes. Nothing here is hard-coded.
 */
export function Hero({ bundle }: HeroProps) {
  const { event, nights, passes } = bundle;
  const dateRange = formatDateRange(nights.map((night) => night.date));
  const firstNight = nights[0];
  const timeRange = firstNight ? formatTimeRange(firstNight.startTime, firstNight.endTime) : null;
  const location = [event.venueName, event.city].filter(Boolean).join(", ");
  const bookablePasses = passes.filter((pass) => pass.availability.enabled);
  const cheapest = bookablePasses.length
    ? Math.min(...bookablePasses.map((pass) => pass.priceInr))
    : null;

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
              {nightCountCopy(nights.length)}
            </span>

            <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl lg:text-[3.4rem] lg:leading-[1.05]">
              <span className="from-marigold via-orange-soft to-rani bg-gradient-to-r bg-clip-text text-transparent">
                {event.name}
              </span>
            </h1>

            {event.tagline ? (
              <p className="text-muted max-w-xl text-base/7 sm:text-lg/8">
                {event.tagline}. {siteConfig.tagline}.
              </p>
            ) : null}

            <dl className="border-border/70 bg-surface/60 grid w-full max-w-xl gap-px overflow-hidden rounded-2xl border sm:grid-cols-3">
              <HeroFact
                icon={<CalendarIcon className="text-marigold size-[1.15rem]" />}
                label="Dates"
                value={dateRange || "Dates to be announced"}
              />
              <HeroFact
                icon={<ClockIcon className="text-marigold size-[1.15rem]" />}
                label="Timing"
                value={timeRange ?? "Timing to be confirmed"}
              />
              <HeroFact
                icon={<MapPinIcon className="text-marigold size-[1.15rem]" />}
                label="Venue"
                value={location}
              />
            </dl>

            {cheapest !== null ? (
              <p className="text-muted text-sm">
                Passes from{" "}
                <span className="text-marigold-soft font-semibold">
                  {new Intl.NumberFormat(siteConfig.locale, {
                    style: "currency",
                    currency: event.currency,
                    maximumFractionDigits: 0,
                  }).format(cheapest)}
                </span>{" "}
                per pass
              </p>
            ) : null}

            <div className="flex w-full flex-col gap-3 sm:flex-row">
              <Button href="/book" size="lg" className="w-full sm:w-auto">
                Book Now
              </Button>
              <Button href="/passes" variant="secondary" size="lg" className="w-full sm:w-auto">
                View Passes
              </Button>
            </div>
          </div>

          <div className="relative">
            <div className="border-border relative aspect-4/3 overflow-hidden rounded-3xl border shadow-2xl shadow-black/50 sm:aspect-16/10 lg:aspect-4/3">
              {event.heroImageUrl ? (
                <Image
                  src={event.heroImageUrl}
                  alt={`${event.name} at ${event.venueName}`}
                  fill
                  priority
                  sizes="(max-width: 1024px) 100vw, 45vw"
                  className="object-cover"
                  unoptimized
                />
              ) : (
                <HeroArtwork />
              )}

              <div
                aria-hidden="true"
                className="from-night/85 absolute inset-0 bg-gradient-to-t via-transparent to-transparent"
              />

              <div className="absolute inset-x-4 bottom-4 flex flex-wrap items-center gap-2">
                {dateRange ? (
                  <span className="bg-night/70 text-marigold-soft rounded-full px-3 py-1 text-xs font-semibold backdrop-blur">
                    {dateRange}
                  </span>
                ) : null}
                <span className="bg-night/70 text-foreground/90 rounded-full px-3 py-1 text-xs font-semibold backdrop-blur">
                  {location}
                </span>
              </div>
            </div>

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

function nightCountCopy(count: number): string {
  if (count === 0) {
    return "Navratri season";
  }

  return `${count} ${count === 1 ? "night" : "nights"} of Navratri`;
}

/** Built-in diya artwork shown until a homepage hero image is uploaded. */
function HeroArtwork() {
  return (
    <div className="from-navy via-surface to-[#2a1055] absolute inset-0 bg-gradient-to-br">
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-70"
        style={{
          backgroundImage:
            "radial-gradient(circle at 50% 0%, rgba(247,183,49,0.25), transparent 55%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        <DiyaIcon className="text-marigold/25 size-32" />
      </div>
    </div>
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
