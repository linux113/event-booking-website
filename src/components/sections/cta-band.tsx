import { WhatsAppButton } from "@/components/layout/whatsapp-button";
import { Button } from "@/components/ui/button";
import { Container, Section } from "@/components/ui/container";
import { buildSiteContact, type SiteContact } from "@/lib/contact";

type CtaBandProps = {
  title?: string;
  description?: string;
  /** Overrides the primary button label. */
  bookLabel?: string;
  /**
   * The event's contact details, when the page already has them, so the button opens the
   * event's own WhatsApp number. Without one the deployment-level fallback is used, and
   * if that is empty too there is no button rather than a guessed number.
   */
  contact?: SiteContact | null;
};

/** Closing call to action reused at the bottom of every public page. */
export function CtaBand({
  title = "Ready to dance all nine nights?",
  description = "Reserve your pass before a night sells out. Checkout will be handled by Razorpay once the booking step is live.",
  bookLabel = "Book Now",
  contact = null,
}: CtaBandProps) {
  return (
    <Section className="pt-4">
      <Container>
        <div className="border-border relative overflow-hidden rounded-3xl border bg-gradient-to-br from-navy via-surface to-[#2a1055] px-6 py-12 text-center shadow-2xl shadow-black/40 sm:px-12">
          <div
            aria-hidden="true"
            className="from-marigold/25 via-rani/15 pointer-events-none absolute inset-0 bg-gradient-to-tr to-transparent"
          />

          <div className="relative flex flex-col items-center gap-5">
            <h2 className="text-2xl font-bold tracking-tight text-balance sm:text-3xl">{title}</h2>
            <p className="text-muted max-w-xl text-sm/7 sm:text-base/7">{description}</p>

            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <Button href="/book" size="lg" className="w-full sm:w-auto">
                {bookLabel}
              </Button>
              <Button href="/passes" variant="secondary" size="lg" className="w-full sm:w-auto">
                View Passes
              </Button>
              <WhatsAppButton
                href={(contact ?? buildSiteContact(null)).whatsappHref}
                variant="full"
                size="lg"
                className="w-full sm:w-auto"
              />
            </div>
          </div>
        </div>
      </Container>
    </Section>
  );
}
