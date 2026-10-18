import { useCallback, useId, useRef, useState } from "react";
import type { JSX } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { ApiError, api, errorText } from "@/shared/api";
import { NoCustomerData } from "@/shared/NoCustomerData";
import { visible } from "@/shared/visible";
import { decimal, kopecks, money } from "@/orders/types";
import type { Store } from "@/orders/types";
import { asInput } from "@/prices/SuggestedPrice";
import {
  isTillMethod,
  methodHow,
  methodLabels,
  notStated,
  refundHow,
  tillMethods,
} from "@/shared/payment";
import type { TillMethod } from "@/shared/payment";
import {
  PaperFields,
  paperRefusal,
  paperText,
  usePaperMark,
} from "@/sales/paperMark";
import type { PaperBody } from "@/sales/paperMark";
import { paidDuringOutage } from "@/sales/types";
import { useSettled } from "@/sales/StockSearch";
import { Sum } from "@/shared/Sum";
import { number, plural } from "@/openings/types";
import { submitCreditCommand, useCreditCommand } from "./commands";
import { CustomerRow, debtsCount } from "./CustomerRow";
import { Customer as CustomerDebts } from "./Customer";
import { erasedCustomer, statusLabels } from "./types";
import type {
  Credit,
  CreditEntry,
  Customer,
  CustomerPage,
  Erasure,
  StoreDebts,
} from "./types";

const pageSize = 20;

/** As the server: another store's customer is found by their whole phone,
 * however it is written or pasted, with the invisible marks a phone's
 * contacts add (owner decision, 2026-10-10). */
function wholePhone(text: string): boolean {
  const digits = text.replace(/\D/g, "").length;
  return /^[\d\s()+./\p{Cf}-]+$/u.test(text) && digits >= 10 && digits <= 15;
}
const askForPhone =
  "Введіть повний номер телефону покупця, наприклад 067 123 45 67. За іменем чи частиною номера борги інших магазинів не шукають.";

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

function day(iso: string): string {
  return new Date(iso).toLocaleDateString("uk-UA");
}

/**
 * What the owner's erasure did: how many closed debts lost the customer, and
 * how many open ones keep them. Those are erased by their own term once
 * closed, or by the owner again (owner decision, 2026-10-09; ADR-0015 §5).
 */
function erasedText(result: Erasure): string {
  const open =
    result.still_open > 0
      ? ` Відкритих боргів цього покупця: ${String(result.still_open)}. З них дані не стирають; коли їх закриють, стерти можна так само.`
      : "";
  return result.erased > 0
    ? `Дані покупця стерто із закритих боргів${result.network ? "" : " цього магазину"}: ${String(result.erased)}.${open}`
    : `Дані покупця вже стерто.${open}`;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("uk-UA", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

const entryLabels: Record<CreditEntry["kind"], string> = {
  PAYMENT: "Внесок",
  RETURN: "Повернення товару",
  WRITE_OFF: "Списано",
};

/**
 * What a history line says of how money moved (ADR-0012 §B12): «· готівка»
 * after a payment, «(повернено 1 000,00 грн на картку)» after a return that
 * handed money back. A payment recorded before the way was asked reads «не
 * вказано», and is never guessed (owner decision, 2026-10-04).
 */
function entryWay(entry: CreditEntry): string {
  const corrected = entry.corrected ? " (виправлено)" : "";
  if (entry.kind === "PAYMENT")
    return ` · ${
      entry.payment_method
        ? methodLabels[entry.payment_method].toLowerCase()
        : notStated
    }${corrected}`;
  if (entry.kind === "RETURN" && (kopecks(entry.cash_back) ?? 0n) > 0n)
    return ` (повернено ${money(entry.cash_back)}${
      isTillMethod(entry.payment_method)
        ? ` ${refundHow[entry.payment_method]}`
        : ""
    }${entry.corrected ? ", виправлено" : ""})`;
  return "";
}

function Debt({
  store,
  token,
  journalKey,
  blocked,
  readOnly,
  networkOwner,
  mayErase,
  credit,
  changed,
  back,
}: {
  store: Store;
  token: string;
  journalKey: string;
  blocked: boolean;
  readOnly: boolean;
  networkOwner: boolean;
  mayErase: boolean;
  credit: Credit;
  changed: (credit: Credit) => void;
  back: () => void;
}): JSX.Element {
  const { busy, pending } = useCreditCommand();
  const [commandId, setCommandId] = useState(() => crypto.randomUUID());
  const [amount, setAmount] = useState("");
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [erasing, setErasing] = useState<"ask" | "sending" | null>(null);
  const cache = useQueryClient();
  const hint = useId();
  // Another store's debt, paid here because that one does not trade.
  const elsewhere = credit.store_id !== store.id;
  // The owner writes off; for a store that does not trade, the network's.
  const mayWriteOff =
    credit.store_state === "ACTIVE"
      ? !readOnly && store.permissions.includes("credit:write_off")
      : networkOwner;
  const owed = kopecks(credit.owed) ?? 0n;
  const working = busy || pending !== null;
  // Paper mode: the till's switch (`@/sales/paper`); the paper's time is
  // this payment's own (owner decision, 2026-10-10; ADR-0021).
  const paperMark = usePaperMark(store, token, journalKey, "credit");
  // A store's owner erases in their store, while it trades (owner,
  // 2026-10-09); the network's owner anywhere.
  const erasesHere =
    !readOnly &&
    !elsewhere &&
    store.permissions.includes("credit:erase_customer");

  async function send(
    body:
      | {
          kind: "payment";
          amount: string;
          payment_method: TillMethod;
          elsewhere?: boolean;
          outage?: PaperBody;
        }
      | { kind: "write-off"; reason: string },
  ): Promise<void> {
    setProblem(null);
    setDone(null);
    const outcome = await submitCreditCommand(journalKey, token, {
      // A new transport key per attempt; the payment's identity is
      // `command_id`, which is what makes a late retry safe.
      key: crypto.randomUUID(),
      body: {
        ...body,
        store_id: store.id,
        credit_id: credit.id,
        command_id: commandId,
      },
    });
    if (outcome.kind === "done") {
      setCommandId(crypto.randomUUID());
      setAmount("");
      setReason("");
      setAsking(false);
      setDone(
        body.kind === "write-off"
          ? `Борг списано: ${money(outcome.result.written_off)}.`
          : `${paymentTaken(body.amount, body.payment_method, !!body.outage, body.outage?.first_days === true)} ${
              outcome.result.status === "SETTLED"
                ? "Борг сплачено повністю."
                : `Залишок боргу ${money(outcome.result.owed)}.`
            }`,
      );
      if (body.kind === "payment" && body.outage) paperMark.forgetTime();
      changed(outcome.result);
    } else if (outcome.kind === "refused") {
      setCommandId(crypto.randomUUID());
      setAsking(false);
      setProblem(
        refusalText(
          outcome.error,
          body.kind === "payment" ? body.payment_method : undefined,
        ),
      );
      // Refused because the debt moved on — another payment, a return: show
      // it as it is now.
      try {
        changed(
          await api<Credit>(
            `/credits/${credit.id}${elsewhere ? `?store_id=${store.id}` : ""}`,
            token,
          ),
        );
      } catch {
        // What was shown stays; the refusal says what to do.
      }
    }
  }

  /**
   * The owner erases this customer at their request: from every closed debt
   * of the network under their phone. Not a money command, and the same
   * whenever repeated, so it is sent directly rather than through the
   * journal (owner decision, 2026-10-09; ADR-0015).
   */
  async function erase(): Promise<void> {
    setProblem(null);
    setDone(null);
    setErasing("sending");
    try {
      // A body makes it a POST; the command takes nothing in it.
      const result = await api<Erasure>(
        `/credits/${credit.id}/erase-customer`,
        token,
        {},
      );
      setDone(erasedText(result));
      changed(result.credit);
      // The customer is erased in every store of the network.
      void cache.invalidateQueries({ queryKey: ["credits"] });
    } catch (error) {
      setProblem(refusalText(error));
    } finally {
      setErasing(null);
    }
  }

  function pay(way: TillMethod): void {
    // From paper, nothing is sent until the series says which paper it is
    // (owner decision, 2026-10-16): the buttons wait, and so does this.
    if (!paperMark.ready) return;
    const cents = kopecks(amount);
    if (cents === null || cents <= 0n) {
      setProblem("Вкажіть суму внеску з точністю до копійок.");
      return;
    }
    if (cents > owed) {
      // The same words as the server's refusal: a sum typed from paper may
      // have been taken already (owner decision, 2026-10-07).
      setProblem(moreThanOwed(credit.owed, way));
      return;
    }
    const outage = paperMark.body();
    void send({
      kind: "payment",
      amount: decimal(cents),
      payment_method: way,
      ...(elsewhere ? { elsewhere: true } : {}),
      ...(outage ? { outage } : {}),
    });
  }

  return (
    <section>
      <div className="toolbar">
        <h2>Борг</h2>
        <button
          className="quiet"
          disabled={working || erasing === "sending"}
          onClick={back}
        >
          До списку боргів
        </button>
      </div>
      <h3>{visible(credit.customer_name ?? erasedCustomer)}</h3>
      {credit.customer_phone ? (
        <p>
          <a href={`tel:${credit.customer_phone.replace(/[^\d+]/g, "")}`}>
            {visible(credit.customer_phone)}
          </a>
        </p>
      ) : (
        credit.customer_erased_at && (
          <p className="hint">
            Ім’я й телефон стерто {day(credit.customer_erased_at)}. Суми
            лишаються.
          </p>
        )
      )}
      <p className="hint">
        {credit.goods.map(visible).join(", ")} · продано{" "}
        {when(credit.opened_at)}
      </p>
      {elsewhere && (
        <p className="notice">
          Продано в магазині «{visible(credit.store_name)}», який зараз{" "}
          {credit.store_state === "ARCHIVED" ? "закрито" : "заблоковано"}.
          Внесок приймає цей магазин; борг лишається за «
          {visible(credit.store_name)}».
        </p>
      )}
      <dl className="debt">
        <dt>Сума продажу</dt>
        <dd>{money(credit.amount)}</dd>
        <dt>Сплачено</dt>
        <dd>{money(credit.paid)}</dd>
        {(kopecks(credit.returned) ?? 0n) > 0n && (
          <>
            <dt>Повернено товару на</dt>
            <dd>
              {money(credit.returned)}
              {(kopecks(credit.cash_back) ?? 0n) > 0n &&
                `, з них грошима ${money(credit.cash_back)}`}
            </dd>
          </>
        )}
        {(kopecks(credit.written_off) ?? 0n) > 0n && (
          <>
            <dt>Списано</dt>
            <dd>{money(credit.written_off)}</dd>
          </>
        )}
        <dt>Залишок боргу</dt>
        <dd>
          <strong>{money(credit.owed)}</strong>
        </dd>
      </dl>
      {credit.status !== "OPEN" && (
        <p className="badge">{statusLabels[credit.status]}</p>
      )}
      {done && <p role="status">{done}</p>}
      {problem && <p role="alert">{problem}</p>}
      {credit.status === "OPEN" && !readOnly && (
        <fieldset disabled={blocked || working}>
          <legend>Внесок</legend>
          <PaperFields mark={paperMark} what="payment" storeId={store.id} />
          <label>
            Сума внеску, грн
            <input
              inputMode="decimal"
              placeholder="0,00"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
              }}
            />
          </label>
          <div className="actions">
            {tillMethods.map((way) => (
              <button
                key={way}
                type="button"
                disabled={!paperMark.ready}
                onClick={() => {
                  pay(way);
                }}
              >
                {paperMark.paper
                  ? `З паперу · ${methodLabels[way]}`
                  : methodLabels[way]}
              </button>
            ))}
            <button
              type="button"
              className="quiet"
              onClick={() => {
                setAmount(asInput(credit.owed));
              }}
            >
              Увесь залишок
            </button>
          </div>
          {paperMark.paper && (
            <p className="hint">
              {paperMark.firstDays === null
                ? "Оберіть угорі, що вносите з паперу."
                : paperMark.firstDays
                  ? "Внесок уже взяли: натисніть, як заплатили. На терміналі нічого не проводьте."
                  : "Внесок взяли під час збою: натисніть, як заплатили. На терміналі нічого не проводьте."}
              {` Хто прийняв: ${paperMark.named ? visible(paperMark.named.display_name) : "не вказано"}.`}
            </p>
          )}
        </fieldset>
      )}
      {credit.status === "OPEN" && mayWriteOff && (
        <fieldset disabled={blocked || working}>
          <legend>Списання</legend>
          {asking ? (
            <div className="notice">
              <p>
                Борг {money(credit.owed)} закриється без оплати. Скасувати це
                потім не можна.
              </p>
              <label>
                Чому списуємо
                <textarea
                  value={reason}
                  maxLength={1000}
                  aria-describedby={hint}
                  onChange={(event) => {
                    setReason(event.target.value);
                  }}
                />
                <NoCustomerData id={hint} />
              </label>
              <div className="actions">
                <button
                  type="button"
                  disabled={reason.trim() === ""}
                  onClick={() => {
                    void send({ kind: "write-off", reason: reason.trim() });
                  }}
                >
                  Так, списати {money(credit.owed)}
                </button>
                <button
                  type="button"
                  className="quiet"
                  onClick={() => {
                    setAsking(false);
                  }}
                >
                  Скасувати
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="quiet"
              onClick={() => {
                setDone(null);
                setProblem(null);
                setAsking(true);
              }}
            >
              Списати борг
            </button>
          )}
        </fieldset>
      )}
      {(mayErase || erasesHere) &&
        credit.status !== "OPEN" &&
        credit.customer_erased_at === null && (
          <fieldset disabled={working || erasing === "sending"}>
            <legend>Дані покупця</legend>
            {erasing ? (
              <div className="notice">
                <p>
                  Ім’я й телефон покупця зникнуть з усіх закритих боргів{" "}
                  {mayErase ? "мережі" : "цього магазину"} з цим телефоном. Суми
                  лишаються. Скасувати це не можна.
                </p>
                <div className="actions">
                  <button
                    type="button"
                    onClick={() => {
                      void erase();
                    }}
                  >
                    Так, стерти дані покупця
                  </button>
                  <button
                    type="button"
                    className="quiet"
                    onClick={() => {
                      setErasing(null);
                    }}
                  >
                    Скасувати
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="quiet"
                onClick={() => {
                  setDone(null);
                  setProblem(null);
                  setErasing("ask");
                }}
              >
                Стерти дані покупця
              </button>
            )}
          </fieldset>
        )}
      <h3>Історія</h3>
      <ul aria-label="Історія боргу">
        {credit.entries.map((entry, index) => (
          <li key={`${entry.at}:${String(index)}`}>
            {when(entry.at)} · {entryLabels[entry.kind]} {money(entry.amount)}
            {entryWay(entry)} ·{" "}
            {entry.outage
              ? `${paperText("payment", entry.outage)} · внесено: ${visible(entry.by)}`
              : visible(entry.by)}
            {entry.taken_at &&
              ` · прийняв магазин «${visible(entry.taken_at)}»`}
            {entry.note && ` · ${visible(entry.note)}`}
            {entry.kind === "WRITE_OFF" &&
              entry.note === null &&
              " · причину стерто разом з даними покупця"}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * «Внесок 300,00 грн прийнято карткою.», or for one typed from paper the
 * same with what the till says of money taken during the outage: never to
 * charge the card again (owner decision, 2026-10-10; ADR-0021). The first
 * days' paper says it with no word of an outage.
 */
export function paymentTaken(
  amount: string,
  way: TillMethod,
  fromPaper: boolean,
  firstDays = false,
): string {
  if (!fromPaper) return `Внесок ${money(amount)} прийнято ${methodHow[way]}.`;
  const paid = paidDuringOutage(way, firstDays);
  return `Внесок ${money(amount)} з паперу записано: ${methodHow[way]}${paid ? ` — ${paid}` : ""}.`;
}

/**
 * How money taken for a debt goes back to the customer: the way it came,
 * never another — cash from the drawer, a card through the terminal, a
 * transfer by transfer (owner decision, 2026-10-07; ADR-0013 §8, G9). After
 * «поверніть покупцю»; cash, and a payment kept from before the way was
 * asked, add nothing.
 */
function backTo(way: TillMethod | null): string {
  return way === "CARD"
    ? " на картку через термінал"
    : way === "TRANSFER"
      ? " переказом"
      : "";
}

/**
 * More than is owed: what is still owed is taken, and the rest goes back the
 * way it came (G9).
 */
function moreThanOwed(owed: string, way: TillMethod | null): string {
  return `Це більше, ніж винні: залишок боргу ${money(owed)}. Прийміть ${money(owed)}, а решту поверніть покупцю${backTo(way)}.`;
}

/**
 * Why a payment or a write-off was refused. `way` is how the payment was
 * pressed, null for one kept from before the way was asked, and absent for a
 * write-off. A payment taken on paper and typed once the debt was paid
 * meanwhile stays refused, and the money goes back (owner decisions,
 * 2026-10-04 and 2026-10-07; ADR-0013 §8, G9, G19). A kept payment refused
 * on resend says the same (`@/cash/errors`).
 */
export function refusalText(error: unknown, way?: TillMethod | null): string {
  if (error instanceof ApiError) {
    // Typed from paper, refused for its mark (ADR-0021).
    const paper = paperRefusal(error.details.reason, error.details.days);
    if (paper !== null) return paper;
    switch (error.details.reason) {
      case "MORE_THAN_OWED":
        return way === undefined
          ? `Це більше, ніж винні: залишок боргу ${money(String(error.details.owed))}.`
          : moreThanOwed(String(error.details.owed), way);
      case "NOT_OWED":
        if (way === undefined) return "За цим продажем уже нічого не винні.";
        // Cash not yet given back is in the drawer: a surplus at the close,
        // with its reason. A card or a transfer is not in it.
        return `За цим продажем уже нічого не винні — внесок не записано. Якщо гроші вже взяли, поверніть їх покупцю${backTo(way)}${
          way === "CASH"
            ? ". Поки не повернули, вони зайві в касі: при закритті вкажіть причину."
            : way === null
              ? "."
              : ". На касу це не впливає."
        }`;
      case "NOTHING_PAID":
        return "Внесок має бути більшим за нуль.";
      case "NO_REASON":
        return "Вкажіть, чому списуємо борг.";
      // Taken on paper in another store while this one was blocked, typed
      // once it works again: a manager decides each case (owner decision,
      // 2026-10-07; G25).
      case "PAID_WHERE_SOLD":
        return "Магазин, де продали, знову працює — внесок приймає він. Передайте папір менеджеру.";
      case "PHONE_REQUIRED":
        return askForPhone;
      case "STILL_OWED":
        return "Борг ще не закрито: дані покупця з нього не стирають. Коли його закриють, стерти можна так само.";
    }
  }
  return errorText(error);
}
