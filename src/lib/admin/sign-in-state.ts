/**
 * The staff sign-in form's state.
 *
 * Kept out of `src/app/admin/actions.ts` on purpose: a `"use server"` module may only
 * export async functions, and the form needs a value to seed `useActionState` with
 * before anybody has submitted anything. The type and that seed value live here, so
 * both the action and the client component can share them.
 */

export interface SignInState {
  error: string | null;
}

/**
 * Where the sign-in screen may send somebody afterwards.
 *
 * Kept here so the page (server component) and the action (server function) agree
 * without either importing the other.
 */
export const DEFAULT_ADMIN_PATH = "/admin";

/** Before the first submit: nothing has gone wrong yet. */
export const EMPTY_SIGN_IN_STATE: SignInState = { error: null };
