import { PageHeroSkeleton, CardGridSkeleton } from "@/components/ui/skeleton";

/** Shown while the event record that supplies the contact channels loads. */
export default function ContactLoading() {
  return (
    <>
      <PageHeroSkeleton />
      <div aria-busy="true">
        <span className="sr-only">Loading contact details…</span>
        <CardGridSkeleton count={3} />
      </div>
    </>
  );
}
