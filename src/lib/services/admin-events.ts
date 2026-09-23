import "server-only";

import { getAdminClient } from "@/lib/services/admin-client";
import { fail, ok, type Result } from "@/lib/services/result";
import { formatEventDate, formatTimeOfDay } from "@/lib/format";

/**
 * The event's nights, for the operations screens that need to offer them as a filter.
 *
 * Read with the service-role client rather than the public one, and deliberately: this
 * is an admin-side list, and a night that has been taken off sale or set to `completed`
 * still has passes valid for it. The public availability function answers "can somebody
 * book this night", which is a different question from "which nights exist", and a
 * filter built on the first would hide bookings made for the second.
 *
 * The label carries the important facts in the order an operator reads them — the date,
 * then whether the night is closed — so a night that has been cancelled is recognisable
 * in the select without opening anything.
 */

export interface EventNightOption {
  id: string;
  /** The raw `YYYY-MM-DD`, for anything that needs to compare rather than display. */
  date: string;
  /** `Sat, 17 Oct 2026 · 7:00 PM` — the date, and the time when the row has one. */
  label: string;
  status: string;
  capacity: number;
  /** Already sold / closed nights are still offered, but marked. */
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
 *
 * Returns an empty list rather than an error when the database has not been configured:
 * a filter select with nothing in it is a smaller problem than a page that refuses to
 * render, and the page says so in words.
 */
export async function getEventNights(): Promise<Result<EventNightOption[]>> {
  const client = getAdminClient();

  if (!client.ok) {
    return { ok: false, error: client.error };
  }

  const { data, error } = await client.client
    .from("event_dates")
    .select("id, event_date, start_time, capacity, status")
    .order("event_date", { ascending: true })
    .limit(120);

  if (error) {
    console.error("[admin] event_dates read failed:", error.message, error.code);

    return fail("query-failed", "We could not load the event's nights right now.");
  }

  return ok(
    ((data ?? []) as NightRow[]).map((night) => {
      const time = formatTimeOfDay(night.start_time);
      const closed = night.status !== "scheduled";

      return {
        id: night.id,
        date: night.event_date,
        label: [
          formatEventDate(night.event_date),
          time,
          // The status is only worth the space when it is not the ordinary one.
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
}
