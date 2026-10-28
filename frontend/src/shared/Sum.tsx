import { useState, type JSX } from "react";

/**
 * A sum in one piece (spec §6.17; «Усе на бірці» task list, P0-1): its sign
 * and figures «−1 850» in the display face, «,00» at 0.55 of them and «грн»
 * at 0.6, both in pencil. The till's panel, the return's panel and result.
 * A sum that changes under the eye shows the fold behind it for 400 ms; the
 * figures themselves never move.
 */
export function Sum({ value }: { value: string }): JSX.Element {
  const changes = useChanges(value);
  const flash = changes > 0 && (
    <span className="sum-flash" key={changes} aria-hidden="true" />
  );
  const parts = /^([−+-]?[\d\u00a0]+)(,\d+)?(\sгрн)?$/.exec(value);
  if (!parts)
    return (
      <strong className={changes ? "sum flashing" : "sum"}>
        {flash}
        {value}
      </strong>
    );
  const [, figures, kopecks, unit] = parts;
  return (
    <strong className={changes ? "sum flashing" : "sum"}>
      {flash}
      {figures}
      {kopecks && <span className="sum-kop">{kopecks}</span>}
      {unit && <span className="sum-unit">{unit}</span>}
    </strong>
  );
}

/** How many times `value` has changed since the first render: none for a
 * sum as it first shows. Kept from the render before, as React keeps it. */
function useChanges(value: string): number {
  const [seen, setSeen] = useState(value);
  const [changes, setChanges] = useState(0);
  if (seen !== value) {
    setSeen(value);
    setChanges(changes + 1);
  }
  return changes;
}
