"use server";

import type { Route } from "next";
import { redirect } from "next/navigation";

import type { SignInState } from "@/lib/admin/sign-in-state";
import { findStaffMember } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Staff sign-in and sign-out.
 *
 * Two steps, and both are needed:
 *
 *   1. `signInWithPassword` — Supabase Auth decides whether the email/password pair
 *      is real. Nothing in this repository ever sees or stores a password.
 *   2. `findStaffMember` — the `admin_users` allow-list decides whether that account
 *      may work the gate. A legitimate Supabase user who is not staff is signed
 *      straight back out, so a curious customer with an account cannot poke around a
 *      staff page.
 *
 * Failures return one message that is deliberately vague about *which* part was
 * wrong: there is no reason to tell an attacker whether an email exists.
 *
 * The state type lives in `src/lib/admin/sign-in-state.ts`, because a `"use server"`
 * module may only export async functions — the seed value the form needs is not one.
 */

const WRONG_DETAILS = "Those details did not match a staff account.";
const NOT_STAFF = "That account is not an active staff account for this event.";
const UNAVAILABLE = "Staff sign-in is unavailable right now: this deployment is not connected to the database.";

/** Only paths on this site, so a crafted link cannot redirect somebody elsewhere. */
function safeNext(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/admin/scanner";
  }

  return value;
}

export async function signInAction(_previous: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));

  if (email === "" || password === "") {
    return { error: "Enter your staff email and password." };
  }

  let supabase;

  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return { error: UNAVAILABLE };
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    console.error("[auth] staff sign-in failed:", error.message);

    return { error: error.status === 429 ? "Too many attempts. Wait a moment and try again." : WRONG_DETAILS };
  }

  if (!data.user) {
    return { error: WRONG_DETAILS };
  }

  const staff = await findStaffMember(data.user.id);

  if (!staff) {
    // A real account, but not an allow-listed staff member: end the session rather
    // than leaving a half-signed-in browser behind.
    await supabase.auth.signOut();

    return { error: NOT_STAFF };
  }

  // Outside the try/catch above and outside any handler: `redirect` throws, and the
  // destination must not be swallowed. Typed routes want a literal — `safeNext`
  // already guaranteed it is a path on this site.
  redirect(next as Route);
}

/** Ends the session and returns to the sign-in screen. */
export async function signOutAction(): Promise<void> {
  try {
    const supabase = await createSupabaseServerClient();

    await supabase.auth.signOut();
  } catch (error) {
    console.error("[auth] staff sign-out failed:", error);
  }

  redirect("/admin/login");
}
