import type { PromoVideo } from "@/types";

/**
 * Promo video slots for the gallery page.
 *
 * Deliberately URL-less: the UI renders an explicit "coming soon" state instead
 * of embedding someone else's video or a placeholder file. The organiser fills
 * `url` in (or, later, a row in the database) and the embed activates.
 */
export const demoPromoVideos: readonly PromoVideo[] = [
  {
    id: "aftermovie",
    title: "Festival aftermovie",
    description: "A two-minute cut of the best moments from all nine nights.",
    platform: "YouTube",
  },
  {
    id: "drone-reel",
    title: "Drone highlights reel",
    description: "Aerial footage of the circles forming on the main ground.",
    platform: "Instagram",
  },
  {
    id: "garba-basics",
    title: "Garba steps for beginners",
    description: "A short tutorial so first-timers can join the circle confidently.",
    platform: "WhatsApp",
  },
] satisfies readonly PromoVideo[];
