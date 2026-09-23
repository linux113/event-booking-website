/**
 * A minimal PostgREST-compatible HTTP server for tests.
 *
 * WHY THIS EXISTS
 *   The app talks to Supabase through `@supabase/supabase-js`, which speaks
 *   PostgREST over HTTP. There is no Supabase project in this environment, so to
 *   test the *real* client code paths (the exact queries, filters, RPC calls and
 *   Row Level Security behaviour) we put a real PostgreSQL database behind a
 *   tiny HTTP layer that understands the subset of the PostgREST protocol the
 *   app uses.
 *
 * WHAT THIS IS NOT
 *   It is not a PostgREST conformance implementation, and it is not shipped: it
 *   is a test double for the transport. Anything it does not support is logged
 *   and ignored rather than silently accepted, so a query the app sends that the
 *   shim cannot model shows up as a visible warning in the test output.
 *
 * Supports: GET /rest/v1/<table> with select, eq/in/gte/lte/is filters, order,
 * limit; POST /rest/v1/rpc/<function> with JSON arguments — a set-returning
 * function answers with an array, a scalar-returning one with a bare value, as
 * PostgREST does; anon/authenticated/service_role derived from the Authorization
 * header, so RLS is exercised for real. Raised exceptions keep their SQLSTATE/detail, which is how the booking
 * API tells capacity failures from duplicate submissions.
 *
 * It can also carry `/auth/v1/*` for the Supabase Auth double
 * (`./supabase-auth-stub.mjs`), so a server-side session — sign in, cookie,
 * `getUser()`, staff allow-list — can be exercised end to end without a Supabase
 * project. Pass an `auth` handler to enable it.
 *
 * `/storage/v1/*` is mounted here too, forwarded to the Storage double
 * (`./storage-double.mjs`), because Supabase serves storage from the same origin
 * as the REST API: the app builds its storage URLs from
 * `NEXT_PUBLIC_SUPABASE_URL`, which in this harness is the shim. The returned
 * `storage` handle is the in-memory bucket state a test can inspect.
 */
import { createServer } from "node:http";

import { createStorageDouble } from "./storage-double.mjs";

const UNSUPPORTED = new Set();

/**
 * A request body, shaped the way the Storage double reads it.
 *
 * An upload arrives as bytes — multipart when the client sent a file, or the raw
 * file with its own content type. The commands (`move`, `remove`, `list`, `sign`)
 * arrive as a small JSON document instead. So: parse when the bytes *are* JSON, and
 * hand over the untouched buffer otherwise. Guessing from the content type alone
 * would break a raw upload whose bytes happen not to be valid UTF-8.
 */
function storageBody(contentType, raw) {
  if (contentType.includes("multipart/form-data")) {
    return raw;
  }

  try {
    const parsed = JSON.parse(raw.toString("utf8"));

    return parsed !== null && typeof parsed === "object" ? parsed : raw;
  } catch {
    return raw;
  }
}

function logUnsupported(what) {
  if (!UNSUPPORTED.has(what)) {
    UNSUPPORTED.add(what);
    console.warn(`  \u001b[33m!\u001b[0m shim: unsupported query feature ignored: ${what}`);
  }
}

function quoteIdent(value) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe identifier: ${value}`);
  }
  return `"${value}"`;
}

/** Decode a JWT payload without verifying it — the shim only needs the claims. */
function roleFromAuthHeader(header) {
  if (!header) {
    return { role: "anon", sub: null };
  }

  const token = header.replace(/^Bearer\s+/i, "");

  if (!token || token === "anon") {
    return { role: "anon", sub: null };
  }

  const [, payload] = token.split(".");

  if (!payload) {
    return { role: "anon", sub: null };
  }

  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));

    return { role: claims.role ?? "authenticated", sub: claims.sub ?? null };
  } catch {
    return { role: "anon", sub: null };
  }
}

/** Parse PostgREST filter params (`column=eq.value`, `column=in.(a,b)`). */
function buildWhere(params) {
  const clauses = [];
  const values = [];

  for (const [key, raw] of params.entries()) {
    if (["select", "order", "limit", "offset", "on_conflict"].includes(key)) {
      continue;
    }

    const [operator, ...rest] = raw.split(".");
    const operand = rest.join(".");

    switch (operator) {
      case "eq": {
        clauses.push(`${quoteIdent(key)} = $${values.length + 1}`);
        values.push(operand);
        break;
      }
      case "neq": {
        clauses.push(`${quoteIdent(key)} <> $${values.length + 1}`);
        values.push(operand);
        break;
      }
      case "gte": {
        clauses.push(`${quoteIdent(key)} >= $${values.length + 1}`);
        values.push(operand);
        break;
      }
      case "lte": {
        clauses.push(`${quoteIdent(key)} <= $${values.length + 1}`);
        values.push(operand);
        break;
      }
      case "in": {
        const list = operand
          .replace(/^\(|\)$/g, "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
        const placeholders = list.map((_, index) => `$${values.length + index + 1}`);
        clauses.push(`${quoteIdent(key)} in (${placeholders.join(", ")})`);
        values.push(...list);
        break;
      }
      case "is": {
        if (operand === "null") {
          clauses.push(`${quoteIdent(key)} is null`);
        } else if (operand === "true") {
          clauses.push(`${quoteIdent(key)} is true`);
        } else if (operand === "false") {
          clauses.push(`${quoteIdent(key)} is false`);
        }
        break;
      }
      default:
        logUnsupported(`${key}=${raw}`);
    }
  }

  return { where: clauses.length ? `where ${clauses.join(" and ")}` : "", values };
}

function buildOrder(raw) {
  if (!raw) {
    return "";
  }

  const parts = raw.split(",").map((entry) => {
    const [column, ...modifiers] = entry.split(".");
    const direction = modifiers.includes("desc") ? "desc" : "asc";
    const nulls = modifiers.includes("nullsfirst") ? " nulls first" : "";

    return `${quoteIdent(column)} ${direction}${nulls}`;
  });

  return `order by ${parts.join(", ")}`;
}

function buildSelect(raw) {
  if (!raw || raw === "*") {
    return "*";
  }

  if (raw.includes("(")) {
    logUnsupported(`embedded select: ${raw}`);
    return "*";
  }

  return raw
    .split(",")
    .map((column) => quoteIdent(column.trim()))
    .join(", ");
}

/**
 * `true` when the function returns a single value rather than a set.
 *
 * PostgREST serialises a scalar-returning function as a bare JSON value and a
 * set-returning one as an array, and the app sees that difference, so the shim has to
 * answer the same question the same way: by asking the catalog.
 */
function scalarFunctionSql(fnName) {
  const safe = fnName.replace(/'/g, "''");

  return `
    select (not p.proretset
            and p.prorettype not in ('pg_catalog.record'::regtype, 'pg_catalog.void'::regtype)
            and p.prorettype <> 'pg_catalog.trigger'::regtype) as is_scalar
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = '${safe}'
     limit 1;
  `;
}

export async function startShim({ db, port = 0, log = false, auth = null, storage = null }) {
  // PGlite is single-connection; serialise every statement through one chain.
  let queue = Promise.resolve();

  const buckets = storage ?? createStorageDouble();

  function serialised(task) {
    const result = queue.then(task, task);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function runAs(role, sub, sql, values) {
    return serialised(async () => {
      await db.exec(`set role ${role};`);
      await db.exec(`select set_config('request.jwt.claim.sub', '${sub ?? ""}', false);`);

      try {
        return await db.query(sql, values);
      } finally {
        await db.exec("select set_config('request.jwt.claim.sub', '', false);");
        await db.exec("reset role;");
      }
    });
  }

  const server = createServer((req, res) => {
    (async () => {
      const url = new URL(req.url, "http://localhost");
      const { role, sub } = roleFromAuthHeader(req.headers.authorization);

      if (log) {
        console.log(`  → ${req.method} ${url.pathname}${url.search} [${role}]`);
      }

      if (url.pathname.startsWith("/auth/v1/")) {
        if (!auth) {
          return respond(res, 404, { message: "This shim was started without an auth stub." });
        }

        const result = await auth.handle({
          method: req.method,
          pathname: url.pathname,
          searchParams: url.searchParams,
          headers: req.headers,
          body: await readJsonBody(req),
        });

        return respond(res, result.status, result.body);
      }

      if (url.pathname.startsWith("/storage/v1/")) {
        const contentType = String(req.headers["content-type"] ?? "");
        const rawBody = await readRawBody(req);

        const result = buckets.handle({
          method: req.method,
          pathname: url.pathname,
          headers: req.headers,
          body: storageBody(contentType, rawBody),
          // Storage authorises by the key in the header, exactly as the hosted
          // service does: the service-role key reaches everything, an anon key
          // reaches only what a policy allows — and the gallery grants nothing.
          role,
        });

        if (result.raw) {
          res.writeHead(result.status, {
            ...(result.headers ?? {}),
            "content-length": result.raw.length,
          });
          res.end(result.raw);

          return;
        }

        return respond(res, result.status, result.body);
      }

      if (url.pathname.startsWith("/rest/v1/rpc/")) {
        const fnName = url.pathname.replace("/rest/v1/rpc/", "");
        const body = await readJsonBody(req);
        const keys = Object.keys(body);

        const placeholders = keys.map((_, index) => `$${index + 1}`);
        const args = keys.map((key) => `${quoteIdent(key)} => ${placeholders[keys.indexOf(key)]}`);

        const { rows } = await runAs(
          role,
          sub,
          `select * from ${quoteIdent(fnName)}(${args.join(", ")})`,
          keys.map((key) => body[key]),
        );

        // Scalar or set-returning? PostgREST asks the catalog and shapes the response
        // accordingly, and supabase-js gives the app whatever comes back — so the
        // difference is visible to the app and has to be modelled here too.
        const scalar = await runAs(role, sub, scalarFunctionSql(fnName));

        if (scalar.rows[0]?.is_scalar) {
          const [first] = rows;
          const value = first ? Object.values(first)[0] ?? null : null;

          return respond(res, 200, value);
        }

        return respond(res, 200, rows);
      }

      if (url.pathname.startsWith("/rest/v1/")) {
        const table = url.pathname.replace("/rest/v1/", "");
        const params = url.searchParams;
        const { where, values } = buildWhere(params);
        const order = buildOrder(params.get("order"));
        const limit = params.get("limit") ? Number(params.get("limit")) : null;

        const sql = [
          `select ${buildSelect(params.get("select"))} from ${quoteIdent(table)}`,
          where,
          order,
          limit !== null && Number.isFinite(limit) ? `limit ${limit}` : "",
        ]
          .filter(Boolean)
          .join(" ");

        const { rows } = await runAs(role, sub, sql, values);

        return respond(res, 200, rows);
      }

      respond(res, 404, { message: "Not found" });
    })().catch((error) => {
      // PostgREST hands the client the real SQLSTATE, message and detail. The app
      // branches on the code (capacity, pass not on sale, duplicate key), so the
      // shim must not flatten them into a generic error.
      const code = typeof error?.code === "string" && error.code.length === 5 ? error.code : "SHIM_ERROR";
      const status = code === "23505" ? 409 : 400;

      if (code === "SHIM_ERROR") {
        console.error("  shim error:", error.message);
      }

      respond(res, status, {
        message: error?.message ?? "shim error",
        code,
        details: error?.detail ?? null,
        hint: error?.hint ?? null,
      });
    });
  });

  function respond(res, status, body) {
    // 204 (and a null body) must not be written as JSON: Supabase Auth answers
    // logout with an empty response, and supabase-js reads that as success.
    if (status === 204 || body === null || body === undefined) {
      res.writeHead(status, { "content-length": 0 });
      res.end();

      return;
    }

    const payload = JSON.stringify(body);
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(payload),
    });
    res.end(payload);
  }

  function readRawBody(req) {
    return new Promise((resolve) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", () => resolve(Buffer.alloc(0)));
    });
  }

  function readJsonBody(req) {
    return new Promise((resolve) => {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
      });
      req.on("end", () => {
        try {
          resolve(raw ? JSON.parse(raw) : {});
        } catch {
          resolve({});
        }
      });
    });
  }

  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

  const address = server.address();

  return {
    url: `http://127.0.0.1:${address.port}`,
    unsupported: UNSUPPORTED,
    storage: buckets,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
