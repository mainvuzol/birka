import { useId, useRef, useState } from "react";
import type { JSX, ReactNode } from "react";
import { Icon } from "./Icon";

/** The longest whole part a sum takes, as the journal keeps it. */
const WHOLE = 10;

/** How long ⌫ is held before it clears the sum (spec §6.25). */
const HELD = 600;

/** How soon after a held ⌫ is let go its own click may come, and is let
 * pass. A touch often sends none: a later press, from a keyboard or a
 * screen reader, is never swallowed (review, 2026-10-29). */
const LET_GO = 500;

/**
 * A key pressed on a sum typed as «1500,5»: a digit, the comma, or ⌫. At
 * most two figures after the comma; a leading zero is dropped; a comma
 * first is «0,» (spec §6.25). A key that would break that does nothing.
 */
export function pressed(sum: string, key: string): string {
  if (key === "⌫") return sum.slice(0, -1);
  const [whole = "", fraction] = sum.split(",");
  if (key === ",") {
    if (fraction !== undefined) return sum;
    return `${whole === "" ? "0" : whole},`;
  }
  if (!/^\d$/.test(key)) return sum;
  if (fraction !== undefined)
    return fraction.length >= 2 ? sum : `${sum}${key}`;
  if (whole === "0") return key;
  return whole.length >= WHOLE ? sum : `${sum}${key}`;
}

/**
 * What a hardware keyboard typed into the display, in the keypad's own
 * terms: the same sum, or none when it is not one.
 */
function typedIn(text: string): string | null {
  const plain = text.replace(/[\s\u00a0\u202f]/g, "").replace(".", ",");
  if (!/^\d*(,\d{0,2})?$/.test(plain)) return null;
  const [whole = "", fraction] = plain.split(",");
  if (whole.length > WHOLE) return null;
  const kept = whole.replace(/^0+(?=\d)/, "");
  return fraction === undefined
    ? kept
    : `${kept === "" ? "0" : kept},${fraction}`;
}

/** «1 500,5»: the thousands apart by a no-break space, as `money()`. */
function shown(sum: string): string {
  const [whole = "", fraction] = sum.split(",");
  const grouped = whole.replace(/\B(?=(\d{3})+$)/g, "\u00a0");
  return fraction === undefined ? grouped : `${grouped},${fraction}`;
}

const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ",", "0", "⌫"];

/**
 * The app's own keypad for a sum (spec §6.25; «Усе на бірці» task list,
 * P0-3): the sum large over a 3 × 4 grid «1 2 3 · 4 5 6 · 7 8 9 · , 0 ⌫».
 * The phone's keyboard never opens over the dock's buttons (`inputmode`
 * none); a keyboard of a computer still types into the sum. ⌫ held clears
 * it. No buzz on a key.
 */
export function Keypad({
  label,
  value,
  change,
  disabled,
  aside,
  invalid = false,
  describedBy,
}: {
  /** Over the sum, and what it is called: «Сума, грн». */
  label: string;
  /** The sum as typed: «1500,5», or "". */
  value: string;
  change: (sum: string) => void;
  disabled: boolean;
  /** Beside the label: «Увесь залишок …». */
  aside?: ReactNode;
  /** The sum cannot be taken: said by the line `describedBy` names. */
  invalid?: boolean;
  describedBy?: string;
}): JSX.Element {
  const sumId = useId();
  const held = useRef<number | null>(null);
  // A press of ⌫ held to its end has cleared the sum: its click, if it
  // comes as it is let go, deletes nothing more.
  const cleared = useRef<number | null>(null);
  // What a key made of the sum, heard: the key keeps the focus, and the
  // field is not where a reader is (review, 2026-10-29).
  const [heard, setHeard] = useState("");
  function release(): void {
    if (held.current !== null) window.clearTimeout(held.current);
    held.current = null;
    if (cleared.current === Infinity) cleared.current = performance.now();
  }
  function keyed(sum: string): void {
    change(sum);
    setHeard(`${label}: ${sum === "" ? "0" : shown(sum)}`);
  }
  return (
    <div className="keypad">
      <div className="keypad-head">
        <label className="keypad-label" htmlFor={sumId}>
          {label}
        </label>
        {aside}
      </div>
      <input
        id={sumId}
        className="keypad-sum"
        inputMode="none"
        autoComplete="off"
        placeholder="0"
        value={shown(value)}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(event) => {
          const sum = typedIn(event.target.value);
          if (sum !== null) change(sum);
        }}
      />
      <div className="keypad-keys">
        {keys.map((key) => (
          <button
            type="button"
            key={key}
            className={key === "⌫" ? "keypad-key keypad-erase" : "keypad-key"}
            disabled={disabled}
            aria-label={
              key === "⌫" ? "Стерти" : key === "," ? "Кома" : undefined
            }
            {...(key === "⌫"
              ? {
                  onPointerDown: () => {
                    cleared.current = null;
                    release();
                    held.current = window.setTimeout(() => {
                      held.current = null;
                      // Let go is when it is timed from.
                      cleared.current = Infinity;
                      keyed("");
                    }, HELD);
                  },
                  onPointerUp: release,
                  onPointerLeave: release,
                  onPointerCancel: release,
                  // A long press is the clearing, never the phone's menu.
                  onContextMenu: (event: { preventDefault: () => void }) => {
                    event.preventDefault();
                  },
                }
              : {})}
            onClick={() => {
              const clearedAt = cleared.current;
              cleared.current = null;
              if (
                key === "⌫" &&
                clearedAt !== null &&
                performance.now() - clearedAt < LET_GO
              )
                return;
              keyed(pressed(value, key));
            }}
          >
            {key === "⌫" ? <Icon name="backspace" /> : key}
          </button>
        ))}
      </div>
      <p className="visually-hidden" aria-live="polite">
        {heard}
      </p>
    </div>
  );
}
