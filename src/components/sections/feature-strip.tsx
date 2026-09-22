import { featureIcons } from "@/components/icons";
import { Container, Section } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { demoFeatures } from "@/config/features";

/**
 * What is included at the event: anchor, gorilla dancer, videographer, drone,
 * LED wall and DJ. Icon + label come from the same `Feature` type the admin
 * dashboard will write to later.
 */
export function FeatureStrip() {
  return (
    <Section className="pt-6 sm:pt-8">
      <Container className="flex flex-col gap-8">
        <SectionHeading
          eyebrow="What's included"
          title="Everything you need for a full night"
          description="Production and entertainment built into every event night."
          align="center"
        />

        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {demoFeatures.map((feature) => {
            const FeatureIcon = featureIcons[feature.id];

            return (
              <li key={feature.id}>
                <div className="border-border bg-surface/60 hover:border-marigold/40 flex h-full flex-col items-center gap-3 rounded-2xl border px-4 py-6 text-center transition-colors duration-200">
                  <span className="from-violet/30 to-rani/20 text-marigold-soft ring-border/80 flex size-12 items-center justify-center rounded-xl bg-gradient-to-br ring-1">
                    <FeatureIcon className="size-6" />
                  </span>
                  <span className="text-sm font-semibold tracking-tight text-balance">
                    {feature.label}
                  </span>
                  <span className="text-muted hidden text-xs/5 sm:block">{feature.description}</span>
                </div>
              </li>
            );
          })}
        </ul>
      </Container>
    </Section>
  );
}
