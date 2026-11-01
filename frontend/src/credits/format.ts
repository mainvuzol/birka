import { visible } from "@/shared/visible";
import type { Credit } from "./types";

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

/** «з 01.10 · останній внесок 12.10». */
export function sinceText(credit: Credit): string {
  return `з ${shortDay(credit.opened_at)}${
    credit.last_payment_at
      ? ` · останній внесок ${shortDay(credit.last_payment_at)}`
      : ""
  }`;
}
