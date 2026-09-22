import { Container, Section } from "@/components/ui/container";
import { PageHeroSkeleton, Skeleton } from "@/components/ui/skeleton";

/** Shown while published gallery media loads from the database. */
export default function GalleryLoading() {
  return (
    <>
      <PageHeroSkeleton />
      <Section className="pt-0" aria-busy="true">
        <Container className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
          <span className="sr-only">Loading gallery…</span>
          <Skeleton className="aspect-4/3 w-full rounded-2xl" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <Skeleton className="aspect-4/3 w-full rounded-2xl" />
            <Skeleton className="aspect-4/3 w-full rounded-2xl" />
          </div>
        </Container>
      </Section>
    </>
  );
}
