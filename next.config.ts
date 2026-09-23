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
  // Frame protection is deliberately scoped to the staff area. The public site is
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

  // Remote images come from Supabase Storage. The wildcard covers every project
  // ref (the ref is not known at build time) and is limited to the public
  // storage path, so nothing else can be proxied through the image optimiser.
  images: {
    remotePatterns: storagePatterns(),
  },
};

/**
 * Where optimised images may be fetched from.
 *
 * Two entries at most, and both are as narrow as the pattern language allows:
 *
 *   1. **Any hosted Supabase project**, limited to the public storage path — the
 *      project ref is not known at build time, but the path is always ours.
 *   2. **The project this deployment is configured with**, whatever it is. That is
 *      what makes a self-hosted Supabase, a local stack, or an automated check
 *      pointed at a test double work without weakening the rule above: the host
 *      comes from `NEXT_PUBLIC_SUPABASE_URL`, and the path is still restricted.
 */
function storagePatterns(): NonNullable<NextConfig["images"]>["remotePatterns"] {
  const patterns: NonNullable<NextConfig["images"]>["remotePatterns"] = [
    {
      protocol: "https",
      hostname: "**.supabase.co",
      pathname: "/storage/v1/object/public/**",
    },
  ];

  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (configured) {
    try {
      const url = new URL(configured);

      patterns.push({
        protocol: url.protocol.replace(":", "") as "http" | "https",
        hostname: url.hostname,
        port: url.port || undefined,
        pathname: "/storage/v1/object/public/**",
      });
    } catch {
      // A URL that cannot be parsed is a deployment problem the app reports at
      // runtime (`src/config/env.ts`); the build should not fail over it.
    }
  }

  return patterns;
}

export default nextConfig;
