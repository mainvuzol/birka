import type { JSX } from "react";
import { Eyelet } from "./Eyelet";

/**
 * «Показати ще» under a list: its next page from the server, one strip the
 * list's width (audit 2026-11-20, frame P2-1). Pressed, it keeps its look
 * while its page is read, the eyelet's ring turning before its words, as a
 * record's press on its way does — never the dashed «not now» (audit
 * 2026-11-22, frame P2-2). Held for any other reason — the list read again
 * whole, its tags gone stale — it takes no tap, dashed, as decided
 * (2026-11-21). What it reads, when, and where the cursor goes: each list's
 * own.
 */
export function ListMore({
  reading,
  held,
  more,
}: {
  /** Its own page asked and not answered yet. */
  reading: boolean;
  /** No page now, for a reason of the list's. */
  held: boolean;
  more: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className={reading ? "list-more pressed" : "list-more"}
      disabled={reading || held}
      onClick={more}
    >
      {reading && <Eyelet state="spin" size={20} />}
      Показати ще
    </button>
  );
}
