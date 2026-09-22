import Image from "next/image";

import { CheckIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Container, Section } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import aboutImage from "@/assets/images/about-dandiya.jpg";
import { demoHighlights } from "@/config/event";

const promises = [
  "Organised, marshalled dance floor with separate family zone",
  "Digital QR entry — no paper tickets, no gate queues",
  "Live dhol, DJ and anchor every night of the festival",
] as const;

export function AboutSection() {
  return (
    <Section id="about">
      <Container className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <div className="relative order-2 lg:order-1">
          <div className="border-border relative aspect-4/3 overflow-hidden rounded-3xl border shadow-2xl shadow-black/40">
            <Image
              src={aboutImage}
              alt="Flat lay of decorated dandiya sticks, a lit clay diya and marigold petals on indigo silk"
              fill
              sizes="(max-width: 1024px) 100vw, 45vw"
              className="object-cover"
            />
          </div>
          <div
            aria-hidden="true"
            className="border-marigold/25 absolute -bottom-6 -left-4 hidden rounded-2xl border bg-night/90 px-5 py-4 shadow-xl backdrop-blur sm:block"
          >
            <p className="font-mono text-2xl font-bold text-marigold">09</p>
            <p className="text-muted text-xs tracking-wide uppercase">Nights of garba</p>
          </div>
        </div>

        <div className="order-1 flex flex-col gap-6 lg:order-2">
          <SectionHeading
            eyebrow="About the event"
            title="A Navratri celebration built for everyone"
            description="Highlights are read from the event record once the database is connected. Until then they are demo copy."
          />

          <ul className="flex flex-col gap-3">
            {promises.map((promise) => (
              <li key={promise} className="flex items-start gap-3 text-sm/6">
                <span className="bg-marigold/15 text-marigold mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full">
                  <CheckIcon className="size-3.5" />
                </span>
                <span className="text-muted">{promise}</span>
              </li>
            ))}
          </ul>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button href="/about" variant="secondary">
              More about us
            </Button>
            <Button href="/passes" variant="ghost" className="justify-start">
              See pass options
            </Button>
          </div>
        </div>
      </Container>

      <Container className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {demoHighlights.map((highlight) => (
          <div
            key={highlight.title}
            className="border-border bg-surface/50 hover:border-violet-soft/40 rounded-2xl border p-5 transition-colors duration-200"
          >
            <h3 className="text-base font-semibold tracking-tight">{highlight.title}</h3>
            <p className="text-muted mt-2 text-sm/6">{highlight.description}</p>
          </div>
        ))}
      </Container>
    </Section>
  );
}
