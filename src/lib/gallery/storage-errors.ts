export type GalleryStorageOperation = "store" | "read";

/** Turn Vercel Blob SDK failures into the deployment actions an organiser can take. */
export function storageFailureMessage(error: unknown, operation: GalleryStorageOperation): string {
  const source = (typeof error === "object" && error !== null ? error : {}) as {
    message?: unknown;
    name?: unknown;
    status?: unknown;
    statusCode?: unknown;
    code?: unknown;
  };
  const status = Number(source.statusCode ?? source.status);
  const detail = typeof source.message === "string" ? source.message : String(error);
  const name = typeof source.name === "string" ? source.name : "";
  const code = typeof source.code === "string" ? source.code : "";
  const isAuthorizationFailure =
    status === 401 ||
    status === 403 ||
    /BlobAccessError|BlobStoreNotFoundError|BlobStoreSuspendedError|access.?denied|unauthori[sz]ed|forbidden/i.test(name) ||
    /invalid.{0,20}token|token.{0,20}(invalid|expired|unauthori[sz]ed|access)|unauthori[sz]ed|forbidden|access denied|valid token|store does not exist|store has been suspended/i.test(detail) ||
    /BLOB_(ACCESS|STORE_NOT_FOUND|STORE_SUSPENDED)|FORBIDDEN|UNAUTHORIZED/i.test(code);

  const credentialSteps =
    "In Vercel → Project → Storage, connect the correct Blob store and make sure BLOB_READ_WRITE_TOKEN is available for this environment (Production, and Preview if used), then redeploy.";

  if (isAuthorizationFailure) {
    return `Vercel Blob rejected this deployment's credentials. ${credentialSteps} The photo could not be ${operation === "store" ? "stored" : "read"}.`;
  }

  return `Vercel Blob could not ${operation} this photo. Check that the Blob store is connected to this project and BLOB_READ_WRITE_TOKEN is available for this environment (Production, and Preview if used); then redeploy. If it still fails, check the Vercel Function logs.${operation === "store" ? " Nothing was saved." : ""}`;
}
