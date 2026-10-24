import type { JSX } from "react";
import { money } from "@/orders/types";

/** A line's price that does not read as money (redesign P0-3). */
export const priceText =
  "Впишіть ціну: гривні й копійки, напр. 1850 або 1850,50.";

/**
 * Under a line's price, as the till says it (redesign P0-3): what it started
 * from and that it may be changed, or that there is none yet, or that what
 * was typed is no price; and a price of nothing said, never refused (owner,
 * В3 (а)). The till's basket, and a new order's lines (orders task list,
 * P0-5).
 */
export function PriceHint({
  typed,
  price,
  suggested,
}: {
  /** The price as typed in the line. */
  typed: string;
  /** The price as sent: "" until what was typed reads as one. */
  price: string;
  /** The model's price for this store, which the line started from. */
  suggested: string | null;
}): JSX.Element {
  return (
    <>
      {price === "" && (typed.trim() || suggested) ? (
        <span className="hint price-error">{priceText}</span>
      ) : suggested ? (
        <span className="hint">
          Ціна продажу {money(suggested)}. Домовилися про іншу — змініть.
        </span>
      ) : (
        <span className="hint">
          Ціни продажу ще немає — впишіть домовлену. Ціну для всіх задає
          менеджер у «Залишках».
        </span>
      )}
      {price === "0.00" && (
        // A gift is allowed, a slip is not caught (owner, В3 (а)).
        <span className="hint price-warn">
          Ціна 0,00 грн. Це справді подарунок? Перевірте ціну.
        </span>
      )}
    </>
  );
}
