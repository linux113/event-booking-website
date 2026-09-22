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

  // Remote images come from Supabase Storage. The wildcard covers every project
  // ref (the ref is not known at build time) and is limited to the public
  // storage path, so nothing else can be proxied through the image optimiser.
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default nextConfig;
