"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import type { CatalogueError, CatalogueResult } from "@/types/catalogue";

/**
 * Sending a management form, in one place.
 *
 * Three things every one of these controls needs, and needs to get right:
 *
 *   1. **One request at a time.** The button is disabled while a save is in flight,
 *      so a double-tap cannot post the same new pass twice — and on the server the
 *      second attempt would be refused by the same rule that makes the code unique.
 *   2. **The database's answer, not the form's.** A success carries the row as it
 *      was saved (normalised code, computed seats available); a refusal carries the
 *      field to highlight and the sentence to show.
 *   3. **A refresh afterwards.** The page is a server component reading live data, so
 *      after a successful write the server's copy is what everybody sees next.
 *
 * Nothing here decides anything: it posts, and it reports what came back.
 */
export function useCatalogueSave<T>() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<CatalogueError | null>(null);
  const [saved, setSaved] = useState(false);

  const send = useCallback(
    async (path: string, payload: unknown): Promise<CatalogueResult<T>> => {
      setPending(true);
      setError(null);
      setSaved(false);

      try {
        const response = await fetch(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          // Same-origin form post; the session cookie travels with it.
          credentials: "same-origin",
        });

        const body = (await response.json()) as CatalogueResult<T>;

        if (!body.ok) {
          setError(body.error);

          return body;
        }

        setSaved(true);
        // The page's own data is stale now: ask the server for it again.
        router.refresh();

        return body;
      } catch {
        const offline: CatalogueError = {
          kind: "server-error",
          message: "The connection dropped before the change was saved. Check the list before trying again.",
        };

        setError(offline);

        return { ok: false, error: offline };
      } finally {
        setPending(false);
      }
    },
    [router],
  );

  const clear = useCallback(() => {
    setError(null);
    setSaved(false);
  }, []);

  return { send, pending, error, saved, clear };
}
