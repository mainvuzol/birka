import { useState } from "react";
import type { JSX } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, errorText } from "@/shared/api";
import { decimal, kopecks, money } from "@/orders/types";
import type { Store } from "@/orders/types";
import { asInput } from "@/prices/SuggestedPrice";
import { submitCreditCommand, useCreditCommand } from "./commands";
import { statusLabels } from "./types";
import type { Credit, CreditEntry, CustomerPage, StoreDebts } from "./types";

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
 */
export function Credits({
  store,
  token,
  journalKey,
  blocked,
}: {
  store: Store;
  token: string;
  journalKey: string;
  blocked: boolean;
}): JSX.Element {
  const cache = useQueryClient();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [owedOnly, setOwedOnly] = useState(true);
  const [shown, setShown] = useState(pageSize);
  const [selected, setSelected] = useState<Credit | null>(null);
  const customers = useQuery({
    queryKey: ["credits", store.id, "customers", search, owedOnly, shown],
    queryFn: () =>
      api<CustomerPage>(
        `/credits/customers?store_id=${store.id}&limit=${String(shown)}${
          owedOnly ? "&status=OPEN" : ""
        }${search ? `&query=${encodeURIComponent(search)}` : ""}`,
        token,
      ),
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
        Покупці, які забрали товар і доплачують частинами. Внески приймає лише
        магазин, де продали.
      </p>
      {summary.data && (
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
      {customers.isPending ? (
        <p role="status">Завантажуємо борги…</p>
      ) : customers.error ? (
        <p role="alert">{errorText(customers.error)}</p>
      ) : customers.data.items.length === 0 ? (
        <p>
          {search
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

function Debt({
  store,
  token,
  journalKey,
  blocked,
  credit,
  changed,
  back,
}: {
  store: Store;
  token: string;
  journalKey: string;
  blocked: boolean;
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
  const mayWriteOff = store.permissions.includes("credit:write_off");
  const owed = kopecks(credit.owed) ?? 0n;
  const working = busy || pending !== null;

  async function send(
    body:
      | { kind: "payment"; amount: string }
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
            ? `Внесок ${money(body.amount)} прийнято. Борг сплачено повністю.`
            : `Внесок ${money(body.amount)} прийнято. Залишок боргу ${money(outcome.result.owed)}.`,
      );
      changed(outcome.result);
    } else if (outcome.kind === "refused") {
      setCommandId(crypto.randomUUID());
      setAsking(false);
      setProblem(refusalText(outcome.error));
      // Refused because the debt moved on — another payment, a return: show
      // it as it is now.
      try {
        changed(await api<Credit>(`/credits/${credit.id}`, token));
      } catch {
        // What was shown stays; the refusal says what to do.
      }
    }
  }

  function pay(): void {
    const cents = kopecks(amount);
    if (cents === null || cents <= 0n) {
      setProblem("Вкажіть суму внеску з точністю до копійок.");
      return;
    }
    if (cents > owed) {
      setProblem(
        `Це більше, ніж винні: залишок боргу ${money(credit.owed)}. Прийміть не більше.`,
      );
      return;
    }
    void send({ kind: "payment", amount: decimal(cents) });
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
                `, з них готівкою ${money(credit.cash_back)}`}
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
      {credit.status === "OPEN" && (
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
            <button type="button" onClick={pay}>
              Прийняти внесок
            </button>
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
            {entry.kind === "RETURN" &&
              (kopecks(entry.cash_back) ?? 0n) > 0n &&
              ` (готівкою повернено ${money(entry.cash_back)})`}{" "}
            · {entry.by}
            {entry.note && ` · ${entry.note}`}
          </li>
        ))}
      </ul>
    </section>
  );
}

function refusalText(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.details.reason) {
      case "MORE_THAN_OWED":
        return `Це більше, ніж винні: залишок боргу ${money(String(error.details.owed))}.`;
      case "NOT_OWED":
        return "За цим продажем уже нічого не винні.";
      case "NOTHING_PAID":
        return "Внесок має бути більшим за нуль.";
      case "NO_REASON":
        return "Вкажіть, чому списуємо борг.";
    }
  }
  return errorText(error);
}
