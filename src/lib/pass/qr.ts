import "server-only";

import QRCode from "qrcode";

import { formatEventDate, formatInr, formatTimeRange } from "@/lib/format";
import type { DigitalPassTicket } from "@/types/pass";

/**
 * QR codes, generated on the server.
 *
 * Nothing is uploaded anywhere and no third-party image service is involved: the
 * code is drawn from the pass's own verification URL when the page renders, so it
 * can never point at a stale destination and needs no storage bucket. The same
 * URL is what the printer, the downloaded SVG and a phone camera all see.
 */

const QR_ERROR_CORRECTION = "M" as const;

/**
 * The QR as SVG path data — the modules as one path in a 0..size square.
 *
 * Returning geometry instead of a string lets the pass page draw the code inline
 * (crisp on screen and in print, no data URL, no second request) and lets the
 * downloadable ticket embed it as real vector shapes.
 */
export function qrPathData(text: string): { path: string; size: number } {
  const qr = QRCode.create(text, { errorCorrectionLevel: QR_ERROR_CORRECTION });
  const size = qr.modules.size;
  let path = "";

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (qr.modules.get(x, y)) {
        path += `M${x} ${y}h1v1h-1z`;
      }
    }
  }

  return { path, size };
}

/** A standalone SVG of the QR code (used by the download route). */
export function renderQrSvg(text: string): string {
  const { path, size } = qrPathData(text);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"`,
    ` width="512" height="512" role="img" aria-label="Digital pass QR code">`,
    `<rect width="${size}" height="${size}" fill="#ffffff"/>`,
    `<path d="${path}" fill="#0b0a24"/>`,
    `</svg>`,
  ].join("");
}

/** A PNG of the QR code, `size` pixels square (used by the download route). */
export async function renderQrPng(text: string, size = 1024): Promise<Buffer> {
  return QRCode.toBuffer(text, {
    type: "png",
    errorCorrectionLevel: QR_ERROR_CORRECTION,
    width: size,
    margin: 2,
    color: { dark: "#0b0a24ff", light: "#ffffffff" },
  });
}

// -----------------------------------------------------------------------------
// The downloadable ticket
// -----------------------------------------------------------------------------

const INK = "#191233";
const MUTED = "#6b628f";
const LINE = "#ded7f0";
const PAPER = "#ffffff";
const ACCENT = "#f7b731";
const VALID_INK = "#0f9e86";

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/** XML-safe text: a name really can contain `&` or `<`. */
function xml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function label(x: number, y: number, text: string): string {
  return `<text x="${x}" y="${y}" font-family="${FONT_STACK}" font-size="10" font-weight="600" letter-spacing="1.6" fill="${MUTED}">${xml(text.toUpperCase())}</text>`;
}

function value(x: number, y: number, text: string, options: { size?: number; weight?: number; fill?: string } = {}): string {
  const { size = 15, weight = 600, fill = INK } = options;

  return `<text x="${x}" y="${y}" font-family="${FONT_STACK}" font-size="${size}" font-weight="${weight}" fill="${fill}">${xml(text)}</text>`;
}

/**
 * The whole pass as a self-contained SVG file: what "Download pass" saves.
 *
 * Deliberately a light, paper-coloured ticket even though the site is dark — it is
 * meant to be printed or shown at a gate, and it prints with no ink-heavy
 * background. The QR is embedded as vector paths, so the file has no dependencies
 * and stays sharp at any size.
 */
export function renderPassTicketSvg(ticket: DigitalPassTicket): string {
  const { pass } = ticket;
  const width = 760;
  const height = 340;
  const qrBox = 176;
  const qrX = width - qrBox - 44;
  const qrY = 96;
  const { path, size } = qrPathData(pass.verifyUrl);
  const scale = qrBox / size;
  const timeRange = formatTimeRange(ticket.startTime, ticket.endTime);
  const statusFill = pass.displayStatus === "valid" ? VALID_INK : MUTED;

  const rows: Array<[string, string, number, number]> = [
    ["Pass ID", pass.passId, 44, 200],
    ["Customer", ticket.customerName, 44, 236],
    ["Pass", [ticket.passName, ticket.passComposition].filter(Boolean).join(" · "), 44, 272],
    ["Date", `${formatEventDate(ticket.eventDate)}${timeRange ? ` · ${timeRange}` : ""}`, 268, 200],
    ["Payment", ticket.paymentStatus.toUpperCase(), 268, 236],
    ["Status", pass.displayLabel, 268, 272],
  ];

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Digital pass ${xml(pass.passId)}">`,
    `<rect width="${width}" height="${height}" rx="20" fill="${PAPER}"/>`,
    `<rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="20" fill="none" stroke="${LINE}" stroke-width="2"/>`,
    `<rect x="0" y="0" width="${width}" height="10" rx="5" fill="${ACCENT}"/>`,

    label(44, 58, "Digital pass"),
    value(44, 90, ticket.eventName, { size: 26, weight: 700 }),
    value(44, 116, `${ticket.venueName}, ${ticket.city}`, { size: 13, weight: 500, fill: MUTED }),

    `<line x1="44" y1="140" x2="${width - 44}" y2="140" stroke="${LINE}" stroke-width="1" stroke-dasharray="6 6"/>`,

    ...rows.flatMap(([name, text, x, y]) => [label(x, y, name), value(x, y + 22, text)]),

    `<rect x="${qrX - 12}" y="${qrY - 12}" width="${qrBox + 24}" height="${qrBox + 24}" rx="14" fill="#f7f5fd" stroke="${LINE}"/>`,
    `<g transform="translate(${qrX} ${qrY}) scale(${scale})"><path d="${path}" fill="${INK}"/></g>`,
    value(qrX + qrBox / 2, qrY + qrBox + 34, "SCAN AT THE GATE", { size: 10, weight: 700, fill: MUTED }),

    `<line x1="44" y1="${height - 58}" x2="${width - 44}" y2="${height - 58}" stroke="${LINE}"/>`,
    label(44, height - 34, `Booking ${ticket.bookingReference} · Pass ${pass.passNumber} of ${pass.passTotal}`),
    value(width - 44, height - 34, formatInr(ticket.totalAmount, ticket.currency) + " paid", {
      size: 12,
      weight: 600,
      fill: statusFill,
      // right-align by anchoring: the caller cannot know the text width
    }).replace("<text ", '<text text-anchor="end" '),
    `</svg>`,
  ].join("");
}
