import type { Metadata } from "next";

import { ContactCard } from "@/components/contact/contact-card";
import { ClockIcon, MapPinIcon } from "@/components/icons";
import { PageHero } from "@/components/layout/page-hero";
import { WhatsAppButton } from "@/components/layout/whatsapp-button";
import { CtaBand } from "@/components/sections/cta-band";
import { Button } from "@/components/ui/button";
import { Container, Section } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { SectionHeading } from "@/components/ui/section-heading";
import { buildContactChannels, supportHours } from "@/config/contact";
import { getFeaturedEvent } from "@/lib/services/events";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Contact the organiser for booking help, group passes, sponsorships and venue directions.",
};

export const revalidate = 300;

const FAQS = [
  {
    question: "Do I need a partner for garba or dandiya?",
    answer:
      "No. Traditional garba raas is danced in circles without a partner, and our floor marshals pair up anyone who wants to play dandiya.",
  },
  {
    question: "Is there a family section?",
    answer:
      "Yes. The family zone sits away from the main speakers with seating, and children are welcome with a family pass.",
  },
  {
    question: "How will entry work?",
    answer:
      "Every booking gets a QR entry pass. You show it at the gate and the booking is verified on the spot — no paper tickets.",
  },
  {
    question: "Can I book for a corporate group?",
    answer:
      "Yes. Message us on WhatsApp with the group size and preferred night and the organiser will confirm availability and pricing.",
  },
] as const;

export default async function ContactPage() {
  const result = await getFeaturedEvent();

  if (!result.ok) {
    return (
      <Section>
        <Container>
          <ErrorState error={result.error} title="Contact details are unavailable" />
        </Container>
      </Section>
    );
  }

  const event = result.data;
  const channels = buildContactChannels(event ?? undefined);

  return (
    <>
      <PageHero
        eyebrow="Contact"
        title="Talk to the organisers"
        description="WhatsApp is the fastest way to reach us during the festival. For sponsorships and bulk bookings, email works best."
      />

      <Section className="pt-0">
        <Container className="flex flex-col gap-8">
          {channels.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {channels.map((channel) => (
                <ContactCard key={channel.id} channel={channel} />
              ))}
            </div>
          ) : (
            <EmptyState
              title="No contact details published yet"
              description="The organiser has not added phone or email details to the event record. They appear here as soon as they exist — we do not invent contact information."
            />
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button href="/passes" variant="ghost" size="sm">
              See passes
            </Button>
          </div>
        </Container>
      </Section>

      <Section className="pt-0">
        <Container className="grid gap-6 lg:grid-cols-2">
          <div className="border-border bg-surface/50 flex flex-col gap-4 rounded-2xl border p-6">
            <h2 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
              <MapPinIcon className="text-marigold size-5" />
              Venue &amp; directions
            </h2>
            {event ? (
              <>
                <address className="text-muted text-sm/7 not-italic">
                  {[event.venueName, event.venueAddress, event.city, event.state]
                    .filter(Boolean)
                    .map((line) => (
                      <span key={line} className="block">
                        {line}
                      </span>
                    ))}
                </address>
                {event.mapsUrl ? (
                  <a
                    href={event.mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-marigold-soft hover:text-marigold w-fit text-sm font-semibold underline-offset-4 hover:underline"
                  >
                    Open in Google Maps
                  </a>
                ) : null}
              </>
            ) : (
              <p className="text-muted text-sm/6">
                The venue is published with the event record once it is confirmed.
              </p>
            )}
            <WhatsAppButton
              variant="full"
              size="sm"
              className="w-fit"
              number={event?.contactPhone?.replace(/[^0-9]/g, "")}
              message="Hi! I need directions to the venue."
            />
          </div>

          <div className="border-border bg-surface/50 flex flex-col gap-4 rounded-2xl border p-6">
            <h2 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
              <ClockIcon className="text-marigold size-5" />
              {supportHours.label}
            </h2>
            <ul className="flex flex-col gap-2">
              {supportHours.lines.map((line) => (
                <li key={line} className="text-muted text-sm/6">
                  {line}
                </li>
              ))}
            </ul>
            <div
              className="border-border/80 from-navy/40 to-violet/25 mt-auto flex min-h-32 items-center justify-center rounded-xl border bg-gradient-to-br p-4 text-center"
              role="img"
              aria-label="Map placeholder — the venue map will be embedded here"
            >
              <p className="text-muted text-xs/5">
                {event?.mapsUrl
                  ? "Use the directions link to open the venue in your maps app."
                  : "The venue map is published once the organiser confirms the location."}
              </p>
            </div>
          </div>
        </Container>
      </Section>

      <Section className="pt-0">
        <Container className="flex flex-col gap-8">
          <SectionHeading
            eyebrow="FAQ"
            title="Common questions"
            description="These answers describe how the event runs today. Booking-specific answers are updated once checkout is live."
          />

          <div className="grid gap-4 sm:grid-cols-2">
            {FAQS.map((faq) => (
              <div key={faq.question} className="border-border bg-surface/50 rounded-2xl border p-5">
                <h3 className="text-base font-semibold tracking-tight">{faq.question}</h3>
                <p className="text-muted mt-2 text-sm/6">{faq.answer}</p>
              </div>
            ))}
          </div>
        </Container>
      </Section>

      <Section className="pt-0">
        <Container className="flex flex-col gap-8">
          <SectionHeading
            eyebrow="Message us"
            title="Contact form"
            description="A contact form needs somewhere to store messages and a spam strategy. Until that exists, it is not shipped — use WhatsApp or email in the meantime."
          />

          <EmptyState
            title="Contact form coming in a later step"
            description="Messages will be stored in the database and routed to the organiser once authentication and the messages table exist. No fake form is shown in the meantime."
            action={
              <WhatsAppButton
                variant="full"
                size="sm"
                number={event?.contactPhone?.replace(/[^0-9]/g, "")}
                message="Hi! I have a question about the Navratri event."
              />
            }
          />
        </Container>
      </Section>

      <CtaBand
        title="Passes are selling per night"
        description="Compare the pass types and pick the night that suits your group."
      />
    </>
  );
}
