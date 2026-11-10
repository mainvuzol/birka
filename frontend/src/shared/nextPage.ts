import { useState } from "react";

/**
 * Whether the error a paged list holds is its next page's (orders and
 * «Каса» task list after stage 2, P2-6; review): kept as that page's until
 * the list is read with no error. A whole read again meanwhile — the app
 * come back, a step recorded — still says it at the foot where «Показати
 * ще» stood, never over the rows; a whole read refused anew says its own
 * over them.
 */
export function useNextPageFailed(pages: {
  error: unknown;
  isFetchNextPageError: boolean;
}): boolean {
  const [failed, setFailed] = useState<unknown>(null);
  // Kept from one draw to the next, as React adjusts what it keeps: set
  // while drawing, drawn again at once.
  if (pages.isFetchNextPageError && failed !== pages.error)
    setFailed(pages.error);
  else if (pages.error === null && failed !== null) setFailed(null);
  return (
    pages.error !== null &&
    (pages.isFetchNextPageError || pages.error === failed)
  );
}
