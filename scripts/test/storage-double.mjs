/**
 * A minimal Supabase Storage double, in memory.
 *
 * WHY THIS EXISTS
 *   The gallery is the first feature that stores *files*, and the interesting part
 *   of it is not the bytes — it is where the bytes are allowed to live. A draft
 *   photograph sits in a private bucket and is not publicly reachable; publishing
 *   it moves the object into the public bucket; deleting the row deletes both
 *   versions. None of that can be checked against a real Supabase project in this
 *   environment, and none of it should be *assumed*, so storage is doubled the
 *   same way the database is: a real HTTP surface speaking the subset of the
 *   Storage API that `@supabase/storage-js` uses, so the app's own client code is
 *   what gets exercised.
 *
 * WHAT THIS IS NOT
 *   It is not the storage service. It models the two buckets the gallery uses, the
 *   upload / download / move / delete calls those flows make, the public route's
 *   rule that only a public bucket is served, and the service-role rule that
 *   nothing else may reach a private bucket. Anything outside that subset is
 *   answered with an honest error rather than a guess.
 *
 * The double is deliberately assertable: `objects` is a map of live objects and
 * `requests` is a log of what was asked of it, so a test can say "the file is in
 * the inbox, not the public bucket" without going through the app's own API.
 */

const PRIVATE_OBJECT_ERROR = {
  statusCode: "400",
  error: "InvalidRequest",
  message: "Object not found",
};

const UNAUTHORIZED_ERROR = {
  statusCode: "403",
  error: "Unauthorized",
  message: "new row violates row-level security policy",
};

/** Splits a `multipart/form-data` body into named fields and the uploaded file. */
function parseMultipart(buffer, contentType) {
  const boundaryMatch = /boundary=("?)([^";]+)\1/i.exec(contentType ?? "");

  if (!boundaryMatch) {
    return { fields: {}, file: null };
  }

  // `@supabase/storage-js` sends FormData for a Blob: `cacheControl` (and metadata)
  // as fields, then the file under an empty name.
  const boundary = Buffer.from(`--${boundaryMatch[2]}`);
  const fields = {};
  let file = null;
  let cursor = buffer.indexOf(boundary);

  while (cursor !== -1) {
    let start = cursor + boundary.length;

    if (buffer.subarray(start, start + 2).toString() === "--") {
      break;
    }

    if (buffer.subarray(start, start + 2).toString() === "\r\n") {
      start += 2;
    }

    const next = buffer.indexOf(boundary, start);

    if (next === -1) {
      break;
    }

    let end = next;

    if (buffer.subarray(end - 2, end).toString() === "\r\n") {
      end -= 2;
    }

    const section = buffer.subarray(start, end);
    const headerEnd = section.indexOf("\r\n\r\n");
    const headerText = section.subarray(0, Math.max(headerEnd, 0)).toString("utf8");
    const payload = section.subarray(headerEnd + 4);
    const name = /name="([^"]*)"/i.exec(headerText)?.[1] ?? "";
    const filename = /filename="([^"]*)"/i.exec(headerText)?.[1] ?? null;
    const partType = /^content-type:\s*(.+)$/im.exec(headerText)?.[1]?.trim() ?? null;

    if (filename !== null || name === "") {
      file = {
        filename: filename ?? "",
        contentType: partType ?? "application/octet-stream",
        data: Buffer.from(payload),
      };
    } else {
      fields[name] = payload.toString("utf8");
    }

    cursor = next;
  }

  return { fields, file };
}

export function createStorageDouble() {
  /** bucket id → { public, fileSizeLimit, allowedMimeTypes } */
  const buckets = new Map();
  /** "bucket/key" → { data, contentType, cacheControl, updatedAt } */
  const objects = new Map();
  /** Every call the app made, for tests that want to prove *how* something happened. */
  const requests = [];

  function objectKey(bucket, path) {
    return `${bucket}/${path}`;
  }

  function setBucket(id, options = {}) {
    buckets.set(id, {
      public: options.public === true,
      fileSizeLimit: options.fileSizeLimit ?? null,
      allowedMimeTypes: options.allowedMimeTypes ?? null,
    });
  }

  function list(prefix = "") {
    return [...objects.keys()].filter((key) => key.startsWith(prefix)).sort();
  }

  function decodePath(pathname) {
    return decodeURIComponent(pathname).replace(/^\/+/, "");
  }

  /**
   * Answers one Storage API request.
   *
   * `role` is the role the request's key belongs to — `service_role` for the
   * server-side client the app uses, anything else for a key that should not be
   * able to touch a private bucket.
   */
  function handle({ method, pathname, headers, body, role }) {
    const relative = pathname.replace(/^\/storage\/v1/, "");
    const route = { method, path: relative, role };
    requests.push(route);

    const json = (status, payload) => ({ status, body: payload });
    const isService = role === "service_role";

    // POST /object/<bucket>/<path…> — upload (with `x-upsert: true`, an overwrite)
    // PUT /object/<bucket>/<path…> — upload without upsert
    const uploadMatch = /^\/object\/([^/]+)\/?(.*)$/.exec(relative);

    // `/object/<bucket>/…` is the upload route, but the same shape also carries the
    // sub-commands (`/object/move`, `/object/list/<bucket>`, `/object/sign/…`): a
    // bucket really could be called "list", so the reserved names win.
    const RESERVED_OBJECT_PATHS = new Set(["move", "copy", "list", "list-v2", "sign", "info", "public", "authenticated"]);

    if ((method === "POST" || method === "PUT") && uploadMatch && !RESERVED_OBJECT_PATHS.has(uploadMatch[1])) {
      const [, bucket, rawPath] = uploadMatch;
      const path = decodePath(rawPath);

      if (!isService) {
        return json(403, UNAUTHORIZED_ERROR);
      }

      if (!buckets.has(bucket)) {
        return json(404, { statusCode: "404", error: "Bucket not found", message: "Bucket not found" });
      }

      // Node lower-cases incoming header names; the app's own tests may pass them
      // either way, so both spellings are accepted here.
      const contentType = headers["content-type"] ?? headers["Content-Type"] ?? headers.contentType;
      const { fields, file } = (contentType ?? "").includes("multipart/form-data")
        ? parseMultipart(body, contentType)
        : { fields: {}, file: { contentType: contentType ?? "application/octet-stream", data: body, filename: "" } };

      if (!file || file.data.length === 0) {
        return json(400, { statusCode: "400", error: "InvalidRequest", message: "The file body was empty" });
      }

      const bucketInfo = buckets.get(bucket);

      if (bucketInfo.fileSizeLimit && file.data.length > bucketInfo.fileSizeLimit) {
        return json(400, {
          statusCode: "413",
          error: "EntityTooLarge",
          message: "The object exceeded the maximum allowed size",
        });
      }

      if (bucketInfo.allowedMimeTypes && !bucketInfo.allowedMimeTypes.includes(file.contentType)) {
        return json(400, {
          statusCode: "415",
          error: "InvalidMimeType",
          message: `mime type ${file.contentType} is not supported`,
        });
      }

      objects.set(objectKey(bucket, path), {
        data: file.data,
        contentType: file.contentType,
        cacheControl: fields.cacheControl ?? "3600",
        updatedAt: Date.now(),
      });

      return json(200, { Id: `obj-${objects.size}`, Key: objectKey(bucket, path) });
    }

    // DELETE /object/<bucket> with { prefixes: [...] }
    if (method === "DELETE" && /^\/object\/[^/]+$/.test(relative)) {
      const bucket = relative.replace("/object/", "");

      if (!isService) {
        return json(403, UNAUTHORIZED_ERROR);
      }

      const prefixes = Array.isArray(body?.prefixes) ? body.prefixes : [];
      const removed = prefixes.filter((path) => objects.delete(objectKey(bucket, path)));

      return json(200, removed.map((path) => ({ name: path })));
    }

    // POST /object/move — between buckets as well as inside one
    if (method === "POST" && relative === "/object/move") {
      if (!isService) {
        return json(403, UNAUTHORIZED_ERROR);
      }

      const { bucketId, sourceKey, destinationKey, destinationBucket } = body ?? {};
      const target = destinationBucket || bucketId;

      if (!buckets.has(target)) {
        return json(404, { statusCode: "404", error: "Bucket not found", message: "Bucket not found" });
      }

      const source = objectKey(bucketId, sourceKey);
      const entry = objects.get(source);

      if (!entry) {
        return json(400, { statusCode: "400", error: "InvalidRequest", message: "Object not found" });
      }

      objects.delete(source);
      objects.set(objectKey(target, destinationKey), { ...entry, updatedAt: Date.now() });

      return json(200, { Id: `obj-${objects.size}`, Key: objectKey(target, destinationKey) });
    }

    // GET /object/public/<bucket>/<path…> — the URL the website actually loads
    const publicMatch = /^\/object\/public\/([^/]+)\/?(.*)$/.exec(relative);

    if (method === "GET" && publicMatch) {
      const [, bucket, rawPath] = publicMatch;
      const bucketInfo = buckets.get(bucket);

      // A public bucket is served without any key; a private one is not served at
      // all, which is exactly the property the gallery depends on.
      if (!bucketInfo?.public) {
        return json(400, PRIVATE_OBJECT_ERROR);
      }

      const entry = objects.get(objectKey(bucket, decodePath(rawPath)));

      if (!entry) {
        return json(400, PRIVATE_OBJECT_ERROR);
      }

      return {
        status: 200,
        raw: entry.data,
        headers: { "content-type": entry.contentType, "cache-control": `max-age=${entry.cacheControl}` },
      };
    }

    // POST /object/sign/<bucket>/<path…> — a time-limited URL
    const signMatch = /^\/object\/sign\/([^/]+)\/?(.*)$/.exec(relative);

    if (method === "POST" && signMatch) {
      const [, bucket, rawPath] = signMatch;
      const path = decodePath(rawPath);

      if (!isService && !buckets.get(bucket)?.public) {
        return json(403, UNAUTHORIZED_ERROR);
      }

      if (!objects.has(objectKey(bucket, path))) {
        return json(400, PRIVATE_OBJECT_ERROR);
      }

      return json(200, { signedURL: `/object/sign/${bucket}/${path}?token=${Buffer.from(path).toString("base64url")}` });
    }

    // GET /object/<bucket>/<path…> — an authenticated download, no signed URL
    const downloadMatch = /^\/object\/([^/]+)\/?(.*)$/.exec(relative);

    if (method === "GET" && downloadMatch && !relative.startsWith("/object/list")) {
      const [, bucket, rawPath] = downloadMatch;

      // With no policy granting `select` on storage.objects, the service role is
      // the only key that can read a private object through the API.
      if (!isService) {
        return json(403, UNAUTHORIZED_ERROR);
      }

      const entry = objects.get(objectKey(bucket, decodePath(rawPath)));

      if (!entry) {
        return json(400, PRIVATE_OBJECT_ERROR);
      }

      return {
        status: 200,
        raw: entry.data,
        headers: { "content-type": entry.contentType },
      };
    }

    // POST /object/list/<bucket> — used by the management screen to spot orphans
    if (method === "POST" && relative.startsWith("/object/list/")) {
      if (!isService) {
        return json(403, UNAUTHORIZED_ERROR);
      }

      const bucket = relative.replace("/object/list/", "");
      const prefix = body?.prefix ?? "";

      return json(
        200,
        list(objectKey(bucket, prefix)).map((key) => ({
          name: key.slice(bucket.length + 1),
          id: key,
          updated_at: new Date().toISOString(),
        })),
      );
    }

    // GET /bucket/<id>
    if (method === "GET" && relative.startsWith("/bucket/")) {
      const id = relative.replace("/bucket/", "");

      if (!isService) {
        return json(403, UNAUTHORIZED_ERROR);
      }

      const bucketInfo = buckets.get(id);

      if (!bucketInfo) {
        return json(404, { statusCode: "404", error: "Bucket not found", message: "Bucket not found" });
      }

      return json(200, {
        id,
        name: id,
        public: bucketInfo.public,
        file_size_limit: bucketInfo.fileSizeLimit,
        allowed_mime_types: bucketInfo.allowedMimeTypes,
      });
    }

    return json(404, { statusCode: "404", error: "InvalidRequest", message: `Unsupported storage route: ${method} ${relative}` });
  }

  return { handle, buckets, objects, requests, setBucket, list };
}
