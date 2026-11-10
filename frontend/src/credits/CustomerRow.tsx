import { useId } from "react";
import type { JSX } from "react";
import { visible } from "@/shared/visible";
import { money } from "@/orders/types";
import { number, plural } from "@/openings/types";
import { Icon } from "@/shared/Icon";
import { Sticker } from "@/shared/Sticker";
import { goodsOf, initialsOf } from "./format";
import { erasedCustomer, statusLabels } from "./types";
import type { Customer } from "./types";

/** «2 борги»: how many debts a row stands for. */
export function debtsCount(count: number): string {
  return `${number(count)} ${plural(count, "борг", "борги", "боргів")}`;
}

/**
 * One customer in a store's list (credits task list, P0-1; spec §6.8): their
 * two letters, who, their phone, and with one debt its goods; what they owe
 * the store, as the server summed it, in the debt's colour with its glyph.
 * Never a sale's sum or a payment's way. The whole row opens the customer's
 * card in «Покупці» («Усе на бірці» sections task list, P0-4); at the till,
 * the debt, or the customer's debts when there are more; read while the
 * till waits, as before, the debt's own commands held.
 *
 * Found at the till in another store of this person's, it opens nothing and
 * says where the payment is taken (spec S08; «Усе на бірці» task list,
 * P0-3).
 */
export function CustomerRow({
  customer,
  here,
  open,
  held = false,
}: {
  customer: Customer;
  /** This store: another's debt is named by its store. */
  here: string;
  /** Opens the debt; or, for another store's, that store's name. */
  open: (() => void) | { takenAt: string };
  /** Found on «Сьогодні» while a kept operation holds its verbs. */
  held?: boolean;
}): JSX.Element {
  const meta = useId();
  const name = visible(customer.customer_name ?? erasedCustomer);
  const [only] = customer.credits.length === 1 ? customer.credits : [];
  const away = customer.credits.find((credit) => credit.store_id !== here);
  const owes = customer.open_debts > 0;
  // Nothing owed among those read: debts that closed alike say how; others,
  // that nothing is owed. Under «Сплачені» or «Списані» only that status is
  // read, so the customer may still owe here.
  const [first] = customer.credits;
  const alike =
    first && customer.credits.every((credit) => credit.status === first.status)
      ? first
      : undefined;
  const closed = owes
    ? null
    : alike
      ? statusLabels[alike.status]
      : "Нічого не винні";
  const said = owes
    ? `винні ${money(customer.owed)}`
    : (closed ?? "").toLowerCase();
  const takenAt = typeof open === "function" ? null : open.takenAt;
  const inside = (
    <>
      <span className="debt-mark" aria-hidden="true">
        {initialsOf(customer.customer_name)}
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
          {takenAt !== null ? (
            <Sticker tone="neutral">
              Внесок приймає «{visible(takenAt)}»
            </Sticker>
          ) : (
            away && (
              <Sticker tone="neutral">
                Магазин «{visible(away.store_name)}»
              </Sticker>
            )
          )}
        </span>
      </span>
      {owes ? (
        <span className="debt-owed">
          <Icon name="owed" size={16} />
          {money(customer.owed)}
        </span>
      ) : (
        <Sticker tone={alike?.status === "SETTLED" ? "paid" : "neutral"}>
          {closed}
        </Sticker>
      )}
      {takenAt === null && (
        <Icon name="chevron-right" size={16} className="sale-open" />
      )}
    </>
  );
  return typeof open === "function" ? (
    <button
      type="button"
      className="sale-row debt-row"
      aria-label={`Відкрити борг: ${name}, ${said}`}
      aria-describedby={meta}
      disabled={held}
      onClick={open}
    >
      {inside}
    </button>
  ) : (
    <div className="sale-row debt-row taken-elsewhere">{inside}</div>
  );
}
