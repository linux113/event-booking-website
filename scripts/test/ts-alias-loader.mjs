/**
 * ESM resolver hooks so the verification scripts can import the app's real
 * TypeScript service modules in plain Node:
 *   - maps the `@/*` path alias to `<repo>/src/*`
 *   - resolves extensionless imports to .ts / .tsx / index files
 *
 * Type stripping itself is done by Node (enabled by default on Node 22.18+).
 */
import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");

const CANDIDATE_EXTENSIONS = ["", ".ts", ".tsx", ".mts", ".js", "/index.ts", "/index.tsx"];

function resolveFile(basePath) {
  for (const extension of CANDIDATE_EXTENSIONS) {
    const candidate = basePath + extension;

    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const file = resolveFile(join(REPO_ROOT, "src", specifier.slice(2)));

    if (file) {
      return { url: pathToFileURL(file).href, shortCircuit: true };
    }
  }

  // Relative imports inside the app omit extensions too.
  if (specifier.startsWith(".")) {
    const parentPath = fileURLToPath(context.parentURL);
    const file = resolveFile(resolvePath(dirname(parentPath), specifier));

    if (file) {
      return { url: pathToFileURL(file).href, shortCircuit: true };
    }
  }

  return nextResolve(specifier, context);
}
