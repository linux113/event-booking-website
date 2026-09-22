import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { Container } from "@/components/ui/container";
import { siteConfig } from "@/config/site";

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-border/70 bg-surface/40 mt-8 border-t">
      <Container className="flex flex-col gap-8 py-12">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex max-w-sm flex-col gap-3">
            <Logo />
            <p className="text-muted text-sm/6">{siteConfig.description}</p>
          </div>

          <nav aria-label="Footer" className="flex flex-col gap-2.5 text-sm">
            {siteConfig.footerNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-muted hover:text-foreground w-fit transition-colors"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="border-border/70 text-muted flex flex-col gap-2 border-t pt-6 text-xs sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year} {siteConfig.name}. All rights reserved.
          </p>
          <p>
            Payments will be processed by Razorpay. Prices are shown in {siteConfig.currency}.
          </p>
        </div>
      </Container>
    </footer>
  );
}
