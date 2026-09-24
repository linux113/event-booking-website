import type { Metadata } from "next";

import { ContactCard } from "@/components/contact/contact-card";
import { ClockIcon, MailIcon, MapPinIcon, PhoneIcon, socialIcons, WhatsAppIcon } from "@/components/icons";
import { PageHero } from "@/components/layout/page-hero";
import { WhatsAppButton } from "@/components/layout/whatsapp-button";
import { CtaBand } from "@/components/sections/cta-band";
import { Button, buttonClasses } from "@/components/ui/button";
import { Container, Section } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { SectionHeading } from "@/components/ui/section-heading";
import { buildContactChannels, buildSiteContact, WHATSAPP_MESSAGE } from "@/lib/contact";
import { getFeaturedEvent, getSiteContent } from "@/lib/services/events";
import { parseSiteContentJson } from "@/lib/site-content";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Contact the organiser for booking help, group passes, sponsorships and venue directions — WhatsApp, phone, email, address, map and social profiles.",
};

export const revalidate = 300;

/** The default "Questions before booking", shown until the organiser saves their own. */
const DEFAULT_FAQS = [
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

/**
 * The contact page.
 *
 * Every value on it — the WhatsApp number, the telephone number, the email address, the
 * venue, the address, the map link, the three social profiles and the support hours —
 * comes from the event row in the database, through one pure module
 * (`src/lib/contact.ts`). Adding a number to the event record adds it here, in the
 * footer and in the header at the same time, which is the point: the site has one
 * contact block, not four copies of one.
 *
 * Channels the organiser has not filled in are omitted, and when there is nothing at
 * all the page says so instead of showing a placeholder telephone number.
 */
export default async function ContactPage() {
  const [result, contentResult] = await Promise.all([getFeaturedEvent(), getSiteContent()]);

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
  const contact = buildSiteContact(event);
  const channels = buildContactChannels(event);
  // Organiser-edited FAQs; falls back to the default questions when unset or unreadable.
  const content = contentResult.ok ? contentResult.data : parseSiteContentJson(null);
  const faqs = content.faqs.length > 0 ? content.faqs : DEFAULT_FAQS;

  return (
    <>
      <PageHero
        eyebrow="Contact"
        title="Talk to the organisers"
        description="WhatsApp is the fastest way to reach us during the festival. For sponsorships and bulk bookings, email works best."
      >
        <div className="flex flex-wrap items-center gap-3">
          <WhatsAppButton href={contact.whatsappHref} variant="full" size="lg" />
          {contact.phoneHref ? (
            <a href={contact.phoneHref} className={buttonClasses({ variant: "secondary", size: "lg" })}>
              <PhoneIcon className="size-[1.05rem]" />
              Call {contact.phone}
            </a>
          ) : null}
        </div>
      </PageHero>

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
              description="The organiser has not added phone, email or WhatsApp details to the event record. They appear here as soon as they exist — we do not invent contact information."
            />
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button href="/passes" variant="ghost" size="sm">
              See passes
            </Button>
            <Button href="/book" variant="ghost" size="sm">
              Start a booking
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

            {contact.addressLines.length > 0 ? (
              <address className="text-muted text-sm/7 not-italic">
                {contact.addressLines.map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
              </address>
            ) : (
              <p className="text-muted text-sm/6">
                The venue is published with the event record once it is confirmed.
              </p>
            )}

            {contact.mapsHref ? (
              <a
                href={contact.mapsHref}
                target="_blank"
                rel="noopener noreferrer"
                className="text-marigold-soft hover:text-marigold w-fit text-sm font-semibold underline-offset-4 hover:underline"
              >
                Open in Google Maps
              </a>
            ) : null}

            <div className="mt-auto flex flex-wrap items-center gap-3">
              <WhatsAppButton href={contact.whatsappHref} variant="full" size="sm" className="w-fit" />
              <p className="text-muted/80 text-xs/5">
                Ask on WhatsApp and the organiser will send the gate number and parking notes.
              </p>
            </div>
          </div>

          <div className="border-border bg-surface/50 flex flex-col gap-4 rounded-2xl border p-6">
            <h2 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
              <ClockIcon className="text-marigold size-5" />
              Support hours
            </h2>

            {contact.supportHours.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {contact.supportHours.map((line) => (
                  <li key={line} className="text-muted text-sm/6">
                    {line}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted text-sm/6">
                Support hours are published with the event record. Messages sent outside them are answered the next
                morning.
              </p>
            )}

            <div
              className="border-border/80 from-navy/40 to-violet/25 mt-auto flex min-h-32 items-center justify-center rounded-xl border bg-gradient-to-br p-4 text-center"
              role="img"
              aria-label="Map placeholder — the venue map will be embedded here"
            >
              <p className="text-muted text-xs/5">
                {contact.mapsHref
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
            eyebrow="Follow"
            title="Find us between the nights"
            description="Photos, reels, announcements and after-movie clips are posted on the event's own profiles."
          />

          {contact.socials.length > 0 ? (
            <ul className="flex flex-wrap gap-3">
              {contact.socials.map((social) => {
                const SocialIcon = socialIcons[social.id];

                return (
                  <li key={social.id}>
                    <a
                      href={social.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="border-border bg-surface-raised/60 hover:border-marigold/50 hover:text-marigold text-muted inline-flex items-center gap-3 rounded-full border px-4 py-2.5 text-sm font-semibold transition-colors"
                    >
                      <SocialIcon className="size-[1.15rem]" />
                      {social.label}
                    </a>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-muted text-sm/6">
              The organiser has not linked any social profiles to this event yet. When they do, they appear here and in
              the footer.
            </p>
          )}
        </Container>
      </Section>

      <Section className="pt-0">
        <Container className="flex flex-col gap-8">
          <SectionHeading
            eyebrow="FAQ"
            title="Questions before booking"
            description="These answers describe how the event runs today. Anything else, ask us on WhatsApp before you book."
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
        <Container className="flex flex-col gap-6">
          <SectionHeading
            eyebrow="Message us"
            title="Send us a message"
            description="A contact form needs somewhere to store messages and a spam strategy. Until that exists, it is not shipped — use WhatsApp or email in the meantime."
          />

          <div className="border-border bg-surface/50 flex flex-col gap-4 rounded-2xl border p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-2">
              <p className="flex items-center gap-2.5 font-semibold">
                <WhatsAppIcon className="text-[#7ff0ab] size-[1.15rem]" />
                WhatsApp
              </p>
              <p className="text-muted text-sm/6">
                Opens WhatsApp with the message “{WHATSAPP_MESSAGE}” already typed — on a phone the app takes over, on a
                desktop WhatsApp Web opens with the same text.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <WhatsAppButton href={contact.whatsappHref} variant="full" size="md" />
              {contact.emailHref ? (
                <a href={contact.emailHref} className={buttonClasses({ variant: "secondary", size: "md" })}>
                  <MailIcon className="size-[1.05rem]" />
                  Email us
                </a>
              ) : null}
            </div>
          </div>
        </Container>
      </Section>

      <CtaBand
        title="Passes are selling per night"
        description="Compare the pass types and pick the night that suits your group."
        contact={contact}
      />
    </>
  );
}
