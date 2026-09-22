import { PassCard } from "@/components/events/pass-card";
import { Button } from "@/components/ui/button";
import { Container, Section } from "@/components/ui/container";
import { DemoBadge } from "@/components/ui/demo-badge";
import { SectionHeading } from "@/components/ui/section-heading";
import { demoPasses } from "@/config/passes";

/** Home-page pass grid. The full comparison table lives on `/passes`. */
export function PassesPreview() {
  return (
    <Section id="passes">
      <Container className="flex flex-col gap-10">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <SectionHeading
            eyebrow="Passes"
            title="Pick the pass that fits your group"
            description="Five ways to enter — from a pair of friends to the whole family."
          />
          <div className="flex flex-col items-start gap-3 sm:items-end">
            <Button href="/passes" variant="secondary">
              Compare all passes
            </Button>
            <DemoBadge label="Demo prices — will load from the database" />
          </div>
        </div>

        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {demoPasses.map((pass) => (
            <li key={pass.id} className="h-full">
              <PassCard pass={pass} variant="preview" />
            </li>
          ))}
        </ul>
      </Container>
    </Section>
  );
}
