import { Button } from "@/components/ui/button";
import { Container, Section } from "@/components/ui/container";

export default function NotFound() {
  return (
    <Section>
      <Container className="flex flex-col items-center gap-6 text-center">
        <p className="text-marigold font-mono text-sm font-semibold tracking-widest uppercase">
          404
        </p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          This page has left the dance floor
        </h1>
        <p className="text-muted max-w-md text-base/7">
          The page you were looking for does not exist or has been moved.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button href="/">Back to home</Button>
          <Button href="/events" variant="secondary">
            Browse events
          </Button>
        </div>
      </Container>
    </Section>
  );
}
