import { useEffect } from "react";
import type { JSX } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/shared/api";
import { visible } from "@/shared/visible";
import { money } from "@/orders/types";
import type { Store } from "@/orders/types";
import { Sum } from "@/shared/Sum";
import { goodsOf } from "./CustomerRow";
import { refusalText } from "./Credits";
import { erasedCustomer, statusLabels } from "./types";
import type { Credit, Customer as CustomerDebts, CustomerPage } from "./types";

/** «01.10», and the year when it is not this one. */
export function shortDay(iso: string, now = new Date()): string {
  const at = new Date(iso);
  return at.toLocaleDateString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    ...(at.getFullYear() === now.getFullYear() ? {} : { year: "2-digit" }),
  });
}

/** «з 01.10 · останній внесок 12.10». */
function sinceText(credit: Credit): string {
  return `з ${shortDay(credit.opened_at)}${
    credit.last_payment_at
      ? ` · останній внесок ${shortDay(credit.last_payment_at)}`
      : ""
  }`;
}

/**
 * A customer's debts, when there are more than one (credits task list,
 * P0-1, P0-3): what they owe in all, as the server summed it, and a row a
 * debt. The seller chooses which one is paid; none is chosen beforehand
 * (owner decision, 2026-10-01).
 *
 * Read by the customer's phone, whatever was searched: a payment changes
 * their debts, and a name only a paid one carried no longer finds them. As
 * the list showed them until then; gone — every debt paid, say — it goes
 * back to the list, never showing sums the phone kept.
 */
export function Customer({
  store,
  token,
  first,
  openOnly,
  elsewhere,
  choose,
  back,
}: {
  store: Store;
  token: string;
  /** As the list showed them: a phone's, so a customer of one debt or more. */
  first: CustomerDebts & { phone_digits: string };
  openOnly: boolean;
  /** Found among the stores that do not trade, by their whole phone. */
  elsewhere: boolean;
  choose: (credit: Credit) => void;
  back: () => void;
}): JSX.Element {
  const phone = first.phone_digits;
  const read = useQuery({
    queryKey: ["credits", store.id, "customer", phone, openOnly, elsewhere],
    queryFn: () =>
      api<CustomerPage>(
        `/credits/customers?store_id=${store.id}&limit=5&query=${phone}${
          openOnly ? "&status=OPEN" : ""
        }${elsewhere ? "&elsewhere=true" : ""}`,
        token,
      ),
    retry: false,
    placeholderData: { items: [first], has_more: false },
  });
  const found = read.data?.items.find((each) => each.phone_digits === phone);
  const gone = read.isSuccess && !read.isPlaceholderData && !found;
  useEffect(() => {
    if (gone) back();
  }, [gone, back]);
  const customer = found ?? first;
  const here = store.id;
  const name = visible(customer.customer_name ?? erasedCustomer);
  return (
    <section className="credits">
      <button type="button" className="quiet back" onClick={back}>
        <span aria-hidden="true">← </span>Борги
      </button>
      <h2>{name}</h2>
      {customer.customer_phone && (
        <p className="hint">
          <a href={`tel:${customer.customer_phone.replace(/[^\d+]/g, "")}`}>
            {visible(customer.customer_phone)}
          </a>
        </p>
      )}
      {read.isError && (
        // Read again and refused: what is shown is as it was, and said.
        <div role="alert">
          <p>{refusalText(read.error)}</p>
          <button
            type="button"
            disabled={read.isFetching}
            onClick={() => {
              void read.refetch();
            }}
          >
            Спробувати ще раз
          </button>
        </div>
      )}
      {customer.open_debts > 0 && (
        <div className="owed-card">
          <p className="owed-what">Винні всього</p>
          <p className="owed-sum">
            <Sum value={money(customer.owed)} />
          </p>
        </div>
      )}
      <div role="list" aria-label={`Борги: ${name}`}>
        {customer.credits.map((credit) => {
          const goods = goodsOf(credit);
          const since = sinceText(credit);
          const open = credit.status === "OPEN";
          return (
            <div role="listitem" key={credit.id}>
              <button
                type="button"
                className="sale-row debt-row"
                aria-label={`Відкрити борг: ${goods}, ${since}, ${
                  open
                    ? `винні ${money(credit.owed)}`
                    : statusLabels[credit.status].toLowerCase()
                }`}
                onClick={() => {
                  choose(credit);
                }}
              >
                <span className="sale-main">
                  <span className="debt-name">{goods}</span>
                  <span className="sale-meta">
                    {since}
                    {credit.store_id !== here && (
                      <span className="badge neutral">
                        Магазин «{visible(credit.store_name)}»
                      </span>
                    )}
                  </span>
                </span>
                {open ? (
                  <span className="debt-owed">{money(credit.owed)}</span>
                ) : (
                  <span
                    className={
                      credit.status === "WRITTEN_OFF"
                        ? "badge neutral"
                        : "badge"
                    }
                  >
                    {statusLabels[credit.status]}
                  </span>
                )}
                <span className="sale-open" aria-hidden="true">
                  ›
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
