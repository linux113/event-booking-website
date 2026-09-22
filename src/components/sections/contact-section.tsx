import { ContactCard } from "@/components/contact/contact-card";
import { MapPinIcon } from "@/components/icons";
import { WhatsAppButton } from "@/components/layout/whatsapp-button";
import { Container, Section } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { buildContactChannels } from "@/config/contact";
import type { EventSummary } from "@/types";

type ContactSectionProps = {
  /** `preview` hides the venue block on the home page. */
  variant?: "full" | "preview";
  /** When present, its contact details take precedence over the site-level ones. */
  event?: EventSummary;
};

export function ContactSection({ variant = "full", event }: ContactSectionProps) {
  const isPreview = variant === "preview";
  const channels = buildContactChannels(event);

  return (
    <Section id="contact">
      <Container className="flex flex-col gap-10">
        <SectionHeading
          eyebrow="Contact"
          title="Questions before you book?"
          description="Reach the organiser directly on WhatsApp, phone or email. A contact form is added in a later step once messages have a place to go."
        />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {channels.map((channel) => (
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
                {[event?.venueName, event?.venueAddress, event?.city, event?.state]
                  .filter(Boolean)
                  .map((line) => (
                    <span key={line} className="block">
                      {line}
                    </span>
                  ))}
                {event ? null : <span className="block">Venue to be confirmed</span>}
              </address>
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
              aria-label="Map placeholder — the venue map will be embedded here"
            >
              <p className="text-muted max-w-xs text-sm/6">
                {event?.mapsUrl
                  ? "Open the venue in Google Maps from the link above."
                  : "The venue map is published once the organiser confirms the location."}
              </p>
            </div>
          </div>
        )}
      </Container>
    </Section>
  );
}
