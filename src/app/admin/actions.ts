"use server";

import type { Route } from "next";
import { redirect } from "next/navigation";

import type { SignInState } from "@/lib/admin/sign-in-state";
import { findStaffMember, recordStaffLogin } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Staff sign-in.
 *
 * Two steps, and both are needed:
 *
 *   1. `signInWithPassword` — Supabase Auth decides whether the email/password pair
 *      is real. Nothing in this repository ever sees or stores a password hash.
 *   2. `findStaffMember` — the `admin_users` allow-list decides whether that account
 *      may work here, and with which role. A legitimate Supabase user who is not on
 *      the list is signed straight back out, so a customer with an account of their
 *      own cannot reach a single admin page.
 *
 * The role the app then uses comes from that database row — never from the form, and
 * never from anything the browser sends. There is no code path in which a visitor can
 * ask to be an admin.
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

/**
 * Where to go after signing in.
 *
 * Admin routes only, and only same-site paths: an open redirect on a sign-in page is
 * a phishing tool, and there is no legitimate reason for a staff member to land
 * anywhere but here.
 */
function safeNext(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/admin") || value.startsWith("//")) {
    return "/admin";
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

  // Best effort, and after the decision: the timestamp is a convenience on the staff
  // page, never a condition for getting in.
  await recordStaffLogin(staff.userId);

  // Outside the try/catch above and outside any handler: `redirect` throws, and the
  // destination must not be swallowed. Typed routes want a literal — `safeNext`
  // already guaranteed it is an admin path on this site.
  redirect(next as Route);
}
