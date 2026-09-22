import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fail the production build on type errors instead of shipping them.
  // Note: Next.js 16 no longer runs ESLint during `next build` — lint separately
  // via `npm run lint` (or the combined `npm run check`).
  typescript: { ignoreBuildErrors: false },

  // Type-safe <Link href> values across the app.
  typedRoutes: true,

  // Dev-server origins allowed to request internal dev assets. The sandbox
  // preview host is *.e2b.app; add your own tunnel/LAN host here if needed.
  allowedDevOrigins: ["*.e2b.app"],

  // Remote images: add the Supabase Storage / CDN host here once event cover
  // images are uploaded, e.g. `hostname: "<project-ref>.supabase.co"`.
  images: {
    remotePatterns: [],
  },
};

export default nextConfig;
