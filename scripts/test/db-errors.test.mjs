import assert from "node:assert/strict";
import { register } from "node:module";

register("./ts-alias-loader.mjs", import.meta.url);
const { DatabaseError, toDatabaseError } = await import("../../src/lib/db/client.ts");

function check(label, run) {
  run();
  console.log(`  ✓ ${label}`);
}

const prismaRawQueryError = Object.assign(
  new Error("Raw query failed. Code: `PB002`. Message: `night_not_bookable`"),
  {
    code: "P2010",
    meta: {
      driverAdapterError: {
        cause: {
          originalCode: "PB002",
          code: "PB002",
          kind: "postgres",
          message: "night_not_bookable",
          detail: "booking is closed",
          hint: "choose another night",
        },
      },
    },
  },
);

check("Prisma P2010 preserves the underlying custom PostgreSQL SQLSTATE", () => {
  const error = toDatabaseError(prismaRawQueryError);
  assert.ok(error instanceof DatabaseError);
  assert.equal(error.code, "PB002");
  assert.equal(error.message, "night_not_bookable");
  assert.equal(error.details, "booking is closed");
  assert.equal(error.hint, "choose another night");
});

check("direct PostgreSQL errors keep their SQLSTATE and details", () => {
  const error = toDatabaseError(
    Object.assign(new Error("duplicate key"), {
      code: "23505",
      detail: "Key already exists.",
      hint: "Use a different key.",
    }),
  );
  assert.equal(error.code, "23505");
  assert.equal(error.details, "Key already exists.");
  assert.equal(error.hint, "Use a different key.");
});

check("existing DatabaseError instances pass through unchanged", () => {
  const original = new DatabaseError("night_not_bookable", { code: "PB002" });
  assert.equal(toDatabaseError(original), original);
});

console.log("\n3 passed, 0 failed");
