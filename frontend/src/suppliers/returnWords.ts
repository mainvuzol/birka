import { ApiError, errorText, inOwnWords } from "@/shared/api";
import { sizeLabel } from "@/returns/types";
import { visible } from "@/shared/visible";
import type { ReturnLine, SupplierReturn } from "./types";

/** How many of a return's lines its row names before «+ ще N». */
const NAMED = 2;

/** A return's units, all its lines. */
export function unitsOf(item: { lines: { quantity: number }[] }): number {
  return item.lines.reduce((units, line) => units + line.quantity, 0);
}

/** «Кокон графіт, M × 2». */
export function lineText(line: ReturnLine): string {
  return `${visible(line.display_name)}, ${sizeLabel(line.size)} × ${String(line.quantity)}`;
}

/** «Кокон графіт, M × 2 · Лоран, S × 1», and «+ ще N» after two. */
export function goodsText(item: SupplierReturn): string {
  const named = item.lines.slice(0, NAMED).map(lineText);
  const more = item.lines.length - named.length;
  return [...named, ...(more > 0 ? [`+ ще ${String(more)}`] : [])].join(" · ");
}

/** «склад «Основний»», or «з «Браку» «Основний»» for a unit from «Брак»
 * (В6 (а)). */
export function placeText(item: SupplierReturn): string {
  return `${item.damaged_unit_id ? "з «Браку»" : "склад"} «${visible(item.location_name)}»`;
}

/** What a return recorded, said once: on its screen, and on a kept one's
 * stub torn off (stage 2, money task list, P0-6). */
export function returnedText(result: SupplierReturn): string {
  return `Повернено постачальнику «${visible(result.supplier.name)}»: ${String(
    unitsOf(result),
  )} шт.`;
}

/** Why a return was not taken, in this screen's words: here, and under a
 * kept one checked (stage 2, money task list, P0-6). */
export function refusalText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "INSUFFICIENT_STOCK")
      return "Вільного товару вже менше, ніж ви повертаєте: частину могли продати чи забронювати. Оновіть і перевірте кількість.";
    switch (error.details.reason) {
      case "FROM_DAMAGED":
        return "Брак повертають постачальнику з розділу «Брак».";
      case "DUPLICATE_LINE":
        return "Кожну модель і розмір — один раз, з усією кількістю.";
      case "NO_REASON":
        return "Вкажіть, чому скасовуєте.";
      case "SET_OFF":
        return "Постачальник зарахував це повернення в накладну — спершу скасуйте залік у «Накладних».";
    }
  }
  return inOwnWords(
    errorText(error),
    "Не записано. Перевірте повернення та спробуйте ще раз.",
    "Не записано: дані повернення змінилися — перегляньте їх і спробуйте ще раз.",
  );
}
