import type { Metadata } from "next";

import { PassCard } from "@/components/events/pass-card";
import { CalendarIcon, CheckIcon, SparkleIcon } from "@/components/icons";
import { PageHero } from "@/components/layout/page-hero";
import { WhatsAppButton } from "@/components/layout/whatsapp-button";
import { Button } from "@/components/ui/button";
import { Container, Section } from "@/components/ui/container";
import { DemoBadge } from "@/components/ui/demo-badge";
import { SectionHeading } from "@/components/ui/section-heading";
import { demoEvent } from "@/config/event";
import { demoPasses } from "@/config/passes";

export const metadata: Metadata = {
  title: "Book Now",
  description:
    "Reserve your Navratri and Dandiya passes. Online checkout opens with Razorpay in the next build step.",
};

const bookingSteps = [
  {
    title: "Choose your night",
    body: "Pick which of the festival nights you are coming for. Per-night availability is shown once the events table is connected.",
  },
  {
    title: "Select your passes",
    body: "Add the pass types your group needs and check the total before paying. Nothing is reserved until payment succeeds.",
  },
  {
    title: "Pay securely with Razorpay",
    body: "Checkout runs on Razorpay with UPI, cards and netbanking. Your QR entry pass is issued after the payment is verified.",
  },
] as const;

export default function BookPage() {
  return (
    <>
      <PageHero
        eyebrow="Book now"
        title="Reserve your pass"
        description="Here is exactly how booking will work. The checkout itself is not live yet — this page will not take a payment until Razorpay is wired up in the next step."
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button href="/passes" size="lg" className="w-full sm:w-auto">
            View Passes
          </Button>
          <WhatsAppButton
            variant="full"
            size="lg"
            className="w-full sm:w-auto"
            message="Hi! I'd like help booking passes for the Navratri event."
          />
        </div>
      </PageHero>

      <Section className="pt-0">
        <Container className="grid gap-6 lg:grid-cols-3">
          {bookingSteps.map((step, index) => (
            <article
              key={step.title}
              className="border-border bg-surface/60 flex flex-col gap-3 rounded-2xl border p-6"
            >
              <span className="text-marigold font-mono text-sm font-semibold">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h2 className="text-lg font-semibold tracking-tight">{step.title}</h2>
              <p className="text-muted text-sm/6">{step.body}</p>
            </article>
          ))}
        </Container>
      </Section>

      <Section className="pt-0">
        <Container className="flex flex-col gap-8">
          <div className="border-marigold/40 bg-marigold/8 flex flex-col gap-3 rounded-2xl border p-6">
            <h2 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
              <SparkleIcon className="text-marigold size-5" />
              Checkout is not open yet
            </h2>
            <p className="text-muted text-sm/7">
              We are building this in stages. Online booking, payment and the QR entry pass arrive
              with the Razorpay and database steps — until then this page collects no details and
              takes no money. For a group booking or a corporate enquiry, message us on WhatsApp
              and the organiser will confirm availability manually.
            </p>
            <div className="flex flex-wrap gap-3 pt-1">
              <WhatsAppButton
                variant="full"
                size="sm"
                message="Hi! I'd like to book a group pass for the Navratri event."
              />
              <Button href="/contact" variant="secondary" size="sm">
                Other ways to reach us
              </Button>
            </div>
            <DemoBadge label="No payment, no form and no booking record is created on this page" />
          </div>
        </Container>
      </Section>

      <Section className="pt-0">
        <Container className="flex flex-col gap-8">
          <SectionHeading
            eyebrow="Choose a pass"
            title="Passes available at this event"
            description="Selecting a pass will lead into the checkout once it exists. For now these cards show what each pass will include."
          />

          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {demoPasses.map((pass) => (
              <li key={pass.id} className="h-full">
                <PassCard pass={pass} variant="preview" bookHref="/passes" />
              </li>
            ))}
          </ul>
        </Container>
      </Section>

      <Section className="pt-0">
        <Container className="grid gap-6 lg:grid-cols-2">
          <div className="border-border bg-surface/50 flex flex-col gap-4 rounded-2xl border p-6">
            <h2 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
              <CalendarIcon className="text-marigold size-5" />
              Event details
            </h2>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <Detail label="Event" value={demoEvent.name} />
              <Detail label="Dates" value={demoEvent.dates} />
              <Detail label="Timing" value={demoEvent.time} />
              <Detail label="Venue" value={demoEvent.venue} />
              <Detail label="Location" value={demoEvent.location} />
            </dl>
            <DemoBadge label="Demo event details" />
          </div>

          <div className="border-border bg-surface/50 flex flex-col gap-4 rounded-2xl border p-6">
            <h2 className="text-lg font-semibold tracking-tight">What you will need</h2>
            <ul className="flex flex-col gap-2.5">
              {[
                "A mobile number that can receive the booking confirmation",
                "A UPI app, card or netbanking account for the Razorpay checkout",
                "One lead name per pass group for the entry register",
                "Photo ID for the lead guest, checked at the gate",
              ].map((item) => (
                <li key={item} className="text-muted flex items-start gap-2.5 text-sm/6">
                  <CheckIcon className="text-peacock mt-0.5 size-4 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
            <p className="text-muted/80 border-border/70 border-t pt-4 text-xs">
              Refunds, transfers and cancellations are governed by the organiser&apos;s policy, which
              will be published here alongside the checkout.
            </p>
          </div>
        </Container>
      </Section>
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted/80 text-[0.6875rem] font-semibold tracking-widest uppercase">
        {label}
      </dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
