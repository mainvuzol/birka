import type { JSX } from "react";
import type { Store } from "@/orders/types";
import { useDamagedUnits } from "@/damaged/units";

/** «2 очікують перевірки», «1 очікує перевірки», «нічого не чекає». */
export function awaitingText(count: number): string {
  if (count === 0) return "нічого не чекає";
  const one = count % 10 === 1 && count % 100 !== 11;
  return `${String(count)} ${one ? "очікує" : "очікують"} перевірки`;
}

/**
 * «Брак»'s line on its row of «Ще» («Усе на бірці» task list, P0-4), as its
 * tile's was: how many units wait to be inspected, read each time «Ще»
 * opens, the screen's own read. Grey while read; unread, none, though one
 * was read before — no number is made up (review, 2026-10-26).
 */
export function DamagedMeta({
  store,
  token,
}: {
  store: Store;
  token: string;
}): JSX.Element | null {
  const units = useDamagedUnits(store, token);
  if (units.isPending)
    return (
      <span className="more-meta">
        <span className="skeleton skeleton-meta" aria-hidden="true" />
      </span>
    );
  if (units.isError) return null;
  const awaiting = units.data.units.filter(
    (unit) => unit.status === "AWAITING",
  ).length;
  return <span className="more-meta">{awaitingText(awaiting)}</span>;
}
