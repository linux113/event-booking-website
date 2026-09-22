import {
  EXPORT_MAX_ROWS,
  bookingExportFileName,
  bookingsToCsv,
  parseBookingQuery,
  type SearchParamsInput,
} from "@/lib/admin/bookings";
import { can } from "@/lib/auth/permissions";
import { getStaffMember } from "@/lib/auth/staff";
import { collectBookingsForExport } from "@/lib/services/admin";

/**
 * GET /admin/bookings/export — the booking list as a CSV file.
 *
 * The same filters as the screen, reading the same database function, so the file and
 * the list cannot disagree about what "paid, unrefunded, night of the 12th" means.
 *
 * Three rules, and the order they are checked in matters:
 *
 *   1. **The session decides, on the server.** No session → `401`, and no query is made.
 *      A signed-in visitor who is not staff → `403`. The request hook refuses both of
 *      those before this handler runs; this is the second lock, and the one that would
 *      still hold if a future route were added without the hook.
 *   2. **The role decides the *shape* of the file**, not just whether there is one. A
 *      caller without `bookings:view_contact` gets an export whose header row has no
 *      Mobile, Email, Amount or Razorpay columns at all — the rows never carry them,
 *      because the query was made with `p_include_contact = false`.
 *   3. **Never cached, never inline.** The response is `no-store` and served as an
 *      attachment, so a shared browser or proxy cannot hand yesterday's customer list
 *      to whoever loads the URL next.
 */

export const runtime = "nodejs";

// A file built for one operator's filters at one moment: caching it would be wrong.
export const dynamic = "force-dynamic";

function jsonError(status: number, kind: string, message: string): Response {
  return Response.json({ ok: false, error: { kind, message } }, { status, headers: { "cache-control": "no-store" } });
}

export async function GET(request: Request): Promise<Response> {
  const staff = await getStaffMember();

  if (!staff) {
    return jsonError(401, "not-authorized", "Sign in as event staff to export bookings.");
  }

  if (!can(staff.role, "bookings:view")) {
    // 403, not 401: the session is fine, this role simply cannot read the list.
    return jsonError(403, "forbidden", "Your role cannot export bookings.");
  }

  // The URL's own filters, parsed by the same function the screen uses: unknown values
  // are dropped rather than passed on, so a hand-edited link cannot make the database
  // reject the call or widen the export.
  const params: SearchParamsInput = {};
  const search = new URL(request.url).searchParams;

  for (const [key, value] of search.entries()) {
    params[key] = value;
  }

  const query = parseBookingQuery(params);
  const result = await collectBookingsForExport(query, staff.role);

  if (!result.ok) {
    return jsonError(
      result.error.kind === "not-configured" ? 503 : 500,
      result.error.kind,
      "The export could not be built right now.",
    );
  }

  const { rows, includeContact, truncated } = result.data;
  const csv = bookingsToCsv(rows, includeContact);

  return new Response(`\ufeff${csv}`, {
    status: 200,
    headers: {
      // `text/csv; charset=utf-8` with a byte-order mark: Excel is the most likely thing
      // to open this, and without the mark it mangles every non-ASCII name in the file.
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${bookingExportFileName()}"`,
      "cache-control": "no-store",
      // Paging through the database for a large export is done in batches; these two
      // headers state plainly what the file is, so a truncated one is never mistaken
      // for a complete answer.
      "x-export-rows": String(rows.length),
      "x-export-truncated": truncated ? "true" : "false",
      "x-export-max-rows": String(EXPORT_MAX_ROWS),
    },
  });
}
