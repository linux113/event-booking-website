import droneImage from "@/assets/images/gallery-drone-aerial.jpg";
import dancersImage from "@/assets/images/gallery-dancers-silhouette.jpg";
import decorImage from "@/assets/images/gallery-marigold-decor.jpg";
import stageImage from "@/assets/images/gallery-stage-led.jpg";
import type { GalleryItem } from "@/types";

/**
 * ⚠️ DEMO CONTENT — placeholder visuals.
 *
 * These are original illustrations generated for this project (no photographs of
 * people, no third-party artwork). They stand in for the real event photographs
 * that will be uploaded to Supabase Storage and listed here after the first night.
 */
export const demoGallery: readonly GalleryItem[] = [
  {
    id: "stage",
    src: stageImage,
    alt: "Illustration of an empty festival stage with a glowing LED wall, truss lighting and marigold garlands",
    caption: "Main stage & LED wall",
    tag: "Stage",
  },
  {
    id: "dancers",
    src: dancersImage,
    alt: "Illustration of garba dancers shown only as silhouettes against magenta and gold stage lights",
    caption: "Garba circles in full swing",
    tag: "Performers",
  },
  {
    id: "drone",
    src: droneImage,
    alt: "Abstract aerial illustration of a circular garba dance formation lit in magenta and blue",
    caption: "Aerial view of the dance floor",
    tag: "Drone",
  },
  {
    id: "decor",
    src: decorImage,
    alt: "Close-up illustration of marigold garlands, lit clay diyas and magenta silk drapes",
    caption: "Marigold & diya decor",
    tag: "Decor",
  },
] satisfies readonly GalleryItem[];
