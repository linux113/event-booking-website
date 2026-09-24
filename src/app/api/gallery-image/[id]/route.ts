import { NextResponse } from "next/server";

import { readPublishedGalleryImage } from "@/lib/services/gallery-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Public, published-only stream for gallery photos stored in Postgres bytea. */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  if (!UUID.test(id)) {
    return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  }

  const { searchParams } = new URL(request.url);
  const variant = searchParams.get("variant") === "thumb" ? "thumb" : "full";

  const result = await readPublishedGalleryImage(id, variant);
  if (!result.ok) {
    const status = result.error.kind === "not-found" ? 404 : result.error.kind === "not-configured" ? 503 : 500;
    return new Response(status === 404 ? "Not found" : "Gallery image unavailable", {
      status,
      headers: { "cache-control": "no-store" },
    });
  }

  const etag = `"gallery-${id}-${variant}"`;
  const hasVersionParam = searchParams.has("v");
  const cacheControl = hasVersionParam ? "public, max-age=31536000, immutable" : "public, max-age=3600";

  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, {
      status: 304,
      headers: { etag, "cache-control": cacheControl },
    });
  }

  return new NextResponse(new Uint8Array(result.data.bytes), {
    headers: {
      "content-type": "image/webp",
      "content-length": String(result.data.bytes.byteLength),
      "cache-control": cacheControl,
      etag,
      "x-content-type-options": "nosniff",
    },
  });
}
