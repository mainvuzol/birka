import { useEffect, useId, useState } from "react";
import type { JSX } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, errorText } from "@/shared/api";
import { NoCustomerData } from "@/shared/NoCustomerData";
import { visible } from "@/shared/visible";
import { decimal, kopecks, money } from "@/orders/types";
import type { Store } from "@/orders/types";
import { isTillMethod, refundHow, tillMethods } from "@/shared/payment";
import type { TillMethod } from "@/shared/payment";
import {
  PaperFields,
  paperRefusal,
  paperText,
  usePaperMark,
} from "@/sales/paperMark";
import { submitReturn, useReturnCommand } from "./commands";
import { useBackOnSale } from "./places";
import { refundLabels, sizeLabel } from "./types";
import type {
  Refund,
  ReturnPart,
  SaleList,
  SaleMethod,
  SaleSummary,
} from "./types";

const pageSize = 20;

/**
 * A return at the till (owner decision, 2026-10-01).
 *
 * The seller finds the sale in the store's list, searchable by name, and says
 * how many of each line came back intact and how many damaged. Intact goes
 * back to the warehouse it was sold from; damaged to the store's «Брак»,
 * where nothing sells. The money is what was paid, worked out by the server.
 *
 * Goods bought at another store of the network come back here too (owner
 * decisions, 2026-10-01): the seller finds that sale by a search among the
 * other stores', this store hands the money back, and damaged goods stay in
 * this store's «Брак». Intact goods sold from a warehouse this store does
 * not reach go to one of its own, which the seller chooses.
 *
 * The money goes back the way the sale was paid, unless the seller changes
 * it — a card sale returned in cash (owner decision, 2026-10-04; ADR-0012
 * §B12). Money returned to a card does not leave the drawer.
 */
export function Returns({
  store,
  token,
  journalKey,
  blocked,
  open = null,
  opened,
}: {
  store: Store;
  token: string;
  journalKey: string;
  blocked: boolean;
  /**
   * A sale to open at once, from its receipt (redesign P1-2): the store's
   * newest, so it is on the first page; if it is not, the list shows.
   */
  open?: string | null;
  /** Called once the sale asked for was looked for. */
  opened?: () => void;
}): JSX.Element {
  const cache = useQueryClient();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(pageSize);
  // Bought at another store of the network: found only by a search.
  const [elsewhere, setElsewhere] = useState(false);
  const [selected, setSelected] = useState<SaleSummary | null>(null);
  const [done, setDone] = useState<{
    refund: Refund;
    sent: ReturnPart[];
  } | null>(null);
  const searching = !elsewhere || search.length >= 2;
  const sales = useQuery({
    queryKey: ["store-sales", store.id, elsewhere, search, shown],
    queryFn: () =>
      api<SaleList>(
        `/sales?store_id=${store.id}&limit=${String(shown)}${
          elsewhere ? "&elsewhere=true" : ""
        }${search ? `&q=${encodeURIComponent(search)}` : ""}`,
        token,
      ),
    enabled: searching,
    retry: false,
  });

  useEffect(() => {
    if (open === null) return;
    // The list could not be read: the list's own failure shows, and the
    // sale is not opened later, for another customer (review, 2026-10-15).
    if (sales.isError) {
      opened?.();
      return;
    }
    // Read afresh, never from a page cached before the sale was made.
    if (!sales.isSuccess || sales.isFetching) return;
    const sale = sales.data.sales.find((each) => each.id === open);
    if (sale) setSelected(sale);
    opened?.();
  }, [
    open,
    sales.isError,
    sales.isSuccess,
    sales.isFetching,
    sales.data,
    opened,
  ]);

  async function settled(refund: Refund, sent: ReturnPart[]): Promise<void> {
    setDone({ refund, sent });
    setSelected(null);
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["store-sales", store.id] }),
      cache.invalidateQueries({ queryKey: ["inventory-stock"] }),
      cache.invalidateQueries({ queryKey: ["credits", store.id] }),
      cache.invalidateQueries({ queryKey: ["damaged-units", store.id] }),
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
        settled={(refund, sent) => {
          void settled(refund, sent);
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
      {done && (
        <Done
          store={store}
          token={token}
          refund={done.refund}
          sent={done.sent}
        />
      )}
      <label>
        Де купили
        <select
          value={elsewhere ? "ELSEWHERE" : "HERE"}
          onChange={(event) => {
            setElsewhere(event.target.value === "ELSEWHERE");
            setShown(pageSize);
          }}
        >
          <option value="HERE">У цьому магазині</option>
          <option value="ELSEWHERE">В іншому магазині мережі</option>
        </select>
      </label>
      {elsewhere && (
        <p className="hint">
          Повернення приймає будь-який магазин мережі, і гроші покупцю віддаєте
          ви. Продаж іншого магазину знаходять за назвою товару.
        </p>
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
      {!searching ? (
        <p>Введіть назву товару, щоб знайти продаж іншого магазину.</p>
      ) : sales.isPending ? (
        <p role="status">Завантажуємо продажі…</p>
      ) : sales.error ? (
        <p role="alert">{errorText(sales.error)}</p>
      ) : sales.data.sales.length === 0 ? (
        <p>
          {elsewhere
            ? "В інших магазинах продажів із таким товаром не знайдено."
            : search
              ? "Продажів із таким товаром не знайдено."
              : "У цьому магазині ще немає продажів."}
        </p>
      ) : (
        <>
          {sales.data.sales.map((sale) => (
            <SaleCard
              key={sale.id}
              sale={sale}
              here={sale.store_id === store.id}
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

/**
 * A sale typed from paper (ADR-0013 §5.6): the list carries its mark, never
 * its sum or way, so the drawer's blind count is untouched.
 */
function soldDuringOutage(sale: SaleSummary): boolean {
  return sale.outage !== undefined && sale.outage !== null;
}

function SaleCard({
  sale,
  here,
  choose,
  blocked,
}: {
  sale: SaleSummary;
  here: boolean;
  choose: () => void;
  blocked: boolean;
}): JSX.Element {
  const returnable = sale.items.some((item) => item.refunded < item.quantity);
  return (
    <article className="order-card">
      <strong>
        {when(sale.sold_at)} · {money(sale.total)}
      </strong>
      {!here && <span>Продано в магазині «{visible(sale.store_name)}»</span>}
      {sale.paid_in_parts && <span className="badge">Оплата частинами</span>}
      {soldDuringOutage(sale) && (
        <span className="badge">
          {sale.outage?.first_days === true
            ? "Продано з паперу"
            : "Продано під час збою"}
        </span>
      )}
      <ul>
        {sale.items.map((item) => (
          <li key={item.id}>
            {visible(item.display_name)}, {sizeLabel(item.size)} —{" "}
            {item.quantity} шт
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

/**
 * What the seller does with the money, by the way it goes back (ADR-0012
 * §B12, G39). An answer recorded before the way was asked names none.
 */
function handBack(amount: string, way: TillMethod | null | undefined): string {
  switch (way) {
    case "CASH":
      return `Поверніть покупцю ${money(amount)} готівкою.`;
    case "CARD":
      return `Поверніть ${money(amount)} на картку покупця через термінал.`;
    case "TRANSFER":
      return `Надішліть покупцю ${money(amount)} переказом.`;
    default:
      return `Поверніть покупцю ${money(amount)}.`;
  }
}

/**
 * A kept return confirmed — maybe by the phone itself, hours after the
 * press. Following the paper text, the money may have been given back
 * meanwhile, so it says to give it back only if nobody did, as a card does
 * at the till (owner decision, 2026-10-08).
 */
function handBackOnce(
  amount: string,
  way: TillMethod | null | undefined,
): string {
  const step = handBack(amount, way).replace(/\.$/, "");
  return `Якщо гроші ще не повернули — ${step.charAt(0).toLowerCase()}${step.slice(1)}. Якщо вже повернули, поки сервер не відповідав, — не повертайте вдруге.`;
}

/**
 * A return typed from paper: the money went back while the server did not
 * answer, the way the seller pressed (ADR-0021); or, from the first days'
 * paper, before the app took returns (owner decision, 2026-10-16).
 */
function handedBack(
  amount: string,
  way: TillMethod | null | undefined,
  firstDays: boolean,
): string {
  const how = way ? ` ${refundHow[way]}` : "";
  return `${money(amount)}${how} повернули ${firstDays ? "раніше" : "під час збою"} — вдруге не повертайте.`;
}

export function Done({
  store,
  token,
  refund,
  sent,
  kept = false,
}: {
  store: Store;
  token: string;
  refund: Refund;
  /**
   * The lines as sent: the form's, or a kept attempt's, read back from the
   * phone after a reopen. A line naming a warehouse is one whose intact goods
   * go to a warehouse of this store the seller chose.
   */
  sent: readonly ReturnPart[];
  /** A kept attempt confirmed, never a return answered at once. */
  kept?: boolean;
}): JSX.Element {
  // Typed from paper: the money went back during the outage (owner
  // decision, 2026-10-10; ADR-0021), so it is never said to hand it back.
  const back = refund.outage
    ? (amount: string, way: TillMethod | null | undefined) =>
        handedBack(amount, way, refund.outage?.first_days === true)
    : kept
      ? handBackOnce
      : handBack;
  const damaged = refund.items.some((item) => item.condition === "DAMAGED");
  const intact = refund.items.some((item) => item.condition === "INTACT");
  // Intact goods the seller sent to a warehouse of this store (owner
  // decision, 2026-10-01): named where the server says they went, from this
  // store's warehouses as the form offered them — read again when the form
  // is gone. A name not found there is left out, never said to be the
  // warehouse they were sold from.
  const chose = new Set(
    sent.flatMap((part) =>
      part.location_id === undefined ? [] : [part.sale_item_id],
    ),
  );
  const placed = new Set(
    refund.items.flatMap((item) =>
      item.condition === "INTACT" &&
      chose.has(item.sale_item_id) &&
      item.destination_location_id !== null
        ? [item.destination_location_id]
        : [],
    ),
  );
  const ownPlaces = useBackOnSale(store, token, placed.size > 0);
  const named = (ownPlaces.data ?? []).filter((location) =>
    placed.has(location.id),
  );
  const chosen =
    named.length === placed.size
      ? named.map((location) => visible(location.name)).join("», «")
      : undefined;
  const { credit } = refund;
  const elsewhere =
    !!refund.taken_at_store_id && refund.taken_at_store_id !== refund.store_id;
  return (
    <div className="section-block" role="status">
      <h3>Повернення оформлено</h3>
      {refund.outage && (
        <p className="badge">{paperText("return", refund.outage)}</p>
      )}
      {elsewhere && (
        <p>
          {refund.outage
            ? "Товар куплено в іншому магазині мережі — гроші віддавав ваш магазин."
            : "Товар куплено в іншому магазині мережі — гроші віддаєте ви."}
        </p>
      )}
      {credit ? (
        <>
          {(kopecks(credit.debt_reduced) ?? 0n) > 0n && (
            <p>Борг покупця зменшено на {money(credit.debt_reduced)}.</p>
          )}
          <p>
            {(kopecks(credit.cash_back) ?? 0n) > 0n
              ? back(credit.cash_back, refund.payment_method)
              : "Грошей покупцю не повертаємо."}
          </p>
          <p>
            {(kopecks(credit.owed_after) ?? 0n) > 0n
              ? `Покупець ще винен ${money(credit.owed_after)}.`
              : "Покупець більше нічого не винен."}
          </p>
        </>
      ) : (
        <p>{back(refund.total_amount, refund.payment_method)}</p>
      )}
      {intact &&
        (placed.size === 0 ? (
          <p>Цілий товар повернуто на склад, з якого його продали.</p>
        ) : chosen ? (
          <p>Цілий товар повернуто на склад «{chosen}» вашого магазину.</p>
        ) : (
          <p>Цілий товар повернуто на склад вашого магазину.</p>
        ))}
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
  settled: (refund: Refund, sent: ReturnPart[]) => void;
  back: () => void;
}): JSX.Element {
  const hint = useId();
  const { busy, pending } = useReturnCommand();
  // Paper mode: the till's switch (`@/sales/paper`); the paper's time is
  // this return's own.
  const mark = usePaperMark(store, token, journalKey, "refund");
  const [commandId, setCommandId] = useState(() => crypto.randomUUID());
  const [counts, setCounts] = useState<Counts>({});
  // Per sale line: the warehouse of this store intact goods go to, when the
  // one they were sold from is another store's own.
  const [places, setPlaces] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [refusal, setRefusal] = useState<unknown>(null);
  // How the money goes back: the seller's choice, else the one the sale
  // suggests (owner decision, 2026-10-04; ADR-0012 G4, G5). Only this one
  // sale's way is asked for, never a list's (G32).
  const [chosenWay, setChosenWay] = useState<TillMethod | null>(null);
  const paid = useQuery({
    queryKey: ["sale-method", store.id, sale.id],
    queryFn: () =>
      api<SaleMethod>(
        `/cash/sales/${sale.id}/method?store_id=${store.id}`,
        token,
      ),
    retry: false,
  });
  const suggested = paid.data?.refund_method;
  const way = chosenWay ?? (isTillMethod(suggested) ? suggested : null);
  const lines = sale.items.filter((item) => item.refunded < item.quantity);
  const elsewhere = sale.store_id !== store.id;
  const choosing = lines.some((item) => !item.back_to_sold_from);
  const ownPlaces = useBackOnSale(store, token, choosing);

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
    const place = places[item.id];
    if (intact > 0 && !item.back_to_sold_from && !place) {
      problems.push(
        `${item.display_name}: оберіть склад вашого магазину для цілого товару.`,
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
          ...(condition === "INTACT" && !item.back_to_sold_from && place
            ? { location_id: place }
            : {}),
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
    // From paper, nothing is sent until the series says which paper it is
    // (owner decision, 2026-10-16): the button waits, and so does this.
    if (!mark.ready) return;
    setRefusal(null);
    const trimmed = reason.trim();
    const outage = mark.body();
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
        ...(elsewhere ? { elsewhere: true } : {}),
        // A sale in parts may go without: the server asks for the way only
        // when money goes back (ADR-0012 G35).
        ...(way ? { payment_method: way } : {}),
        ...(outage ? { outage } : {}),
      },
    });
    if (outcome.kind === "done") {
      setCommandId(crypto.randomUUID());
      mark.forgetTime();
      settled(outcome.result, parts);
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
        Продаж {when(sale.sold_at)} на {money(sale.total)}
        {elsewhere && ` у магазині «${visible(sale.store_name)}»`}.
      </p>
      {elsewhere && (
        <p className="hint">
          Товар куплено в іншому магазині мережі: гроші покупцю віддаєте ви,
          пошкоджений товар лишається у вашому «Браку».
        </p>
      )}
      {sale.paid_in_parts && (
        <p className="hint">
          Цей продаж оплачували частинами. Повернений товар спершу зменшує борг
          покупця; гроші повертаємо лише те, що сплачено понад вартість товару,
          який лишається в покупця. Скільки саме — покаже підсумок.
        </p>
      )}
      <fieldset disabled={blocked || working}>
        <legend>Що повертають</legend>
        <PaperFields mark={mark} what="return" storeId={store.id} />
        {lines.map((item) => {
          const left = item.quantity - item.refunded;
          const entered = counts[item.id] ?? { intact: "", damaged: "" };
          return (
            <div className="line-return" key={item.id}>
              <h3>
                {visible(item.display_name)}, {sizeLabel(item.size)}
              </h3>
              <p className="hint">
                {money(item.final_unit_price)} за 1 шт. · продано{" "}
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
              {!item.back_to_sold_from && (
                <label>
                  Цілий товар — на склад вашого магазину
                  <select
                    value={places[item.id] ?? ""}
                    onChange={(event) => {
                      setPlaces({ ...places, [item.id]: event.target.value });
                    }}
                  >
                    <option value="">Оберіть склад</option>
                    {(ownPlaces.data ?? []).map((location) => (
                      <option key={location.id} value={location.id}>
                        {visible(location.name)}
                      </option>
                    ))}
                  </select>
                  <span className="hint">
                    Його продали з власного складу іншого магазину, куди ваш
                    магазин не має доступу.
                  </span>
                </label>
              )}
            </div>
          );
        })}
        <label>
          Причина повернення (необов’язково)
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
        <fieldset>
          <legend>
            {mark.paper
              ? sale.paid_in_parts
                ? mark.firstDays === false
                  ? "Як повертали гроші під час збою (якщо повертали)"
                  : "Як повертали гроші (якщо повертали)"
                : mark.firstDays === false
                  ? "Як повернули гроші під час збою"
                  : "Як повернули гроші"
              : sale.paid_in_parts
                ? "Як повертаємо гроші (якщо буде що повертати)"
                : "Як повертаємо гроші"}
          </legend>
          {tillMethods.map((option) => (
            <label className="check" key={option}>
              <input
                type="radio"
                name="refund-method"
                checked={way === option}
                onChange={() => {
                  setChosenWay(option);
                }}
              />
              {refundLabels[option]}
            </label>
          ))}
        </fieldset>
        {ownPlaces.error && <p role="alert">{errorText(ownPlaces.error)}</p>}
        {problems.map((problem) => (
          <p key={problem} role="alert">
            {visible(problem)}
          </p>
        ))}
        <button
          type="button"
          disabled={
            !ready || !mark.ready || (!sale.paid_in_parts && way === null)
          }
          onClick={() => {
            void send();
          }}
        >
          {!ready
            ? "Вкажіть, що повертають"
            : !mark.ready
              ? "Оберіть, що вносите з паперу"
              : `${mark.paper ? "З паперу · " : ""}${
                  sale.paid_in_parts
                    ? `Оформити повернення на ${money(decimal(total))}`
                    : way === null
                      ? "Оберіть, як повертаєте гроші"
                      : `Повернути покупцю ${money(decimal(total))} ${refundHow[way]}`
                }`}
        </button>
        {mark.paper && (
          <p className="hint">
            {mark.firstDays === null
              ? "Оберіть угорі, що вносите з паперу."
              : mark.firstDays
                ? "Гроші, які вже віддали, вдруге не віддавайте: оберіть, як їх віддавали, і натисніть."
                : "Гроші, які віддали під час збою, вдруге не віддавайте: оберіть, як їх віддавали, і натисніть."}
            {` Хто прийняв: ${mark.named ? visible(mark.named.display_name) : "не вказано"}.`}
          </p>
        )}
      </fieldset>
      {refusal !== null && (
        <p role="alert">
          {refusalText(refusal)}{" "}
          {mark.paper ? "Нічого не записано." : "Нічого не повернено."}
        </p>
      )}
    </section>
  );
}

/**
 * Why a return was refused. A kept return refused on resend says the same
 * (`@/cash/errors`, ADR-0013 §8).
 */
export function refusalText(error: unknown): string {
  if (error instanceof ApiError) {
    // Typed from paper, refused for its mark (ADR-0021).
    const paper = paperRefusal(error.details.reason, error.details.days);
    if (paper !== null) return paper;
    if (error.code === "DAMAGED_RETURNS_UNAVAILABLE")
      return error.details.reason === "SOLD_FROM"
        ? "Склад «Брак» цього магазину налаштований як склад для продажу, тож пошкоджений товар туди не приймається. Зверніться до власника."
        : "У цього магазину ще немає складу «Брак» для пошкодженого товару. Зверніться до власника.";
    if (error.code === "REFUND_EXCEEDS_SOLD")
      return "Частину цього товару вже повернули. Поверніться до списку й оновіть продаж.";
    if (
      error.details.reason === "CHOOSE_A_WAREHOUSE" ||
      error.details.reason === "NOT_A_WAREHOUSE_OF_THIS_STORE"
    )
      return "Цілий товар цього продажу йде на склад вашого магазину — оберіть його ще раз.";
    if (error.details.reason === "SEARCH_REQUIRED")
      return "Продаж іншого магазину знаходять за назвою товару.";
    // Only a sale paid in parts is sent without a way, and the server asks
    // for one once it has worked out that money goes back (ADR-0012 G35).
    if (error.details.reason === "PAYMENT_METHOD_REQUIRED")
      return "Покупцю повертаємо гроші — оберіть, як.";
  }
  return errorText(error);
}
