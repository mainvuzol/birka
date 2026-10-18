import { useCallback, useRef, useState } from "react";
import type { JSX } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { api } from "@/shared/api";
import { visible } from "@/shared/visible";
import { money } from "@/orders/types";
import type { Store } from "@/orders/types";
import { useSettled } from "@/sales/StockSearch";
import { Sum } from "@/shared/Sum";
import { number, plural } from "@/openings/types";
import { CustomerRow, debtsCount } from "./CustomerRow";
import { Customer as CustomerDebts } from "./Customer";
import { Debt, refusalText } from "./Debt";
import { askForPhone, erasedCustomer } from "./types";
import type { Credit, Customer, CustomerPage, StoreDebts } from "./types";

const pageSize = 20;

/** As the server: another store's customer is found by their whole phone,
 * however it is written or pasted, with the invisible marks a phone's
 * contacts add (owner decision, 2026-10-10). */
function wholePhone(text: string): boolean {
  const digits = text.replace(/\D/g, "").length;
  return /^[\d\s()+./\p{Cf}-]+$/u.test(text) && digits >= 10 && digits <= 15;
}

/**
 * A store's debts: sales paid in parts (owner decisions, 2026-10-01).
 *
 * The customer took the goods and pays the rest when they can; there is no
 * schedule. A seller finds the customer by name or phone — one phone is one
 * customer, with all their debts and what they owe in all — and takes a
 * payment on the debt they choose, here, in the store that sold. The owner
 * may write off a debt that will not be paid, saying why. Returns lower a
 * debt from «Повернення». The store sees what it is owed in all.
 *
 * While the store that sold is blocked or archived, any store that trades
 * finds its debts by the customer's whole phone, only those still owed, and
 * takes the payments; the debt stays that store's, and the owner of the
 * network may still write it off (owner decisions, 2026-10-01, "store
 * states", and 2026-10-10).
 *
 * Each payment is paid one way, given by the button that takes it: the
 * till's «Готівка», «Картка» and «Переказ» (owner decision, 2026-10-04;
 * ADR-0012 §B12, G23).
 *
 * A closed debt's customer is erased a year after it was paid or returned,
 * three after it was written off, or at once by the owner when the customer
 * asks: the network's owner in every store, a store's owner in that store.
 * The debt then reads «Покупця стерто», with every sum (owner decisions,
 * 2026-10-09; ADR-0015).
 */
export function Credits({
  store,
  token,
  journalKey,
  blocked,
  readOnly = false,
  networkOwner = false,
  mayErase = false,
}: {
  store: Store;
  token: string;
  journalKey: string;
  blocked: boolean;
  /** This store does not trade: its debts are read, and paid elsewhere. */
  readOnly?: boolean;
  /** The owner of the network, who writes off a debt of a store that does not trade. */
  networkOwner?: boolean;
  /**
   * The network's owner, who erases a closed debt's customer who asks in
   * every store; a store's owner does it in that store alone.
   */
  mayErase?: boolean;
}): JSX.Element {
  const cache = useQueryClient();
  // What the seller types, searched once they pause, from two letters, as
  // at the till and in «Повернення» (credits task list, P0-1); Enter
  // searches at once.
  const [query, setQuery] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const typed = useSettled(query);
  const [pressed, setPressed] = useState("");
  const search = pressed !== "" && pressed === query.trim() ? pressed : typed;
  const [owedOnly, setOwedOnly] = useState(true);
  const [selected, setSelected] = useState<Credit | null>(null);
  // A customer of more than one debt, whose debts are shown to choose from.
  const [chosen, setChosen] = useState<
    (Customer & { phone_digits: string }) | null
  >(null);
  // Whose debts: this store's, or those of the stores that do not trade.
  const [elsewhere, setElsewhere] = useState(false);
  // Other stores' customers are found by their whole phone, never browsed;
  // only what they still owe (owner decisions, 2026-10-10).
  // What is asked of them is what is in the field: cleared at the switch,
  // the search is cleared in the same render (`useSettled`), never a number
  // typed before it (review, 2026-10-18).
  const searched = !elsewhere || wholePhone(search);
  const openOnly = owedOnly || elsewhere;
  // Twenty at a time, each page under those read (credits task list, P0-2):
  // the server takes fifty at most, and a growing `limit` broke the list
  // after forty.
  const customers = useInfiniteQuery({
    queryKey: ["credits", store.id, "customers", elsewhere, search, openOnly],
    queryFn: ({ pageParam }) =>
      api<CustomerPage>(
        `/credits/customers?store_id=${store.id}&limit=${String(pageSize)}&offset=${String(pageParam)}${
          openOnly ? "&status=OPEN" : ""
        }${search ? `&query=${encodeURIComponent(search)}` : ""}${
          elsewhere ? "&elsewhere=true" : ""
        }`,
        token,
      ),
    initialPageParam: 0,
    getNextPageParam: (last: CustomerPage, pages: CustomerPage[]) =>
      last.has_more ? pages.length * pageSize : undefined,
    enabled: searched,
    retry: false,
    // A search typed keeps the list in place until the new one comes, as at
    // the till; never this store's for the other stores', nor the owed for
    // all.
    placeholderData: (
      previous: InfiniteData<CustomerPage, number> | undefined,
      before,
    ) =>
      before?.queryKey[3] === elsewhere && before.queryKey[5] === openOnly
        ? previous
        : undefined,
  });
  // A debt opened meanwhile moves the pages' edge: a customer read twice is
  // shown once.
  const listed = [
    ...new Map(
      (customers.data?.pages ?? [])
        .flatMap((page) => page.items)
        .map((customer) => [keyOf(customer), customer]),
    ).values(),
  ];
  const summary = useQuery({
    queryKey: ["credits", store.id, "summary"],
    queryFn: () =>
      api<StoreDebts>(`/credits/summary?store_id=${store.id}`, token),
    retry: false,
  });
  const leave = useCallback(() => {
    setChosen(null);
  }, []);

  if (selected)
    return (
      <Debt
        store={store}
        token={token}
        journalKey={journalKey}
        blocked={blocked}
        readOnly={readOnly}
        networkOwner={networkOwner}
        mayErase={mayErase}
        credit={selected}
        changed={(credit) => {
          setSelected(credit);
          void cache.invalidateQueries({ queryKey: ["credits", store.id] });
        }}
        back={() => {
          setSelected(null);
        }}
        // Opened from a customer's card, back to it, by their name.
        {...(chosen
          ? { backTo: visible(chosen.customer_name ?? erasedCustomer) }
          : {})}
      />
    );

  if (chosen)
    return (
      <CustomerDebts
        store={store}
        token={token}
        first={chosen}
        openOnly={openOnly}
        elsewhere={elsewhere}
        choose={(credit) => {
          setSelected(credit);
        }}
        back={leave}
      />
    );

  return (
    <section className="credits">
      <h2>Борги</h2>
      {readOnly && (
        // The store's own notice says it does not trade; this says who
        // takes the payments (credits task list, P0-1).
        <p className="hint">
          Внески приймає будь-який магазин мережі, що працює.
        </p>
      )}
      {!elsewhere && summary.data && (
        <div
          className="owed-card"
          role="group"
          aria-label="Скільки винні магазину"
        >
          <p className="owed-what">Магазину винні</p>
          <p className="owed-sum">
            <Sum value={money(summary.data.owed)} />
          </p>
          <p className="owed-count">
            {number(summary.data.customers)}{" "}
            {plural(summary.data.customers, "покупець", "покупці", "покупців")}{" "}
            · {debtsCount(summary.data.debts)}
          </p>
        </div>
      )}
      {elsewhere && (
        // Never mixed with this store's: headed, and left in one tap.
        <div className="toolbar elsewhere-head">
          <h3>Магазини, що не працюють</h3>
          <button
            type="button"
            className="quiet"
            onClick={() => {
              setElsewhere(false);
              setQuery("");
              setPressed("");
            }}
          >
            <span aria-hidden="true">← </span>Борги цього магазину
          </button>
        </div>
      )}
      <form
        className="search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          setPressed(query.trim().length >= 2 ? query.trim() : "");
        }}
      >
        <label className="till-search">
          {elsewhere ? "Повний номер телефону покупця" : "Ім’я або телефон"}
          <input
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            inputMode={elsewhere ? "tel" : undefined}
            ref={field}
            value={query}
            maxLength={200}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </label>
      </form>
      {!searched ? (
        <p>{askForPhone}</p>
      ) : customers.isPending ||
        (customers.isPlaceholderData && listed.length === 0) ? (
        <p role="status">Завантажуємо борги…</p>
      ) : !customers.data ? (
        <div role="alert">
          <p>{refusalText(customers.error)}</p>
          <button
            type="button"
            onClick={() => {
              void customers.refetch();
            }}
          >
            Спробувати ще раз
          </button>
        </div>
      ) : listed.length === 0 ? (
        elsewhere ? (
          <p>
            За цим номером боргів магазинів, що не працюють, не знайдено.
            Перевірте номер або зверніться до менеджера.
          </p>
        ) : search ? (
          <div className="empty">
            <p>
              За «{visible(search)}» боргів не знайдено. Перевірте ім’я або
              введіть номер телефону.
            </p>
            <button
              type="button"
              className="quiet"
              onClick={() => {
                setQuery("");
                setPressed("");
                field.current?.focus();
              }}
            >
              Очистити
            </button>
          </div>
        ) : (
          <p>
            {owedOnly
              ? "Зараз ніхто не винен цьому магазину."
              : "У цьому магазині ще не продавали частинами."}
          </p>
        )
      ) : (
        <>
          {customers.isError && !customers.isFetchNextPageError && (
            // Read again and refused: the rows below are as they were, and
            // that is said (ADR-0011).
            <div role="alert">
              <p>{refusalText(customers.error)}</p>
              <button
                type="button"
                disabled={customers.isFetching}
                onClick={() => {
                  void customers.refetch();
                }}
              >
                Спробувати ще раз
              </button>
            </div>
          )}
          <div role="list" aria-label="Хто винен">
            {listed.map((each) => (
              <div role="listitem" key={keyOf(each)}>
                <CustomerRow
                  customer={each}
                  here={store.id}
                  open={() => {
                    // One debt shown: it is opened; more, and the seller
                    // chooses (credits task list, P0-1).
                    const [only] =
                      each.credits.length === 1 ? each.credits : [];
                    const phone = each.phone_digits;
                    if (only) setSelected(only);
                    // An erased customer stands alone: one debt each.
                    else if (phone !== null)
                      setChosen({ ...each, phone_digits: phone });
                  }}
                />
              </div>
            ))}
          </div>
          {customers.isFetchNextPageError ? (
            // The next page could not be read: those read stay.
            <div role="alert">
              <p>{refusalText(customers.error)}</p>
              <button
                type="button"
                disabled={customers.isFetching}
                onClick={() => {
                  void customers.fetchNextPage();
                }}
              >
                Спробувати ще раз
              </button>
            </div>
          ) : (
            customers.hasNextPage && (
              <button
                type="button"
                className="quiet"
                disabled={customers.isFetching}
                onClick={() => {
                  void customers.fetchNextPage();
                }}
              >
                Показати ще
              </button>
            )
          )}
        </>
      )}
      {!elsewhere && (
        // Under the list, and under an empty one: the paid and written off
        // are asked for, never shown first (credits task list, P0-1).
        <button
          type="button"
          className="quiet owed-mode"
          onClick={() => {
            setOwedOnly(!owedOnly);
          }}
        >
          {owedOnly ? "Показати сплачені й списані" : "Лише ті, хто винен"}
        </button>
      )}
      {!readOnly && !elsewhere && (
        // Under the results, where the owner's В2 puts it; how a closed
        // store's debts are looked for stays as it was until that is built
        // (credits task list, P1-1).
        <button
          type="button"
          className="quiet elsewhere-ask"
          onClick={() => {
            setElsewhere(true);
            setQuery("");
            setPressed("");
          }}
        >
          Борг магазину, що зараз не працює?
        </button>
      )}
    </section>
  );
}

/** One customer's place in the list: their phone, or their erased debt. */
function keyOf(customer: Customer): string {
  return customer.phone_digits ?? `erased:${customer.credits[0]?.id ?? ""}`;
}
