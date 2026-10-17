import type { JSX } from "react";

/**
 * «1850» large, «,00 грн» smaller and quieter (direction §4, money): the
 * till's panel, and the return's panel and result.
 */
export function Sum({ value }: { value: string }): JSX.Element {
  const at = value.indexOf(",");
  return at < 0 ? (
    <strong className="sum">{value}</strong>
  ) : (
    <strong className="sum">
      {value.slice(0, at)}
      <span className="sum-rest">{value.slice(at)}</span>
    </strong>
  );
}
