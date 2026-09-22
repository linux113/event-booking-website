import { Skeleton } from "@/components/ui/skeleton";

/** Shown while a booking lookup is in flight. */
export default function BookingsLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <span className="sr-only">Loading the booking lookup…</span>

      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>

      <Skeleton className="h-11 w-full rounded-xl" />

      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="border-border bg-surface/50 flex flex-col gap-3 rounded-2xl border p-4">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-56 max-w-full" />
            <Skeleton className="h-4 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
