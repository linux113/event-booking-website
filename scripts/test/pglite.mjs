/**
 * PGlite configured to behave like the real Supabase PostgREST API.
 *
 * PostgREST returns `date` columns as plain `YYYY-MM-DD` strings. PGlite's
 * default parser turns them into JavaScript `Date`s, which JSON-serialise as
 * ISO timestamps — a difference that would make local renders disagree with
 * production. The parser for `date` (OID 1082) is therefore overridden to hand
 * the value through untouched.
 *
 * Used by both verification scripts, so the checks always run against the same
 * database behaviour the deployed site will see.
 */
import { PGlite, types } from "@electric-sql/pglite";

export function createVerificationDb() {
  return new PGlite({
    parsers: {
      [types.DATE]: (value) => value,
    },
  });
}
