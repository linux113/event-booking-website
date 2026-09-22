import { GalleryTile } from "@/components/events/gallery-tile";
import { Button } from "@/components/ui/button";
import { Container, Section } from "@/components/ui/container";
import { DemoBadge } from "@/components/ui/demo-badge";
import { SectionHeading } from "@/components/ui/section-heading";
import { demoGallery } from "@/config/gallery";

/** Home-page gallery teaser. `/gallery` shows the full set and video slots. */
export function GalleryPreview() {
  const [feature, ...rest] = demoGallery;

  return (
    <Section id="gallery">
      <Container className="flex flex-col gap-10">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <SectionHeading
            eyebrow="Gallery"
            title="Nights we are still talking about"
            description="Placeholder visuals today; real event photographs will be uploaded to storage after each night."
          />
          <Button href="/gallery" variant="secondary" className="sm:self-end">
            Open full gallery
          </Button>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          {feature ? <GalleryTile item={feature} size="feature" /> : null}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            {rest.map((item) => (
              <GalleryTile key={item.id} item={item} />
            ))}
          </div>
        </div>

        <DemoBadge label="Placeholder artwork — real event photos coming soon" className="w-fit" />
      </Container>
    </Section>
  );
}
