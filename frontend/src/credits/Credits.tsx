import { useState } from "react";
import type { JSX } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, errorText } from "@/shared/api";
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
import { submitCreditCommand, useCreditCommand } from "./commands";
import { statusLabels } from "./types";
import type { Credit, CreditEntry, CustomerPage, StoreDebts } from "./types";

const pageSize = 20;
// As the server: another store's customers are found by two letters at least.
const minSearch = 2;

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
 * finds its debts by a search and takes the payments; the debt stays that
 * store's, and the owner of the network may still write it off (owner
 * decisions, 2026-10-01, "store states").
 *
 * Each payment is paid one way, given by the button that takes it: the
 * till's «Готівка», «Картка» and «Переказ» (owner decision, 2026-10-04;
 * ADR-0012 §B12, G23).
 */
export function Credits({
  store,
  token,
  journalKey,
  blocked,
  readOnly = false,
  networkOwner = false,
}: {
  store: Store;
  token: string;
  journalKey: string;
  blocked: boolean;
  /** This store does not trade: its debts are read, and paid elsewhere. */
  readOnly?: boolean;
  /** The owner of the network, who writes off a debt of a store that does not trade. */
  networkOwner?: boolean;
}): JSX.Element {
  const cache = useQueryClient();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [owedOnly, setOwedOnly] = useState(true);
  const [shown, setShown] = useState(pageSize);
  const [selected, setSelected] = useState<Credit | null>(null);
  // Whose debts: this store's, or those of the stores that do not trade.
  const [elsewhere, setElsewhere] = useState(false);
  // Other stores' customers are found, never browsed.
  const searched = !elsewhere || search.length >= minSearch;
  const customers = useQuery({
    queryKey: [
      "credits",
      store.id,
      "customers",
      elsewhere,
      search,
      owedOnly,
      shown,
    ],
    queryFn: () =>
      api<CustomerPage>(
        `/credits/customers?store_id=${store.id}&limit=${String(shown)}${
          owedOnly ? "&status=OPEN" : ""
        }${search ? `&query=${encodeURIComponent(search)}` : ""}${
          elsewhere ? "&elsewhere=true" : ""
        }`,
        token,
      ),
    enabled: searched,
    retry: false,
  });
  const summary = useQuery({
    queryKey: ["credits", store.id, "summary"],
    queryFn: () =>
      api<StoreDebts>(`/credits/summary?store_id=${store.id}`, token),
    retry: false,
  });

  if (selected)
    return (
      <Debt
        store={store}
        token={token}
        journalKey={journalKey}
        blocked={blocked}
        readOnly={readOnly}
        networkOwner={networkOwner}
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

  return (
    <section>
      <div className="toolbar">
        <h2>Борги</h2>
        <button
          className="quiet"
          disabled={customers.isFetching}
          onClick={() => {
            void customers.refetch();
            void summary.refetch();
          }}
        >
          Оновити
        </button>
      </div>
      <p className="hint">
        {readOnly
          ? "Магазин не торгує: його борги тут лише для перегляду. Внески приймає будь-який магазин мережі, що працює."
          : "Покупці, які забрали товар і доплачують частинами. Внески приймає магазин, де продали, а поки він заблокований чи закритий — будь-який магазин мережі, що працює."}
      </p>
      {!readOnly && (
        <label>
          Де брали в борг
          <select
            value={elsewhere ? "ELSEWHERE" : "HERE"}
            onChange={(event) => {
              setElsewhere(event.target.value === "ELSEWHERE");
              setShown(pageSize);
            }}
          >
            <option value="HERE">У цьому магазині</option>
            <option value="ELSEWHERE">
              У магазині, що заблокований чи закритий
            </option>
          </select>
        </label>
      )}
      {!elsewhere && summary.data && (
        <div className="section-block" aria-label="Скільки винні магазину">
          <p className="total">
            Магазину винні <strong>{money(summary.data.owed)}</strong>
          </p>
          <p className="hint">
            Покупців: {summary.data.customers} · відкритих боргів:{" "}
            {summary.data.debts}
          </p>
        </div>
      )}
      <form
        className="search"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(query.trim());
          setShown(pageSize);
        }}
      >
        <label>
          Пошук за ім’ям або телефоном
          <input
            type="search"
            value={query}
            maxLength={200}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </label>
        <button type="submit">Знайти</button>
      </form>
      <label>
        Показати
        <select
          value={owedOnly ? "OPEN" : "ALL"}
          onChange={(event) => {
            setOwedOnly(event.target.value === "OPEN");
            setShown(pageSize);
          }}
        >
          <option value="OPEN">Ті, хто ще винен</option>
          <option value="ALL">Усі, разом зі сплаченими й списаними</option>
        </select>
      </label>
      {!searched ? (
        <p>
          Знайдіть покупця за ім’ям або телефоном — щонайменше дві літери чи
          цифри.
        </p>
      ) : customers.isPending ? (
        <p role="status">Завантажуємо борги…</p>
      ) : customers.error ? (
        <p role="alert">{errorText(customers.error)}</p>
      ) : customers.data.items.length === 0 ? (
        <p>
          {elsewhere
            ? "Боргів магазинів, що не працюють, за таким ім’ям чи телефоном не знайдено."
            : search
              ? "Боргів за таким ім’ям чи телефоном не знайдено."
              : owedOnly
                ? "Зараз ніхто не винен цьому магазину."
                : "У цьому магазині ще не продавали частинами."}
        </p>
      ) : (
        <>
          {customers.data.items.map((customer) => (
            <article className="order-card" key={customer.phone_digits}>
              <strong>{customer.customer_name}</strong>
              <span>{customer.customer_phone}</span>
              <p>
                {customer.open_debts > 0 ? (
                  <>
                    Винні всього <strong>{money(customer.owed)}</strong>
                    {customer.open_debts > 1 &&
                      ` · боргів: ${String(customer.open_debts)}`}
                  </>
                ) : (
                  <span className="badge">Нічого не винні</span>
                )}
              </p>
              <ul aria-label={`Борги: ${customer.customer_name}`}>
                {customer.credits.map((credit) => (
                  <li key={credit.id}>
                    <p>
                      {credit.status === "OPEN"
                        ? `Винні ${money(credit.owed)} з ${money(credit.amount)}`
                        : statusLabels[credit.status]}
                    </p>
                    {credit.store_id !== store.id && (
                      <p className="hint">
                        Продано в магазині «{credit.store_name}»
                      </p>
                    )}
                    <p className="hint">
                      {credit.goods.join(", ")} · продано{" "}
                      {when(credit.opened_at)}
                      {credit.last_payment_at &&
                        ` · останній внесок ${when(credit.last_payment_at)}`}
                    </p>
                    <button
                      className="quiet"
                      onClick={() => {
                        setSelected(credit);
                      }}
                    >
                      Відкрити борг {customer.customer_name} від{" "}
                      {when(credit.opened_at)}
                    </button>
                  </li>
                ))}
              </ul>
            </article>
          ))}
          {customers.data.has_more && (
            <button
              className="quiet"
              disabled={customers.isFetching}
              onClick={() => {
                setShown(shown + pageSize);
              }}
            >
              Показати ще
            </button>
          )}
        </>
      )}
    </section>
  );
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
 * after a payment, «(повернено 1000,00 грн на картку)» after a return that
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
  // Another store's debt, paid here because that one does not trade.
  const elsewhere = credit.store_id !== store.id;
  // The owner writes off; for a store that does not trade, the network's.
  const mayWriteOff =
    credit.store_state === "ACTIVE"
      ? !readOnly && store.permissions.includes("credit:write_off")
      : networkOwner;
  const owed = kopecks(credit.owed) ?? 0n;
  const working = busy || pending !== null;

  async function send(
    body:
      | {
          kind: "payment";
          amount: string;
          payment_method: TillMethod;
          elsewhere?: boolean;
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
          : outcome.result.status === "SETTLED"
            ? `Внесок ${money(body.amount)} прийнято ${methodHow[body.payment_method]}. Борг сплачено повністю.`
            : `Внесок ${money(body.amount)} прийнято ${methodHow[body.payment_method]}. Залишок боргу ${money(outcome.result.owed)}.`,
      );
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

  function pay(way: TillMethod): void {
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
    void send({
      kind: "payment",
      amount: decimal(cents),
      payment_method: way,
      ...(elsewhere ? { elsewhere: true } : {}),
    });
  }

  return (
    <section>
      <div className="toolbar">
        <h2>Борг</h2>
        <button className="quiet" disabled={working} onClick={back}>
          До списку боргів
        </button>
      </div>
      <h3>{credit.customer_name}</h3>
      <p>
        <a href={`tel:${credit.customer_phone.replace(/[^\d+]/g, "")}`}>
          {credit.customer_phone}
        </a>
      </p>
      <p className="hint">
        {credit.goods.join(", ")} · продано {when(credit.opened_at)}
      </p>
      {elsewhere && (
        <p className="notice">
          Продано в магазині «{credit.store_name}», який зараз{" "}
          {credit.store_state === "ARCHIVED" ? "закрито" : "заблоковано"}.
          Внесок приймає цей магазин; борг лишається за «{credit.store_name}».
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
                onClick={() => {
                  pay(way);
                }}
              >
                {methodLabels[way]}
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
                  onChange={(event) => {
                    setReason(event.target.value);
                  }}
                />
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
      <h3>Історія</h3>
      <ul aria-label="Історія боргу">
        {credit.entries.map((entry, index) => (
          <li key={`${entry.at}:${String(index)}`}>
            {when(entry.at)} · {entryLabels[entry.kind]} {money(entry.amount)}
            {entryWay(entry)} · {entry.by}
            {entry.taken_at && ` · прийняв магазин «${entry.taken_at}»`}
            {entry.note && ` · ${entry.note}`}
          </li>
        ))}
      </ul>
    </section>
  );
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
      case "SEARCH_REQUIRED":
        return "Знайдіть покупця за ім’ям або телефоном — щонайменше дві літери чи цифри.";
    }
  }
  return errorText(error);
}
