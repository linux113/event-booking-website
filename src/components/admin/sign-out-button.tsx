import { signOutAction } from "@/app/admin/actions";
import { ButtonElement } from "@/components/ui/button";

/**
 * Ends the staff session.
 *
 * A form and a server action, deliberately: signing out has to clear the Supabase
 * session cookies on the server, which a client-side button cannot do. It is also
 * the honest counterpart to the scanner — a phone that stays signed in after a shift
 * is a phone that can admit people.
 */
export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <ButtonElement type="submit" variant="secondary" size="sm">
        Sign out
      </ButtonElement>
    </form>
  );
}
