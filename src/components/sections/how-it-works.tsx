import { Card } from "@/components/ui/card";
import { Container, Section } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";

const steps = [
  {
    title: "Find a night near you",
    body: "Browse published Navratri and Dandiya events with their date, venue and organiser details.",
  },
  {
    title: "Choose your passes",
    body: "Pick the pass type and quantity the organiser has made available for that event.",
  },
  {
    title: "Pay and get confirmed",
    body: "Checkout through Razorpay. Your booking is stored and shown under your account.",
  },
] as const;

export function HowItWorks() {
  return (
    <Section id="how-it-works" className="scroll-mt-20">
      <Container className="flex flex-col gap-12">
        <SectionHeading
          eyebrow="How it works"
          title="Three steps from invite to dance floor"
          description="The flow below is what this project is being built to do. The booking, payment and account steps are wired up in the next steps of the build."
        />

        <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step.title}>
              <Card className="flex h-full flex-col gap-3">
                <span className="text-marigold font-mono text-sm font-semibold">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="text-lg font-semibold tracking-tight">{step.title}</h3>
                <p className="text-muted text-sm/6">{step.body}</p>
              </Card>
            </li>
          ))}
        </ol>
      </Container>
    </Section>
  );
}
