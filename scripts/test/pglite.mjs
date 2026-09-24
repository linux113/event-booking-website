/**
 * PGlite configured with PostgreSQL date values matching the app's raw-row contract.
 *
 * Its default parser turns `date` columns into JavaScript `Date` objects, which JSON
 * serializes as ISO timestamps. PostgreSQL drivers used by the application expose
 * those values as `YYYY-MM-DD` strings, so the parser for date (OID 1082) passes the
 * value through unchanged.
 *
 * The database setup tests use this in-process PostgreSQL instance to exercise the
 * real migration chain and constraints without connecting to a hosted database.
 */
import { PGlite, types } from "@electric-sql/pglite";

export function createVerificationDb() {
  return new PGlite({
    parsers: {
      [types.DATE]: (value) => value,
    },
  });
}
