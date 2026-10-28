import type { JSX } from "react";

/**
 * The tag's eyelet (spec §1.4, §6.0; «Усе на бірці» task list, P0-2): what
 * became of a record, told by its shape as well as its colour. Filled — the
 * server recorded it once; dashed — kept on the phone, its answer lost; a
 * knot — nothing is left to check; a ring turning — the server is being
 * asked, the app's only spinner. Where motion is reduced the ring stands
 * still, dashed, and `Waiting` beside it says so in words.
 */
export type EyeletState = "filled" | "dashed" | "knot" | "spin";

export function Eyelet({
  state,
  size = 12,
}: {
  state: EyeletState;
  size?: 8 | 12 | 20;
}): JSX.Element {
  return (
    <span
      className={`eyelet eyelet-${state} eyelet-${String(size)}`}
      aria-hidden="true"
    >
      {state === "knot" && (
        // The thread's loop, drawn to the right of the hole: tied in 300 ms.
        <svg className="eyelet-loop" viewBox="0 0 14 12" focusable="false">
          <path pathLength={1} d="M1 6c3-5 9-5 9-1.5S5 9 5.5 6 10 2.5 13 6" />
        </svg>
      )}
    </span>
  );
}

/**
 * «Чекаємо на сервер», seen only where motion is reduced: there the ring
 * does not turn, and the words say what it would.
 */
export function Waiting(): JSX.Element {
  return <span className="waiting-words">Чекаємо на сервер</span>;
}

/**
 * The check in its eyelet over a result (spec §6.30): the ring closes, then
 * the tick is drawn; still where motion is reduced.
 */
export function RecordedMark(): JSX.Element {
  return (
    <svg
      className="recorded-mark"
      viewBox="0 0 28 28"
      aria-hidden="true"
      focusable="false"
    >
      <circle className="recorded-ring" cx="14" cy="14" r="12.25" />
      <path className="recorded-tick" d="M8.5 14.5l3.75 3.75L19.5 10.5" />
    </svg>
  );
}
