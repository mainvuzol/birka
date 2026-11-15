import { visible } from "@/shared/visible";
import type { Credit, Customer } from "./types";

/**
 * A customer's two letters, for their mark (spec §6.26; «Усе на бірці»
 * sections task list, P0-4): the first of their first two words, «ДМ»;
 * one word, its letter; «—» once erased, or with no letter at all. Each
 * is taken from the word as typed, past any invisible mark (review,
 * 2026-10-18).
 */
export function initialsOf(name: string | null): string {
  if (name === null) return "—";
  const letters = name
    .split(/\s+/u)
    .map((word) => /\p{L}/u.exec(word)?.[0])
    .filter((letter): letter is string => letter !== undefined)
    .slice(0, 2);
  return letters.length > 0 ? letters.join("").toLocaleUpperCase("uk-UA") : "—";
}

/** «01.10», and the year when it is not this one. */
export function shortDay(iso: string, now = new Date()): string {
  const at = new Date(iso);
  return at.toLocaleDateString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    ...(at.getFullYear() === now.getFullYear() ? {} : { year: "2-digit" }),
  });
}

/** «13:00». */
export function shortTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("uk-UA", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** «01.10, 13:00», and the year when it is not this one. */
export function shortWhen(iso: string, now = new Date()): string {
  return `${shortDay(iso, now)}, ${shortTime(iso)}`;
}

/** «Лоран шоколад · M», and «+ ще 2» for the rest of a debt's goods. */
export function goodsOf(credit: Credit): string {
  const [first, ...rest] = credit.goods.map(visible);
  if (first === undefined) return "";
  return rest.length > 0 ? `${first} + ще ${String(rest.length)}` : first;
}

/** The latest, or the earliest, of the times given; null with none. */
function pick(
  times: readonly (string | null)[],
  later: boolean,
): string | null {
  let found: string | null = null;
  for (const at of times)
    if (
      at !== null &&
      (found === null ||
        (later
          ? Date.parse(at) > Date.parse(found)
          : Date.parse(at) < Date.parse(found)))
    )
      found = at;
  return found;
}

/**
 * When, for a customer's row in «Покупці» (spec S19 pp. 6–12; audit
 * 2026-11-15, sale P1-1), from their debts as the list read them — nothing
 * counted again. Owing: «останній внесок 19.10» by the latest payment, or
 * «з 18.10» by the earliest opened when none was paid. Nothing owed:
 * «закрито 05.10» by the latest close, its sticker saying how. Null when
 * there is no date to say.
 */
export function rowWhen(customer: Customer): string | null {
  const { credits } = customer;
  if (customer.open_debts > 0) {
    const paid = pick(
      credits.map((credit) => credit.last_payment_at),
      true,
    );
    if (paid !== null) return `останній внесок ${shortDay(paid)}`;
    const opened = pick(
      credits.map((credit) => credit.opened_at),
      false,
    );
    return opened === null ? null : `з ${shortDay(opened)}`;
  }
  const closed = pick(
    credits.map((credit) => credit.closed_at),
    true,
  );
  return closed === null ? null : `закрито ${shortDay(closed)}`;
}

/** «з 01.10 · останній внесок 12.10». */
export function sinceText(credit: Credit): string {
  return `з ${shortDay(credit.opened_at)}${
    credit.last_payment_at
      ? ` · останній внесок ${shortDay(credit.last_payment_at)}`
      : ""
  }`;
}
