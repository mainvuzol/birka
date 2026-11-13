import type { JSX } from "react";

/**
 * A switch row (spec S08, S10 п. 7, §6.15): its words on the left, the
 * switch on the right, the whole 44 row its target — «Вношу продаж з
 * паперу», «Оплата частинами» (audit 2026-11-13, sale P2-6). Read aloud as a
 * switch, named by its words.
 */
export function SwitchRow({
  label,
  on,
  turn,
}: {
  label: string;
  on: boolean;
  turn: (on: boolean) => void;
}): JSX.Element {
  return (
    <label className="switch-row">
      <input
        type="checkbox"
        role="switch"
        checked={on}
        onChange={(event) => {
          turn(event.target.checked);
        }}
      />
      <span className="switch-label">{label}</span>
      <span className="switch-track" aria-hidden="true">
        <span className="switch-knob" />
      </span>
    </label>
  );
}
