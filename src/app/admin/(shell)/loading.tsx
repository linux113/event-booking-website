import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown while the dashboard's four aggregates are in flight.
 *
 * The skeleton is shaped like the page it replaces — a grid of statistic cards, a
 * pair of charts, the distribution, and a table — so the layout does not jump when the
 * numbers arrive. It is sized for a phone as well as a desktop, because the first
 * paint on a venue's wifi is usually a phone.
 *
 * The whole region is `aria-busy` with a screen-reader sentence, and the placeholder
 * blocks themselves are `aria-hidden` (see `Skeleton`), so nobody is read a wall of
 * grey rectangles.
 */
export default function AdminHomeLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <span className="sr-only">Loading the dashboard…</span>

      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="border-border bg-surface/50 flex flex-col gap-3 rounded-2xl border p-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-20" />
            <Skeleton className="h-3 w-full" />
          </div>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="border-border bg-surface/50 flex flex-col gap-4 rounded-2xl border p-5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-64 max-w-full" />
            <Skeleton className="h-36 w-full rounded-xl" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>

      <div className="border-border bg-surface/50 flex flex-col gap-3 rounded-2xl border p-5">
        <Skeleton className="h-4 w-36" />
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="flex items-center gap-4">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="hidden h-4 w-32 sm:block" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}
