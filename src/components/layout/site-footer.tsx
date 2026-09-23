import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { MailIcon, MapPinIcon, PhoneIcon, socialIcons } from "@/components/icons";
import { WhatsAppButton } from "@/components/layout/whatsapp-button";
import { Container } from "@/components/ui/container";
import { contentStatus, siteConfig } from "@/config/site";
import type { SiteContact } from "@/lib/contact";

/**
 * The site footer.
 *
 * Every contact line in it — the phone number, the email address, the venue address,
 * the map link, the three social profiles and the WhatsApp button — is the event row
 * rendered through `buildSiteContact()`. Nothing here is a literal: change the number
 * or the Instagram handle in the database and the footer, the header and the contact
 * page all change together.
 *
 * A value the organiser has not filled in is left out rather than faked, so the footer
 * gets shorter instead of showing a placeholder telephone number.
 */
export function SiteFooter({ contact }: { contact: SiteContact }) {
  const year = new Date().getFullYear();

  return (
    <footer className="border-border/60 bg-surface/40 mt-16 border-t">
      <Container className="grid gap-12 py-14 lg:grid-cols-[1.4fr_1fr_1.2fr]">
        <div className="flex flex-col gap-4">
          <Logo />
          <p className="text-muted max-w-sm text-sm/6">{siteConfig.description}</p>

          {contact.socials.length > 0 ? (
            <div className="flex items-center gap-2.5">
              {contact.socials.map((social) => {
                const SocialIcon = socialIcons[social.id];

                return (
                  <a
                    key={social.id}
                    href={social.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${siteConfig.name} on ${social.label}`}
                    className="border-border bg-surface-raised/60 text-muted hover:border-marigold/50 hover:text-marigold flex size-10 items-center justify-center rounded-full border transition-colors"
                  >
                    <SocialIcon className="size-[1.15rem]" />
                  </a>
                );
              })}
            </div>
          ) : null}

          {contact.supportHours.length > 0 ? (
            <div className="flex flex-col gap-1 text-xs/5">
              <h2 className="text-muted/80 font-semibold tracking-widest uppercase">When we answer</h2>
              {contact.supportHours.map((line) => (
                <p key={line} className="text-muted">
                  {line}
                </p>
              ))}
            </div>
          ) : null}
        </div>

        <nav aria-label="Footer" className="flex flex-col gap-3 text-sm">
          <h2 className="text-foreground text-xs font-semibold tracking-widest uppercase">Explore</h2>
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

        <div className="flex flex-col gap-3 text-sm">
          <h2 className="text-foreground text-xs font-semibold tracking-widest uppercase">Get in touch</h2>

          {contact.phone && contact.phoneHref ? (
            <a
              href={contact.phoneHref}
              className="text-muted hover:text-foreground flex items-center gap-2.5 transition-colors"
            >
              <PhoneIcon className="text-marigold size-[1.05rem]" />
              {contact.phone}
            </a>
          ) : null}

          {contact.email && contact.emailHref ? (
            <a
              href={contact.emailHref}
              className="text-muted hover:text-foreground flex items-center gap-2.5 transition-colors"
            >
              <MailIcon className="text-marigold size-[1.05rem]" />
              {contact.email}
            </a>
          ) : null}

          {contact.addressLines.length > 0 ? (
            <p className="text-muted flex items-start gap-2.5">
              <MapPinIcon className="text-marigold mt-0.5 size-[1.05rem] shrink-0" />
              <span>
                {contact.addressLines.map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
                {contact.mapsHref ? (
                  <a
                    href={contact.mapsHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-marigold-soft hover:text-marigold mt-1 inline-block text-xs font-semibold underline-offset-4 hover:underline"
                  >
                    Open in Google Maps
                  </a>
                ) : null}
              </span>
            </p>
          ) : null}

          <WhatsAppButton href={contact.whatsappHref} variant="full" size="sm" className="mt-1 w-fit" />
        </div>
      </Container>

      <Container className="border-border/60 flex flex-col gap-3 border-t py-6 text-xs sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted">
          © {year} {siteConfig.name}. All rights reserved.
        </p>
        <p className="text-muted">
          {contentStatus.isDemoContent ? (
            <span className="text-muted/80">{contentStatus.notice} </span>
          ) : null}
          Payments will be processed by Razorpay. Prices are shown in {siteConfig.currency}.
        </p>
      </Container>
    </footer>
  );
}
