/**
 * Ends the admin session.
 *
 * A plain HTML form POST to `/api/staff/logout` rather than a client-side handler,
 * for three reasons: it works with JavaScript disabled, there is no button that can
 * be clicked while a stale session is still cached in memory, and the endpoint is a
 * normal request the tests can exercise exactly as a browser would.
 *
 * POST, never GET: a link would let any page on the internet sign a staff member out
 * by loading an image.
 */
export function SignOutButton() {
  return (
    <form action="/api/staff/logout" method="post">
      <button
        type="submit"
        className="border-border bg-surface-raised/70 text-foreground hover:bg-surface-raised inline-flex h-9 items-center rounded-full border px-4 text-sm font-semibold tracking-tight transition-colors"
      >
        Sign out
      </button>
    </form>
  );
}
