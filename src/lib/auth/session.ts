import "server-only";

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

import { isAdminAuthConfigured } from "@/config/env";

/**
 * Single-admin authentication.
 *
 * One administrator, no roles, no database user table:
 *
 *   - Credentials come from `ADMIN_EMAIL` + `ADMIN_PASSWORD_HASH` (scrypt).
 *   - A successful login writes an HTTP-only signed cookie (`gn_admin`).
 *   - The cookie is an expiry + HMAC-SHA256 under `AUTH_SECRET` — nothing secret
 *     is stored client-side, and a tampered value fails verification.
 *
 * Password hashes never appear in source. Generate one with the command in
 * `.env.example`.
 */

export const ADMIN_SESSION_COOKIE = "gn_admin";
export const ADMIN_SESSION_MAX_AGE = 12 * 60 * 60; // 12 hours

export interface AdminIdentity {
  /** Stable id for this deployment's single admin. */
  id: "admin";
  username: string;
  displayName: string;
  role: "super_admin";
}

function authSecret(): string {
  const value = process.env.AUTH_SECRET?.trim();
  if (!value) {
    throw new Error("AUTH_SECRET is not set. See .env.example.");
  }
  return value;
}

function expectedEmail(): string {
  const value =
    process.env.ADMIN_EMAIL?.trim() || process.env.ADMIN_USERNAME?.trim();
  if (!value) {
    throw new Error("ADMIN_EMAIL is not set. See .env.example.");
  }
  return value;
}

function expectedPasswordHash(): string {
  const value = process.env.ADMIN_PASSWORD_HASH?.trim();
  if (!value) {
    throw new Error("ADMIN_PASSWORD_HASH is not set. See .env.example.");
  }
  return value;
}

function emailsMatch(entered: string, expected: string): boolean {
  return entered.trim().toLowerCase() === expected.trim().toLowerCase();
}

/**
 * Verify a plain password against `scrypt$<salt-hex>$<hash-hex>`.
 * Constant-time on the digest comparison.
 */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") {
    console.error("[auth] ADMIN_PASSWORD_HASH is not in scrypt$salt$hash form");
    return false;
  }

  try {
    const salt = Buffer.from(parts[1], "hex");
    const expected = Buffer.from(parts[2], "hex");
    if (salt.length === 0 || expected.length === 0) return false;
    const actual = scryptSync(password, salt, expected.length);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Timing-safe credential check for the sign-in form. */
export function authenticate(email: string, password: string): AdminIdentity | null {
  if (!isAdminAuthConfigured()) {
    console.error("[auth] admin auth is not configured (ADMIN_EMAIL / ADMIN_PASSWORD_HASH / AUTH_SECRET missing)");
    return null;
  }

  const emailOk = emailsMatch(email, expectedEmail());
  const passOk = verifyPassword(password, expectedPasswordHash());

  // Evaluate both even when the email is wrong so failures take similar time.
  if (!emailOk || !passOk) {
    return null;
  }

  const adminEmailValue = expectedEmail();
  return {
    id: "admin",
    username: adminEmailValue,
    displayName: adminEmailValue,
    role: "super_admin",
  };
}

function sign(payload: string): string {
  return createHmac("sha256", authSecret()).update(`gn_admin:${payload}`).digest("hex");
}

/** Cookie value: `<expiry-unix-seconds>.<hex hmac>`. */
export function createSessionValue(now = Date.now()): string {
  const exp = Math.floor(now / 1000) + ADMIN_SESSION_MAX_AGE;
  return `${exp}.${sign(String(exp))}`;
}

/** Parse and verify a cookie value; null when missing, tampered or expired. */
export function readSessionValue(value: string | undefined | null, now = Date.now()): boolean {
  if (!value) return false;
  const [expRaw, sig, ...rest] = value.split(".");
  if (!expRaw || !sig || rest.length > 0) return false;

  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp * 1000 <= now) return false;

  const expected = sign(expRaw);
  try {
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length || a.length === 0) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** The signed-in admin for this request, or null. */
export async function getAdminSession(): Promise<AdminIdentity | null> {
  if (!isAdminAuthConfigured()) {
    return null;
  }

  try {
    const store = await cookies();
    const value = store.get(ADMIN_SESSION_COOKIE)?.value;

    if (!readSessionValue(value)) {
      return null;
    }

    return {
      id: "admin",
      username: expectedEmail(),
      displayName: expectedEmail(),
      role: "super_admin",
    };
  } catch {
    // cookies() outside a request scope (build/import) — not signed in.
    return null;
  }
}

/** Cookie attributes for writing/clearing the session cookie. */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    // Strict: the admin cookie is only ever sent on same-site requests, so a
    // link on another site can never carry an admin session into this app.
    sameSite: "strict" as const,
    path: "/",
    maxAge: ADMIN_SESSION_MAX_AGE,
    secure: process.env.NODE_ENV === "production",
  };
}

/** Mint a random salt+hash line for docs/tests (never used at runtime). */
export function hashPasswordForDocs(password: string): string {
  const salt = randomBytes(16).toString("hex");
  // The salt is stored as hex but keyed as raw bytes — exactly what
  // `verifyPassword` reverses with `Buffer.from(salt, "hex")`.
  const hash = scryptSync(password, Buffer.from(salt, "hex"), 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}
