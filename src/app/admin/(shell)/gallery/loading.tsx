import { Skeleton } from "@/components/ui/skeleton";

/** Shown while the gallery rows are read: the counts first, then the photos. */
export default function Loading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <span className="sr-only">Loading the gallery…</span>

      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-4 w-full max-w-2xl" />
      </div>

      <Skeleton className="h-40 w-full rounded-2xl" />

      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-40 w-full rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
