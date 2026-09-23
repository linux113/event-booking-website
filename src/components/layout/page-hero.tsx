import type { ReactNode } from "react";

import { Container, Section } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";

type PageHeroProps = {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  /** Buttons or extra content rendered under the heading. */
  children?: ReactNode;
};

/** Shared header block for the inner pages, so they match the home hero. */
export function PageHero({ eyebrow, title, description, children }: PageHeroProps) {
  return (
    <Section className="relative overflow-hidden pb-8 sm:pb-10">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="bg-navy-soft/30 absolute -top-32 left-1/4 size-[26rem] rounded-full blur-3xl" />
        <div className="bg-rani/15 absolute -top-16 right-0 size-[20rem] rounded-full blur-3xl" />
      </div>

      <Container className="flex flex-col gap-6">
        <SectionHeading
          eyebrow={eyebrow}
          headingLevel="h1"
          title={title}
          description={description}
        />
        {children}
      </Container>
    </Section>
  );
}
