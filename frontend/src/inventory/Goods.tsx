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
          <svg
            className="tile-icon receive-icon"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M12 3.5v10M7.5 9.5l4.5 4.5 4.5-4.5M4 14v5.5h16V14" />
          </svg>
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
          <svg
            className="tile-icon damaged-icon"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M3.5 4h8l9 9-7.5 7.5-9-9zM12.5 13.5l4 4M16.5 13.5l-4 4" />
            <circle cx="7.5" cy="8" r="1.4" />
          </svg>
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
