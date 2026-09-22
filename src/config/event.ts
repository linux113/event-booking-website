import heroImage from "@/assets/images/hero-festival.jpg";
import type { EventDetails, Highlight } from "@/types";

/**
 * ⚠️ DEMO CONTENT.
 *
 * The hero event and its highlights are hard-coded placeholders so the public UI
 * can be reviewed before the database exists. In the Supabase step this file is
 * deleted and the same values are read from the `events` table — pages already
 * consume the `EventDetails` shape, so only the data source changes.
 */
export const demoEvent: EventDetails = {
  name: "Garba Nights Navratri Utsav",
  tagline: "Nine nights of garba, dandiya and non-stop beats",
  dates: "11 – 19 October 2026",
  time: "7:00 PM onwards",
  venue: "Royal Garden Lawns",
  location: "Andheri West, Mumbai",
  image: heroImage,
  imageAlt:
    "Illustration of a decorated Navratri garba stage with marigold garlands, hanging lanterns and dandiya sticks",
} satisfies EventDetails;

export const demoHighlights: readonly Highlight[] = [
  {
    title: "Live dandiya & garba",
    description:
      "Traditional garba raas circles and dandiya rounds with live dhol, every night of the festival.",
  },
  {
    title: "All-night DJ set",
    description:
      "A Bollywood and Gujarati DJ set that keeps the floor moving after the live performance ends.",
  },
  {
    title: "Best dresser contest",
    description:
      "Daily prizes for the best chaniya choli, kediyu and duo outfits, judged by the crowd.",
  },
  {
    title: "Food & refreshment court",
    description:
      "Gujarati thali, chaat, falooda and mocktail stalls with seating away from the dance floor.",
  },
  {
    title: "Safe & family friendly",
    description:
      "Separate family section, medical desk, professional bouncers and trained floor marshals.",
  },
  {
    title: "Secure digital entry",
    description:
      "Every booking gets a QR entry pass. No paper tickets, no queue at the gate.",
  },
] satisfies readonly Highlight[];
