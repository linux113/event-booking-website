import { GalleryTile } from "@/components/events/gallery-tile";
import { Button } from "@/components/ui/button";
import { Container, Section } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeading } from "@/components/ui/section-heading";
import type { GalleryItem, SiteContent } from "@/types";

type GalleryPreviewProps = {
  items: readonly GalleryItem[];
  /** Organiser-edited gallery title/intro; null/empty fields fall back to the defaults. */
  content: SiteContent;
};

/** Home-page gallery teaser, fed by the `gallery` table. */
export function GalleryPreview({ items, content }: GalleryPreviewProps) {
  const [feature, ...rest] = items;

  return (
    <Section id="gallery">
      <Container className="flex flex-col gap-10">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <SectionHeading
            eyebrow="Gallery"
            title={content.galleryTitle ?? "Nights we are still talking about"}
            description={
              content.galleryIntro ??
              "Photos and videos are published here by the organiser after each night."
            }
          />
          <Button href="/gallery" variant="secondary" className="sm:self-end">
            Open full gallery
          </Button>
        </div>

        {feature ? (
          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <GalleryTile item={feature} size="feature" />

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {rest.map((item) => (
                <GalleryTile key={item.id} item={item} />
              ))}
            </div>
          </div>
        ) : (
          <EmptyState
            title="No photos published yet"
            description="The gallery fills up as soon as the organiser publishes images from the event. Nothing is shown until real photos exist — no placeholder stock."
            action={
              <Button href="/contact" variant="secondary" size="sm">
                Ask about the event
              </Button>
            }
          />
        )}
      </Container>
    </Section>
  );
}
