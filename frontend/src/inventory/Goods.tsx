import type { JSX } from "react";
import type { Store } from "@/orders/types";
import { useDamagedUnits } from "@/damaged/units";
import { Icon } from "@/shared/Icon";

/** «2 очікують перевірки», «1 очікує перевірки», «нічого не чекає». */
export function awaitingText(count: number): string {
  if (count === 0) return "нічого не чекає";
  const one = count % 10 === 1 && count % 100 !== 11;
  return `${String(count)} ${one ? "очікує" : "очікують"} перевірки`;
}

/**
 * «Товар»'s tiles (navigation task list, P0-3, the minimal one; owner's
 * answers after #141, 2026-10-26): «Прийшов товар» and «Брак», with how
 * many units wait to be inspected, each for whoever may open it; one alone
 * the whole width. While the units are read their line is grey; unread, the
 * tile has none, and nothing is said — no number is made up.
 */
export function GoodsTiles({
  store,
  token,
  disabled,
  receive,
  damaged,
}: {
  store: Store;
  token: string;
  /** Held as the row is. */
  disabled: boolean;
  /** «Прийшов товар», for whoever may receive. */
  receive: (() => void) | null;
  /** «Брак», for whoever handles it; its line is the screen's read, none
   * once a read fails, though one was read before (review, 2026-10-26). */
  damaged: (() => void) | null;
}): JSX.Element | null {
  const units = useDamagedUnits(store, token, damaged !== null);
  if (!receive && !damaged) return null;
  const awaiting = units.data?.units.filter(
    (unit) => unit.status === "AWAITING",
  ).length;
  return (
    <div className="goods-tiles">
      {receive && (
        <button
          type="button"
          className="tile"
          disabled={disabled}
          onClick={receive}
        >
          <Icon name="arrived" className="tile-icon receive-icon" />
          <span className="tile-word">Прийшов товар</span>
        </button>
      )}
      {damaged && (
        <button
          type="button"
          className="tile"
          disabled={disabled}
          onClick={damaged}
        >
          <Icon name="damaged" className="tile-icon damaged-icon" />
          <span className="tile-word">Брак</span>
          {/* Read as two words, not run together; a flex item's gap is
              not a space. */}{" "}
          {units.isPending ? (
            <span className="skeleton skeleton-meta" aria-hidden="true" />
          ) : !units.isError && awaiting !== undefined ? (
            <span className="tile-meta">{awaitingText(awaiting)}</span>
          ) : null}
        </button>
      )}
    </div>
  );
}
