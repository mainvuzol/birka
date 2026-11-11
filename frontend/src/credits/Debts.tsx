import { useEffect, useId } from "react";
import type { JSX } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/shared/api";
import { Icon } from "@/shared/Icon";
import { visible } from "@/shared/visible";
import { money } from "@/orders/types";
import type { Store } from "@/orders/types";
import { Sheet } from "@/shared/Sheet";
import { Unread } from "@/shared/Unread";
import { Sticker } from "@/shared/Sticker";
import { refusalText } from "./Debt";
import { goodsOf, sinceText } from "./format";
import { erasedCustomer } from "./types";
import type { Credit, Customer as CustomerDebts, CustomerPage } from "./types";

/**
 * A customer's debts at the till's «Внесок», when there are more than one
 * (credits task list, P0-1, P0-3): a sheet over the list, as the card's
 * «На який борг вносить?» is (spec §3, §6.29, S20; audit after stage 2,
 * sale P2-4) — the till stays under the finger. Under its title one line:
 * who, and what they owe this store in all, as the server summed it; then
 * a row a debt, as the card's sheet has them. The seller chooses which one
 * is paid; none is chosen beforehand (owner decision, 2026-10-01). Among
 * the stores that do not trade, no sum: each debt is its own store's, and
 * those are never added up («Усе на бірці» sections task list, P0-5).
 *
 * Read by the customer's phone, whatever was searched: a payment changes
 * their debts, and a name only a paid one carried no longer finds them. As
 * the list showed them until then; gone — every debt paid, say — the sheet
 * closes on the list, never showing sums the phone kept, and the list is
 * read again, so their row goes too (review).
 */
export function Debts({
  store,
  token,
  first,
  elsewhere,
  choose,
  close,
}: {
  store: Store;
  token: string;
  /** As the list showed them: a phone's, so a customer of one debt or more. */
  first: CustomerDebts & { phone_digits: string };
  /** Found among the stores that do not trade, by their whole phone. */
  elsewhere: boolean;
  /** A debt tapped: the sheet is done with, and S21 opens on it. */
  choose: (credit: Credit) => void;
  close: () => void;
}): JSX.Element {
  const phone = first.phone_digits;
  const lineId = useId();
  const cache = useQueryClient();
  // Only what is still owed, as the till's list reads them.
  const read = useQuery({
    queryKey: ["credits", store.id, "customer", phone, true, elsewhere],
    queryFn: () =>
      api<CustomerPage>(
        `/credits/customers?store_id=${store.id}&limit=5&query=${phone}&status=OPEN${
          elsewhere ? "&elsewhere=true" : ""
        }`,
        token,
      ),
    retry: false,
    placeholderData: { items: [first], has_more: false },
  });
  const found = read.data?.items.find((each) => each.phone_digits === phone);
  const gone = read.isSuccess && !read.isPlaceholderData && !found;
  useEffect(() => {
    if (!gone) return;
    // The list under it stays mounted, so it is read again here — the
    // screen this sheet replaced was, by mounting it anew — and what this
    // read found is forgotten: a tap on her row before the list answers
    // reads afresh rather than closing at once (review).
    cache.removeQueries({ queryKey: ["credits", store.id, "customer", phone] });
    void cache.invalidateQueries({
      queryKey: ["credits", store.id, "customers"],
    });
    close();
  }, [gone, close, cache, store.id, phone]);
  const customer = found ?? first;
  const here = store.id;
  const name = visible(customer.customer_name ?? erasedCustomer);
  const payable = customer.credits.filter(
    (credit) => credit.status === "OPEN",
  );
  return (
    <Sheet title="На який борг вносить?" close={close} said={lineId}>
      <p className="t-meta debts-line" id={lineId}>
        {name}
        {customer.open_debts > 0 && !elsewhere && (
          <> · винні всього {money(customer.owed)}</>
        )}
      </p>
      {read.isError && (
        // Read again and refused: what is shown is as it was, and said.
        <Unread
          error={read.error}
          said={refusalText}
          held={read.isFetching}
          retry={() => {
            void read.refetch();
          }}
        />
      )}
      <div role="list" aria-label={`Борги: ${name}`}>
        {payable.map((credit) => (
          <div role="listitem" key={credit.id}>
            <button
              type="button"
              className="sale-row debt-row"
              aria-label={`${goodsOf(credit)}, винні ${money(credit.owed)}${
                credit.store_id !== here
                  ? `, магазин «${visible(credit.store_name)}»`
                  : ""
              }`}
              onClick={() => {
                choose(credit);
              }}
            >
              <span className="sale-main">
                <span className="debt-name">{goodsOf(credit)}</span>
                <span className="sale-meta">
                  {sinceText(credit)}
                  {credit.store_id !== here && (
                    <Sticker tone="neutral">
                      Магазин «{visible(credit.store_name)}»
                    </Sticker>
                  )}
                </span>
              </span>
              <span className="debt-owed">
                <Icon name="owed" size={16} />
                {money(credit.owed)}
              </span>
              <Icon name="chevron-right" size={16} className="sale-open" />
            </button>
          </div>
        ))}
      </div>
    </Sheet>
  );
}
