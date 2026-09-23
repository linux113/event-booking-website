import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/utils";

type BadgeVariant = "marigold" | "rani" | "neutral";

const variantStyles: Record<BadgeVariant, string> = {
  marigold: "border-marigold/30 bg-marigold/10 text-marigold-soft",
  rani: "border-rani/30 bg-rani/10 text-rani-soft",
  neutral: "border-border bg-surface-raised/60 text-muted",
};

type BadgeProps = ComponentPropsWithoutRef<"span"> & {
  variant?: BadgeVariant;
};

export function Badge({ variant = "marigold", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold tracking-wide uppercase",
        variantStyles[variant],
        className,
      )}
      {...props}
    />
  );
}
