import { money } from "@/orders/types";
import { methodLabels, notStated } from "@/shared/payment";
import type { Period } from "@/money/reads";
import { periods } from "@/money/reads";
import type { Figures, OffTillFigures, WayFigures } from "./types";

/**
 * How «Звіт про продажі» and its two screens write what the server answers
 * (stage 2, money task list, P1-1): every figure a field of the server's,
 * nothing added up on the phone.
 */

export type Range = { from: string; to: string };

/** The period chosen: one of «Гроші»'s, or days of one's own. */
export type Chosen = Period | "other";

/** A sum that may be below nothing: what a till handed back exceeded what
 * it took. */
export function signed(value: string): string {
  return value.startsWith("-") ? `−${money(value.slice(1))}` : money(value);
}

/** What went out: returned goods, money handed back. */
export function minus(value: string): string {
  return value === "0.00" ? money(value) : signed(`-${value}`);
}

/** What a correction moved: «+350,00 грн», «−350,00 грн». */
export function moved(value: string): string {
  return value.startsWith("-") ? signed(value) : `+${money(value)}`;
}

export function nothing(value: string): boolean {
  return value === "0.00";
}

/** A figure of the table, «грн» said once over it: «1 700,00». */
export function bare(text: string): string {
  return text.replace(/\u00a0грн$/, "");
}

/** A way's name in the report: «Не вказано» for money recorded before the
 * way was asked (owner decision, 2026-10-04). */
export const wayLabels: Record<WayFigures["method"], string> = {
  CASH: methodLabels.CASH,
  CARD: methodLabels.CARD,
  TRANSFER: methodLabels.TRANSFER,
  NOT_STATED: `${notStated.charAt(0).toUpperCase()}${notStated.slice(1)}`,
};

interface Way {
  label: string;
  came_in: string;
  corrected: string;
  net: string;
}

/** An order's money paid off the till, outside «Разом» (owner decision,
 * 2026-10-04; ADR-0012 §G24). */
export function offTill(figures: Figures): Way[] {
  const ways: [string, OffTillFigures][] = [
    [methodLabels.PREPAID_TRANSFER, figures.off_till.prepaid_transfer],
    [methodLabels.CARRIER_COD, figures.off_till.carrier_cod],
  ];
  return ways.map(([label, sums]) => ({ label, ...sums }));
}

/** «картка −350,00 грн, готівка +350,00 грн» — what corrections made in
 * these days moved, the way it left first. A correction counts on the day
 * it is made, never back on the day of its sale (owner decision,
 * 2026-10-04). */
export function correctionsText(figures: Figures): string {
  const ways: Way[] = [
    ...figures.ways.map((way) => ({ ...way, label: wayLabels[way.method] })),
    ...offTill(figures),
  ].filter((way) => !nothing(way.corrected));
  const ordered = [
    ...ways.filter((way) => way.corrected.startsWith("-")),
    ...ways.filter((way) => !way.corrected.startsWith("-")),
  ];
  return ordered
    .map((way) => `${way.label.toLowerCase()} ${moved(way.corrected)}`)
    .join(", ");
}

/** The report's query: its days — none, the server's today — and its
 * store. */
export function query(
  range: Range | null,
  storeId = "",
  extra: Record<string, string> = {},
): string {
  const params = new URLSearchParams(extra);
  if (range) {
    params.set("date_from", range.from);
    params.set("date_to", range.to);
  }
  if (storeId) params.set("store_id", storeId);
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** «05.11» of a day the server names; «05.11.2025» when it is not of the
 * stores' year now. */
export function dayMonth(day: string, today: string | undefined): string {
  const [year = "", month = "", date = ""] = day.split("-");
  const thisYear = today === undefined || today.slice(0, 4) === year;
  return thisYear ? `${date}.${month}` : `${date}.${month}.${year}`;
}

/** «03.11 – 05.11», or one day, «04.11». */
export function daysText(range: Range, today: string | undefined): string {
  return range.from === range.to
    ? dayMonth(range.from, today)
    : `${dayMonth(range.from, today)} – ${dayMonth(range.to, today)}`;
}

/** The screens' line of context (spec §6.2): the period in words, «Тиждень
 * · 03.11 – 05.11», «Вчора · 04.11», as «Гроші»'s day leads its own; days
 * of one's own, the days alone. Today not said yet, «Сьогодні». */
export function periodLead(
  range: Range | null,
  chosen: Chosen,
  today: string | undefined,
): string {
  const label = periods.find(({ mode }) => mode === chosen)?.label;
  const days = range ?? (today ? { from: today, to: today } : null);
  if (days === null) return label ?? "";
  return label ? `${label} · ${daysText(days, today)}` : daysText(days, today);
}
