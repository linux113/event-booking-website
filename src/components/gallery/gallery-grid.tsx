"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import type { GalleryItem } from "@/types";

/**
 * The public gallery: a responsive grid, and a lightbox that opens a photo full size.
 *
 * Three decisions worth naming:
 *
 *   * **The grid loads thumbnails, not photographs.** When a row has a stored
 *     thumbnail, the tile asks for that; the full image is only fetched when somebody
 *     opens the lightbox. Combined with `loading="lazy"` and `sizes`, a visitor on a
 *     phone pays for the pictures they actually look at.
 *   * **It is keyboard-first.** Every tile is a button, `Enter` opens, the lightbox
 *     takes focus, `Escape` closes and focus returns to the tile that opened it,
 *     `←`/`→` move between photos. A gallery that can only be driven by a mouse is a
 *     gallery half the audience cannot read.
 *   * **Space is reserved before the bytes arrive.** Rows carry the stored image's
 *     width and height, so the tiles keep their shape while loading instead of
 *     reflowing under the reader's thumb.
 */
export function GalleryGrid({ items }: { items: readonly GalleryItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const tileRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openedFrom = useRef<number | null>(null);

  const close = useCallback(() => {
    setOpenIndex(null);

    // Give focus back to the tile the visitor came from, not to the top of the page.
    const index = openedFrom.current;

    if (index !== null) {
      tileRefs.current[index]?.focus();
    }
  }, []);

  const step = useCallback(
    (delta: number) => {
      setOpenIndex((current) => {
        if (current === null || items.length === 0) {
          return current;
        }

        return (current + delta + items.length) % items.length;
      });
    },
    [items.length],
  );

  useEffect(() => {
    if (openIndex === null) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      } else if (event.key === "ArrowRight") {
        step(1);
      } else if (event.key === "ArrowLeft") {
        step(-1);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    closeRef.current?.focus();

    // The page behind the lightbox must not scroll while it is open.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [openIndex, close, step]);

  const active = openIndex === null ? null : items[openIndex];

  return (
    <>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
        {items.map((item, index) => {
          const feature = index === 0;
          const tile = item.thumbnailSrc ?? item.src;

          return (
            <li key={item.id} className={cn(feature && "col-span-2 row-span-2")}>
              <button
                ref={(element) => {
                  tileRefs.current[index] = element;
                }}
                type="button"
                onClick={() => {
                  openedFrom.current = index;
                  setOpenIndex(index);
                }}
                aria-label={`Open “${item.caption}”${item.mediaType === "video" ? " (video)" : ""} — larger view`}
                className={cn(
                  "group border-border focus-visible:ring-marigold/40 relative block h-full w-full overflow-hidden rounded-2xl border focus-visible:ring-2 focus-visible:outline-none",
                  feature ? "aspect-4/3 sm:aspect-16/10" : "aspect-4/3",
                )}
              >
                <Image
                  src={tile}
                  alt={item.alt}
                  fill
                  // The first tile is the one above the fold: it is fetched eagerly.
                  // Everything else is left to the browser, which lazy-loads offscreen
                  // images by default — and `sizes` tells it which width to ask for.
                  priority={feature}
                  sizes={
                    feature
                      ? "(max-width: 640px) 100vw, (max-width: 1024px) 66vw, 50vw"
                      : "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                  }
                  className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                />

                <span
                  aria-hidden="true"
                  className="from-night/90 via-night/25 absolute inset-0 bg-gradient-to-t to-transparent"
                />

                {item.mediaType === "video" ? (
                  <span className="bg-night/70 absolute top-3 right-3 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.625rem] font-semibold tracking-widest text-white uppercase">
                    <span aria-hidden="true">▶</span> Video
                  </span>
                ) : null}

                <span className="absolute inset-x-0 bottom-0 flex flex-col gap-1 p-3 text-left sm:p-4">
                  <span className="text-marigold-soft text-[0.625rem] font-semibold tracking-widest uppercase">
                    {item.tag}
                  </span>
                  <span className={cn("text-balance font-semibold", feature ? "text-base sm:text-lg" : "text-sm")}>
                    {item.caption}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {active ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={active.caption}
          className="bg-night/95 fixed inset-0 z-50 flex flex-col"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              close();
            }
          }}
        >
          <div className="flex items-center justify-between gap-4 px-4 py-3 sm:px-6">
            <span className="text-muted text-xs font-semibold tracking-widest uppercase">
              {openIndex === null ? 0 : openIndex + 1} / {items.length}
            </span>

            <button
              ref={closeRef}
              type="button"
              onClick={close}
              className="focus-visible:ring-marigold/40 inline-flex h-10 items-center rounded-full border border-white/20 px-4 text-sm font-semibold text-white focus-visible:ring-2 focus-visible:outline-none"
            >
              Close
            </button>
          </div>

          <div className="flex min-h-0 flex-1 items-center justify-center px-2 sm:px-6">
            {active.mediaType === "video" ? (
              <div className="flex max-w-3xl flex-col items-center gap-4 text-center">
                <p className="text-sm text-white/80">
                  This item is a video. It plays in a new tab so the gallery stays open here.
                </p>
                <a
                  href={active.src}
                  target="_blank"
                  rel="noreferrer"
                  className="focus-visible:ring-marigold/40 rounded-full border border-white/25 px-5 py-2.5 text-sm font-semibold text-white focus-visible:ring-2 focus-visible:outline-none"
                >
                  Watch {active.caption}
                </a>
              </div>
            ) : (
              <Image
                key={active.id}
                src={active.src}
                alt={active.alt}
                width={active.width ?? 1600}
                height={active.height ?? 1200}
                sizes="100vw"
                className="max-h-full w-auto max-w-full rounded-xl object-contain"
              />
            )}
          </div>

          <div className="flex items-center justify-between gap-4 px-4 py-4 sm:px-6">
            <button
              type="button"
              onClick={() => step(-1)}
              disabled={items.length < 2}
              className="focus-visible:ring-marigold/40 h-11 rounded-full border border-white/20 px-4 text-sm font-semibold text-white focus-visible:ring-2 focus-visible:outline-none disabled:opacity-40"
            >
              ← Previous
            </button>

            <p className="text-muted hidden max-w-lg truncate text-xs sm:block">{active.alt}</p>

            <button
              type="button"
              onClick={() => step(1)}
              disabled={items.length < 2}
              className="focus-visible:ring-marigold/40 h-11 rounded-full border border-white/20 px-4 text-sm font-semibold text-white focus-visible:ring-2 focus-visible:outline-none disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
