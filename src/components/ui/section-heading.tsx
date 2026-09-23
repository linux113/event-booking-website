import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type SectionHeadingProps = {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  align?: "left" | "center";
  headingLevel?: "h1" | "h2" | "h3";
  className?: string;
};

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "left",
  headingLevel: Heading = "h2",
  className,
}: SectionHeadingProps) {
  const isCentered = align === "center";

  return (
    <div
      className={cn(
        "flex flex-col gap-4",
        isCentered ? "items-center text-center" : "items-start",
        className,
      )}
    >
      {eyebrow ? <Badge variant="rani">{eyebrow}</Badge> : null}
      <Heading className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
        {title}
      </Heading>
      {description ? (
        <p className={cn("text-muted max-w-2xl text-base/7", isCentered && "mx-auto")}>
          {description}
        </p>
      ) : null}
    </div>
  );
}
