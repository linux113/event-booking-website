import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Overridable so automated checks can build and serve from an isolated output
  // directory without touching the `.next` used by a running dev server.
  distDir: process.env.NEXT_DIST_DIR || ".next",

  // Fail the production build on type errors instead of shipping them.
  // Note: Next.js 16 no longer runs ESLint during `next build` — lint separately
  // via `npm run lint` (or the combined `npm run check`).
  typescript: { ignoreBuildErrors: false },

  // Type-safe <Link href> values across the app.
  typedRoutes: true,

  // Dev-server origins allowed to request internal dev assets. The sandbox
  // preview host is *.e2b.app; add your own tunnel/LAN host here if needed.
  allowedDevOrigins: ["*.e2b.app"],

  // Security headers.
  //
  // Three are for every response: `nosniff` (we serve an SVG file and user-uploaded
  // images, and neither should ever be sniffed into something executable),
  // `strict-origin-when-cross-origin` (a pass URL in a referrer is a credential), and
  // a permissions policy that hands out the camera — which the scanner needs — and
  // nothing else.
  //
  // Frame protection is deliberately scoped to the admin area. The public site is
  // meant to be embeddable (a preview pane, a venue's own portal), while a framed
  // gallery or pass screen is exactly how an admin gets tricked into clicking
  // "Delete": the frame *is* our origin, so no cookie attribute stops that click.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "x-content-type-options", value: "nosniff" },
          { key: "referrer-policy", value: "strict-origin-when-cross-origin" },
          { key: "permissions-policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
      {
        source: "/admin/:path*",
        headers: [
          { key: "x-frame-options", value: "DENY" },
          { key: "content-security-policy", value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },

  // Remote images: public gallery files live on Vercel Blob (and may be on any
  // `public.blob.vercel-storage.com` project). The path restriction is not used
  // for Blob (keys are not path-prefixed on the host), so hosts are limited to
  // the well-known Blob CDN domains.
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.public.blob.vercel-storage.com",
      },
      {
        protocol: "https",
        hostname: "**.blob.vercel-storage.com",
      },
    ],
  },
};

export default nextConfig;
