import type { Metadata } from "next";

import { ContactCard } from "@/components/contact/contact-card";
import { ClockIcon, MapPinIcon } from "@/components/icons";
import { PageHero } from "@/components/layout/page-hero";
import { WhatsAppButton } from "@/components/layout/whatsapp-button";
import { CtaBand } from "@/components/sections/cta-band";
import { Button } from "@/components/ui/button";
import { Container, Section } from "@/components/ui/container";
import { DemoBadge } from "@/components/ui/demo-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeading } from "@/components/ui/section-heading";
import { contactChannels, supportHours } from "@/config/contact";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Contact the organiser for booking help, group passes, sponsorships and venue directions.",
};

const faqs = [
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

export default function ContactPage() {
  return (
    <>
      <PageHero
        eyebrow="Contact"
        title="Talk to the organisers"
        description="WhatsApp is the fastest way to reach us during the festival. For sponsorships and bulk bookings, email works best."
      />

      <Section className="pt-0">
        <Container className="flex flex-col gap-8">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {contactChannels.map((channel) => (
              <ContactCard key={channel.id} channel={channel} />
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <DemoBadge label="Demo contact details — replace with the real numbers before launch" />
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
            <address className="text-muted text-sm/7 not-italic">
              {siteConfig.contact.addressLines.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </address>
            <p className="text-muted text-sm/6">
              The venue map is published with the confirmed event record. We do not embed a location
              we have not verified.
            </p>
            <WhatsAppButton
              variant="full"
              size="sm"
              className="w-fit"
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
                Map embed placeholder — connects to the venue coordinates from the event record.
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
            {faqs.map((faq) => (
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
