import { PageHeroSkeleton, CardGridSkeleton } from "@/components/ui/skeleton";

/** Shown while published events and their nights load. */
export default function EventsLoading() {
  return (
    <>
      <PageHeroSkeleton />
      <div aria-busy="true">
        <span className="sr-only">Loading events…</span>
        <CardGridSkeleton count={3} />
      </div>
    </>
  );
}
