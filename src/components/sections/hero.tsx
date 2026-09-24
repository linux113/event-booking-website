import Image from "next/image";
import type { ReactNode } from "react";

import logoMark from "@/assets/brand/logo-mark.png";
import { InterestButton } from "@/components/events/interest-button";
import { CalendarIcon, ClockIcon, DiyaIcon, MapPinIcon, SparkleIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Container, Section } from "@/components/ui/container";
import { formatDateRange, formatInr, formatTimeRange } from "@/lib/format";
import { siteConfig } from "@/config/site";
import type { EventBundle } from "@/types";

type HeroProps = {
  bundle: EventBundle;
};

/**
 * Festival hero, rendered entirely from the database: event record, its nights
 * and its passes. Nothing here is hard-coded.
 *
 * The mobile layout is the event details screen: the artwork first with the
 * brand and the venue chips on it, then the event name with the interest pill,
 * the date/time/venue facts, the event description — and a booking bar pinned
 * to the bottom of the viewport with the starting price and live availability.
 * From `lg` up it opens out into the two-column landing hero.
 */
export function Hero({ bundle }: HeroProps) {
  const { event, nights } = bundle;
  const dateRange = formatDateRange(nights.map((night) => night.date));
  const firstNight = nights[0];
  const timeRange = firstNight ? formatTimeRange(firstNight.startTime, firstNight.endTime) : null;
  const location = [event.venueName, event.city].filter(Boolean).join(", ");

  return (
    <Section className="relative overflow-hidden pt-8 sm:pt-16 lg:pt-20">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="bg-navy-soft/35 absolute -top-32 -left-24 size-[30rem] rounded-full blur-3xl" />
        <div className="bg-violet/25 absolute top-10 right-0 size-[26rem] rounded-full blur-3xl" />
        <div className="bg-rani/20 absolute -bottom-24 left-1/3 size-[24rem] rounded-full blur-3xl" />
      </div>

      {/* Event details screen — mobile. */}
      <MobileEventDetails bundle={bundle} dateRange={dateRange} timeRange={timeRange} location={location} />

      {/* Landing hero — desktop. */}
      <Container className="hidden lg:block">
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

            <InterestButton eventId={event.id} eventName={event.name} />

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

            <CheapestPassNote bundle={bundle} />

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
            <div className="border-border relative aspect-4/3 overflow-hidden rounded-3xl border shadow-2xl shadow-black/50">
              <HeroImage bundle={bundle} location={location} dateRange={dateRange} />
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

type LayoutSharedProps = {
  bundle: EventBundle;
  dateRange: string;
  timeRange: string | null;
  location: string;
};

/**
 * The event details screen from the mobile reference: brand slate over the
 * artwork, interest pill next to the title, the date/time/venue facts, the
 * event description, and the pinned booking bar with the live starting price.
 */
function MobileEventDetails({ bundle, dateRange, timeRange, location }: LayoutSharedProps) {
  const { event, nights } = bundle;

  return (
    <div className="lg:hidden">
      <Container className="flex flex-col gap-6">
        {/* Event artwork with the brand slate and the venue chips on it. */}
        <div className="border-border relative aspect-4/3 overflow-hidden rounded-3xl border shadow-2xl shadow-black/50 sm:aspect-16/10">
          <HeroImage bundle={bundle} location={location} dateRange={dateRange} priority />

          <div className="bg-night/70 absolute top-3 left-3 flex items-center gap-2 rounded-full py-1 pr-3.5 pl-1 backdrop-blur">
            <Image
              src={logoMark}
              alt={`${siteConfig.name} logo`}
              width={28}
              height={28}
              className="size-7 rounded-full"
            />
            <span className="text-xs leading-none font-semibold tracking-tight">
              {siteConfig.name}
            </span>
          </div>
        </div>

        {/* Book Now directly below the artwork. */}
        <div className="flex flex-col gap-2">
          <Button href="/book" size="lg" className="w-full">
            Book Now
          </Button>
          <CheapestPassNote bundle={bundle} className="text-center" />
        </div>

        {/* Title + interest pill. */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="text-3xl font-bold tracking-tight text-balance">
              <span className="from-marigold via-orange-soft to-rani bg-gradient-to-r bg-clip-text text-transparent">
                {event.name}
              </span>
            </h1>
            {event.tagline ? <p className="text-muted text-sm/6">{event.tagline}</p> : null}
          </div>
          <InterestButton eventId={event.id} eventName={event.name} className="mt-1" />
        </div>

        {/* Event details. */}
        <dl className="border-border/70 bg-surface/60 divide-border/60 divide-y overflow-hidden rounded-2xl border">
          <HeroFact
            icon={<CalendarIcon className="text-marigold size-[1.15rem]" />}
            label="Date"
            value={dateRange || "Dates to be announced"}
          />
          <HeroFact
            icon={<ClockIcon className="text-marigold size-[1.15rem]" />}
            label="Time"
            value={timeRange ?? "Timing to be confirmed"}
          />
          <HeroFact
            icon={<MapPinIcon className="text-marigold size-[1.15rem]" />}
            label="Venue"
            value={location || "Venue to be announced"}
          />
        </dl>

        {/* Description. */}
        {event.description ? (
          <div className="flex flex-col gap-2.5">
            <h2 className="text-lg font-semibold tracking-tight">About the event</h2>
            <p className="text-muted text-sm/7">{event.description}</p>
          </div>
        ) : null}
      </Container>

      <MobileBookingBar bundle={bundle} nightCount={nights.length} />
    </div>
  );
}

/**
 * The pinned booking bar from the event details reference: the cheapest pass on
 * sale and the live night availability on the left, "Book Now" on the right.
 * When nothing is on sale the copy says so rather than quoting a price — the
 * button still lands on /book, which explains the state and offers WhatsApp.
 */
function MobileBookingBar({ bundle, nightCount }: { bundle: EventBundle; nightCount: number }) {
  const { event, nights, passes } = bundle;
  const bookablePasses = passes.filter((pass) => pass.availability.enabled);
  const cheapest = bookablePasses.length ? Math.min(...bookablePasses.map((pass) => pass.priceInr)) : null;
  const bookableNights = nights.filter((night) => night.isBookable).length;
  const placesLeft = nights.reduce((total, night) => (night.isBookable ? total + night.remaining : total), 0);

  return (
    <div className="border-border/60 bg-background/92 fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
      <Container className="flex items-center justify-between gap-4 py-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          {cheapest !== null ? (
            <p className="text-sm font-bold tracking-tight">
              {formatInr(cheapest, event.currency)}{" "}
              <span className="text-muted text-xs font-medium">onwards per pass</span>
            </p>
          ) : (
            <p className="text-sm font-bold tracking-tight">Passes not on sale</p>
          )}
          <p className="text-muted truncate text-xs">
            {bookableNights > 0
              ? `${bookableNights} of ${nightCount} ${nightCount === 1 ? "night" : "nights"} open · ${placesLeft} places left`
              : "Booking closed right now"}
          </p>
        </div>
        <Button href="/book" className="shrink-0">
          Book Now
        </Button>
      </Container>
    </div>
  );
}

function CheapestPassNote({ bundle, className }: { bundle: EventBundle; className?: string }) {
  const { event, passes } = bundle;
  const bookablePasses = passes.filter((pass) => pass.availability.enabled);
  const cheapest = bookablePasses.length ? Math.min(...bookablePasses.map((pass) => pass.priceInr)) : null;

  if (cheapest === null) {
    return null;
  }

  return (
    <p className={`text-muted text-sm ${className ?? ""}`}>
      Passes from{" "}
      <span className="text-marigold-soft font-semibold">{formatInr(cheapest, event.currency)}</span> per pass
    </p>
  );
}

/** The artwork: the uploaded hero image, or the built-in diya artwork. */
function HeroImage({
  bundle,
  location,
  dateRange,
  priority = true,
}: {
  bundle: EventBundle;
  location: string;
  dateRange: string;
  priority?: boolean;
}) {
  const { event } = bundle;

  return (
    <>
      {event.heroImageUrl ? (
        <Image
          src={event.heroImageUrl}
          alt={`${event.name} at ${event.venueName}`}
          fill
          priority={priority}
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

      <div className="absolute inset-x-3 bottom-3 flex flex-wrap items-center gap-2 sm:inset-x-4 sm:bottom-4">
        {dateRange ? (
          <span className="bg-night/70 text-marigold-soft rounded-full px-3 py-1 text-xs font-semibold backdrop-blur">
            {dateRange}
          </span>
        ) : null}
        <span className="bg-night/70 text-foreground/90 rounded-full px-3 py-1 text-xs font-semibold backdrop-blur">
          {location}
        </span>
      </div>
    </>
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
