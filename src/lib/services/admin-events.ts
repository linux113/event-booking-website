import "server-only";

import { isDatabaseConfigured } from "@/config/env";
import { DatabaseError, sql } from "@/lib/db/client";
import { fail, ok, type Result } from "@/lib/services/result";
import { formatEventDate, formatTimeOfDay } from "@/lib/format";

/**
 * The event's nights, for the operations screens that need to offer them as a filter.
 *
 * Deliberately includes closed/cancelled nights: a night that has been taken off
 * sale still has passes valid for it, and a filter built on "bookable only"
 * would hide bookings made for those nights.
 */

export interface EventNightOption {
  id: string;
  date: string;
  label: string;
  status: string;
  capacity: number;
  closed: boolean;
}

interface NightRow {
  id: string;
  event_date: string;
  start_time: string | null;
  capacity: number;
  status: string;
}

/**
 * Every night of the (first) event, earliest first.
 * Empty list rather than an error when the database is not configured.
 */
export async function getEventNights(): Promise<Result<EventNightOption[]>> {
  if (!isDatabaseConfigured()) {
    return fail(
      "not-configured",
      "The admin area needs the database: add DATABASE_URL and try again.",
    );
  }

  try {
    const data = await sql<NightRow[]>`
      select id, event_date, start_time, capacity, status
      from public.event_dates
      order by event_date asc
      limit 120
    `;

    return ok(
      data.map((night) => {
        const time = formatTimeOfDay(night.start_time);
        const closed = night.status !== "scheduled";

        return {
          id: night.id,
          date: night.event_date,
          label: [
            formatEventDate(night.event_date),
            time,
            closed ? night.status.replace("_", " ") : null,
          ]
            .filter(Boolean)
            .join(" · "),
          status: night.status,
          capacity: night.capacity,
          closed,
        };
      }),
    );
  } catch (error) {
    const dbError = error instanceof DatabaseError ? error : new DatabaseError(String(error));
    console.error("[admin] event_dates read failed:", dbError.message, dbError.code ?? "");
    return fail("query-failed", "We could not load the event's nights right now.");
  }
}
