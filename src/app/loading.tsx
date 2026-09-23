import { PageHeroSkeleton, CardGridSkeleton } from "@/components/ui/skeleton";

/** Shown while the featured event, its nights and the gallery load. */
export default function HomeLoading() {
  return (
    <>
      <PageHeroSkeleton />
      <div aria-busy="true">
        <span className="sr-only">Loading event details…</span>
        <CardGridSkeleton count={5} />
      </div>
    </>
  );
}
