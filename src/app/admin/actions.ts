"use server";

import type { Route } from "next";
import { redirect } from "next/navigation";

import type { SignInState } from "@/lib/admin/sign-in-state";
import { attemptSignIn } from "@/lib/auth/staff";
import {
  ADMIN_SESSION_COOKIE,
  createSessionValue,
  sessionCookieOptions,
} from "@/lib/auth/session";
import { cookies } from "next/headers";

/**
 * Administrator sign-in.
 *
 * One admin account, credentials in the environment (`ADMIN_EMAIL`,
 * `ADMIN_PASSWORD_HASH`). A successful check writes the HTTP-only `gn_admin`
 * session cookie and sends the browser to the admin home (or the `next` path
 * they came from — admin paths only).
 *
 * Failures return one deliberately vague message: there is no reason to tell an
 * attacker whether a username exists.
 */

const WRONG_DETAILS = "Those details did not match the administrator account.";
const UNAVAILABLE =
  "Sign-in is unavailable right now: this deployment is not configured with admin credentials.";

/** Admin routes only, and only same-site paths — no open redirects. */
function safeNext(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/admin") || value.startsWith("//")) {
    return "/admin";
  }

  return value;
}

export async function signInAction(_previous: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));

  if (email === "" || password === "") {
    return { error: "Enter your admin email and password." };
  }

  if (!email.includes("@")) {
    return { error: "Enter a valid admin email address." };
  }

  const admin = attemptSignIn(email, password);

  if (!admin) {
    console.error("[auth] admin sign-in failed");
    return { error: WRONG_DETAILS };
  }

  try {
    const store = await cookies();
    store.set(ADMIN_SESSION_COOKIE, createSessionValue(), sessionCookieOptions());
  } catch (error) {
    console.error("[auth] could not write the session cookie:", error);
    return { error: UNAVAILABLE };
  }

  // Outside try/catch: `redirect` throws, and the destination must not be swallowed.
  redirect(next as Route);
}
