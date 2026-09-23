import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/utils";

export function Card({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-surface/80 p-6 shadow-xl shadow-black/20 backdrop-blur",
        className,
      )}
      {...props}
    />
  );
}
