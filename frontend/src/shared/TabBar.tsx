import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { JSX, Ref } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./icons";

/** A tab of the bottom menu, held by its own section's rule. */
export interface TabItem {
  key: string;
  label: string;
  icon: IconName;
  /** Its own screen («page»), or a screen opened from it («true»: «Ще»
   * over «Брак»). */
  current: boolean | "true";
  disabled: boolean;
  open: () => void;
  /** «Ще»'s, so the focus can come back to it from a row it opened. */
  ref?: Ref<HTMLButtonElement>;
}

/** A field the phone's keyboard opens for. The app's keypad does not. */
function typing(element: Element | null): boolean {
  if (element instanceof HTMLTextAreaElement) return true;
  if (!(element instanceof HTMLInputElement)) return false;
  if (element.inputMode === "none") return false;
  return !["checkbox", "radio", "button", "submit", "reset", "range"].includes(
    element.type,
  );
}

/** How much shorter than the screen the visible part must be before the
 * keyboard is taken to be up: more than a browser's own bars, less than any
 * phone's keyboard. */
const KEYBOARD = 150;

/**
 * The phone's keyboard is up: a field it opens for has the focus, and the
 * visible part of the screen, unzoomed, is shorter by a keyboard's height
 * than it was while no such field had the focus — measured afresh each
 * time none has, so a window made shorter, or turned, is the new measure. A
 * cursor put in the till's search as it opens, with no keyboard, keeps the
 * menu (spec §6.2; review, 2026-10-29).
 */
function useKeyboardUp(): boolean {
  const [up, setUp] = useState(false);
  useEffect(() => {
    const view = window.visualViewport;
    const seen = (): number =>
      view ? view.height * view.scale : window.innerHeight;
    let free = seen();
    let width = window.innerWidth;
    const check = (event?: Event): void => {
      const now = seen();
      const typed = typing(document.activeElement);
      if (window.innerWidth !== width) {
        // Turned: while typing, no height to go by but the screen's own.
        width = window.innerWidth;
        free = typed ? Math.max(now, window.innerHeight) : now;
      } else if (!typed && event?.type === "resize") {
        // A window made shorter, or the keyboard gone: the new measure.
        free = now;
      } else if (!typed) {
        // The focus let go while the keyboard is still closing.
        free = Math.max(free, now);
      }
      setUp(typed && free - now > KEYBOARD);
    };
    check();
    view?.addEventListener("resize", check);
    window.addEventListener("resize", check);
    document.addEventListener("focusin", check);
    document.addEventListener("focusout", check);
    return () => {
      view?.removeEventListener("resize", check);
      window.removeEventListener("resize", check);
      document.removeEventListener("focusin", check);
      document.removeEventListener("focusout", check);
    };
  }, []);
  return up;
}

/**
 * The bottom menu («Усе на бірці» task list, P0-4; spec §6.2): the tabs this
 * person may open here, each its glyph over its word, the open one on a
 * pill. Its height is the docks' floor (`--menu-h`), the iPhone's home
 * indicator its own. Out of the way while the keyboard is up, and on a
 * task's screen.
 */
export function TabBar({
  tabs,
  away,
}: {
  tabs: readonly TabItem[];
  /** A task's screen: the menu steps aside. */
  away: boolean;
}): JSX.Element | null {
  const keyboard = useKeyboardUp();
  const shown = !away && !keyboard && tabs.length > 0;
  const bar = useRef<HTMLElement>(null);
  // Before the paint: no dock is drawn under the menu for a frame (review,
  // 2026-10-29).
  useLayoutEffect(() => {
    const root = document.documentElement;
    const element = bar.current;
    const clear = (): void => {
      root.style.removeProperty("--menu-h");
      root.style.removeProperty("--dock-safe");
    };
    if (!shown || !element) {
      clear();
      return;
    }
    const keep = (): void => {
      root.style.setProperty("--menu-h", `${String(element.offsetHeight)}px`);
      root.style.setProperty("--dock-safe", "0px");
    };
    keep();
    const watch = new ResizeObserver(keep);
    watch.observe(element);
    return () => {
      watch.disconnect();
      clear();
    };
  }, [shown]);
  if (!shown) return null;
  return (
    <nav ref={bar} aria-label="Розділи" className="tab-bar">
      <div className="tab-row">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            ref={tab.ref}
            type="button"
            className="tab"
            aria-current={
              tab.current === true ? "page" : tab.current || undefined
            }
            disabled={tab.disabled}
            onClick={tab.open}
          >
            <span className="tab-pill">
              <Icon name={tab.icon} />
            </span>
            <span className="tab-label">{tab.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
