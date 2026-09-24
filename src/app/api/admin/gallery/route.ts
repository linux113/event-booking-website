import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import {
  bodyString,
  catalogueError,
  catalogueJson,
  forbidden,
  readCatalogueBody,
  unauthorized,
} from "@/lib/admin/api";
import {
  firstGalleryError,
  isCleanGalleryForm,
  parseGalleryForm,
} from "@/lib/admin/gallery";
import {
  GALLERY_UPLOAD_FILES_PER_REQUEST,
  GALLERY_UPLOAD_REQUEST_BYTES,
} from "@/lib/admin/gallery-upload";
import { isDatabaseConfigured } from "@/config/env";
import { can } from "@/lib/auth/permissions";
import { getStaffMember } from "@/lib/auth/staff";
import {
  deleteGalleryItem,
  moveGalleryItem,
  saveGalleryItem,
  setGalleryItemStatus,
  uploadGalleryItem,
} from "@/lib/services/gallery-admin";
import { isGalleryStatus, type GalleryUploadOutcome } from "@/types/gallery";

/**
 * POST /api/admin/gallery — upload photographs, edit one, publish it, move it, delete it.
 *
 * The bytes of a photograph are served from a sibling route
 * (`/api/admin/gallery/preview`) because reading and changing are different
 * capabilities, and the request hook guards each on its own.
 *
 * One endpoint, because every action shares the same two checks (a staff session and
 * the `gallery:edit` capability) and the same answer shape. Uploads arrive as
 * `multipart/form-data` — the file is the payload — and everything else as JSON;
 * which one it is is decided by the content type, not by a query parameter, so a
 * file can never be smuggled into a JSON action.
 *
 * The order of the checks is the same as the pass and date endpoints: identity
 * (401/403) before the body is read, then shape (400), then the database's own rules
 * (409, with the field and the sentence to show). An upload adds one step in front of
 * that: the image is decoded, resized and re-encoded before anything is written, so a
 * file that is not a photograph, or is too small to use, is refused without touching
 * storage.
 */

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The upload's own ceiling: the same number the storage schema and form state. */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** Enforced before `request.formData()` buffers the multipart request. */
const MAX_UPLOAD_REQUEST_BYTES = GALLERY_UPLOAD_REQUEST_BYTES;

function revalidatePublicGallery(): void {
  // The public gallery uses a short ISR interval; invalidate immediately when its
  // rows or captions change so Publish has an immediate, visible effect.
  revalidatePath("/gallery");
  revalidatePath("/");
}

export async function POST(request: Request): Promise<NextResponse> {
  const staff = await getStaffMember();

  if (!staff) {
    return unauthorized();
  }

  if (!can(staff.role, "gallery:edit")) {
    return forbidden("Your role can see the gallery but cannot change it.");
  }

  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    return uploadMany(request);
  }

  const read = await readCatalogueBody(request);

  if (!read.ok) {
    return read.response;
  }

  const action = bodyString(read.body, "action", 20);

  if (action === "save") {
    const { values, errors } = parseGalleryForm(read.body.item);

    if (!isCleanGalleryForm(errors)) {
      const first = firstGalleryError(errors);

      return catalogueError("invalid-input", first?.message ?? "Check the form.", { field: first?.field });
    }

    if (!values.id || !UUID.test(values.id)) {
      return catalogueError("invalid-input", "That photograph could not be identified — reload the page.", {
        field: "title",
      });
    }

    const result = await saveGalleryItem(values);
    if (result.ok) revalidatePublicGallery();
    return catalogueJson(result);
  }

  if (action === "status") {
    const id = bodyString(read.body, "id", 36);
    const status = bodyString(read.body, "status", 12);

    if (!UUID.test(id) || !isGalleryStatus(status)) {
      return catalogueError("invalid-input", "That photograph could not be identified — reload the page.", {
        field: "status",
      });
    }

    const result = await setGalleryItemStatus(id, status);
    if (result.ok) revalidatePublicGallery();
    return catalogueJson(result);
  }

  if (action === "move") {
    const id = bodyString(read.body, "id", 36);
    const direction = bodyString(read.body, "direction", 6);

    if (!UUID.test(id) || (direction !== "up" && direction !== "down")) {
      return catalogueError("invalid-input", "That photograph could not be identified — reload the page.", {
        field: "order",
      });
    }

    const result = await moveGalleryItem(id, direction);
    if (result.ok) revalidatePublicGallery();
    return catalogueJson(result);
  }

  if (action === "delete") {
    const id = bodyString(read.body, "id", 36);

    if (!UUID.test(id)) {
      return catalogueError("invalid-input", "That photograph could not be identified — reload the page.", {
        field: "delete",
      });
    }

    const result = await deleteGalleryItem(id);
    if (result.ok) revalidatePublicGallery();
    return catalogueJson(result);
  }

  return catalogueError("invalid-input", "Unknown action.", { field: "title" });
}

/**
 * Take a batch of files.
 *
 * Every file is handled on its own: one photograph that is too small, or in a format
 * we cannot read, is reported against its file name and the rest of the batch still
 * lands. Failing a whole night's upload because one of forty pictures is a screenshot
 * would be the wrong behaviour, and silently skipping it would be worse.
 */
async function uploadMany(request: Request): Promise<NextResponse> {
  if (!isDatabaseConfigured()) {
    return catalogueError("not-configured", "The gallery needs DATABASE_URL before photos can be uploaded.");
  }

  const declared = Number(request.headers.get("content-length") ?? "");

  if (Number.isFinite(declared) && declared > MAX_UPLOAD_REQUEST_BYTES) {
    return catalogueJson(
      {
        ok: false,
        error: {
          kind: "invalid-input",
          message: "This request exceeds the 4 MiB upload safety limit (Vercel Functions allow about 4.5 MiB). Choose fewer or smaller photos.",
          field: "file",
        },
      },
      413,
    );
  }

  let form: FormData;

  try {
    form = await request.formData();
  } catch (error) {
    console.error("[gallery] could not read the upload form:", error);

    return catalogueError("invalid-input", "The upload could not be read. Try again.", { field: "file" });
  }

  const files = form.getAll("files").filter((entry): entry is File => entry instanceof File);

  if (files.length === 0) {
    return catalogueError("invalid-input", "Choose at least one photo to upload.", { field: "file" });
  }

  if (files.length > GALLERY_UPLOAD_FILES_PER_REQUEST) {
    return catalogueError(
      "invalid-input",
      `Upload ${GALLERY_UPLOAD_FILES_PER_REQUEST} photos at a time at most.`,
      { field: "file" },
    );
  }

  // The words are optional on an upload: a title is taken from the file name and the
  // alternative text from the title, and the organiser edits both afterwards. What
  // arrives here is what the form's "album" field holds, if the screen offered one.
  const shared = {
    description: typeof form.get("description") === "string" ? String(form.get("description")) : "",
    album: typeof form.get("album") === "string" ? String(form.get("album")) : "",
  };

  const outcome: GalleryUploadOutcome = { uploaded: [], refused: [] };

  for (const file of files) {
    if (file.size > MAX_UPLOAD_BYTES) {
      outcome.refused.push({
        fileName: file.name,
        message: "That photo is larger than 8 MB. Resize it and try again.",
        kind: "invalid-input",
      });

      continue;
    }

    const result = await uploadGalleryItem({
      bytes: Buffer.from(await file.arrayBuffer()),
      contentType: file.type,
      fileName: file.name,
      description: shared.description,
      album: shared.album,
    });

    if (result.ok) {
      outcome.uploaded.push(result.data);

      continue;
    }

    outcome.refused.push({ fileName: file.name, message: result.error.message, kind: result.error.kind });
  }

  if (outcome.uploaded.length === 0) {
    // Keep an all-invalid batch as a successful batch result so the caller can show
    // each file's own refusal. Infrastructure/configuration failures still keep their
    // HTTP error status instead of being mislabeled as bad images.
    const operationalFailure = outcome.refused.find((refusal) => refusal.kind && refusal.kind !== "invalid-input");

    if (operationalFailure?.kind) {
      return catalogueError(operationalFailure.kind, operationalFailure.message, { field: "file" });
    }
  }

  return catalogueJson({ ok: true, data: outcome });
}
