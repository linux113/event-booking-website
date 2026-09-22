import type { Feature } from "@/types";

/**
 * Production elements included at the event. Demo copy — the organiser will
 * manage these per event from the admin dashboard later.
 */
export const demoFeatures: readonly Feature[] = [
  {
    id: "anchor",
    label: "Girl Anchor",
    description: "Professional anchor hosting the games, contests and announcements.",
  },
  {
    id: "gorilla",
    label: "Gorilla Dancer",
    description: "Costumed crowd performer who leads the dandiya rounds and hypes the floor.",
  },
  {
    id: "videographer",
    label: "Videographer",
    description: "Full-night filming with an edited highlights reel after the festival.",
  },
  {
    id: "drone",
    label: "Drone Camera",
    description: "Aerial coverage of the garba circles and the stage, subject to local permissions.",
  },
  {
    id: "led-wall",
    label: "LED Wall",
    description: "Large LED backdrop for visuals, live scores and contest displays.",
  },
  {
    id: "dj",
    label: "DJ",
    description: "Resident DJ with a Gujarati, Bollywood and EDM set till close.",
  },
] satisfies readonly Feature[];
