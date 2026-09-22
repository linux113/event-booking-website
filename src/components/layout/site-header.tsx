import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { MobileNav } from "@/components/layout/mobile-nav";
import { WhatsAppButton } from "@/components/layout/whatsapp-button";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { siteConfig } from "@/config/site";

const navLinkStyles =
  "text-muted hover:text-foreground relative text-sm font-medium transition-colors after:absolute after:-bottom-1.5 after:left-0 after:h-0.5 after:w-0 after:rounded-full after:bg-gradient-to-r after:from-marigold after:to-rani after:transition-all after:duration-200 hover:after:w-full";

export function SiteHeader() {
  return (
    <header className="border-border/60 bg-background/85 sticky top-0 z-50 border-b backdrop-blur-xl">
      <Container className="flex h-16 items-center justify-between gap-3 lg:h-18">
        <Link
          href="/"
          aria-label={`${siteConfig.name} — home`}
          className="rounded-lg focus-visible:outline-offset-4"
        >
          <Logo />
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-7 lg:flex xl:gap-9">
          {siteConfig.nav.map((item) => (
            <Link key={item.href} href={item.href} className={navLinkStyles}>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Button href="/book" size="sm" className="hidden md:inline-flex">
            Book Now
          </Button>
          <WhatsAppButton variant="default" size="sm" className="hidden sm:inline-flex" />
          <WhatsAppButton variant="icon" size="sm" className="sm:hidden" />
          <MobileNav items={siteConfig.nav} />
        </div>
      </Container>
    </header>
  );
}
