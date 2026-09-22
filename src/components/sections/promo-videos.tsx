import { PlayIcon } from "@/components/icons";
import { Container, Section } from "@/components/ui/container";
import { DemoBadge } from "@/components/ui/demo-badge";
import { SectionHeading } from "@/components/ui/section-heading";
import { demoPromoVideos } from "@/config/promos";

/**
 * Video slots. A slot only becomes an embed once `url` is set on the record, so
 * the page never shows a broken player or someone else's footage.
 */
export function PromoVideos() {
  return (
    <Section className="pt-0">
      <Container className="flex flex-col gap-8">
        <SectionHeading
          eyebrow="Watch"
          title="Video highlights"
          description="Video slots are ready — they activate as soon as the organiser supplies the links or uploads the files."
        />

        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {demoPromoVideos.map((video) => (
            <li key={video.id}>
              <article className="border-border bg-surface/60 flex h-full flex-col gap-3 rounded-2xl border p-5">
                <span className="from-navy/60 to-violet/30 text-muted/80 flex aspect-16/9 items-center justify-center rounded-xl bg-gradient-to-br">
                  <PlayIcon className="size-8" />
                </span>

                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold tracking-tight">{video.title}</h3>
                  <span className="border-border text-muted rounded-full border px-2.5 py-0.5 text-[0.6875rem] font-semibold">
                    {video.platform}
                  </span>
                </div>

                <p className="text-muted text-sm/6">{video.description}</p>

                <p className="text-muted/80 mt-auto text-xs">
                  Coming soon — no video attached yet.
                </p>
              </article>
            </li>
          ))}
        </ul>

        <DemoBadge label="Video slots are empty by design — nothing is faked" className="w-fit" />
      </Container>
    </Section>
  );
}
