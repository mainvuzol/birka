import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { CARRIED_TAP } from "./panel";

/** With a way back, a toast stays this long (spec §6.23). */
export const UNDO_FOR = 5_000;

/**
 * A toast (spec §6.23; «Усе на бірці» task list, P0-2, P0-6): a line over
 * the menu for a moment, and its one way back, read out as it comes. Gone
 * after `stays`; held while the cursor is in it, so a key never chases it.
 */
export function Toast({
  text,
  action,
  act,
  gone,
  stays = UNDO_FOR,
}: {
  text: string;
  /** Its one button's words: «Повернути». */
  action: string;
  act: () => void;
  gone: () => void;
  stays?: number;
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
  return (
    <div
      className="toast"
      role="status"
      onFocus={() => {
        setHeld(true);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setHeld(false);
      }}
    >
      <span className="toast-text">{text}</span>
      <button
        type="button"
        className="toast-action"
        onClick={(event) => {
          if (!ready && event.detail !== 0) return;
          act();
        }}
      >
        {action}
      </button>
    </div>
  );
}
