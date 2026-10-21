import { kopecks, money } from "@/orders/types";
import { dayOf, timeOf } from "./errors";
import type { WaySums } from "./types";

/** Nothing either way: «0,00» or «−0,00». */
export function nothing(value: string): boolean {
  return kopecks(value.replace(/^-/, "")) === 0n;
}

// A sum that may be below nothing: «−150,00 грн».
export function signed(value: string): string {
  return value.startsWith("-") ? `−${money(value.slice(1))}` : money(value);
}

// What moved the drawer either way: «+350,00 грн», «−150,00 грн».
export function moved(value: string): string {
  return value.startsWith("-") || nothing(value)
    ? signed(value)
    : `+${money(value)}`;
}

/** «06.10, 20:00» of a moment, the phone's own time. */
export function whenOf(iso: string): string {
  const at = new Date(iso);
  return `${at.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" })}, ${timeOf(iso)}`;
}

/** «Нестача 150,00 грн.», «Надлишок 350,00 грн.», «Збіглося до копійки.» */
export function differenceText(difference: string): string {
  if (nothing(difference)) return "Збіглося до копійки.";
  return difference.startsWith("-")
    ? `Нестача ${money(difference.slice(1))}.`
    : `Надлишок ${money(difference)}.`;
}

/** A day nobody closed went into this close (G9); the same words as the bot's. */
export function unclosedText(days: string[]): string {
  const named = days.map(dayOf).join(", ");
  return days.length === 1
    ? `Не закрито: ${named} — цей день увійшов у це закриття.`
    : `Не закрито: ${named} — ці дні увійшли в це закриття.`;
}

/**
 * What made the card's sum, when more than its payments did: what came in,
 * what went back, and what corrections moved off or onto the card. Null
 * when nothing went back or was corrected.
 */
export function cardParts(card: WaySums): string[] | null {
  if (nothing(card.went_out) && nothing(card.corrected)) return null;
  return [
    `оплати ${money(card.came_in)}`,
    `повернення ${money(card.went_out)}`,
    ...(nothing(card.corrected) ? [] : [`виправлено ${moved(card.corrected)}`]),
  ];
}

/**
 * The card's sum since the previous close, to compare with the terminal's
 * end-of-day slip (owner, answer 11).
 */
export function cardText(card: WaySums): string {
  const parts = cardParts(card);
  return `Картка: ${signed(card.net)}${parts ? ` (${parts.join(", ")})` : ""}. Звірте з чеком терміналу.`;
}
