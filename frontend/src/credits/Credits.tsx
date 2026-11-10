import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { JSX } from "react";
import { BackToMore } from "@/shared/More";
import type { MoreBack } from "@/shared/More";
import {
  useInfiniteQuery,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  InfiniteData,
  UseInfiniteQueryResult,
} from "@tanstack/react-query";
import { api } from "@/shared/api";
import { visible } from "@/shared/visible";
import { money } from "@/orders/types";
import type { Store } from "@/orders/types";
import { useSettled } from "@/sales/StockSearch";
import { Placeholder } from "@/shared/Placeholder";
import { Sum } from "@/shared/Sum";
import { Icon } from "@/shared/Icon";
import { ModeSwitch } from "@/shared/ModeSwitch";
import { Toast } from "@/shared/Toast";
import { ScreenHeader } from "@/shared/ScreenHeader";
import { hideKeyboard } from "@/shared/telegram";
import { Unread } from "@/shared/Unread";
import { SearchField } from "@/shared/SearchField";
import { Empty } from "@/shared/Empty";
import { number, plural } from "@/openings/types";
import { CustomerRow, debtsCount } from "./CustomerRow";
import { Customer as CustomerCard } from "./Customer";
import { Debts } from "./Debts";
import { Debt, refusalText } from "./Debt";
import { askForPhone, erasedCustomer, wholePhone } from "./types";
import type {
  Credit,
  CreditStatus,
  Customer,
  CustomerPage,
  StoreDebts,
} from "./types";

const pageSize = 20;

/** «Винні зараз · Сплачені · Списані»: one status at a time, as the server
 * selects them (owner decision, 2026-11-01, В2 (а)). */
const statuses: readonly { mode: CreditStatus; label: string }[] = [
  { mode: "OPEN", label: "Винні зараз" },
  { mode: "SETTLED", label: "Сплачені" },
  { mode: "WRITTEN_OFF", label: "Списані" },
];

/** A customer of a phone, opened on their card. */
type Phoned = Customer & { phone_digits: string };

/**
 * Sales paid in parts (owner decisions, 2026-10-01): «Покупці» in «Ще» ›
 * «Люди» (spec S19; «Усе на бірці» sections task list, P0-4), and the
 * till's «Внесок».
 *
 * The customer took the goods and pays the rest when they can; there is no
 * schedule. One phone is one customer, with all their debts. «Покупці» is a
 * block a store where this person takes payments — the open one first,
 * then the others that trade — each with what it is owed, as the server
 * summed it for that store alone, never added to another's; «Ім’я або
 * телефон» searches in each, and «Винні зараз · Сплачені · Списані» chooses
 * which debts. A row opens the customer's card (S20), where the payment is
 * taken in the store that sold. The owner may write off a debt that will
 * not be paid, saying why. Returns lower a debt from «Повернення».
 *
 * At the till, «Внесок» lists those who owe this store, and opens a debt
 * for its payment alone (spec S08, S21).
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
  opened,
  till,
  stores = [],
  payTask,
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
  /** «← Ще» over the heading: «Ще» › «Люди» › «Покупці» (S19). */
  back?: MoreBack | undefined;
  /**
   * A customer found on «Сьогодні» (frame task list, P2-2): «Покупці»
   * opens on their card, whose «←» is `back`'s.
   */
  opened?: Phoned | undefined;
  /**
   * The till's «Внесок» (spec S08, S21; «Усе на бірці» task list, P0-3):
   * under «Продаж», those who owe this store, and a debt opened for its
   * payment alone. `others` are this person's other stores that trade and
   * where they take payments, asked for a whole number that owes nothing
   * here; `task` is told while a payment's form stands.
   */
  till?: { task: (shown: boolean) => void; others: readonly Store[] };
  /**
   * «Покупці»'s other blocks: this person's other stores that trade and
   * where they take payments, in the order the server gives them.
   */
  stores?: readonly Store[];
  /** Told while S21's form stands, opened from «Покупці»: the menu steps
   * aside, as at the till. */
  payTask?: (shown: boolean) => void;
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
  const [status, setStatus] = useState<CreditStatus>("OPEN");
  // A debt's detail, read in the store it is in.
  const [selected, setSelected] = useState<{
    credit: Credit;
    store: Store;
  } | null>(null);
  // At the till, a customer of more than one debt, whose debts are shown
  // to choose from.
  const [chosen, setChosen] = useState<Phoned | null>(null);
  // In «Покупці», a customer's card, from the block that listed them; once
  // a payment or a write-off changed a debt of theirs, read afresh, and
  // named as its heading names them.
  const [card, setCard] = useState<{
    first: Phoned;
    from: Store;
    elsewhere: boolean;
    afresh?: true;
    name?: string;
    /** Opened from outside «Покупці»: back there. */
    away?: true;
  } | null>(() =>
    opened
      ? { first: opened, from: store, elsewhere: false, away: true }
      : null,
  );
  // S21 on a debt, from «Покупці»'s card or a debt's detail.
  const [paying, setPaying] = useState<Credit | null>(null);
  // What a card did, said once it had nothing left to show.
  const [toast, setToast] = useState<{ text: string; times: number } | null>(
    null,
  );
  // Whose debts: this store's, or those of the stores that do not trade.
  const [elsewhere, setElsewhere] = useState(false);
  // Other stores' customers are found by their whole phone, never browsed;
  // only what they still owe (owner decisions, 2026-10-10). They are asked
  // for by the number already searched here, by a quiet button under its
  // results, never a choice made first (owner decision, 2026-10-18, В2 (а);
  // credits task list, P1-1); a number changed there into anything else is
  // not asked.
  const searched = !elsewhere || wholePhone(search);
  // One list: the till's, or the stores' that do not trade — only those
  // still owed. «Покупці» reads a list a block.
  const single = till !== undefined || elsewhere;
  // Twenty at a time, each page under those read (credits task list, P0-2):
  // the server takes fifty at most, and a growing `limit` broke the list
  // after forty.
  const customers = useInfiniteQuery({
    queryKey: ["credits", store.id, "customers", elsewhere, search],
    queryFn: ({ pageParam }) =>
      api<CustomerPage>(
        `/credits/customers?store_id=${store.id}&limit=${String(pageSize)}&offset=${String(pageParam)}&status=OPEN${
          search ? `&query=${encodeURIComponent(search)}` : ""
        }${elsewhere ? "&elsewhere=true" : ""}`,
        token,
      ),
    initialPageParam: 0,
    getNextPageParam: (last: CustomerPage, pages: CustomerPage[]) =>
      last.has_more ? pages.length * pageSize : undefined,
    enabled: single && searched,
    retry: false,
    // A search typed keeps the list in place until the new one comes, as at
    // the till; never this store's for the other stores'.
    placeholderData: (
      previous: InfiniteData<CustomerPage, number> | undefined,
      before,
    ) => (before?.queryKey[3] === elsewhere ? previous : undefined),
  });
  // A whole number, the one in the field: what the closed stores and the
  // till's other stores are asked for, once it is answered here.
  const asked = wholePhone(search) && search === query.trim();
  // Asked for once this store has answered for the number in the field —
  // never under its loading, its refusal, the rows of a search before it,
  // nor for a number typed before the one shown (review, 2026-10-19).
  const askElsewhere =
    till !== undefined &&
    !elsewhere &&
    asked &&
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
  const toElsewhere = (): void => {
    switched.current = true;
    setElsewhere(true);
  };
  const listed = unique(customers.data?.pages ?? []);
  // A whole number that owes nothing here, at the till: the same question
  // to each other store of this person's that trades and where they take
  // payments. Found, its row says where the payment is taken, and opens
  // nothing (spec S08; «Усе на бірці» task list, P0-3).
  const others = till?.others ?? [];
  const asksOthers =
    till !== undefined &&
    others.length > 0 &&
    !elsewhere &&
    asked &&
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
  const othersPending = asksOthers && othersRead.some((read) => read.isPending);
  const takenElsewhere = asksOthers
    ? others.flatMap((other, at) =>
        (othersRead[at]?.data?.items ?? [])
          .filter((customer) => customer.open_debts > 0)
          .map((customer) => ({ other, customer })),
      )
    : [];
  const leave = useCallback(() => {
    setChosen(null);
  }, []);
  const named = useCallback((name: string) => {
    setCard((now) => (now && now.name !== name ? { ...now, name } : now));
  }, []);
  // A debt changed under the card, while it is not shown: what it read is
  // gone, so it shows nothing it read before — no old sums, no «Внесок» on
  // them — until read again (S20).
  const cardChanged = (): void => {
    if (!card) return;
    cache.removeQueries({ queryKey: ["credits", store.id, "card"] });
    setCard({ ...card, afresh: true });
  };
  const leaveCard = useCallback((said?: string) => {
    setCard(null);
    if (said !== undefined)
      setToast((now) => ({ text: said, times: (now?.times ?? 0) + 1 }));
  }, []);
  const clear = (): void => {
    setQuery("");
    setPressed("");
    field.current?.focus();
  };
  const blockStores = [
    store,
    ...stores.filter((other) => other.id !== store.id),
  ];
  // Opened from a customer's card, back to it, by their name.
  const cardName = card
    ? (card.name ?? visible(card.first.customer_name ?? erasedCustomer))
    : null;

  if (paying)
    // S21 from «Покупці» (spec S21): the payment alone, on the app's
    // keypad, the menu aside; back where it was opened. Its own, never the
    // detail's: back on the detail, nothing of S21 stays.
    return (
      <Debt
        key={`pay:${paying.id}`}
        store={store}
        token={token}
        journalKey={journalKey}
        blocked={blocked}
        readOnly={readOnly}
        networkOwner={networkOwner}
        mayErase={mayErase}
        credit={paying}
        changed={(credit) => {
          setPaying(credit);
          setSelected((now) =>
            now?.credit.id === credit.id ? { ...now, credit } : now,
          );
          cardChanged();
          void cache.invalidateQueries({ queryKey: ["credits", store.id] });
        }}
        back={() => {
          setPaying(null);
        }}
        // Named as the screen it goes back to: the debt's detail, or the
        // card, by the name each is headed with.
        backTo={
          selected
            ? visible(selected.credit.customer_name ?? erasedCustomer)
            : (cardName ?? visible(paying.customer_name ?? erasedCustomer))
        }
        till={{ task: payTask ?? noTask }}
      />
    );

  if (selected) {
    // Another store's debt, that trades: read here, paid there (owner
    // decision, 2026-10-01); its owner's ⋯ is there too.
    const other = selected.store.id !== store.id;
    return (
      <Debt
        key={`debt:${selected.credit.id}`}
        store={selected.store}
        token={token}
        journalKey={journalKey}
        blocked={blocked}
        readOnly={readOnly || other}
        networkOwner={networkOwner && !other}
        mayErase={mayErase && !other}
        credit={selected.credit}
        changed={(credit) => {
          setSelected({ ...selected, credit });
          cardChanged();
          void cache.invalidateQueries({ queryKey: ["credits", store.id] });
        }}
        back={() => {
          setSelected(null);
        }}
        {...(till
          ? {
              till: { task: till.task },
              ...(chosen
                ? { backTo: visible(chosen.customer_name ?? erasedCustomer) }
                : {}),
            }
          : {
              backTo: cardName ?? "Покупці",
              ...(other
                ? { takenAt: selected.store.name }
                : {
                    deposit: () => {
                      setPaying(selected.credit);
                    },
                  }),
            })}
      />
    );
  }

  if (chosen)
    return (
      <Debts
        store={store}
        token={token}
        first={chosen}
        openOnly
        elsewhere={elsewhere}
        choose={(credit) => {
          setSelected({ credit, store });
        }}
        back={leave}
      />
    );

  if (card)
    return (
      <CustomerCard
        store={store}
        stores={blockStores}
        token={token}
        journalKey={journalKey}
        blocked={blocked}
        readOnly={readOnly}
        networkOwner={networkOwner}
        mayErase={mayErase}
        first={card.first}
        from={card.from}
        elsewhere={card.elsewhere}
        afresh={card.afresh === true}
        named={named}
        choose={(credit, from) => {
          setSelected({ credit, store: from });
        }}
        deposit={setPaying}
        back={leaveCard}
        away={card.away && back}
      />
    );

  // A row of «Покупці»: the customer's card; an erased one, who stands
  // alone, their one debt.
  const openCard =
    (from: Store, inElsewhere: boolean) =>
    (each: Customer): void => {
      // The search done with: the keyboard goes (spec §4.4; «Усе на бірці»
      // task list, P1-2).
      hideKeyboard();
      const phone = each.phone_digits;
      const [only] = each.credits;
      if (phone !== null)
        setCard({
          first: { ...each, phone_digits: phone },
          from,
          elsewhere: inElsewhere,
        });
      else if (only) setSelected({ credit: only, store: from });
    };
  // A row of the till's: one debt shown, it is opened; more, and the seller
  // chooses (credits task list, P0-1).
  const openAtTill = (each: Customer): void => {
    hideKeyboard();
    const [only] = each.credits.length === 1 ? each.credits : [];
    const phone = each.phone_digits;
    if (only) setSelected({ credit: only, store });
    // An erased customer stands alone: one debt each.
    else if (phone !== null) setChosen({ ...each, phone_digits: phone });
  };

  return (
    <>
      <ScreenHeader
        ref={heading}
        focusable
        title={till ? "Продаж" : "Покупці"}
        back={back && <BackToMore back={back} />}
      />
      <section className={till ? "credits" : "credits customers"}>
        {mode}
        {!till && (
          <p className="hint credits-context">Ті, хто купує частинами</p>
        )}
        {elsewhere && (
          // Never mixed with this store's: headed, and left in one tap, the
          // number kept, to read here again. The section's caption, as the
          // return's (spec §5; audit after stage 2, sale P1-1).
          <div className="toolbar elsewhere-head">
            <h3 ref={elsewhereHeading} tabIndex={-1} className="t-label">
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
          className="find"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            setPressed(query.trim().length >= 2 ? query.trim() : "");
          }}
        >
          {/* The till's and the return's own field (spec §6.6; audit after
              stage 2, sale P1-1): its name heard, its hint seen, «×» to
              empty it with the cursor kept; a number's keys where only a
              number is searched. */}
          <SearchField
            label="Ім’я або телефон"
            placeholder="Ім’я або телефон"
            maxLength={200}
            value={query}
            change={(text) => {
              // A letter more, or «×», and the search waits for the pause
              // again, as «Очистити» does — the return's and the orders'
              // rule (review).
              setQuery(text);
              setPressed("");
            }}
            inputRef={field}
            inputMode={elsewhere ? "tel" : undefined}
          />
        </form>
        {!till && !elsewhere && (
          <ModeSwitch
            label="Які борги показати"
            modes={statuses}
            current={status}
            choose={setStatus}
            disabled={false}
            filters
          />
        )}
        {!single ? (
          <>
            {blockStores.map((each) => (
              <Block
                key={each.id}
                store={each}
                here={store}
                token={token}
                status={status}
                search={search}
                alone={blockStores.length === 1}
                readOnly={each.id === store.id && readOnly}
                {...(each.id === store.id && sell ? { sell } : {})}
                blocked={blocked}
                open={openCard(each, false)}
                clear={clear}
                // Under the open store's block, for a whole number it has
                // answered (P1-1), in a store that trades.
                {...(each.id === store.id && !readOnly && asked
                  ? { ask: toElsewhere }
                  : {})}
              />
            ))}
            <p className="hint credits-kept">
              Покупець з’являється тут, коли купує частинами. Ім’я й телефон
              боргу зберігаємо рік після того, як його закрито, і 3 роки після
              списання.
            </p>
          </>
        ) : !searched ? (
          <p>{askForPhone}</p>
        ) : customers.isPending ||
          (customers.isPlaceholderData && listed.length === 0) ? (
          // The rows' places while they are read (credits task list, P2-3).
          <Placeholder said="Завантажуємо борги…" rows={3} debts block />
        ) : !customers.data ? (
          <Unread
            error={customers.error}
            said={refusalText}
            retry={() => {
              void customers.refetch();
            }}
          />
        ) : listed.length === 0 ? (
          // The whole list empty: the blank tag (spec §6.28; audit after
          // stage 2, sale P1-2), the words as before, a sentence a line.
          elsewhere ? (
            <Empty
              title="За цим номером боргів магазинів, що не працюють, не знайдено."
              meta="Перевірте номер або зверніться до менеджера."
            />
          ) : search && othersPending ? (
            <Placeholder said="Завантажуємо борги…" rows={1} debts block />
          ) : search && takenElsewhere.length > 0 ? (
            <div className="list-block" role="list" aria-label="Хто винен">
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
            <Empty {...notFound(search, false)}>
              <button type="button" className="quiet" onClick={clear}>
                Очистити
              </button>
            </Empty>
          ) : (
            <NobodyOwes sell={sell} blocked={blocked} />
          )
        ) : (
          <Rows
            customers={customers}
            listed={listed}
            here={store.id}
            open={till ? openAtTill : openCard(store, true)}
          />
        )}
        {askElsewhere && (
          // Under this store's results for a whole number, and under none:
          // the same number among the stores that do not trade (P1-1).
          <button
            type="button"
            className="quiet elsewhere-ask"
            onClick={toElsewhere}
          >
            Борг магазину, що зараз не працює? Шукати за цим номером
          </button>
        )}
      </section>
      {toast && (
        <Toast
          key={toast.times}
          text={toast.text}
          gone={() => {
            setToast(null);
          }}
        />
      )}
    </>
  );
}

/** S21 opened where nothing steps aside. */
function noTask(): void {
  // Nothing to tell.
}

/**
 * One store's block of «Покупці» (spec S19; «Усе на бірці» sections task
 * list, P0-4): «Магазину «Центр» винні» in capitals, what it is owed as the
 * server summed it for that store, in the debt's colour with its glyph, and
 * «4 покупці · 5 боргів»; under «Сплачені» and «Списані», «Магазин
 * «Центр»» alone. Then its customers twenty at a time, read from that
 * store alone, and its own «Показати ще». What is owed, unread, keeps its
 * place and says so, with a way to read it again (owner decision,
 * 2026-10-21).
 */
function Block({
  store,
  here,
  token,
  status,
  search,
  alone,
  readOnly,
  sell,
  blocked,
  open,
  clear,
  ask,
}: {
  store: Store;
  /** The open store. */
  here: Store;
  token: string;
  status: CreditStatus;
  search: string;
  /** The only block: the words of one store's list, as before. */
  alone: boolean;
  readOnly: boolean;
  sell?: () => void;
  blocked: boolean;
  open: (customer: Customer) => void;
  clear: () => void;
  /** The closed stores asked for the number searched, under this block. */
  ask?: () => void;
}): JSX.Element {
  const headingId = useId();
  const name = visible(store.name);
  const customers = useInfiniteQuery({
    queryKey: ["credits", here.id, "block", store.id, status, search],
    queryFn: ({ pageParam }) =>
      api<CustomerPage>(
        `/credits/customers?store_id=${store.id}&limit=${String(pageSize)}&offset=${String(pageParam)}&status=${status}${
          search ? `&query=${encodeURIComponent(search)}` : ""
        }`,
        token,
      ),
    initialPageParam: 0,
    getNextPageParam: (last: CustomerPage, pages: CustomerPage[]) =>
      last.has_more ? pages.length * pageSize : undefined,
    retry: false,
    // A search typed keeps the rows in place until the new ones come; never
    // one status's for another's.
    placeholderData: (
      previous: InfiniteData<CustomerPage, number> | undefined,
      before,
    ) => (before?.queryKey[4] === status ? previous : undefined),
  });
  const owedNow = status === "OPEN";
  const summary = useQuery({
    queryKey: ["credits", store.id, "summary"],
    queryFn: () =>
      api<StoreDebts>(`/credits/summary?store_id=${store.id}`, token),
    enabled: owedNow,
    retry: false,
  });
  // Refused, and not read since: said so, and held so while read again —
  // its button stays, waiting (review, 2026-10-21).
  const unread = summary.data === undefined && summary.errorUpdateCount > 0;
  const listed = unique(customers.data?.pages ?? []);
  const answered = customers.isSuccess && !customers.isPlaceholderData;
  const label = owedNow ? `Магазину «${name}» винні` : `Магазин «${name}»`;
  return (
    <section className="credits-block" aria-labelledby={headingId}>
      <div className="credits-block-head">
        <h3 id={headingId} className="t-label">
          {label}
        </h3>
        {owedNow &&
          (summary.data ? (
            <div
              className="block-owed"
              role="group"
              aria-label={`Скільки винні магазину «${name}»`}
            >
              <p className="owed-sum">
                <Icon name="owed" size={20} />
                <Sum value={money(summary.data.owed)} />
              </p>
              <p className="owed-count">
                {number(summary.data.customers)}{" "}
                {plural(
                  summary.data.customers,
                  "покупець",
                  "покупці",
                  "покупців",
                )}{" "}
                · {debtsCount(summary.data.debts)}
              </p>
            </div>
          ) : (
            // Its place while it is read, in its own lines' heights, so
            // the rows under it do not move when it comes (credits task
            // list, P2-3); and kept when it cannot be read, saying so.
            <div
              className={`block-owed owed-place${unread ? " owed-failed" : ""}`}
              {...(unread
                ? {
                    role: "group",
                    "aria-label": `Скільки винні магазину «${name}»`,
                  }
                : { "aria-hidden": true })}
            >
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
                  // Over the lines, never below them: nothing moves. A
                  // warning's line with its triangle, never a refusal's
                  // red over what is owed (audit after stage 2, sale P1-2).
                  <div className="owed-retry">
                    <p role="alert" className="owed-unread">
                      <Icon name="warning" size={16} />
                      Не вдалося прочитати
                    </p>
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
          ))}
      </div>
      {readOnly && (
        // The store's own notice says it does not trade; this says who
        // takes the payments (credits task list, P0-1).
        <p className="hint">
          Внески приймає будь-який магазин мережі, що працює.
        </p>
      )}
      {customers.isPending ||
      (customers.isPlaceholderData && listed.length === 0) ? (
        // The rows' places while they are read (credits task list, P2-3).
        <Placeholder
          said="Завантажуємо борги…"
          rows={alone ? 3 : 1}
          debts
          block
        />
      ) : !customers.data ? (
        <Unread
          error={customers.error}
          said={refusalText}
          retry={() => {
            void customers.refetch();
          }}
        />
      ) : listed.length === 0 ? (
        search ? (
          alone ? (
            // The whole list: the blank tag (sale P1-2); in a block among
            // several, its line (2026-11-01).
            <Empty {...notFound(search, readOnly)}>
              <button type="button" className="quiet" onClick={clear}>
                Очистити
              </button>
            </Empty>
          ) : (
            <p className="hint">Нікого не знайдено.</p>
          )
        ) : status === "SETTLED" ? (
          <p className="hint">Сплачених боргів тут немає.</p>
        ) : status === "WRITTEN_OFF" ? (
          <p className="hint">Списаних боргів тут немає.</p>
        ) : store.id === here.id && !readOnly ? (
          // In a block among several, its lines as before: the tag is the
          // whole list's (2026-11-01).
          <NobodyOwes sell={sell} blocked={blocked} plain={!alone} />
        ) : alone ? (
          <Empty title="Зараз ніхто не винен цьому магазину." />
        ) : (
          <p>Зараз ніхто не винен цьому магазину.</p>
        )
      ) : (
        <Rows
          customers={customers}
          listed={listed}
          here={store.id}
          label={alone ? "Хто винен" : `Хто винен магазину «${name}»`}
          open={open}
        />
      )}
      {ask && answered && (
        // Under this store's results for a whole number, and under none:
        // the same number among the stores that do not trade (P1-1).
        <button type="button" className="quiet elsewhere-ask" onClick={ask}>
          Борг магазину, що зараз не працює? Шукати за цим номером
        </button>
      )}
    </section>
  );
}

/**
 * A list's rows, read again and refused over them, and its «Показати ще»:
 * twenty more, or the page that could not be read asked again, those read
 * staying (ADR-0011).
 */
function Rows({
  customers,
  listed,
  here,
  label = "Хто винен",
  open,
}: {
  customers: UseInfiniteQueryResult<InfiniteData<CustomerPage>>;
  listed: readonly Customer[];
  here: string;
  label?: string;
  open: (customer: Customer) => void;
}): JSX.Element {
  return (
    <>
      {customers.isError && !customers.isFetchNextPageError && (
        // Read again and refused: the rows below are as they were, and that
        // is said (ADR-0011).
        <Unread
          error={customers.error}
          said={refusalText}
          held={customers.isFetching}
          retry={() => {
            void customers.refetch();
          }}
        />
      )}
      <div className="list-block" role="list" aria-label={label}>
        {listed.map((each) => (
          <div role="listitem" key={keyOf(each)}>
            <CustomerRow
              customer={each}
              here={here}
              open={() => {
                open(each);
              }}
            />
          </div>
        ))}
      </div>
      {customers.isFetchNextPageError ? (
        // The next page could not be read: those read stay.
        <Unread
          error={customers.error}
          said={refusalText}
          held={customers.isFetching}
          retry={() => {
            void customers.fetchNextPage();
          }}
        />
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
  );
}

/** What a search that found nothing says: the fact its line, what to do
 * its meta (audit after stage 2, sale P1-2). */
function notFound(
  search: string,
  readOnly: boolean,
): { title: string; meta?: string } {
  return !wholePhone(search)
    ? {
        title: `За «${visible(search)}» боргів не знайдено.`,
        meta: "Перевірте ім’я або введіть номер телефону.",
      }
    : readOnly
      ? // Anyone trading takes it: the fact alone (review, 2026-10-19).
        { title: "За цим номером у цьому магазині боргів немає." }
      : // A whole number owes nothing here: the rule, and the closed stores
        // asked for under it (P1-1).
        {
          title: "За цим номером у цьому магазині боргів немає.",
          meta: "Внесок приймає магазин, де продали.",
        };
}

/** The first weeks (credits task list, P1-4): where a debt begins, and a
 * way there — the blank tag (audit after stage 2, sale P1-2). «Продаж» is
 * the till; «Каса» is the drawer. */
function NobodyOwes({
  sell,
  blocked,
  plain = false,
}: {
  sell: (() => void) | undefined;
  blocked: boolean;
  /** In a block among several: its lines, no tag (2026-11-01). */
  plain?: boolean;
}): JSX.Element {
  const title = "Зараз ніхто не винен.";
  const meta = "Борг з’являється, коли продають частинами.";
  // Held as the till's own button is, while a kept command waits.
  const button = sell && (
    <button type="button" disabled={blocked} onClick={sell}>
      Новий продаж
    </button>
  );
  return plain ? (
    <div className="empty">
      <p>{`${title} ${meta}`}</p>
      {button}
    </div>
  ) : (
    <Empty title={title} meta={meta}>
      {button}
    </Empty>
  );
}

/** A debt opened meanwhile moves the pages' edge: a customer read twice is
 * shown once. */
function unique(pages: readonly CustomerPage[]): Customer[] {
  return [
    ...new Map(
      pages
        .flatMap((page) => page.items)
        .map((customer) => [keyOf(customer), customer]),
    ).values(),
  ];
}

/** One customer's place in the list: their phone, or their erased debt. */
function keyOf(customer: Customer): string {
  return customer.phone_digits ?? `erased:${customer.credits[0]?.id ?? ""}`;
}
