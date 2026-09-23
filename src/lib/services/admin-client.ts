import { isDatabaseConfigured } from "@/config/env";
import type { ServiceError } from "@/lib/services/result";

/**
 * The one door to the admin database.
 *
 * Every admin read goes through Prisma/Neon (`src/lib/db/client.ts`). This
 * module only decides what happens when the connection string is missing: an
 * *answer*, not a crash, so pages render a "database not connected" state and
 * `next build` completes on a deployment that has no env vars yet.
 */

export const NOT_CONFIGURED: ServiceError = {
  kind: "not-configured",
  message: "The admin area needs the database: add DATABASE_URL and try again.",
};

export function getAdminClient(): { ok: true; client: true } | { ok: false; error: ServiceError } {
  if (!isDatabaseConfigured()) {
    return { ok: false, error: NOT_CONFIGURED };
  }

  return { ok: true, client: true };
}
