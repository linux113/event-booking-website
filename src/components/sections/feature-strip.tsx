import { getFeatureIcon } from "@/components/icons";
import { Container, Section } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import type { EventFeature } from "@/types";

type FeatureStripProps = {
  features: readonly EventFeature[];
};

/**
 * Production inclusions for the featured event, read from `event_features`.
 * The icon is resolved from the row's `code`, with a fallback for new codes.
 */
export function FeatureStrip({ features }: FeatureStripProps) {
  if (features.length === 0) {
    return null;
  }

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
          {features.map((feature) => {
            const FeatureIcon = getFeatureIcon(feature.code);

            return (
              <li key={feature.id}>
                <div className="border-border bg-surface/60 hover:border-marigold/40 flex h-full flex-col items-center gap-3 rounded-2xl border px-4 py-6 text-center transition-colors duration-200">
                  <span className="from-violet/30 to-rani/20 text-marigold-soft ring-border/80 flex size-12 items-center justify-center rounded-xl bg-gradient-to-br ring-1">
                    <FeatureIcon className="size-6" />
                  </span>
                  <span className="text-sm font-semibold tracking-tight text-balance">
                    {feature.label}
                  </span>
                  {feature.description ? (
                    <span className="text-muted hidden text-xs/5 sm:block">
                      {feature.description}
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </Container>
    </Section>
  );
}
