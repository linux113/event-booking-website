import { cn } from "@/lib/utils";

/**
 * Loading placeholders used by route-level `loading.tsx` files while the
 * database round-trip is in flight. Marked `aria-hidden` so screen readers are
 * not read a wall of empty boxes; the surrounding region announces "Loading…".
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("bg-surface-raised/70 block animate-pulse rounded-lg", className)}
    />
  );
}

/** A page hero placeholder: eyebrow, title and two lines of copy. */
export function PageHeroSkeleton() {
  return (
    <div className="py-16 sm:py-20 lg:py-24">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-5">
          <Skeleton className="h-6 w-28 rounded-full" />
          <Skeleton className="h-10 w-full max-w-xl" />
          <Skeleton className="h-5 w-full max-w-2xl" />
          <Skeleton className="h-5 w-3/4 max-w-xl" />
        </div>
      </div>
    </div>
  );
}

/** A row of card placeholders, sized like the pass/night grids. */
export function CardGridSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="mx-auto w-full max-w-6xl px-5 sm:px-6 lg:px-8">
      <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: count }).map((_, index) => (
          <li key={index}>
            <div className="border-border bg-surface/50 flex flex-col gap-4 rounded-2xl border p-6">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-9 w-28" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-11 w-full rounded-full" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
