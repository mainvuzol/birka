import type { TermsInput } from "@/credits/Terms";
import type { TillMethod } from "@/shared/payment";
import type { SaleLine, Shortfall } from "./types";

/** A line of the till's basket. */
export interface Draft {
  /** The line's own, whatever its size becomes: its key and its price field. */
  id: string;
  /** What is sent; its `unit_price` is the price typed, once it reads as one. */
  line: SaleLine;
  /** The price as typed in the line (redesign P0-3). */
  price: string;
  /** The model's price for this store, which the line starts from. */
  suggested: string | null;
  name: string;
  size: string;
  /** The balance the coat was picked from. */
  stockSizeId: string;
  /** That balance's size is not known (ADR-0005 §11). */
  unknownStock: boolean;
  /** When it was put in, its model was listed here with coats whose size is
   * not known: the coat in hand may be one of those. */
  unknownNearby: boolean;
  /** Sold as "size not known": there is no size to clarify, nothing to find. */
  unknownSize: boolean;
  /** Its size was read off a coat held with its size not known. */
  fromUnknown: boolean;
}

/**
 * The basket as the till holds it: its lines, their quantities and prices,
 * the terms of paying in parts, the answers about the shelf, the way pressed
 * and its `command_id` — together, since a basket that changed is another
 * operation. The paper's day and time are not kept: a wrong one is
 * permanent, so they are asked again.
 */
export interface Basket {
  /** Built with the paper mode on: a basket from paper is never sent
   * unmarked. */
  paper: boolean;
  /** The paper switch's moves when last kept (`usePaper`'s `moved`). */
  moved: number;
  draft: Draft[];
  commandId: string;
  found: Record<number, number>;
  missing: Record<number, number>;
  clarified: Record<number, number>;
  heldUnknown: ReadonlySet<string>;
  shortfall: Shortfall | null;
  present: string;
  credit: TermsInput;
  method: TillMethod | null;
}

/**
 * Kept while the till is left and come back to (navigation task list, P0-5;
 * the owner's В6 (а), 2026-10-26): a tab, «Повернути» or «Ще» and back, the
 * same basket and panel. In memory only, as the paper mode (`./paper`):
 * nothing new on the phone's disk. Kept under the store and the till's
 * settled kept sales, so it is gone with the store and with every kept sale
 * that settled — the till then opens empty, as it always has, and never
 * takes the `command_id` of a sale already answered; a sale recorded clears
 * it on the till itself.
 */
let kept: { at: string; basket: Basket } | null = null;

export function keepBasket(at: string, basket: Basket): void {
  kept = { at, basket };
}

/** The basket kept under `at`, or none. */
export function keptBasket(at: string): Basket | null {
  return kept !== null && kept.at === at ? kept.basket : null;
}

/** The store left, or the app closed: nothing is kept. */
export function forgetBasket(): void {
  kept = null;
}
