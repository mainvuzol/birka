import { kopecks, money } from "@/orders/types";
import { methodLabels, notStated } from "@/shared/payment";
import type { PaymentMethod } from "@/shared/payment";
import { dayOf, timeOf } from "./errors";
import { movementLabels } from "./types";
import type { Correction, Movement, WaySums } from "./types";

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

/** The phone's own date, as the server's days are written. */
export function isoDay(at: Date): string {
  return `${String(at.getFullYear())}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
}

export function daysAgo(days: number): string {
  const at = new Date();
  at.setDate(at.getDate() - days);
  return isoDay(at);
}

/** The drawer's day `days` before today's, by the phone's clock: 06:00 to
 * 06:00, as the server's (G8) — at 00:30 today's is the evening before's. */
export function cashDay(days: number): string {
  const at = new Date(Date.now() - 6 * 60 * 60 * 1000);
  at.setDate(at.getDate() - days);
  return isoDay(at);
}

/** A way by name, or «не вказано» for none. */
export function wayName(method: PaymentMethod | null): string {
  return method ? methodLabels[method] : notStated;
}

/** Cash moved, as recorded; `once`, a kept one confirmed: «Видачу записано
 * один раз: Витрати, 150,00 грн.» (cash task list, P1-1). */
export function movementDone(movement: Movement, once = false): string {
  if (once) {
    const what =
      movement.direction === "OUT"
        ? `Видачу записано один раз: ${movementLabels[movement.kind]}, ${money(movement.amount)}`
        : `Внесення записано один раз: ${money(movement.amount)}`;
    if (!movement.for_day) return `${what}.`;
    return `${what} — до закриття ${dayOf(movement.for_day)}${
      movement.moved_to_close ? `, ${movedBefore(movement)}` : ""
    }.`;
  }
  if (movement.moved_to_close && movement.for_day)
    return `Записано до закриття ${dayOf(movement.for_day)}: ${movedBefore(movement)}.`;
  if (movement.for_day)
    return `Записано до закриття ${dayOf(movement.for_day)}.`;
  return `Записано: ${movementLabels[movement.kind]}, ${money(movement.amount)}.`;
}

/** Why cash the server put on a colleague's close went there: it moved
 * before that close — taken out, or put in (review, 2026-10-22). */
function movedBefore(movement: Movement): string {
  return movement.direction === "IN"
    ? "гроші внесли до нього"
    : "гроші взяли до нього";
}

/** A way changed, as recorded; `once`, a kept one confirmed (P1-1). */
export function correctionDone(correction: Correction, once = false): string {
  const ways = `${wayName(correction.from_method)} → ${wayName(correction.to_method)}`;
  return `${once ? `Зміну способу оплати записано один раз: ${ways}` : `Спосіб оплати змінено: ${ways}`}.${
    correction.explains_day
      ? ` Пояснює різницю закриття ${dayOf(correction.explains_day)}.`
      : ""
  }`;
}
