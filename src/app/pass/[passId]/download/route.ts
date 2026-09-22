import type { NextRequest } from "next/server";

import { renderPassTicketSvg, renderQrPng } from "@/lib/pass/qr";
import { getDigitalPassByToken } from "@/lib/services/passes";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "cache-control": "no-store",
  "x-robots-tag": "noindex, nofollow",
} as const;

type DownloadRouteProps = {
  params: Promise<{ passId: string }>;
};

/**
 * What "Download pass" actually downloads: /pass/<pass id>/download?t=<token>.
 *
 * `format=svg` (the default) returns the whole pass as a self-contained file —
 * vector, so it stays sharp printed at A6 and needs no fonts, no images and no
 * network. `format=png` returns just the QR code at 1024px, for guests who would
 * rather keep the code in their photo library.
 *
 * The token is verified server-side before anything is rendered, and the pass is
 * re-read from the database on every request, so a cancelled pass downloads
 * stamped CANCELLED rather than as a valid ticket.
 */
export async function GET(request: NextRequest, { params }: DownloadRouteProps) {
  const { passId } = await params;
  const token = request.nextUrl.searchParams.get("t");
  const wantsPng = request.nextUrl.searchParams.get("format") === "png";

  const result = await getDigitalPassByToken(token);

  if (!result.ok) {
    return Response.json(
      { ok: false, error: result.error.kind, message: result.error.message },
      { status: result.error.kind === "not-configured" ? 503 : 500, headers: NO_STORE_HEADERS },
    );
  }

  if (!result.data) {
    return Response.json(
      { ok: false, error: "not-found", message: "We could not find that pass." },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }

  const ticket = result.data;
  // The token is the credential and decides which pass is rendered; the path
  // segment only names the downloaded file. It is sanitised first, because it is a
  // value from the URL and ends up in a `content-disposition` header.
  const safeSegment = /^[A-Za-z0-9._-]{1,40}$/.test(passId) ? passId : ticket.pass.passId;
  const filename = `pass-${safeSegment}${wantsPng ? "-qr" : ""}`;

  if (wantsPng) {
    const png = await renderQrPng(ticket.pass.verifyUrl);

    return new Response(new Uint8Array(png), {
      headers: {
        ...NO_STORE_HEADERS,
        "content-type": "image/png",
        "content-disposition": `attachment; filename="${filename}.png"`,
      },
    });
  }

  return new Response(renderPassTicketSvg(ticket), {
    headers: {
      ...NO_STORE_HEADERS,
      "content-type": "image/svg+xml; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}.svg"`,
    },
  });
}
