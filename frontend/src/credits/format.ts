import { visible } from "@/shared/visible";
import type { Credit } from "./types";

/** «01.10», and the year when it is not this one. */
export function shortDay(iso: string, now = new Date()): string {
  const at = new Date(iso);
  return at.toLocaleDateString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    ...(at.getFullYear() === now.getFullYear() ? {} : { year: "2-digit" }),
  });
}

/** «01.10, 13:00», and the year when it is not this one. */
export function shortWhen(iso: string, now = new Date()): string {
  const at = new Date(iso);
  return `${shortDay(iso, now)}, ${at.toLocaleTimeString("uk-UA", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

/** «Лоран шоколад · M», and «+ ще 2» for the rest of a debt's goods. */
export function goodsOf(credit: Credit): string {
  const [first, ...rest] = credit.goods.map(visible);
  if (first === undefined) return "";
  return rest.length > 0 ? `${first} + ще ${String(rest.length)}` : first;
}
