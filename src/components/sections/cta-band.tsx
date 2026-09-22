import { WhatsAppButton } from "@/components/layout/whatsapp-button";
import { Button } from "@/components/ui/button";
import { Container, Section } from "@/components/ui/container";

type CtaBandProps = {
  title?: string;
  description?: string;
  /** Overrides the primary button label. */
  bookLabel?: string;
};

/** Closing call to action reused at the bottom of every public page. */
export function CtaBand({
  title = "Ready to dance all nine nights?",
  description = "Reserve your pass before a night sells out. Checkout will be handled by Razorpay once the booking step is live.",
  bookLabel = "Book Now",
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
              <WhatsAppButton variant="full" size="lg" className="w-full sm:w-auto" />
            </div>
          </div>
        </div>
      </Container>
    </Section>
  );
}
