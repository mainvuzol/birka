import { useCallback, useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { BackToMore } from "@/shared/More";
import type { MoreBack } from "@/shared/More";
import {
  useInfiniteQuery,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { api } from "@/shared/api";
import { visible } from "@/shared/visible";
import { money } from "@/orders/types";
import type { Store } from "@/orders/types";
import { useSettled } from "@/sales/StockSearch";
import { Placeholder } from "@/shared/Placeholder";
import { Sum } from "@/shared/Sum";
import { ScreenHeader } from "@/shared/ScreenHeader";
import { hideKeyboard } from "@/shared/telegram";
import { number, plural } from "@/openings/types";
import { CustomerRow, debtsCount } from "./CustomerRow";
import { Customer as CustomerDebts } from "./Customer";
import { Debt, refusalText } from "./Debt";
import { askForPhone, erasedCustomer, wholePhone } from "./types";
import type { Credit, Customer, CustomerPage, StoreDebts } from "./types";

const pageSize = 20;

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
  sell,
  mode = null,
  back,
  till,
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
  /**
   * «Новий продаж», where a debt begins, from an empty list; only for whoever
   * may sell here (credits task list, P1-4).
   */
  sell?: (() => void) | undefined;
  /**
   * «Борги | Замовлення» under the heading, for whoever has both
   * (navigation task list, P0-2); none for anyone else. At the till,
   * «Продати · Повернути · Внесок».
   */
  mode?: JSX.Element | null;
  /** «← Ще» over the heading: «Ще» › «Люди» › «Борги» until «Покупці»
   * (S19; «Усе на бірці» task list, P0-4). */
  back?: MoreBack | undefined;
  /**
   * The till's «Внесок» (spec S08, S21; «Усе на бірці» task list, P0-3):
   * under «Продаж», those who owe this store, and a debt opened for its
   * payment alone. `others` are this person's other stores that trade and
   * where they take payments, asked for a whole number that owes nothing
   * here; `task` is told while a payment's form stands.
   */
  till?: { task: (shown: boolean) => void; others: readonly Store[] };
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
  // only what they still owe (owner decisions, 2026-10-10). They are asked
  // for by the number already searched here, by a quiet button under its
  // results, never a choice made first (owner decision, 2026-10-18, В2 (а);
  // credits task list, P1-1); a number changed there into anything else is
  // not asked.
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
  // Asked for once this store has answered for the number in the field —
  // never under its loading, its refusal, the rows of a search before it,
  // nor for a number typed before the one shown (review, 2026-10-19).
  const askElsewhere =
    !readOnly &&
    !elsewhere &&
    wholePhone(search) &&
    search === query.trim() &&
    customers.isSuccess &&
    !customers.isPlaceholderData;
  // Each switch brings the eye and a screen reader to what it opened: the
  // button tapped is gone (review, 2026-10-19).
  const switched = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const elsewhereHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!switched.current) return;
    switched.current = false;
    (elsewhere ? elsewhereHeading : heading).current?.focus();
  }, [elsewhere]);
  const listed = [
    ...new Map(
      (customers.data?.pages ?? [])
        .flatMap((page) => page.items)
        .map((customer) => [keyOf(customer), customer]),
    ).values(),
  ];
  // A whole number that owes nothing here, at the till: the same question
  // to each other store of this person's that trades and where they take
  // payments. Found, its row says where the payment is taken, and opens
  // nothing (spec S08; «Усе на бірці» task list, P0-3).
  const others = till?.others ?? [];
  const asksOthers =
    till !== undefined &&
    others.length > 0 &&
    !elsewhere &&
    wholePhone(search) &&
    search === query.trim() &&
    customers.isSuccess &&
    !customers.isPlaceholderData &&
    listed.length === 0;
  const othersRead = useQueries({
    queries: others.map((other) => ({
      queryKey: ["credits", store.id, "taken-at", other.id, search],
      queryFn: () =>
        api<CustomerPage>(
          `/credits/customers?store_id=${other.id}&limit=5&status=OPEN&query=${encodeURIComponent(search)}`,
          token,
        ),
      enabled: asksOthers,
      retry: false,
    })),
  });
  const othersPending =
    asksOthers && othersRead.some((read) => read.isPending);
  const takenElsewhere = asksOthers
    ? others.flatMap((other, at) =>
        (othersRead[at]?.data?.items ?? [])
          .filter((customer) => customer.open_debts > 0)
          .map((customer) => ({ other, customer })),
      )
    : [];
  // The till names no store's total: what is owed is on each row.
  const summary = useQuery({
    queryKey: ["credits", store.id, "summary"],
    queryFn: () =>
      api<StoreDebts>(`/credits/summary?store_id=${store.id}`, token),
    enabled: till === undefined,
    retry: false,
  });
  // Refused, and not read since: said so, and held so while read again —
  // its button stays, waiting (review, 2026-10-21).
  const unread = summary.data === undefined && summary.errorUpdateCount > 0;
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
        {...(till ? { till: { task: till.task } } : {})}
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
    <>
      <ScreenHeader
        ref={heading}
        focusable
        title={till ? "Продаж" : "Борги"}
        back={back && <BackToMore back={back} />}
      />
      <section className="credits">
        {mode}
        {readOnly && (
          // The store's own notice says it does not trade; this says who
          // takes the payments (credits task list, P0-1).
          <p className="hint">
            Внески приймає будь-який магазин мережі, що працює.
          </p>
        )}
        {till ? null : !elsewhere && summary.data ? (
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
        ) : (
          !elsewhere &&
          (summary.isPending || summary.isError) && (
            // Its place while it is read, in its own lines' heights, so the
            // field under it does not move when it comes (credits task list,
            // P2-3); and kept when it cannot be read, saying so, with a way
            // to read it again (owner decision, 2026-10-21).
            <div
              className={`owed-card owed-place${unread ? " owed-failed" : ""}`}
              {...(unread
                ? { role: "group", "aria-label": "Скільки винні магазину" }
                : { "aria-hidden": true })}
            >
              <p className="owed-what">Магазину винні</p>
              <div className="owed-lines">
                {/* Grey lines the size of the figures to come; what sizes
                    them is never seen, nor read (review, 2026-10-21). */}
                <p className="owed-sum" aria-hidden="true">
                  <strong className="sum skeleton-line">
                    <span>00 000</span>
                  </strong>
                </p>
                <p className="owed-count" aria-hidden="true">
                  <span className="skeleton-line">
                    <span>00 000 · 00 000</span>
                  </span>
                </p>
                {unread && (
                  // Over the lines, never below them: nothing moves.
                  <div className="owed-retry">
                    <p role="alert">Не вдалося прочитати</p>
                    <button
                      type="button"
                      className="quiet"
                      disabled={summary.isFetching}
                      onClick={() => {
                        void summary.refetch();
                      }}
                    >
                      Спробувати ще раз
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        )}
        {elsewhere && (
          // Never mixed with this store's: headed, and left in one tap, the
          // number kept, to read here again.
          <div className="toolbar elsewhere-head">
            <h3 ref={elsewhereHeading} tabIndex={-1}>
              Магазини, що не працюють
            </h3>
            <button
              type="button"
              className="quiet"
              onClick={() => {
                switched.current = true;
                setElsewhere(false);
              }}
            >
              <span aria-hidden="true">← </span>У цьому магазині
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
            Ім’я або телефон
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
          // The rows' places while they are read (credits task list, P2-3).
          <Placeholder said="Завантажуємо борги…" rows={3} debts />
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
          ) : search && othersPending ? (
            <Placeholder said="Завантажуємо борги…" rows={1} debts />
          ) : search && takenElsewhere.length > 0 ? (
            <div role="list" aria-label="Хто винен">
              {takenElsewhere.map(({ other, customer }) => (
                <div role="listitem" key={`${other.id}:${keyOf(customer)}`}>
                  <CustomerRow
                    customer={customer}
                    here={other.id}
                    open={{ takenAt: other.name }}
                  />
                </div>
              ))}
            </div>
          ) : search ? (
            <div className="empty">
              <p>
                {!wholePhone(search)
                  ? `За «${visible(search)}» боргів не знайдено. Перевірте ім’я або введіть номер телефону.`
                  : readOnly
                    ? // Anyone trading takes it: the fact alone (review,
                      // 2026-10-19).
                      "За цим номером у цьому магазині боргів немає."
                    : // A whole number owes nothing here: the rule, and the
                      // closed stores asked for under it (P1-1).
                      "За цим номером у цьому магазині боргів немає. Внесок приймає магазин, де продали."}
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
          ) : owedOnly && !readOnly ? (
            // The first weeks: where a debt begins, and a way there (credits
            // task list, P1-4). «Продаж» is the till; «Каса» is the drawer.
            <div className="empty">
              <p>
                Зараз ніхто не винен. Борг з’являється, коли продають частинами.
              </p>
              {sell && (
                // Held as the till's own button is, while a kept command waits.
                <button type="button" disabled={blocked} onClick={sell}>
                  Новий продаж
                </button>
              )}
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
                      // The search done with: the keyboard goes (spec §4.4;
                      // «Усе на бірці» task list, P1-2).
                      hideKeyboard();
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
        {askElsewhere && (
          // Under this store's results for a whole number, and under none:
          // the same number among the stores that do not trade (P1-1).
          <button
            type="button"
            className="quiet elsewhere-ask"
            onClick={() => {
              switched.current = true;
              setElsewhere(true);
            }}
          >
            Борг магазину, що зараз не працює? Шукати за цим номером
          </button>
        )}
        {!elsewhere && !till && (
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
      </section>
    </>
  );
}

/** One customer's place in the list: their phone, or their erased debt. */
function keyOf(customer: Customer): string {
  return customer.phone_digits ?? `erased:${customer.credits[0]?.id ?? ""}`;
}
