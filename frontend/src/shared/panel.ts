import { useEffect } from "react";
import type { RefObject } from "react";

/** How long after a screen changed under the thumb a tap is taken as meant
 * for what stood there before: a double tap's second half (review,
 * 2026-10-24). */
export const CARRIED_TAP = 700;

/** When a result last stood where its press was (`ResultScreen`). */
let resultStoodAt = -Infinity;
let letGo: number | undefined;

/**
 * A result stands where it was pressed for — the till's receipt where the
 * ways were, S22 where «Записати внесок» was, the menu back under it,
 * Telegram's MainButton the result's own. For `CARRIED_TAP` after, a
 * finger's tap is that press's second half and is let go, as a sheet and an
 * order's steps let theirs (audit 2026-11-20, frame P1-1): `data-carried`
 * on the page's root takes taps off the result's dock and the menu's tabs
 * (`styles.css`) — a key still presses them — and Telegram's MainButton
 * asks `carried`.
 */
export function resultStood(): void {
  resultStoodAt = performance.now();
  const root = document.documentElement;
  root.setAttribute("data-carried", "");
  window.clearTimeout(letGo);
  letGo = window.setTimeout(() => {
    root.removeAttribute("data-carried");
  }, CARRIED_TAP);
}

/** A press now, within `CARRIED_TAP` of a result standing: let go. */
export function carried(): boolean {
  return performance.now() - resultStoodAt < CARRIED_TAP;
}

/** The panels and docks standing now: a toast rises over whichever stands
 * where it would be (spec §6.23; audit 2026-11-13, frame P2-5). */
const standing = new Set<HTMLElement>();

/** The panels and docks standing now, for a toast to keep clear of. */
export function docks(): HTMLElement[] {
  return [...standing];
}

/**
 * A panel held at the bottom of the screen, under the thumb — the till's
 * (redesign P0-4) and the return's (returns task list, P0-4): its height is
 * kept clear wherever the page scrolls to — an answer opened above it, a
 * field in focus — so nothing ends under it (review, 2026-10-15). `html`'s
 * `scroll-padding-bottom` reads it (`styles.css`). The till's search, held
 * at the top, keeps its own (`--find-h`, `scroll-padding-top`).
 */
export function usePanelRoom(
  panel: RefObject<HTMLElement>,
  shown: boolean,
  room = "--pay-panel-h",
): void {
  useEffect(() => {
    const root = document.documentElement;
    const element = panel.current;
    if (!shown || !element) {
      root.style.removeProperty(room);
      return;
    }
    const keep = (): void => {
      root.style.setProperty(room, `${String(element.offsetHeight)}px`);
    };
    keep();
    // The till's search held at the top is no dock: a toast never rises
    // over it (review).
    if (room !== "--find-h") standing.add(element);
    const watch = new ResizeObserver(keep);
    watch.observe(element);
    return () => {
      watch.disconnect();
      standing.delete(element);
      root.style.removeProperty(room);
    };
  }, [panel, shown, room]);
}
