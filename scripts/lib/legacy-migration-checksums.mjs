/**
 * SHA-256 values recorded by earlier Neon installs before provider-specific
 * comments and no-op storage setup were removed from the PostgreSQL history.
 *
 * The SQL effects are unchanged for Neon. Recognizing these exact prior hashes
 * keeps `db:setup` incremental without hiding any future edit to a migration.
 */
export const LEGACY_MIGRATION_CHECKSUMS = Object.freeze({
  "prelude.sql": ["db1109e26adfb63763615ee6c0565160b441c42c0d608dca34a123f034d7563c"],
  "seed.sql": ["18005aa51a76513af83d5a8063bcae9cbc7dabd83bbe5f8d41c46604023342f7"],
  "20260922090000_init_schema.sql": ["d47ccf2a2b8f8d91cf318a97a2d0f88a57fda03ea617694a0ffc37539acd9ea6"],
  "20260922090100_rls_policies.sql": ["8fb100de19bff85c9a3c452e139c7cc02677a01b9e86bb1fa6dbbe8325e32bde"],
  "20260922091300_gallery_management.sql": ["8bf09913f53486ac6e3053c49233eddaebc6652b9bb40a3ad111b29d5a228dc2"],
  "20260923090000_single_admin.sql": ["baafb2d8dd0549da33a4b37e303064e435c88b0ac796f04af0e586135c32950b"],
});

export function isKnownLegacyChecksum(filename, checksum) {
  return LEGACY_MIGRATION_CHECKSUMS[filename]?.includes(checksum) ?? false;
}
