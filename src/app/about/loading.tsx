import { PageHeroSkeleton, CardGridSkeleton } from "@/components/ui/skeleton";

/** Shown while the event record and its highlights load from the database. */
export default function AboutLoading() {
  return (
    <>
      <PageHeroSkeleton />
      <div aria-busy="true">
        <span className="sr-only">Loading event details…</span>
        <CardGridSkeleton count={3} />
      </div>
    </>
  );
}
