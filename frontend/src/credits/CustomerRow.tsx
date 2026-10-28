import { useId } from "react";
import type { JSX } from "react";
import { visible } from "@/shared/visible";
import { money } from "@/orders/types";
import { number, plural } from "@/openings/types";
import { goodsOf } from "./format";
import { erasedCustomer, statusLabels } from "./types";
import type { Customer } from "./types";

/** «2 борги»: how many debts a row stands for. */
export function debtsCount(count: number): string {
  return `${number(count)} ${plural(count, "борг", "борги", "боргів")}`;
}

/** The customer's first letter, for the row's mark; «—» once erased. A
 * letter alone hides and turns nothing, so it is taken from the name as
 * typed, past any invisible mark (review, 2026-10-18). */
function initialOf(name: string | null): string {
  if (name === null) return "—";
  const letter = /\p{L}/u.exec(name);
  return letter ? letter[0].toLocaleUpperCase("uk-UA") : "—";
}

/**
 * One customer in «Борги»'s list (credits task list, P0-1): who, their
 * phone, and with one debt its goods; what they owe in all, as the server
 * summed it, in the debt's colour. Never a sale's sum or a payment's way.
 * The whole row opens the debt, or the customer's debts when there are more;
 * read while the till waits, as before, the debt's own commands held.
 */
export function CustomerRow({
  customer,
  here,
  open,
}: {
  customer: Customer;
  /** This store: another's debt is named by its store. */
  here: string;
  open: () => void;
}): JSX.Element {
  const meta = useId();
  const name = visible(customer.customer_name ?? erasedCustomer);
  const [only] = customer.credits.length === 1 ? customer.credits : [];
  const away = customer.credits.find((credit) => credit.store_id !== here);
  const owes = customer.open_debts > 0;
  // Nothing owed: one debt says how it closed; more, that nothing is owed.
  const closed = owes
    ? null
    : only
      ? statusLabels[only.status]
      : "Нічого не винні";
  const said = owes
    ? `винні ${money(customer.owed)}`
    : (closed ?? "").toLowerCase();
  return (
    <button
      type="button"
      className="sale-row debt-row"
      aria-label={`Відкрити борг: ${name}, ${said}`}
      aria-describedby={meta}
      onClick={open}
    >
      <span className="debt-mark" aria-hidden="true">
        {initialOf(customer.customer_name)}
      </span>
      <span className="sale-main">
        <span className="debt-name">{name}</span>
        <span className="sale-meta" id={meta}>
          <span>
            {/* A number is never broken across lines, nor parted from
                what follows it. */}
            {customer.customer_phone && (
              <>
                <span className="debt-phone">
                  {visible(customer.customer_phone)}
                </span>
                {"\u00a0· "}
              </>
            )}
            {only ? goodsOf(only) : debtsCount(customer.credits.length)}
          </span>
          {away && (
            <span className="badge neutral">
              Магазин «{visible(away.store_name)}»
            </span>
          )}
        </span>
      </span>
      {owes ? (
        <span className="debt-owed">{money(customer.owed)}</span>
      ) : (
        <span
          className={
            only?.status === "SETTLED" ? "badge paid" : "badge neutral"
          }
        >
          {closed}
        </span>
      )}
      <span className="sale-open" aria-hidden="true">
        ›
      </span>
    </button>
  );
}
