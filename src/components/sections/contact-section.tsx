import { ContactCard } from "@/components/contact/contact-card";
import { MapPinIcon } from "@/components/icons";
import { WhatsAppButton } from "@/components/layout/whatsapp-button";
import { Container, Section } from "@/components/ui/container";
import { DemoBadge } from "@/components/ui/demo-badge";
import { SectionHeading } from "@/components/ui/section-heading";
import { contactChannels } from "@/config/contact";
import { siteConfig } from "@/config/site";

type ContactSectionProps = {
  /** `preview` hides the venue block and shows fewer details on the home page. */
  variant?: "full" | "preview";
};

export function ContactSection({ variant = "full" }: ContactSectionProps) {
  const isPreview = variant === "preview";

  return (
    <Section id="contact">
      <Container className="flex flex-col gap-10">
        <SectionHeading
          eyebrow="Contact"
          title="Questions before you book?"
          description="Reach the organiser directly on WhatsApp, phone or email. A contact form is added in a later step once messages have a place to go."
        />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {contactChannels.map((channel) => (
            <ContactCard key={channel.id} channel={channel} />
          ))}
        </div>

        {isPreview ? null : (
          <div className="border-border bg-surface/50 grid gap-6 rounded-2xl border p-6 lg:grid-cols-2">
            <div className="flex flex-col gap-3">
              <h3 className="flex items-center gap-2.5 text-base font-semibold">
                <MapPinIcon className="text-marigold size-5" />
                Venue &amp; directions
              </h3>
              <address className="text-muted text-sm/6 not-italic">
                {siteConfig.contact.addressLines.map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
              </address>
              <p className="text-muted text-sm/6">
                A map embed is added once the final venue is confirmed — we will not publish a
                location we have not verified.
              </p>
              <WhatsAppButton
                variant="full"
                size="sm"
                className="mt-1 w-fit"
                message="Hi! I need directions to the venue."
              />
            </div>

            <div
              className="border-border/80 from-violet/15 to-navy/25 flex min-h-44 items-center justify-center rounded-xl border bg-gradient-to-br p-6 text-center"
              role="img"
              aria-label="Map placeholder — venue location will be embedded here"
            >
              <p className="text-muted max-w-xs text-sm/6">
                Map embed placeholder
                <span className="mt-1 block text-xs">
                  Connect the venue coordinates with the event record in the database step.
                </span>
              </p>
            </div>
          </div>
        )}

        <DemoBadge label="Demo contact details — replace before launch" className="w-fit" />
      </Container>
    </Section>
  );
}
