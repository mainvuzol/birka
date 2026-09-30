import { useState } from "react";
import type { JSX } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, errorText } from "@/shared/api";
import { decimal, kopecks, money } from "@/orders/types";
import type { Store } from "@/orders/types";
import { submitReturn, useReturnCommand } from "./commands";
import { sizeLabel } from "./types";
import type { Refund, ReturnPart, SaleList, SaleSummary } from "./types";

const pageSize = 20;

/**
 * A return at the till (owner decision, 2026-10-01).
 *
 * The seller finds the sale in the store's list, searchable by name, and says
 * how many of each line came back intact and how many damaged. Intact goes
 * back to the warehouse it was sold from; damaged to the store's «Брак»,
 * where nothing sells. The money is what was paid, worked out by the server.
 */
export function Returns({
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
  const [shown, setShown] = useState(pageSize);
  const [selected, setSelected] = useState<SaleSummary | null>(null);
  const [done, setDone] = useState<Refund | null>(null);
  const sales = useQuery({
    queryKey: ["store-sales", store.id, search, shown],
    queryFn: () =>
      api<SaleList>(
        `/sales?store_id=${store.id}&limit=${String(shown)}${
          search ? `&q=${encodeURIComponent(search)}` : ""
        }`,
        token,
      ),
    retry: false,
  });

  async function settled(refund: Refund): Promise<void> {
    setDone(refund);
    setSelected(null);
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["store-sales", store.id] }),
      cache.invalidateQueries({ queryKey: ["inventory-stock"] }),
    ]);
  }

  if (selected)
    return (
      <ReturnForm
        store={store}
        token={token}
        journalKey={journalKey}
        blocked={blocked}
        sale={selected}
        settled={(refund) => {
          void settled(refund);
        }}
        back={() => {
          setSelected(null);
        }}
      />
    );

  return (
    <section>
      <div className="toolbar">
        <h2>Повернення</h2>
        <button
          className="quiet"
          disabled={sales.isFetching}
          onClick={() => {
            void sales.refetch();
          }}
        >
          Оновити
        </button>
      </div>
      <p className="hint">
        Знайдіть продаж, з якого повертають товар. Цілий товар повернеться на
        склад, з якого його продали, пошкоджений — на склад «Брак» магазину.
      </p>
      {done && <Done refund={done} />}
      <form
        className="search"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(query.trim());
          setShown(pageSize);
        }}
      >
        <label>
          Пошук за назвою товару
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </label>
        <button type="submit">Знайти</button>
      </form>
      {sales.isPending ? (
        <p role="status">Завантажуємо продажі…</p>
      ) : sales.error ? (
        <p role="alert">{errorText(sales.error)}</p>
      ) : sales.data.sales.length === 0 ? (
        <p>
          {search
            ? "Продажів із таким товаром не знайдено."
            : "У цьому магазині ще немає продажів."}
        </p>
      ) : (
        <>
          {sales.data.sales.map((sale) => (
            <SaleCard
              key={sale.id}
              sale={sale}
              choose={() => {
                setDone(null);
                setSelected(sale);
              }}
              blocked={blocked}
            />
          ))}
          {sales.data.has_more && (
            <button
              className="quiet"
              disabled={sales.isFetching}
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

function SaleCard({
  sale,
  choose,
  blocked,
}: {
  sale: SaleSummary;
  choose: () => void;
  blocked: boolean;
}): JSX.Element {
  const returnable = sale.items.some((item) => item.refunded < item.quantity);
  return (
    <article className="order-card">
      <strong>
        {when(sale.sold_at)} · {money(sale.total)}
      </strong>
      <ul>
        {sale.items.map((item) => (
          <li key={item.id}>
            {item.display_name}, {sizeLabel(item.size)} — {item.quantity} шт
            {item.refunded > 0 && <small> (повернено {item.refunded})</small>}
          </li>
        ))}
      </ul>
      {returnable ? (
        <button disabled={blocked} onClick={choose}>
          Оформити повернення
        </button>
      ) : (
        <span className="badge">Усе вже повернено</span>
      )}
    </article>
  );
}

function Done({ refund }: { refund: Refund }): JSX.Element {
  const damaged = refund.items.some((item) => item.condition === "DAMAGED");
  const intact = refund.items.some((item) => item.condition === "INTACT");
  return (
    <div className="section-block" role="status">
      <h3>Повернення оформлено</h3>
      <p>Поверніть покупцю {money(refund.total_amount)}.</p>
      {intact && <p>Цілий товар повернуто на склад, з якого його продали.</p>}
      {damaged && (
        <p>
          Пошкоджений товар — на складі «Брак» магазину. Його можна перевірити в
          розділі «Брак».
        </p>
      )}
    </div>
  );
}

type Counts = Record<string, { intact: string; damaged: string }>;

function count(value: string): number | null {
  if (value.trim() === "") return 0;
  return /^\d{1,4}$/.test(value.trim()) ? Number(value.trim()) : null;
}

function ReturnForm({
  store,
  token,
  journalKey,
  blocked,
  sale,
  settled,
  back,
}: {
  store: Store;
  token: string;
  journalKey: string;
  blocked: boolean;
  sale: SaleSummary;
  settled: (refund: Refund) => void;
  back: () => void;
}): JSX.Element {
  const { busy, pending } = useReturnCommand();
  const [commandId, setCommandId] = useState(() => crypto.randomUUID());
  const [counts, setCounts] = useState<Counts>({});
  const [reason, setReason] = useState("");
  const [refusal, setRefusal] = useState<unknown>(null);
  const lines = sale.items.filter((item) => item.refunded < item.quantity);

  const problems: string[] = [];
  const parts: ReturnPart[] = [];
  let total = 0n;
  for (const item of lines) {
    const entered = counts[item.id] ?? { intact: "", damaged: "" };
    const intact = count(entered.intact);
    const damaged = count(entered.damaged);
    const left = item.quantity - item.refunded;
    if (intact === null || damaged === null) {
      problems.push(`${item.display_name}: вкажіть кількість цілим числом.`);
      continue;
    }
    if (intact + damaged > left) {
      problems.push(
        `${item.display_name}: можна повернути не більше ${String(left)}.`,
      );
      continue;
    }
    for (const [quantity, condition] of [
      [intact, "INTACT"],
      [damaged, "DAMAGED"],
    ] as const)
      if (quantity > 0) {
        parts.push({
          sale_item_id: item.id,
          quantity,
          restock: true,
          condition,
        });
        total += (kopecks(item.final_unit_price) ?? 0n) * BigInt(quantity);
      }
  }
  const working = busy || pending !== null;
  const ready = problems.length === 0 && parts.length > 0;

  function set(id: string, field: "intact" | "damaged", value: string): void {
    setCounts({
      ...counts,
      [id]: { ...(counts[id] ?? { intact: "", damaged: "" }), [field]: value },
    });
  }

  async function send(): Promise<void> {
    setRefusal(null);
    const trimmed = reason.trim();
    const outcome = await submitReturn(journalKey, token, {
      // A new transport key per attempt; the return's identity is
      // `command_id`, which is what makes a late retry safe.
      key: crypto.randomUUID(),
      body: {
        store_id: store.id,
        sale_id: sale.id,
        command_id: commandId,
        lines: parts,
        reason: trimmed ? trimmed : null,
      },
    });
    if (outcome.kind === "done") {
      setCommandId(crypto.randomUUID());
      settled(outcome.result);
    } else if (outcome.kind === "refused") {
      setRefusal(outcome.error);
      setCommandId(crypto.randomUUID());
    }
  }

  return (
    <section>
      <div className="toolbar">
        <h2>Повернення</h2>
        <button className="quiet" disabled={working} onClick={back}>
          До списку продажів
        </button>
      </div>
      <p>
        Продаж {when(sale.sold_at)} на {money(sale.total)}.
      </p>
      <fieldset disabled={blocked || working}>
        <legend>Що повертають</legend>
        {lines.map((item) => {
          const left = item.quantity - item.refunded;
          const entered = counts[item.id] ?? { intact: "", damaged: "" };
          return (
            <div className="line-return" key={item.id}>
              <h3>
                {item.display_name}, {sizeLabel(item.size)}
              </h3>
              <p className="hint">
                {money(item.final_unit_price)} за одиницю · продано{" "}
                {item.quantity}
                {item.refunded > 0 &&
                  `, уже повернено ${String(item.refunded)}`}{" "}
                · можна повернути {left}
              </p>
              <div className="fields">
                <label>
                  Цілих
                  <input
                    inputMode="numeric"
                    value={entered.intact}
                    placeholder="0"
                    onChange={(event) => {
                      set(item.id, "intact", event.target.value);
                    }}
                  />
                </label>
                <label>
                  Пошкоджених
                  <input
                    inputMode="numeric"
                    value={entered.damaged}
                    placeholder="0"
                    onChange={(event) => {
                      set(item.id, "damaged", event.target.value);
                    }}
                  />
                </label>
              </div>
            </div>
          );
        })}
        <label>
          Причина повернення (необов’язково)
          <textarea
            value={reason}
            maxLength={1000}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        </label>
        {problems.map((problem) => (
          <p key={problem} role="alert">
            {problem}
          </p>
        ))}
        <button
          type="button"
          disabled={!ready}
          onClick={() => {
            void send();
          }}
        >
          {ready
            ? `Повернути покупцю ${money(decimal(total))}`
            : "Вкажіть, що повертають"}
        </button>
      </fieldset>
      {refusal !== null && (
        <p role="alert">{refusalText(refusal)} Нічого не повернено.</p>
      )}
    </section>
  );
}

function refusalText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "DAMAGED_RETURNS_UNAVAILABLE")
      return error.details.reason === "SOLD_FROM"
        ? "Склад «Брак» цього магазину налаштований як склад для продажу, тож пошкоджений товар туди не приймається. Зверніться до власника."
        : "У цього магазину ще немає складу «Брак» для пошкодженого товару. Зверніться до власника.";
    if (error.code === "REFUND_EXCEEDS_SOLD")
      return "Частину цього товару вже повернули. Поверніться до списку й оновіть продаж.";
  }
  return errorText(error);
}
