import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { CARRIED_TAP, docks } from "./panel";

/** With a way back, a toast stays this long (spec §6.23). */
export const UNDO_FOR = 5_000;

/** Without one, this long (spec §6.23). */
export const TOAST_FOR = 4_000;

/**
 * A toast (spec §6.23; «Усе на бірці» task list, P0-2, P0-6, P1-4): a line
 * over the menu for a moment, and its one way back where it has one, read
 * out as it comes. Gone after `stays`; held while the cursor is in it, so a
 * key never chases it.
 */
export function Toast({
  text,
  action,
  act,
  gone,
  stays = action === undefined ? TOAST_FOR : UNDO_FOR,
  live = true,
}: {
  text: string;
  /** Its one button's words: «Повернути». None, a line alone: «ID
   * скопійовано». */
  action?: string;
  act?: () => void;
  gone: () => void;
  stays?: number;
  /** False where a status line present from the start says its words: a
   * live region put on the page with its words is often not read. */
  live?: boolean;
}): JSX.Element {
  const [held, setHeld] = useState(false);
  const leave = useRef(gone);
  leave.current = gone;
  useEffect(() => {
    if (held) return;
    const timer = window.setTimeout(() => {
      leave.current();
    }, stays);
    return () => {
      window.clearTimeout(timer);
    };
  }, [held, stays]);
  // It rises under the thumb that tapped what it tells of: for a moment a
  // tap on it is that one's second half, let go, as a sheet lets its own
  // (review, 2026-10-31). A key's press is never one.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const wait = window.setTimeout(() => {
      setReady(true);
    }, CARRIED_TAP);
    return () => {
      window.clearTimeout(wait);
    };
  }, []);
  // Over the menu, 16 over it; and 16 over a dock or a panel that stands
  // there, so the dock's button is never under it (spec §6.23; audit
  // 2026-11-13, frame P2-5). A dock higher up — in its flow under content
  // shorter than the screen — leaves the toast its place. Never lifted past
  // the screen's top. Followed while the toast stands, a frame at a time: a
  // sticky dock moves as the page scrolls, the keyboard opens, a screen
  // changes under it.
  const self = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const toast = self.current;
    if (!toast) return;
    let frame = 0;
    const place = (): void => {
      let lift = 0;
      const standing = docks();
      if (standing.length > 0) {
        // The menu's height, as the menu sets it on the page's root.
        const menu =
          parseFloat(
            document.documentElement.style.getPropertyValue("--menu-h"),
          ) || 0;
        const floor = window.innerHeight - menu - 16;
        const top = floor - toast.offsetHeight;
        for (const dock of standing) {
          const box = dock.getBoundingClientRect();
          if (box.height > 0 && box.top < floor && box.bottom > top)
            lift = Math.max(lift, window.innerHeight - box.top + 16);
        }
        lift = Math.min(lift, window.innerHeight - toast.offsetHeight - 8);
      }
      const bottom = lift > 0 ? `${String(lift)}px` : "";
      if (toast.style.bottom !== bottom) toast.style.bottom = bottom;
      frame = window.requestAnimationFrame(place);
    };
    place();
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <div
      ref={self}
      className={action === undefined ? "toast toast-alone" : "toast"}
      role={live ? "status" : undefined}
      onFocus={() => {
        setHeld(true);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setHeld(false);
      }}
    >
      <span className="toast-text">{text}</span>
      {action !== undefined && (
        <button
          type="button"
          className="toast-action"
          onClick={(event) => {
            if (!ready && event.detail !== 0) return;
            act?.();
          }}
        >
          {action}
        </button>
      )}
    </div>
  );
}
