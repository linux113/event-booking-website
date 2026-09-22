import { Button } from "@/components/ui/button";
import { Container, Section } from "@/components/ui/container";
import { siteConfig } from "@/config/site";

const seasonPoints = [
  "Garba & Dandiya nights from organisers across India",
  "Pass types and pricing set by the organiser",
  "Razorpay checkout with a confirmed booking record",
] as const;

export function Hero() {
  return (
    <Section className="relative overflow-hidden">
      {/* Decorative festive backdrop — pure CSS, no image payload. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="bg-marigold/20 absolute -top-40 -left-24 size-[28rem] rounded-full blur-3xl" />
        <div className="bg-rani/20 absolute -top-24 right-0 size-[22rem] rounded-full blur-3xl" />
        <div className="bg-peacock/10 absolute bottom-0 left-1/3 size-[20rem] rounded-full blur-3xl" />
      </div>

      <Container>
        <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="flex flex-col items-start gap-6">
            <span className="border-marigold/30 bg-marigold/10 text-marigold-soft inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold tracking-wide uppercase">
              Navratri season
            </span>

            <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl">
              Book your{" "}
              <span className="from-marigold via-marigold-soft to-rani bg-gradient-to-r bg-clip-text text-transparent">
                Navratri &amp; Dandiya
              </span>{" "}
              nights in minutes.
            </h1>

            <p className="text-muted max-w-xl text-base/7 sm:text-lg/8">
              {siteConfig.tagline} — one place to find a night near you, pick how you want to
              dance, and get your pass without a queue at the gate.
            </p>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button href="/events" size="lg">
                Browse events
              </Button>
              <Button href="/#how-it-works" variant="secondary" size="lg">
                See how it works
              </Button>
            </div>

            <ul className="text-muted flex flex-col gap-2 pt-2 text-sm/6">
              {seasonPoints.map((point) => (
                <li key={point} className="flex items-start gap-2.5">
                  <svg
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    className="text-marigold mt-0.5 size-4 shrink-0"
                  >
                    <path
                      d="m5 13 4 4L19 7"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fill="none"
                    />
                  </svg>
                  {point}
                </li>
              ))}
            </ul>
          </div>

          <DandiyaPanel />
        </div>
      </Container>
    </Section>
  );
}

/** Decorative illustration panel. Contains no event data on purpose. */
function DandiyaPanel() {
  return (
    <div className="relative mx-auto w-full max-w-md">
      <div className="border-border relative overflow-hidden rounded-3xl border bg-gradient-to-br from-[#2a1048] via-[#1a0b31] to-[#120722] p-8 shadow-2xl shadow-black/40">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            backgroundImage:
              "radial-gradient(circle at 50% 0%, rgba(247,183,49,0.25), transparent 55%)",
          }}
        />

        <svg viewBox="0 0 240 240" role="img" aria-label="Decorative garba illustration" className="relative mx-auto w-full max-w-[15rem]">
          <defs>
            <linearGradient id="stick" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#f7b731" />
              <stop offset="100%" stopColor="#e5399b" />
            </linearGradient>
          </defs>

          <circle cx="120" cy="120" r="92" fill="none" stroke="#ffffff" strokeOpacity="0.08" />
          <circle cx="120" cy="120" r="70" fill="none" stroke="#ffffff" strokeOpacity="0.12" />
          <circle cx="120" cy="120" r="48" fill="none" stroke="#ffffff" strokeOpacity="0.16" />

          {Array.from({ length: 12 }).map((_, index) => {
            const angle = (index * 360) / 12;
            return (
              <line
                key={angle}
                x1="120"
                y1="120"
                x2="120"
                y2="34"
                stroke="url(#stick)"
                strokeWidth="3"
                strokeLinecap="round"
                opacity={index % 2 === 0 ? 0.85 : 0.35}
                transform={`rotate(${angle} 120 120)`}
              />
            );
          })}

          <circle cx="120" cy="120" r="26" fill="#120722" stroke="url(#stick)" strokeWidth="3" />
          <circle cx="120" cy="120" r="10" fill="#f7b731" />

          <g stroke="url(#stick)" strokeWidth="5" strokeLinecap="round">
            <line x1="52" y1="188" x2="118" y2="146" />
            <line x1="68" y1="206" x2="128" y2="152" />
            <line x1="188" y1="188" x2="122" y2="146" />
            <line x1="172" y1="206" x2="112" y2="152" />
          </g>
        </svg>
      </div>
    </div>
  );
}
