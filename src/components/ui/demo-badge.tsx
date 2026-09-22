import { cn } from "@/lib/utils";

type DemoBadgeProps = {
  /** Copy explaining what is still placeholder content. */
  label?: string;
  className?: string;
};

/**
 * Marks content that is not yet backed by the database.
 *
 * Showing this beats hiding it: the site never implies that demo prices or
 * dates are live event data. Remove the component from a section once that
 * section reads real data from Supabase.
 */
export function DemoBadge({
  label = "Demo content — will load from the database",
  className,
}: DemoBadgeProps) {
  return (
    <span
      className={cn(
        "border-border bg-surface/80 text-muted inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[0.6875rem] font-medium tracking-wide backdrop-blur",
        className,
      )}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-marigold" />
      {label}
    </span>
  );
}
