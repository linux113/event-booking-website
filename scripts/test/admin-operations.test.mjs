import assert from "node:assert/strict";
import { register } from "node:module";

register("./ts-alias-loader.mjs", import.meta.url);
const { paiseToRupees } = await import("../../src/lib/admin/operations.ts");

const cases = [
  ["number amounts are rounded to whole rupees", () => assert.equal(paiseToRupees(49_950), 500)],
  ["Postgres bigint values are rounded without mixing numeric types", () => assert.equal(paiseToRupees(49_950n), 500)],
  ["decimal-string bigint values are supported", () => assert.equal(paiseToRupees("49950"), 500)],
  ["positive half-paise boundary rounds up", () => assert.equal(paiseToRupees(12_550n), 126)],
  ["negative half boundary matches Math.round semantics", () => assert.equal(paiseToRupees(-150n), -1)],
  ["negative values below the half boundary round down", () => assert.equal(paiseToRupees(-151n), -2)],
  ["null stays null", () => assert.equal(paiseToRupees(null), null)],
  ["malformed driver strings stay null", () => assert.equal(paiseToRupees("49.95"), null)],
  ["unsafe rupee totals stay null instead of displaying a rounded lie", () => assert.equal(paiseToRupees(900719925474099200n), null)],
];

for (const [label, run] of cases) {
  run();
  console.log(`  ✓ ${label}`);
}

console.log(`\n${cases.length} passed, 0 failed`);
