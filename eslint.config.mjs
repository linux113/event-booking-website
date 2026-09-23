import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // `npm run verify:web` builds the app into its own dist directory (see
    // `DIST_DIR` in scripts/verify-web.mjs). It is generated code, and it is gitignored,
    // but flat config patterns are anchored at the config root, so neither `.next/**`
    // nor `build/**` reaches inside it — without this line, a lint run after a
    // verification run reports thousands of errors from bundles nobody wrote.
    ".next-verify/**",
    // Prisma generates the typed client into src/generated/prisma on every build
    // (`npm run db:generate`). It is machine-written TypeScript, it is gitignored,
    // and linting it reports style rules nobody can fix.
    "src/generated/**",
  ]),
]);

export default eslintConfig;
