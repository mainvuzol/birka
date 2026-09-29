import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, errorText } from "@/shared/api";
import { decimal, kopecks, money } from "@/orders/types";
import type { Location, StockOption, Store } from "@/orders/types";
import { submitSale, useSaleCommand } from "./commands";
import type { SaleLine, Sale as SaleReceipt, Shortfall } from "./types";
import { stockKey } from "./types";

const pageSize = 100;

interface Draft {
  line: SaleLine;
  name: string;
  size: string;
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
  const [shortfall, setShortfall] = useState<Shortfall | null>(null);
  const [refusal, setRefusal] = useState<unknown>(null);
  const [present, setPresent] = useState("");
  const [receipt, setReceipt] = useState<SaleReceipt | null>(null);
  const [validation, setValidation] = useState("");
  const { busy, pending } = useSaleCommand();

  const mayCorrect = store.permissions.includes(
    "inventory:correct_during_sale",
  );
  const mayReportMissing = store.permissions.includes(
    "inventory:report_missing_during_sale",
  );

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

  // A basket that changed is a different business operation, and any answer
  // given about the old one no longer applies to it.
  function replaceDraft(next: Draft[]): void {
    setDraft(next);
    setCommandId(crypto.randomUUID());
    setFound({});
    setMissing({});
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
    const line: SaleLine = {
      product_variant_id: selected.product_variant_id,
      size_id: selected.size_id,
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
      { line, name: selected.display_name, size: selected.size_label },
    ]);
    setPrice("");
    setQuantity("1");
    setOption("");
    setValidation("");
  }

  async function send(
    nextFound: Record<number, number>,
    nextMissing: Record<number, number>,
  ): Promise<void> {
    setShortfall(null);
    setRefusal(null);
    setValidation("");
    const outcome = await submitSale(journalKey, token, {
      // A new key per payload: one key then always answers one payload, and a
      // replay of it is unambiguous. `command_id` is what keeps the corrected
      // attempt from selling twice.
      key: crypto.randomUUID(),
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
      },
    });
    if (outcome.kind === "sold") {
      setReceipt(outcome.sale);
      setDraft([]);
      setFound({});
      setMissing({});
      setCommandId(crypto.randomUUID());
      setPresent("");
      await stock.refetch();
    } else if (outcome.kind === "refused") {
      if (outcome.shortfall) setShortfall(outcome.shortfall);
      else setRefusal(outcome.error);
      setPresent("");
    }
  }

  const total = draft.reduce(
    (sum, d) =>
      sum + (kopecks(d.line.unit_price) ?? 0n) * BigInt(d.line.quantity),
    0n,
  );
  const shortIndex = shortfall
    ? draft.findIndex(
        (d) =>
          stockKey(d.line) ===
          stockKey({
            source_location_id: shortfall.location_id,
            product_variant_id: shortfall.product_variant_id,
            size_id: shortfall.size_id,
          }),
      )
    : -1;
  const shortDraft = shortIndex >= 0 ? draft[shortIndex] : undefined;
  const working = busy || pending !== null;

  if (receipt)
    return (
      <Receipt
        receipt={receipt}
        next={() => {
          setReceipt(null);
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
              <option value="">Оберіть склад явно</option>
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
            {missing[index] !== undefined && (
              <span>На місці лише {missing[index]}</span>
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
        <button
          type="button"
          disabled={draft.length === 0}
          onClick={() => {
            void send(found, missing);
          }}
        >
          Продати
        </button>
      </fieldset>
      {refusal !== null && (
        <p role="alert">
          {errorText(refusal)} Кошик збережено — нічого не продано.
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
                  {mayCorrect && (
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
                        void send(next, missing);
                      }}
                    >
                      Товар на місці — продати {shortfall.requested}
                    </button>
                  )}
                  {mayReportMissing && (
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
                              `Вкажіть від 1 до ${String(shortfall.requested - 1)} одиниць. Якщо немає жодної — приберіть рядок із кошика.`,
                            );
                            return;
                          }
                          const next = { ...missing, [shortIndex]: count };
                          setMissing(next);
                          void send(found, next);
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
  next,
}: {
  receipt: SaleReceipt;
  next: () => void;
}): JSX.Element {
  return (
    <section>
      <h2>Продаж записано</h2>
      <p className="total">
        Разом <strong>{money(receipt.total)}</strong>
      </p>
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
