import { CardGridSkeleton, PageHeroSkeleton } from "@/components/ui/skeleton";

/** Shown while pass categories and availability load from the database. */
export default function PassesLoading() {
  return (
    <>
      <PageHeroSkeleton />
      <div aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading passes…</span>
        <CardGridSkeleton count={5} />
      </div>
    </>
  );
}
