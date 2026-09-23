import { Skeleton } from "@/components/ui/skeleton";

/** Shown while the event, venue and deployment values load. */
export default function SettingsLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <span className="sr-only">Loading the event settings…</span>

      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>

      {Array.from({ length: 2 }).map((_, index) => (
        <div key={index} className="border-border bg-surface/50 flex flex-col gap-3 rounded-2xl border p-5">
          <Skeleton className="h-4 w-32" />
          {Array.from({ length: 4 }).map((__, row) => (
            <Skeleton key={row} className="h-4 w-full" />
          ))}
        </div>
      ))}
    </div>
  );
}
