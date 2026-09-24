import { NextResponse } from "next/server";

import { HERO_IMAGE_CONTENT_TYPE } from "@/lib/admin/hero-image";
import { readPublishedHeroImage } from "@/lib/services/hero-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Public, published-only stream for the homepage hero. Gallery has its own storage path. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ eventId: string }> },
): Promise<Response> {
  const { eventId } = await context.params;
  if (!UUID.test(eventId)) {
    return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  }

  const result = await readPublishedHeroImage(eventId);
  if (!result.ok) {
    const status = result.error.kind === "not-found" ? 404 : result.error.kind === "not-configured" ? 503 : 500;
    return new Response(status === 404 ? "Not found" : "Hero image unavailable", {
      status,
      headers: { "cache-control": "no-store" },
    });
  }

  const etag = `"hero-${eventId}-${result.data.version}"`;
  const requestedVersion = new URL(_request.url).searchParams.get("v");
  const isCurrentVersion = requestedVersion === result.data.version;
  const cacheControl = isCurrentVersion ? "public, max-age=31536000, immutable" : "no-store";

  if (isCurrentVersion && _request.headers.get("if-none-match") === etag) {
    return new Response(null, {
      status: 304,
      headers: { etag, "cache-control": cacheControl },
    });
  }

  return new NextResponse(new Uint8Array(result.data.bytes), {
    headers: {
      "content-type": HERO_IMAGE_CONTENT_TYPE,
      "content-length": String(result.data.bytes.byteLength),
      "cache-control": cacheControl,
      etag,
      "x-content-type-options": "nosniff",
    },
  });
}
