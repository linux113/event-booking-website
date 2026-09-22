import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { MobileNav } from "@/components/layout/mobile-nav";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { siteConfig } from "@/config/site";

const linkStyles = "text-muted hover:text-foreground text-sm font-medium transition-colors";

export function SiteHeader() {
  return (
    <header className="border-border/70 bg-background/80 sticky top-0 z-50 border-b backdrop-blur-lg">
      <Container className="flex h-16 items-center justify-between gap-4">
        <Link href="/" aria-label={`${siteConfig.name} — home`} className="rounded-lg">
          <Logo />
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-8 md:flex">
          {siteConfig.nav.map((item) => (
            <Link key={item.href} href={item.href} className={linkStyles}>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Button href="/events" size="sm" className="hidden sm:inline-flex">
            Book passes
          </Button>
          <MobileNav items={siteConfig.nav} />
        </div>
      </Container>
    </header>
  );
}
