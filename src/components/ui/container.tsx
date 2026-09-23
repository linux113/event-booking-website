import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Centred, responsive page gutter. Every page section should be wrapped in one. */
export function Container({ className, children, ...props }: ComponentPropsWithoutRef<"div">) {
  return (
    <div className={cn("mx-auto w-full max-w-6xl px-5 sm:px-6 lg:px-8", className)} {...props}>
      {children}
    </div>
  );
}

type SectionProps<T extends ElementType> = {
  as?: T;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "children">;

/** Vertical rhythm wrapper for page sections. */
export function Section<T extends ElementType = "section">({
  as,
  className,
  children,
  ...props
}: SectionProps<T>) {
  const Component = (as ?? "section") as ElementType;

  return (
    <Component className={cn("py-16 sm:py-20 lg:py-24", className)} {...props}>
      {children}
    </Component>
  );
}
