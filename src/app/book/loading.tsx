import { Container, Section } from "@/components/ui/container";
import { PageHeroSkeleton, Skeleton } from "@/components/ui/skeleton";

/** Shown while nights and their availability load from the database. */
export default function BookLoading() {
  return (
    <>
      <PageHeroSkeleton />
      <Section className="pt-0" aria-busy="true">
        <Container>
          <span className="sr-only">Loading available nights…</span>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 9 }).map((_, index) => (
              <div
                key={index}
                className="border-border bg-surface/50 flex flex-col gap-3 rounded-2xl border p-4"
              >
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-28" />
              </div>
            ))}
          </div>
        </Container>
      </Section>
    </>
  );
}
