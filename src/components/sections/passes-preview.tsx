import { PassCard } from "@/components/events/pass-card";
import { Button } from "@/components/ui/button";
import { Container, Section } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import type { PassOption } from "@/types";

type PassesPreviewProps = {
  passes: readonly PassOption[];
};

/** Home-page pass grid, straight from `pass_categories`. */
export function PassesPreview({ passes }: PassesPreviewProps) {
  if (passes.length === 0) {
    return null;
  }

  const bookable = passes.filter((pass) => pass.availability.enabled);

  return (
    <Section id="passes">
      <Container className="flex flex-col gap-10">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <SectionHeading
            eyebrow="Passes"
            title="Pick the pass that fits your group"
            description={
              bookable.length > 0
                ? `${passes.length} ways to enter — from a pair of friends to the whole family.`
                : "Passes for this event are not on sale at the moment."
            }
          />
          <Button href="/passes" variant="secondary" className="sm:self-end">
            Compare all passes
          </Button>
        </div>

        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {passes.map((pass) => (
            <li key={pass.id} className="h-full">
              <PassCard pass={pass} variant="preview" />
            </li>
          ))}
        </ul>
      </Container>
    </Section>
  );
}
