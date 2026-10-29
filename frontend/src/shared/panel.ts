import { useEffect } from "react";
import type { RefObject } from "react";

/** How long after a screen changed under the thumb a tap is taken as meant
 * for what stood there before: a double tap's second half (review,
 * 2026-10-24). */
export const CARRIED_TAP = 700;

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
    const watch = new ResizeObserver(keep);
    watch.observe(element);
    return () => {
      watch.disconnect();
      root.style.removeProperty(room);
    };
  }, [panel, shown, room]);
}
