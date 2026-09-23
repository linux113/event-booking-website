import { csvCell, type SearchParamsInput } from "@/lib/admin/bookings";
import {
  PASS_EXPORT_COLUMNS,
  PASS_EXPORT_MAX_ROWS,
  parsePassQuery,
  passExportFileName,
  type PassExportRow,
} from "@/lib/admin/operations";
import { can } from "@/lib/auth/permissions";
import { getStaffMember } from "@/lib/auth/staff";
import { collectPassesForExport } from "@/lib/services/admin-operations";

/**
 * GET /admin/passes/export — the door list as a CSV file.
 *
 * The same filters as the pass screen, reading the same database function, so the file
 * and the list cannot disagree about which passes it holds. A door team prints this and
 * takes it to a table where the wifi is a rumour, which is why the export is the one
 * place that deliberately reads *more* than one page: up to 5,000 passes, fetched in
 * batches of 100, with the cap reported in a header rather than applied in silence.
 *
 * Three rules, the same ones the booking export follows:
 *
 *   1. **The session decides, on the server.** No session → `401`, no query made; a
 *      signed-in visitor who is not staff → `403`. The request hook refuses both before
 *      this handler runs — this is the lock that would still hold if a route were added
 *      without it.
 *   2. **The role decides the shape of the file.** Without `bookings:view_contact` the
 *      Mobile, Amount and Currency columns are absent from the header row, and the rows
 *      behind them were never fetched: the query ran with `p_include_contact = false`.
 *   3. **The token is never in the file.** There is no column for `qr_token` and no
 *      parameter that would add one. A pass is admitted by scanning it.
 */

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

function jsonError(status: number, kind: string, message: string): Response {
  return Response.json({ ok: false, error: { kind, message } }, { status, headers: { "cache-control": "no-store" } });
}

/** The door list as text, with the columns the caller's role may have. */
export function passesToCsv(rows: readonly PassExportRow[], includeContact: boolean): string {
  const columns = PASS_EXPORT_COLUMNS.filter((column) => includeContact || !column.contact);
  const lines = [columns.map((column) => csvCell(column.header)).join(",")];

  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(column.value(row))).join(","));
  }

  return lines.join("\r\n");
}

export async function GET(request: Request): Promise<Response> {
  const staff = await getStaffMember();

  if (!staff) {
    return jsonError(401, "not-authorized", "Sign in as event staff to download the door list.");
  }

  if (!can(staff.role, "passes:view")) {
    return jsonError(403, "forbidden", "Your role cannot read the pass list.");
  }

  const params: SearchParamsInput = {};
  const search = new URL(request.url).searchParams;

  for (const [key, value] of search.entries()) {
    params[key] = value;
  }

  const query = parsePassQuery(params);
  const result = await collectPassesForExport(query, staff.role);

  if (!result.ok) {
    return jsonError(
      result.error.kind === "not-configured" ? 503 : 500,
      result.error.kind,
      "The door list could not be built right now.",
    );
  }

  const { rows, includeContact, truncated } = result.data;

  return new Response(`\ufeff${passesToCsv(rows, includeContact)}`, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${passExportFileName()}"`,
      "cache-control": "no-store",
      "x-export-rows": String(rows.length),
      "x-export-truncated": truncated ? "true" : "false",
      "x-export-max-rows": String(PASS_EXPORT_MAX_ROWS),
    },
  });
}
