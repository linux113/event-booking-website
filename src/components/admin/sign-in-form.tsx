"use client";

import { useActionState, useState } from "react";

import { signInAction } from "@/app/admin/actions";
import { EMPTY_SIGN_IN_STATE } from "@/lib/admin/sign-in-state";
import { ButtonElement } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";

/**
 * The administrator sign-in form.
 *
 * Admin email and password go to the server action, where they are checked
 * against `ADMIN_EMAIL` / `ADMIN_PASSWORD_HASH` (scrypt). Nothing client-side
 * stores or logs the password.
 *
 * `next` rides along as a hidden field so the page the visitor was heading for
 * is where they land after signing in.
 */
export function SignInForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, formAction, pending] = useActionState(signInAction, EMPTY_SIGN_IN_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />

      <TextField
        label="Admin email"
        name="email"
        type="email"
        autoComplete="username"
        inputMode="email"
        placeholder="admin@example.com"
        value={email}
        onChange={setEmail}
        required
        disabled={pending}
        className="[&_input]:h-12"
      />

      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={setPassword}
        required
        disabled={pending}
      />

      {state.error ? (
        <p role="alert" className="border-rani/40 bg-rani/10 text-rani-soft rounded-xl border px-3.5 py-3 text-sm/6">
          {state.error}
        </p>
      ) : null}

      <ButtonElement type="submit" size="md" disabled={pending} className="w-full">
        {pending ? "Signing in…" : "Sign in"}
      </ButtonElement>
    </form>
  );
}
