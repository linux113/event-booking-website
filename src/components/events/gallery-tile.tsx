import Image from "next/image";

import { cn } from "@/lib/utils";
import type { GalleryItem } from "@/types";

type GalleryTileProps = {
  item: GalleryItem;
  /** `feature` tiles are larger and span more grid columns on wide screens. */
  size?: "default" | "feature";
  /** Rendered above the fold on a listing page. */
  priority?: boolean;
  className?: string;
};

export function GalleryTile({ item, size = "default", priority = false, className }: GalleryTileProps) {
  const isFeature = size === "feature";

  return (
    <figure
      className={cn(
        "group border-border relative overflow-hidden rounded-2xl border",
        isFeature ? "aspect-4/3 sm:aspect-16/10 lg:aspect-4/3" : "aspect-4/3",
        className,
      )}
    >
      <Image
        src={item.src}
        alt={item.alt}
        fill
        priority={priority}
        sizes={isFeature ? "(max-width: 1024px) 100vw, 60vw" : "(max-width: 640px) 100vw, 40vw"}
        className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
      />

      <div
        aria-hidden="true"
        className="from-night/90 absolute inset-0 bg-gradient-to-t via-night/25 to-transparent"
      />

      <figcaption className="absolute inset-x-0 bottom-0 flex flex-col gap-1 p-4">
        <span className="text-marigold-soft text-[0.6875rem] font-semibold tracking-widest uppercase">
          {item.tag}
        </span>
        <span className="text-sm font-semibold text-balance">{item.caption}</span>
      </figcaption>
    </figure>
  );
}
