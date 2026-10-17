import { useId } from "react";
import type { JSX } from "react";
import { visible } from "@/shared/visible";
import { sizeLabel } from "./types";
import type { SaleSummary } from "./types";

/** How many of a sale's lines a row names before «+ ще N». */
const NAMED = 2;

/** «14:32», by the phone's own clock. */
function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString("uk-UA", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** The phone's own day of a moment, «2026-10-17». */
export function dayOf(iso: string): string {
  const at = new Date(iso);
  return `${String(at.getFullYear())}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
}

/** «Сьогодні», «Вчора», «15 жовтня», and the year when it is not this one. */
export function dayTitle(iso: string, now = new Date()): string {
  const day = dayOf(iso);
  if (day === dayOf(now.toISOString())) return "Сьогодні";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (day === dayOf(yesterday.toISOString())) return "Вчора";
  const at = new Date(iso);
  return at.toLocaleDateString("uk-UA", {
    day: "numeric",
    month: "long",
    ...(at.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** «Лоран шоколад · M», and how much of it came back already. */
function lineText(item: SaleSummary["items"][number]): string {
  return `${visible(item.display_name)} · ${sizeLabel(item.size)}${
    item.refunded > 0 ? ` · повернено ${String(item.refunded)} шт.` : ""
  }`;
}

/**
 * One sale in «Повернення»'s list (returns task list, P0-1): its goods as
 * tags, its hour and count, and its marks — never its sum or the way it was
 * paid, so the drawer's blind count keeps nothing to go by (G32; owner
 * decision, 2026-10-17, В1: for everyone). The whole row opens it; a sale
 * returned whole opens nothing.
 */
export function SaleRow({
  sale,
  here,
  choose,
  blocked,
}: {
  sale: SaleSummary;
  here: boolean;
  choose: () => void;
  blocked: boolean;
}): JSX.Element {
  const returnable = sale.items.some((item) => item.refunded < item.quantity);
  const units = sale.items.reduce((n, item) => n + item.quantity, 0);
  const named = sale.items.slice(0, NAMED).map(lineText);
  const more = sale.items.length - named.length;
  const time = timeOf(sale.sold_at);
  // A screen reader hears the row's marks as its description, and its day
  // when it is not today's (review, 2026-10-17).
  const meta = useId();
  const day = dayTitle(sale.sold_at);
  const said = day === "Сьогодні" ? time : `${day}, ${time}`;
  const body = (
    <span className="sale-main">
      <span className="sale-goods">
        {named.map((text, index) => (
          <span key={sale.items[index]?.id ?? index}>{text}</span>
        ))}
        {more > 0 && <span>+ ще {more}</span>}
      </span>
      <span className="sale-meta" id={meta}>
        {time} · {units} шт.
        {sale.paid_in_parts && <span className="badge">Оплата частинами</span>}
        {sale.outage && (
          <span className="badge">
            {sale.outage.first_days === true
              ? "Продано з паперу"
              : "Продано під час збою"}
          </span>
        )}
        {!here && (
          <span className="badge">Магазин «{visible(sale.store_name)}»</span>
        )}
        {!returnable && <span className="badge">Усе вже повернено</span>}
      </span>
    </span>
  );
  return (
    <article className="sale-row-wrap">
      {returnable ? (
        <button
          type="button"
          className="sale-row"
          aria-label={`Оформити повернення: ${named.join(", ")}, ${said}`}
          aria-describedby={meta}
          disabled={blocked}
          onClick={choose}
        >
          {body}
          <span className="sale-open" aria-hidden="true">
            ›
          </span>
        </button>
      ) : (
        <div className="sale-row">{body}</div>
      )}
    </article>
  );
}
