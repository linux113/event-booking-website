import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { siteConfig } from "@/config/site";
import { siteUrl } from "@/config/env";
import { getSiteContact } from "@/lib/services/contact";

import "./globals.css";

// Fonts are self-hosted and bundled by the `geist` package, so builds never
// depend on reaching Google Fonts and visitors make no third-party requests.
const fontVariables = `${GeistSans.variable} ${GeistMono.variable}`;

export const metadata: Metadata = {
  // Set NEXT_PUBLIC_SITE_URL in production so canonical URLs are absolute.
  metadataBase: new URL(siteUrl),
  title: {
    default: `${siteConfig.name} — ${siteConfig.tagline}`,
    template: `%s · ${siteConfig.name}`,
  },
  description: siteConfig.description,
  icons: {
    icon: [{ url: "/icon.png", sizes: "64x64", type: "image/png" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    locale: siteConfig.locale,
    siteName: siteConfig.name,
    title: `${siteConfig.name} — ${siteConfig.tagline}`,
    description: siteConfig.description,
    url: siteUrl,
  },
  twitter: {
    card: "summary_large_image",
    title: `${siteConfig.name} — ${siteConfig.tagline}`,
    description: siteConfig.description,
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#0e0a1f",
  width: "device-width",
  initialScale: 1,
};

/**
 * The root layout reads the event's contact details once and hands them to the header
 * and the footer.
 *
 * One read, one source: the WhatsApp link in the header, the one in the mobile menu,
 * the phone number and the social profiles in the footer are all the same row. When
 * the database is not configured `getSiteContact()` answers with an empty contact, so
 * the chrome still renders — without the links, rather than without the page.
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const contact = await getSiteContact();

  return (
    <html lang="en-IN" className={fontVariables}>
      <body className="flex min-h-dvh flex-col font-sans">
        <a
          href="#main"
          className="bg-marigold text-marigold-foreground sr-only rounded-full px-4 py-2 font-semibold focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-[100]"
        >
          Skip to content
        </a>

        <SiteHeader whatsappHref={contact.whatsappHref} />

        <main id="main" className="flex-1">
          {children}
        </main>

        <SiteFooter contact={contact} />
      </body>
    </html>
  );
}
