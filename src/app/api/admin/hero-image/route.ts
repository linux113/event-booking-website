import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import {
  catalogueError,
  catalogueJson,
  forbidden,
  readCatalogueBody,
  unauthorized,
} from "@/lib/admin/api";
import {
  HERO_IMAGE_MAX_REQUEST_BYTES,
  HERO_IMAGE_MAX_UPLOAD_BYTES,
} from "@/lib/admin/hero-image";
import { isDatabaseConfigured } from "@/config/env";
import { can } from "@/lib/auth/permissions";
import { getStaffMember } from "@/lib/auth/staff";
import { prepareHeroImage } from "@/lib/hero-image/prepare";
import { removeHeroImage, saveHeroImage } from "@/lib/services/hero-image";
import type { HeroImageSettingsState } from "@/types/event-settings";

/**
 * POST /api/admin/hero-image — replace or remove the single event hero image.
 *
 * Unlike Gallery, this endpoint never calls Vercel Blob and creates no gallery row.
 * It validates and converts the image to WebP, then stores the bytes on `events` in
 * Neon. Identity is checked before the body is read.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const staff = await getStaffMember();
  if (!staff) return unauthorized<HeroImageSettingsState>();

  if (!can(staff.role, "settings:edit")) {
    return forbidden<HeroImageSettingsState>("Your account cannot change event settings.");
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("multipart/form-data")) {
    return upload(request);
  }

  const read = await readCatalogueBody(request);
  if (!read.ok) return read.response;

  const action = typeof read.body.action === "string" ? read.body.action.trim() : "";
  if (action !== "remove") {
    return catalogueError<HeroImageSettingsState>("invalid-input", "Choose an image or request its removal.", {
      field: "file",
    });
  }

  const result = await removeHeroImage();
  if (result.ok) revalidatePath("/");
  return catalogueJson(result);
}

async function upload(request: Request): Promise<NextResponse> {
  if (!isDatabaseConfigured()) {
    return catalogueError<HeroImageSettingsState>(
      "not-configured",
      "Homepage hero uploads need the Neon database connection to be configured.",
    );
  }

  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > HERO_IMAGE_MAX_REQUEST_BYTES) {
    return catalogueJson<HeroImageSettingsState>(
      {
        ok: false,
        error: {
          kind: "invalid-input",
          message: "This upload exceeds the 4 MiB request limit. Choose a smaller photo.",
          field: "file",
        },
      },
      413,
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return catalogueError<HeroImageSettingsState>("invalid-input", "The image upload could not be read.", {
      field: "file",
    });
  }

  const entries = form.getAll("file");
  if (entries.length !== 1 || !(entries[0] instanceof File)) {
    return catalogueError<HeroImageSettingsState>("invalid-input", "Choose exactly one image to upload.", {
      field: "file",
    });
  }

  const file = entries[0];
  if (file.size > HERO_IMAGE_MAX_UPLOAD_BYTES) {
    return catalogueJson<HeroImageSettingsState>(
      {
        ok: false,
        error: {
          kind: "invalid-input",
          message: "That file is too large for one upload. Choose a smaller photo.",
          field: "file",
        },
      },
      413,
    );
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(await file.arrayBuffer());
  } catch {
    return catalogueError<HeroImageSettingsState>("invalid-input", "The image file could not be read.", {
      field: "file",
    });
  }

  const prepared = await prepareHeroImage({ bytes, contentType: file.type });
  if (!prepared.ok) {
    return catalogueError<HeroImageSettingsState>("invalid-input", prepared.error.message, {
      field: prepared.error.field,
    });
  }

  const result = await saveHeroImage(prepared.image.data);
  if (result.ok) revalidatePath("/");
  return catalogueJson(result);
}
