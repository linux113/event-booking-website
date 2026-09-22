import { Hero } from "@/components/sections/hero";
import { HowItWorks } from "@/components/sections/how-it-works";
import { UpcomingEvents } from "@/components/sections/upcoming-events";

export default function HomePage() {
  return (
    <>
      <Hero />
      <UpcomingEvents />
      <HowItWorks />
    </>
  );
}
