import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, errorText } from "@/shared/api";
import type { ApiError } from "@/shared/api";
import { decimal, kopecks, money } from "@/orders/types";
import type { Location, StockOption, Store } from "@/orders/types";
import type { SizeOption } from "@/inventory/receiptTypes";
import { asInput } from "@/prices/SuggestedPrice";
import { sizeLabel } from "@/returns/types";
import { TermsFields, checkTerms, noTerms } from "@/credits/Terms";
import type { TermsInput } from "@/credits/Terms";
import { submitSale, useSaleCommand } from "./commands";
import type {
  EmptyShelf,
  SaleLine,
  Sale as SaleReceipt,
  Shortfall,
} from "./types";
import { stockKey } from "./types";

const pageSize = 100;

interface Draft {
  line: SaleLine;
  name: string;
  size: string;
  /** Sold as "size not known": there is no size to clarify, nothing to find. */
  unknownSize: boolean;
  /** Its size was read off a coat held with its size not known. */
  fromUnknown: boolean;
}

/**
 * The till.
 *
 * Two things make this screen different from reserving an order. It takes
 * money, so the command journal in `./commands` is what decides when a basket
 * may be sent again. And it must let the seller sell what they can *see*: a
 * shelf that disagrees with the ledger is the normal case this whole flow was
 * designed around, so a quantity above the recorded balance is offered to the
 * server rather than blocked here. The server refuses, names the shortfall,
 * and the seller answers it — «товар на місці» or «на місці лише стільько».
 *
 * A third answer exists where a legacy list left the same model here with its
 * size not known (ADR-0005 §11): the coat in hand is one of those, and its
 * label says M. The seller clarifies its size and it is sold as M, as an
 * audited pair of movements. «Товар на місці» is then not offered — the server
 * refuses it, because the coat could be counted twice. A coat held that way
 * whose size is on its label can also be sold with that size from the start,
 * which is how an M the system holds none of is sold at all.
 */
export function Sale({
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
  const [locationId, setLocationId] = useState("");
  const [offset, setOffset] = useState(0);
  const [option, setOption] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [price, setPrice] = useState("");
  const [draft, setDraft] = useState<Draft[]>([]);
  const [commandId, setCommandId] = useState(() => crypto.randomUUID());
  const [found, setFound] = useState<Record<number, number>>({});
  const [missing, setMissing] = useState<Record<number, number>>({});
  const [clarified, setClarified] = useState<Record<number, number>>({});
  // `location:variant` keys this till has learned hold the model with its
  // size not known — from the server refusing «товар на місці» because of it.
  const [heldUnknown, setHeldUnknown] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [labelSize, setLabelSize] = useState("");
  const [shortfall, setShortfall] = useState<Shortfall | null>(null);
  const [refusal, setRefusal] = useState<unknown>(null);
  const [present, setPresent] = useState("");
  const [receipt, setReceipt] = useState<SaleReceipt | null>(null);
  // Lines dropped from the receipt's sale because nothing was on the shelf.
  const [dropped, setDropped] = useState<string[]>([]);
  const [nothingSold, setNothingSold] = useState<EmptyShelf | null>(null);
  const [validation, setValidation] = useState("");
  // Paying in parts (owner decisions, 2026-10-01): the customer takes the
  // goods now, pays part and owes the rest to this store.
  const [credit, setCredit] = useState<TermsInput>(noTerms);
  const { busy, pending } = useSaleCommand();

  const mayCorrect = store.permissions.includes(
    "inventory:correct_during_sale",
  );
  const mayReportMissing = store.permissions.includes(
    "inventory:report_missing_during_sale",
  );
  // The organization's sizes come from the receiving endpoint, which asks
  // for `inventory:receive`; the default seller holds both.
  const mayReadLabel =
    mayCorrect && store.permissions.includes("inventory:receive");
  const mayCredit = store.permissions.includes("sale:credit");

  const locations = useQuery({
    queryKey: ["sale-locations", journalKey, store.id],
    queryFn: () =>
      api<Location[]>(`/stock-locations?store_id=${store.id}`, token),
    retry: false,
  });
  const stock = useQuery({
    queryKey: ["sale-stock", journalKey, store.id, locationId, offset],
    queryFn: () =>
      api<{ items: StockOption[]; has_more: boolean }>(
        `/catalog/stock-options?store_id=${store.id}&location_id=${locationId}&limit=${String(pageSize)}&offset=${String(offset)}`,
        token,
      ),
    enabled: !!locationId && !locations.isError,
    retry: false,
  });
  const selected = stock.data?.items.find(
    (item) => `${item.product_variant_id}:${item.size_id}` === option,
  );
  const sizes = useQuery({
    queryKey: ["sale-sizes", journalKey, store.id],
    queryFn: () =>
      api<SizeOption[]>(`/catalog/sizes?store_id=${store.id}`, token),
    enabled: mayReadLabel && !!selected?.size_is_unknown,
    retry: false,
  });

  // A basket that changed is a different business operation, and any answer
  // given about the old one no longer applies to it.
  function replaceDraft(next: Draft[]): void {
    setDraft(next);
    setCommandId(crypto.randomUUID());
    setFound({});
    setMissing({});
    setClarified({});
    setShortfall(null);
    setPresent("");
  }

  useEffect(() => {
    if (locationId && locations.isSuccess) {
      const reachable = locations.data.some(
        (location) => location.id === locationId,
      );
      if (!reachable) {
        setLocationId("");
        setOption("");
        setOffset(0);
      }
    }
  }, [locationId, locations.isSuccess, locations.data]);

  const sellable = (locations.data ?? []).filter(
    (location) => location.is_active && location.can_sell,
  );
  const onlyWarehouse = sellable.length === 1 ? sellable[0] : undefined;

  useEffect(() => {
    // Explicitly permitted: "the client may prefill it when the store reaches
    // only one warehouse, but the server never chooses" (sale API, owner
    // decision 2026-09-17). Two taps out of a measured eight, and the seller
    // is choosing nothing they had an alternative to.
    if (!locationId && onlyWarehouse) setLocationId(onlyWarehouse.id);
  }, [locationId, onlyWarehouse]);

  function add(): void {
    const cents = kopecks(price);
    const count = Number(quantity);
    if (
      !selected ||
      cents === null ||
      !/^\d+$/.test(quantity) ||
      count < 1 ||
      count > 1000
    ) {
      setValidation(
        "Оберіть товар, кількість від 1 до 1000 та ціну з точністю до копійок.",
      );
      return;
    }
    const label = selected.size_is_unknown
      ? sizes.data?.find((size) => size.size_id === labelSize)
      : undefined;
    const line: SaleLine = {
      product_variant_id: selected.product_variant_id,
      size_id: label ? label.size_id : selected.size_id,
      source_location_id: locationId,
      quantity: count,
      unit_price: decimal(cents),
      discount_amount: "0.00",
    };
    if (draft.some((d) => stockKey(d.line) === stockKey(line))) {
      setValidation(
        "Цей товар із цього складу вже в кошику. Видаліть рядок, щоб змінити кількість.",
      );
      return;
    }
    replaceDraft([
      ...draft,
      {
        line,
        name: selected.display_name,
        size: label
          ? label.code
          : selected.size_is_unknown
            ? "розмір невідомий"
            : selected.size_label,
        unknownSize: selected.size_is_unknown && !label,
        fromUnknown: label !== undefined,
      },
    ]);
    setPrice("");
    setQuantity("1");
    setOption("");
    setLabelSize("");
    setValidation("");
  }

  async function send(
    nextFound: Record<number, number>,
    nextMissing: Record<number, number>,
    nextClarified: Record<number, number>,
  ): Promise<void> {
    // Nothing on the shelf of a line drops it from the sale (owner decision,
    // 2026-10-01; Q-G). Nothing on the shelf of any line leaves no sale to
    // make, and the basket records an empty shelf instead.
    const empty = draft.filter((_, index) => nextMissing[index] === 0);
    const emptyShelf = draft.length > 0 && empty.length === draft.length;
    // What will be sold: a line answered «на місці лише N» sells N.
    const sold = draft.reduce(
      (sum, d, index) =>
        sum +
        (kopecks(d.line.unit_price) ?? 0n) *
          BigInt(nextMissing[index] ?? d.line.quantity),
      0n,
    );
    const terms =
      credit.inParts && !emptyShelf ? checkTerms(credit, sold) : null;
    if (typeof terms === "string") {
      setValidation(terms);
      return;
    }
    const asked = shortfall;
    setShortfall(null);
    setRefusal(null);
    setValidation("");
    const outcome = await submitSale(journalKey, token, {
      // A new key per payload: one key then always answers one payload, and a
      // replay of it is unambiguous. `command_id` is what keeps the corrected
      // attempt from selling twice.
      key: crypto.randomUUID(),
      emptyShelf,
      body: {
        store_id: store.id,
        command_id: commandId,
        lines: draft.map((d) => d.line),
        found_in_store: Object.entries(nextFound).map(([index, value]) => ({
          line_index: Number(index),
          quantity: value,
        })),
        missing_in_store: Object.entries(nextMissing).map(([index, value]) => ({
          line_index: Number(index),
          quantity: value,
        })),
        size_clarified: Object.entries(nextClarified).map(([index, value]) => ({
          line_index: Number(index),
          quantity: value,
        })),
        ...(terms ? { credit: terms } : {}),
      },
    });
    if (outcome.kind === "sold" || outcome.kind === "nothing-sold") {
      if (outcome.kind === "sold") {
        setReceipt(outcome.sale);
        setDropped(empty.map((d) => `${d.name} · ${d.size}`));
      } else {
        setNothingSold(outcome.shelf);
      }
      setDraft([]);
      setFound({});
      setMissing({});
      setClarified({});
      setCommandId(crypto.randomUUID());
      setPresent("");
      // The next customer is someone else.
      setCredit(noTerms);
      await stock.refetch();
    } else if (outcome.kind === "refused") {
      const { error, shortfall: short } = outcome;
      const { details } = error;
      if (
        error.code === "UNKNOWN_SIZE_STOCK" &&
        asked !== null &&
        details.product_variant_id === asked.product_variant_id &&
        details.location_id === asked.location_id
      ) {
        // «Товар на місці» was refused because this model is held here with
        // its size not known. Nothing was sold, the same shortfall stands,
        // and now the till knows which answer fits it.
        setHeldUnknown(
          (known) =>
            new Set([
              ...known,
              `${asked.location_id}:${asked.product_variant_id}`,
            ]),
        );
        const index = indexOf(asked);
        setFound(
          Object.fromEntries(
            Object.entries(nextFound).filter(([key]) => Number(key) !== index),
          ),
        );
        setShortfall(asked);
      } else if (short && details.reason === undefined) {
        setShortfall(short);
      } else {
        // A clarification refused for its own reason is withdrawn, so the
        // seller answers afresh rather than resending what cannot pass.
        setClarified({});
        setRefusal(error);
      }
      setPresent("");
    }
  }

  function indexOf(short: Shortfall): number {
    return draft.findIndex(
      (d) =>
        stockKey(d.line) ===
        stockKey({
          source_location_id: short.location_id,
          product_variant_id: short.product_variant_id,
          size_id: short.size_id,
        }),
    );
  }

  const total = draft.reduce(
    (sum, d) =>
      sum + (kopecks(d.line.unit_price) ?? 0n) * BigInt(d.line.quantity),
    0n,
  );
  const shortIndex = shortfall ? indexOf(shortfall) : -1;
  const shortDraft = shortIndex >= 0 ? draft[shortIndex] : undefined;
  // Whether the short line's model is held at its warehouse with its size not
  // known — and so whether the coat in hand may be one of those.
  const unknownHere =
    shortDraft !== undefined &&
    !shortDraft.unknownSize &&
    (shortDraft.fromUnknown ||
      heldUnknown.has(
        `${shortDraft.line.source_location_id}:${shortDraft.line.product_variant_id}`,
      ) ||
      (shortDraft.line.source_location_id === locationId &&
        (stock.data?.items ?? []).some(
          (item) =>
            item.product_variant_id === shortDraft.line.product_variant_id &&
            item.size_is_unknown &&
            item.available_quantity > 0,
        )));
  const working = busy || pending !== null;

  if (nothingSold)
    return (
      <NothingSold
        shelf={nothingSold}
        next={() => {
          setNothingSold(null);
        }}
      />
    );

  if (receipt)
    return (
      <Receipt
        receipt={receipt}
        dropped={dropped}
        next={() => {
          setReceipt(null);
          setDropped([]);
        }}
      />
    );

  return (
    <section>
      <h2>Продаж</h2>
      <p className="hint">
        Оберіть склад, з якого фізично віддаєте товар. Ціна — остаточна після
        торгу.
      </p>
      <fieldset disabled={blocked || working}>
        <legend>Кошик</legend>
        {locations.isPending ? (
          <p role="status">Завантажуємо склади…</p>
        ) : locations.error ? (
          <Failure
            error={locations.error}
            retry={() => {
              void locations.refetch();
            }}
          />
        ) : (
          <label>
            Склад
            <select
              value={locationId}
              onChange={(event) => {
                setLocationId(event.target.value);
                setOffset(0);
                setOption("");
              }}
            >
              {!onlyWarehouse && <option value="">Оберіть склад явно</option>}
              {locations.data.map((location) => (
                <option
                  key={location.id}
                  value={location.id}
                  disabled={!location.is_active || !location.can_sell}
                >
                  {location.name}
                  {!location.is_active
                    ? " — на паузі"
                    : !location.can_sell
                      ? " — без права продажу"
                      : ""}
                </option>
              ))}
            </select>
            {locations.data.length === 0 && (
              <span>Доступних складів немає. Зверніться до менеджера.</span>
            )}
          </label>
        )}
        {locationId &&
          (stock.isPending ? (
            <p role="status">Завантажуємо товари…</p>
          ) : stock.error ? (
            <Failure
              error={stock.error}
              retry={() => {
                void stock.refetch();
              }}
            />
          ) : (
            <>
              <label>
                Товар і розмір
                <select
                  value={option}
                  onChange={(event) => {
                    setOption(event.target.value);
                    setLabelSize("");
                    // The model's suggested price, which the seller may
                    // change: the agreed price is the one sold at (owner
                    // decisions, 2026-09-15 and 2026-10-01). A model with
                    // none leaves the field empty, never a previous one's.
                    const picked = stock.data.items.find(
                      (item) =>
                        `${item.product_variant_id}:${item.size_id}` ===
                        event.target.value,
                    );
                    setPrice(
                      picked?.suggested_price
                        ? asInput(picked.suggested_price)
                        : "",
                    );
                  }}
                >
                  <option value="">Оберіть товар</option>
                  {stock.data.items.map((item) => (
                    <option
                      key={`${item.product_variant_id}:${item.size_id}`}
                      value={`${item.product_variant_id}:${item.size_id}`}
                    >
                      {item.display_name} ·{" "}
                      {item.size_is_unknown
                        ? "розмір невідомий"
                        : item.size_label}{" "}
                      · доступно {item.available_quantity}
                    </option>
                  ))}
                </select>
              </label>
              {stock.data.items.length === 0 && (
                <p>На цьому складі немає товарів із додатним залишком.</p>
              )}
              {selected && (
                <p className="hint">
                  На складі {selected.quantity} · у резерві{" "}
                  {selected.reserved_quantity} · доступно{" "}
                  {selected.available_quantity}
                  {selected.size_is_unknown &&
                    " · розмір невідомий: продається як є"}
                </p>
              )}
              {selected?.size_is_unknown && mayReadLabel && (
                <label>
                  Розмір з етикетки
                  <select
                    value={labelSize}
                    onChange={(event) => {
                      setLabelSize(event.target.value);
                    }}
                  >
                    <option value="">Не читали — продати без розміру</option>
                    {(sizes.data ?? []).map((size) => (
                      <option key={size.size_id} value={size.size_id}>
                        {size.code}
                      </option>
                    ))}
                  </select>
                  <span className="hint">
                    Прочитали розмір на етикетці — оберіть його, і товар
                    продасться з цим розміром.
                  </span>
                </label>
              )}
              {sizes.error && (
                <Failure
                  error={sizes.error}
                  retry={() => {
                    void sizes.refetch();
                  }}
                />
              )}
              <div className="toolbar">
                <button
                  type="button"
                  className="quiet"
                  disabled={offset === 0}
                  onClick={() => {
                    setOffset(Math.max(0, offset - pageSize));
                    setOption("");
                  }}
                >
                  Попередні товари
                </button>
                <button
                  type="button"
                  className="quiet"
                  disabled={!stock.data.has_more}
                  onClick={() => {
                    setOffset(offset + pageSize);
                    setOption("");
                  }}
                >
                  Наступні товари
                </button>
              </div>
            </>
          ))}
        <div className="fields">
          <label>
            Кількість
            <input
              inputMode="numeric"
              value={quantity}
              onChange={(event) => {
                setQuantity(event.target.value);
              }}
            />
          </label>
          <label>
            Ціна за одиницю, грн
            <input
              inputMode="decimal"
              placeholder="0,00"
              value={price}
              onChange={(event) => {
                setPrice(event.target.value);
              }}
            />
            {selected?.suggested_price && (
              <span className="hint">
                Рекомендована {money(selected.suggested_price)}. Домовилися про
                іншу — змініть.
              </span>
            )}
          </label>
        </div>
        <button
          type="button"
          className="quiet"
          disabled={!selected || draft.length >= 100}
          onClick={add}
        >
          Додати в кошик
        </button>
        {validation && <p role="alert">{validation}</p>}
        {draft.map((d, index) => (
          <div className="line" key={stockKey(d.line)}>
            <strong>
              {d.name} · {d.size}
            </strong>
            <span>
              {d.line.quantity} × {money(d.line.unit_price)}
            </span>
            {found[index] !== undefined && (
              <span>Підтверджено на місці: +{found[index]}</span>
            )}
            {missing[index] === 0 ? (
              <span>На полиці немає — не продається</span>
            ) : (
              missing[index] !== undefined && (
                <span>На місці лише {missing[index]}</span>
              )
            )}
            {d.fromUnknown && (
              <span className="hint">Розмір з етикетки товару без розміру</span>
            )}
            {clarified[index] !== undefined && (
              <span>
                Розмір уточнено: {clarified[index]} од. з «розмір невідомий»
              </span>
            )}
            <button
              type="button"
              className="quiet"
              onClick={() => {
                replaceDraft(draft.filter((_, i) => i !== index));
              }}
            >
              Прибрати {d.name}
            </button>
          </div>
        ))}
        <p className="total">
          Разом <strong>{money(decimal(total))}</strong>
        </p>
        {mayCredit && (
          <TermsFields
            value={credit}
            change={setCredit}
            total={total}
            hint="Покупець забирає товар зараз, решту доплачує, коли зможе. Внески приймає лише цей магазин, у розділі «Борги»."
          />
        )}
        <button
          type="button"
          disabled={draft.length === 0}
          onClick={() => {
            void send(found, missing, clarified);
          }}
        >
          Продати
        </button>
      </fieldset>
      {refusal !== null && (
        <p role="alert">
          {refusalText(refusal)} Кошик збережено — нічого не продано.
        </p>
      )}
      {shortfall && (
        <section className="notice" role="alert">
          <h3>Залишку не вистачає</h3>
          {shortDraft === undefined || shortIndex < 0 ? (
            <p>
              Сервер відмовив через товар, якого немає в цьому кошику. Оновіть
              залишки й складіть кошик заново.
            </p>
          ) : (
            <>
              <p>
                {shortDraft.name} · {shortDraft.size}: у кошику{" "}
                {shortfall.requested}, в обліку доступно {shortfall.available}.
              </p>
              {!shortfall.correctable ? (
                <p>
                  Цей залишок неможливо виправити під час продажу — частина
                  одиниць у резерві замовлення. Зменшіть кількість або продайте
                  інший товар.
                </p>
              ) : (
                <>
                  {mayCorrect && unknownHere && (
                    <>
                      <p>
                        Ця модель є на складі з невідомим розміром. Якщо у вас
                        одна з тих одиниць, уточніть її розмір — вона продасться
                        як {shortDraft.size}.
                      </p>
                      <button
                        type="button"
                        disabled={working}
                        onClick={() => {
                          const next = {
                            ...clarified,
                            [shortIndex]:
                              shortfall.requested - shortfall.available,
                          };
                          setClarified(next);
                          void send(found, missing, next);
                        }}
                      >
                        Це товар без розміру — продати як {shortDraft.size}
                      </button>
                    </>
                  )}
                  {mayCorrect && !unknownHere && !shortDraft.unknownSize && (
                    <button
                      type="button"
                      disabled={working}
                      onClick={() => {
                        const next = {
                          ...found,
                          [shortIndex]:
                            shortfall.requested - shortfall.available,
                        };
                        setFound(next);
                        void send(next, missing, clarified);
                      }}
                    >
                      Товар на місці — продати {shortfall.requested}
                    </button>
                  )}
                  {mayReportMissing && (
                    <button
                      type="button"
                      disabled={working}
                      onClick={() => {
                        const next = { ...missing, [shortIndex]: 0 };
                        setMissing(next);
                        void send(found, next, clarified);
                      }}
                    >
                      {draft.every(
                        (_, index) =>
                          index === shortIndex || missing[index] === 0,
                      )
                        ? "На полиці немає жодної — записати нестачу"
                        : "На полиці немає жодної — продати решту"}
                    </button>
                  )}
                  {mayReportMissing && shortfall.requested > 1 && (
                    <>
                      <label>
                        На місці фактично є, одиниць
                        <input
                          inputMode="numeric"
                          value={present}
                          onChange={(event) => {
                            setPresent(event.target.value);
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        disabled={working}
                        onClick={() => {
                          const count = Number(present);
                          if (
                            !/^\d+$/.test(present) ||
                            count < 1 ||
                            count >= shortfall.requested
                          ) {
                            setValidation(
                              `Вкажіть від 1 до ${String(shortfall.requested - 1)} одиниць. Якщо немає жодної — натисніть «На полиці немає жодної».`,
                            );
                            return;
                          }
                          const next = { ...missing, [shortIndex]: count };
                          setMissing(next);
                          void send(found, next, clarified);
                        }}
                      >
                        Продати стільки, скільки є
                      </button>
                    </>
                  )}
                  {!mayCorrect && !mayReportMissing && (
                    <p>
                      Немає права виправляти залишок під час продажу. Покличте
                      менеджера або зменшіть кількість.
                    </p>
                  )}
                </>
              )}
              <button
                type="button"
                className="quiet"
                onClick={() => {
                  replaceDraft(draft.filter((_, i) => i !== shortIndex));
                }}
              >
                Прибрати цей рядок із кошика
              </button>
            </>
          )}
        </section>
      )}
    </section>
  );
}

function Receipt({
  receipt,
  dropped,
  next,
}: {
  receipt: SaleReceipt;
  dropped: string[];
  next: () => void;
}): JSX.Element {
  return (
    <section>
      <h2>Продаж записано</h2>
      <p className="total">
        Разом <strong>{money(receipt.total)}</strong>
      </p>
      {receipt.credit && (
        <div className="section-block">
          <h3>Оплата частинами</h3>
          <p>
            Сплачено зараз <strong>{money(receipt.credit.paid_now)}</strong>
          </p>
          <p>
            Покупець винен <strong>{money(receipt.credit.owed)}</strong>
          </p>
          <p className="hint">Наступні внески — у розділі «Борги».</p>
        </div>
      )}
      {receipt.items.map((item) => (
        <div className="line" key={item.id}>
          <strong>{item.display_name}</strong>
          <span>
            {item.quantity} × {money(item.final_unit_price)} ={" "}
            {money(item.line_total)}
          </span>
        </div>
      ))}
      {receipt.corrections.length > 0 && (
        <p className="hint">
          Оприходовано знайдене на місці: {receipt.corrections.length} рух(и)
          складу.
        </p>
      )}
      {dropped.length > 0 && (
        <p>Не продано — на полиці не було: {dropped.join(", ")}.</p>
      )}
      {receipt.shortages.length > 0 && (
        <p className="hint">
          Списано як фізично відсутнє: {receipt.shortages.length} рух(и) складу.
          Перевірте склад із менеджером.
        </p>
      )}
      {receipt.size_reclassifications.length > 0 && (
        <p className="hint">
          Уточнено розмір: {receipt.size_reclassifications.length} рух(и)
          складу.
        </p>
      )}
      <button type="button" onClick={next}>
        Новий продаж
      </button>
    </section>
  );
}

/** Nothing in the basket was on the shelf: no sale, and the shortage recorded. */
function NothingSold({
  shelf,
  next,
}: {
  shelf: EmptyShelf;
  next: () => void;
}): JSX.Element {
  return (
    <section>
      <h2>Продажу немає</h2>
      <p>Нічого з кошика не було на полиці. Нестачу записано.</p>
      {shelf.lines.map((line) => (
        <div
          className="line"
          key={`${line.source_location_id}:${line.product_variant_id}:${line.size_id}`}
        >
          <strong>
            {line.display_name} · {sizeLabel(line.size)}
          </strong>
          <span>
            {line.removed > 0
              ? `Знято з обліку: ${String(line.removed)} од.`
              : "Облік і так не мав цих одиниць — нічого не знято."}
          </span>
        </div>
      ))}
      <p className="hint">Перевірте склад із менеджером.</p>
      <button type="button" onClick={next}>
        Новий продаж
      </button>
    </section>
  );
}

/** What the till can say about a refusal it knows the cause of. */
function refusalText(error: unknown): string {
  const details = (error as Partial<ApiError> | null)?.details ?? {};
  switch (details.reason) {
    case "SIZE_NOT_KNOWN_SHORT":
      return `Одиниць цієї моделі без розміру на складі менше, ніж треба уточнити (є ${String(details.available)}). Зменшіть кількість або продайте товар без розміру.`;
    case "SIZE_CLARIFIED":
      return "Облік змінився, поки ви відповідали. Натисніть «Продати» ще раз, щоб побачити, чого бракує тепер.";
    case "SIZE_NOT_KNOWN_AMBIGUOUS":
      return "Ця модель записана на складі під кількома невідомими розмірами, тож уточнити розмір не можна. Зверніться до менеджера.";
    case "NOTHING_TO_SELL":
      return "У кошику не лишилося нічого, що є на полиці.";
    case "PAID_IN_FULL":
      return `Покупець сплачує все одразу (${money(String(details.total))}) — це звичайний продаж. Зніміть «Оплата частинами» або змініть суму.`;
    case "CUSTOMER_NAME":
      return "Вкажіть ім’я покупця, який платить частинами.";
    case "CUSTOMER_PHONE":
      return "Телефон покупця має містити від 10 до 15 цифр.";
    case "NOTHING_PAID":
      return "Покупець має сплатити зараз більше нуля.";
    case "RESERVED":
      return "Частина цих одиниць у резерві замовлення, тому під час продажу облік не виправити. Зменшіть кількість або продайте інший товар.";
    default:
      return errorText(error);
  }
}

function Failure({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}): JSX.Element {
  return (
    <div role="alert">
      <p>{errorText(error)}</p>
      <button type="button" onClick={retry}>
        Повторити завантаження
      </button>
    </div>
  );
}
