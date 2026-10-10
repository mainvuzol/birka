import { useState } from "react";
import type { JSX } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, errorText, recordedNothing } from "@/shared/api";
import { visible } from "@/shared/visible";
import type { Location, Store } from "@/orders/types";
import { CatalogPicker } from "./CatalogPicker";
import { submitCount, useCountCommand } from "./stocktakeCommands";
import type {
  CountResult,
  StocktakePosition,
  StocktakeRecord,
  StocktakeSums,
} from "./stocktakeTypes";
import type { ReceivableVariant, SizeOption } from "./receiptTypes";

/**
 * A stocktake of a whole warehouse (owner decisions, 2026-10-10; ADR-0022).
 *
 * - The warehouse keeps selling while it is counted: each position is sent
 *   with the balance it was counted against, and one a sale moved meanwhile
 *   is refused (`STOCK_CHANGED`) and counted again, alone.
 * - Positions nobody counts stay as they are; the end says how many.
 * - Whoever may correct the warehouse's stock counts (`inventory:adjust`),
 *   and each count applies at once.
 * - It is one record with its sums, and the bot tells the network's owner.
 */

const pageSize = 50;

function moment(iso: string): string {
  return new Date(iso).toLocaleString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function signed(delta: number): string {
  return delta > 0 ? `+${String(delta)}` : `−${String(Math.abs(delta))}`;
}

/** «Пораховано позицій: 12 · не перевірено: 3 · нестача: 2 од. · …» */
export function sumsText(sums: StocktakeSums): string {
  const parts = [
    `Пораховано позицій: ${String(sums.counted_positions)}`,
    `не перевірено: ${String(sums.unchecked_positions)}`,
  ];
  if (sums.shortage_units)
    parts.push(
      `нестача: ${String(sums.shortage_units)} од. (позицій: ${String(sums.shortage_positions)})`,
    );
  if (sums.surplus_units)
    parts.push(
      `надлишок: ${String(sums.surplus_units)} од. (позицій: ${String(sums.surplus_positions)})`,
    );
  if (!sums.shortage_units && !sums.surplus_units)
    parts.push("розбіжностей немає");
  return parts.join(" · ");
}

/**
 * Why a count was refused. `after` says nothing was recorded; a kept count
 * refused on resend says it first instead («Підрахунок не записано.»).
 */
export function countRefusalText(
  error: ApiError,
  after = " Нічого не записано.",
): string {
  const { details } = error;
  // Goods found that the list did not show, counted against nothing.
  if (
    error.code === "STOCK_CHANGED" &&
    typeof details.actual === "number" &&
    details.expected === 0
  )
    return `Цей товар уже є в обліку цього складу: ${String(details.actual)} од. Перерахуйте його й введіть кількість ще раз.${after}`;
  if (error.code === "STOCK_CHANGED" && typeof details.actual === "number")
    return `Поки ви рахували, облік змінився: було ${String(details.expected)}, тепер ${String(details.actual)}. Перерахуйте цей товар і введіть кількість ще раз.${after}`;
  if (error.code === "STOCKTAKE_FINISHED")
    return `Цю інвентаризацію вже завершили. Щоб рахувати далі, почніть нову.${after}`;
  if (details.reason === "RESERVED" && typeof details.reserved === "number")
    return `На цей товар є резерв замовлення (${String(details.reserved)} од.). Якщо кількість не збігається, виправити облік можна після видачі або скасування замовлення.${after}`;
  if (error.status === 422 && typeof details.size_id === "string")
    return `Облік товару з невідомим розміром можна лише зменшити.${after}`;
  return `${errorText(error)}${after}`;
}

/** What App says of a kept count once it is settled as refused. */
export function countErrorText(error: unknown): string {
  if (!recordedNothing(error) || !(error instanceof ApiError))
    return errorText(error);
  return `Підрахунок не записано. ${countRefusalText(error, "")}`;
}

/** The warehouse's stocktakes: the open one, the finished ones, and a start. */
export function Stocktakes({
  store,
  token,
  scopeKey,
  blocked,
  location,
  canCount,
  onCount,
}: {
  store: Store;
  token: string;
  scopeKey: string;
  blocked: boolean;
  location: Location;
  /** Whoever may correct this warehouse's stock (`inventory:adjust`). */
  canCount: boolean;
  onCount: (record: StocktakeRecord) => void;
}): JSX.Element {
  const [asking, setAsking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [shown, setShown] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["stocktakes", scopeKey, store.id, location.id],
    queryFn: () =>
      api<{ items: StocktakeRecord[] }>(
        `/stocktakes?store_id=${store.id}&location_id=${location.id}`,
        token,
      ),
    retry: false,
  });
  const open = list.data?.items.find((item) => item.finished_at === null);
  const finished = (list.data?.items ?? []).filter(
    (item) => item.finished_at !== null,
  );

  async function start(): Promise<void> {
    setStarting(true);
    setFailure(null);
    try {
      const record = await api<StocktakeRecord>("/stocktakes", token, {
        store_id: store.id,
        location_id: location.id,
      });
      setAsking(false);
      void list.refetch();
      onCount(record);
    } catch (error) {
      setFailure(error);
    } finally {
      setStarting(false);
    }
  }

  return (
    <section aria-label="Інвентаризація складу">
      <h3>Інвентаризація складу</h3>
      {list.isPending ? (
        <p role="status">Завантажуємо інвентаризації…</p>
      ) : list.error ? (
        <div role="alert">
          <p>{errorText(list.error)}</p>
          <button
            onClick={() => {
              void list.refetch();
            }}
          >
            Повторити завантаження
          </button>
        </div>
      ) : (
        <>
          {open ? (
            <div className="notice">
              <p>
                Інвентаризація триває: почато {moment(open.started_at)},{" "}
                {visible(open.started_by)}. {sumsText(open.sums)}.
              </p>
              {canCount && (
                <button
                  disabled={blocked}
                  onClick={() => {
                    onCount(open);
                  }}
                >
                  Продовжити інвентаризацію
                </button>
              )}
            </div>
          ) : (
            canCount &&
            (asking ? (
              <div className="notice">
                <p>
                  Склад продає далі. Кожну позицію звіряють з обліком, коли її
                  записують: якщо її тим часом продали чи прийняли, система
                  попросить перерахувати лише її. Те, що не порахують, лишиться
                  як є. Кожна різниця одразу змінює облік.
                </p>
                <div className="actions">
                  <button
                    disabled={blocked || starting}
                    onClick={() => {
                      void start();
                    }}
                  >
                    Почати інвентаризацію
                  </button>
                  <button
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
                className="quiet"
                disabled={blocked}
                onClick={() => {
                  setAsking(true);
                }}
              >
                Почати інвентаризацію складу
              </button>
            ))
          )}
          {failure !== null && <p role="alert">{errorText(failure)}</p>}
          {finished.length > 0 && (
            <details>
              <summary>Попередні інвентаризації</summary>
              {finished.map((record) => (
                <article className="line" key={record.id}>
                  <span>
                    {record.finished_at ? moment(record.finished_at) : ""} ·{" "}
                    {visible(record.finished_by ?? "")}
                  </span>
                  <span>{sumsText(record.sums)}</span>
                  {record.sums.shortage_units + record.sums.surplus_units > 0 &&
                    (shown === record.id ? (
                      <Differences
                        store={store}
                        token={token}
                        scopeKey={scopeKey}
                        stocktakeId={record.id}
                      />
                    ) : (
                      <button
                        className="quiet"
                        onClick={() => {
                          setShown(record.id);
                        }}
                      >
                        Показати розбіжності
                      </button>
                    ))}
                </article>
              ))}
            </details>
          )}
        </>
      )}
    </section>
  );
}

/** Where a finished stocktake found the shelf and the balance apart. */
function Differences({
  store,
  token,
  scopeKey,
  stocktakeId,
}: {
  store: Store;
  token: string;
  scopeKey: string;
  stocktakeId: string;
}): JSX.Element {
  const [offset, setOffset] = useState(0);
  const page = useQuery({
    queryKey: ["stocktake-differences", scopeKey, stocktakeId, offset],
    queryFn: () =>
      api<{ items: StocktakePosition[]; has_more: boolean }>(
        `/stocktakes/${stocktakeId}/positions?store_id=${store.id}&state=differences&limit=${String(pageSize)}&offset=${String(offset)}`,
        token,
      ),
    retry: false,
  });
  if (page.isPending) return <p role="status">Завантажуємо розбіжності…</p>;
  if (page.error) return <p role="alert">{errorText(page.error)}</p>;
  return (
    <ul aria-label="Розбіжності">
      {page.data.items.map((item) => (
        <li key={`${item.product_variant_id}:${item.size_id}`}>
          {visible(item.display_name)} ·{" "}
          {item.size_is_unknown ? "розмір невідомий" : visible(item.size_label)}{" "}
          — {item.count ? signed(item.count.net_delta) : ""} од.
          {item.count
            ? ` (пораховано ${String(item.count.counted_quantity)}, ${visible(item.count.counted_by)})`
            : ""}
        </li>
      ))}
      {(offset > 0 || page.data.has_more) && (
        <li>
          <button
            className="quiet"
            disabled={offset === 0}
            onClick={() => {
              setOffset(Math.max(0, offset - pageSize));
            }}
          >
            Попередні
          </button>
          <button
            className="quiet"
            disabled={!page.data.has_more}
            onClick={() => {
              setOffset(offset + pageSize);
            }}
          >
            Наступні
          </button>
        </li>
      )}
    </ul>
  );
}

/** Counting: the positions left, those counted, goods found, and the end. */
export function Stocktake({
  store,
  token,
  scopeKey,
  journalKey,
  blocked,
  location,
  record,
  onLeave,
}: {
  store: Store;
  token: string;
  scopeKey: string;
  journalKey: string;
  blocked: boolean;
  location: Location;
  record: StocktakeRecord;
  onLeave: () => void;
}): JSX.Element {
  const [state, setState] = useState<"uncounted" | "counted">("uncounted");
  const [offset, setOffset] = useState(0);
  const [finding, setFinding] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [done, setDone] = useState<StocktakeRecord | null>(null);
  const [last, setLast] = useState<{
    name: string;
    result: CountResult;
  } | null>(null);
  const current = useQuery({
    queryKey: ["stocktake", scopeKey, record.id],
    queryFn: () =>
      api<StocktakeRecord>(
        `/stocktakes/${record.id}?store_id=${store.id}`,
        token,
      ),
    retry: false,
  });
  const page = useQuery({
    queryKey: ["stocktake-positions", scopeKey, record.id, state, offset],
    queryFn: () =>
      api<{ items: StocktakePosition[]; has_more: boolean }>(
        `/stocktakes/${record.id}/positions?store_id=${store.id}&state=${state}&limit=${String(pageSize)}&offset=${String(offset)}`,
        token,
      ),
    retry: false,
  });
  const shown = done ?? current.data ?? record;
  const cache = useQueryClient();

  function reread(): void {
    void current.refetch();
    void page.refetch();
  }

  async function finish(): Promise<void> {
    setFinishing(true);
    setFailure(null);
    try {
      const finished = await api<StocktakeRecord>(
        `/stocktakes/${record.id}/finish`,
        token,
        { store_id: store.id },
      );
      // The warehouse's list shows it finished at once, never «Продовжити».
      cache.setQueryData<{ items: StocktakeRecord[] }>(
        ["stocktakes", scopeKey, store.id, location.id],
        (old) =>
          old && {
            items: old.items.map((item) =>
              item.id === finished.id ? finished : item,
            ),
          },
      );
      void cache.invalidateQueries({ queryKey: ["stocktakes"] });
      setDone(finished);
      setConfirming(false);
    } catch (error) {
      setFailure(error);
    } finally {
      setFinishing(false);
    }
  }

  if (done) {
    return (
      <section aria-label="Інвентаризацію завершено">
        <h3>Інвентаризацію завершено: {visible(location.name)}</h3>
        <p role="status">{sumsText(done.sums)}.</p>
        {done.sums.unchecked_positions > 0 && (
          <p>Залишки позицій, які не порахували, не змінювались.</p>
        )}
        <button onClick={onLeave}>Повернутися до залишків</button>
      </section>
    );
  }

  return (
    <section aria-label="Інвентаризація">
      <div className="toolbar">
        <h3>Інвентаризація: {visible(location.name)}</h3>
        <button className="quiet" onClick={onLeave}>
          До залишків
        </button>
      </div>
      <p className="hint">
        Почато {moment(shown.started_at)}, {visible(shown.started_by)}. Склад
        продає далі: кожну позицію звіряють з обліком, коли її записують.
      </p>
      <p role="status">{sumsText(shown.sums)}.</p>
      {last && (
        <p role="status">
          Записано: {visible(last.name)} —{" "}
          {last.result.quantity_delta === 0
            ? `збігається з обліком (${String(last.result.counted_quantity)})`
            : `облік ${String(last.result.quantity_before)} → ${String(last.result.counted_quantity)} (${signed(last.result.quantity_delta)})`}
          .
        </p>
      )}
      <div role="radiogroup" aria-label="Які позиції" className="choices">
        {(
          [
            ["uncounted", "Ще не пораховані"],
            ["counted", "Пораховані"],
          ] as const
        ).map(([key, label]) => (
          <button
            type="button"
            role="radio"
            key={key}
            aria-checked={state === key}
            className={state === key ? "active" : "quiet"}
            onClick={() => {
              setState(key);
              setOffset(0);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {page.isPending ? (
        <p role="status">Завантажуємо позиції…</p>
      ) : page.error ? (
        <div role="alert">
          <p>{errorText(page.error)}</p>
          <button onClick={reread}>Повторити завантаження</button>
        </div>
      ) : (
        <>
          {page.data.items.length === 0 && (
            <p>
              {state === "uncounted"
                ? offset === 0
                  ? "Усі позиції з залишком пораховано."
                  : "На цій сторінці більше немає позицій. Поверніться до попередньої."
                : "Ще нічого не пораховано."}
            </p>
          )}
          {page.data.items.map((item) => (
            <PositionLine
              key={`${state}:${item.product_variant_id}:${item.size_id}`}
              store={store}
              token={token}
              journalKey={journalKey}
              blocked={blocked}
              stocktakeId={record.id}
              position={item}
              onCounted={(result) => {
                setLast({ name: item.display_name, result });
                reread();
              }}
              onRefused={reread}
            />
          ))}
          <div className="toolbar">
            <button
              className="quiet"
              disabled={offset === 0 || page.isFetching}
              onClick={() => {
                setOffset(Math.max(0, offset - pageSize));
              }}
            >
              Попередні позиції
            </button>
            <button
              className="quiet"
              disabled={!page.data.has_more || page.isFetching}
              onClick={() => {
                setOffset(offset + pageSize);
              }}
            >
              Наступні позиції
            </button>
          </div>
        </>
      )}
      {finding ? (
        <FoundGoods
          store={store}
          token={token}
          scopeKey={scopeKey}
          journalKey={journalKey}
          blocked={blocked}
          stocktakeId={record.id}
          onCounted={(name, result) => {
            setLast({ name, result });
            setFinding(false);
            reread();
          }}
          onCancel={() => {
            setFinding(false);
          }}
          onRefused={reread}
        />
      ) : (
        <button
          type="button"
          className="quiet"
          disabled={blocked}
          onClick={() => {
            setFinding(true);
          }}
        >
          Знайшли товар, якого немає в списку
        </button>
      )}
      {confirming ? (
        <div className="notice">
          <p>
            {shown.sums.unchecked_positions > 0
              ? `Не перевірено позицій: ${String(shown.sums.unchecked_positions)} — їхні залишки не зміняться. `
              : ""}
            Після завершення рахувати в цій інвентаризації вже не можна. Бот
            надішле підсумок власнику мережі, якщо завершує не власник.
          </p>
          <div className="actions">
            <button
              disabled={blocked || finishing}
              onClick={() => {
                void finish();
              }}
            >
              Так, завершити
            </button>
            <button
              className="quiet"
              onClick={() => {
                setConfirming(false);
              }}
            >
              Ще ні
            </button>
          </div>
        </div>
      ) : (
        <button
          disabled={blocked}
          onClick={() => {
            void current.refetch();
            setConfirming(true);
          }}
        >
          Завершити інвентаризацію
        </button>
      )}
      {failure !== null && <p role="alert">{errorText(failure)}</p>}
    </section>
  );
}

interface Target {
  product_variant_id: string;
  size_id: string;
  name: string;
  size: string;
  sizeIsUnknown: boolean;
  /** The balance the count is made against. */
  quantity: number;
}

/** One position: its balance, and what the shelf holds. */
function PositionLine({
  store,
  token,
  journalKey,
  blocked,
  stocktakeId,
  position,
  onCounted,
  onRefused,
}: {
  store: Store;
  token: string;
  journalKey: string;
  blocked: boolean;
  stocktakeId: string;
  position: StocktakePosition;
  onCounted: (result: CountResult) => void;
  onRefused: () => void;
}): JSX.Element {
  const [again, setAgain] = useState(false);
  const size = position.size_is_unknown
    ? "розмір невідомий"
    : position.size_label;
  const counted = position.count;
  return (
    <article
      className="line"
      aria-label={`${visible(position.display_name)} · ${visible(size)}`}
      style={{ overflowWrap: "anywhere" }}
    >
      <strong>{visible(position.display_name)}</strong>
      <span>
        {position.size_is_unknown
          ? "Розмір невідомий"
          : `Розмір: ${visible(position.size_label)}`}
      </span>
      <span>
        В обліку: <strong>{position.quantity}</strong>
      </span>
      {position.reserved_quantity > 0 && (
        <span className="hint">
          У резерві замовлень: {position.reserved_quantity}. Якщо кількість не
          збігається, виправити облік можна після видачі або скасування
          замовлення.
        </span>
      )}
      {counted && (
        <span>
          Пораховано: <strong>{counted.counted_quantity}</strong>
          {counted.net_delta === 0
            ? " — збігається з обліком"
            : ` — облік змінено на ${signed(counted.net_delta)}`}{" "}
          · {visible(counted.counted_by)}, {moment(counted.counted_at)}
        </span>
      )}
      {counted && !again ? (
        <button
          type="button"
          className="quiet"
          disabled={blocked}
          onClick={() => {
            setAgain(true);
          }}
        >
          Перерахувати
        </button>
      ) : (
        <CountForm
          store={store}
          token={token}
          journalKey={journalKey}
          blocked={blocked}
          stocktakeId={stocktakeId}
          target={{
            product_variant_id: position.product_variant_id,
            size_id: position.size_id,
            name: position.display_name,
            size,
            sizeIsUnknown: position.size_is_unknown,
            quantity: position.quantity,
          }}
          onCounted={(result) => {
            setAgain(false);
            onCounted(result);
          }}
          onRefused={onRefused}
        />
      )}
    </article>
  );
}

/**
 * What the shelf holds, sent with the balance it was counted against. A
 * count equal to it is recorded as checked and changes nothing.
 */
function CountForm({
  store,
  token,
  journalKey,
  blocked,
  stocktakeId,
  target,
  onCounted,
  onRefused,
}: {
  store: Store;
  token: string;
  journalKey: string;
  blocked: boolean;
  stocktakeId: string;
  target: Target;
  onCounted: (result: CountResult) => void;
  onRefused: () => void;
}): JSX.Element {
  // Where the count is judged from: what the line shows, or what the server
  // saw under its lock when it refused a count made against that — but only
  // while the line still shows the balance it replaced. Read again, the line
  // is the newer (review, 2026-10-10).
  const [moved, setMoved] = useState<{ shown: number; actual: number } | null>(
    null,
  );
  const system =
    moved !== null && moved.shown === target.quantity
      ? moved.actual
      : target.quantity;
  const [count, setCount] = useState("");
  const [tried, setTried] = useState(false);
  const [refusal, setRefusal] = useState("");
  const { busy, pending } = useCountCommand();
  const typed = /^\d{1,5}$/.test(count.trim()) ? Number(count.trim()) : null;
  const invalid =
    typed === null
      ? "Вкажіть, скільки одиниць фактично на складі."
      : typed > 10000
        ? "Не більше 10000 од. однієї позиції."
        : target.sizeIsUnknown && typed > system
          ? "Облік товару з невідомим розміром можна лише зменшити."
          : "";

  async function send(): Promise<void> {
    setTried(true);
    if (invalid || typed === null) return;
    setRefusal("");
    const outcome = await submitCount(journalKey, token, {
      // A new transport key per attempt, and a new command per count: a
      // definite refusal wrote nothing, and an unknown outcome is settled by
      // resending the kept attempt, never by sending this form again.
      key: crypto.randomUUID(),
      body: {
        store_id: store.id,
        stocktake_id: stocktakeId,
        command_id: crypto.randomUUID(),
        product_variant_id: target.product_variant_id,
        size_id: target.size_id,
        counted_quantity: typed,
        expected_quantity: system,
      },
    });
    if (outcome.kind === "done") {
      setCount("");
      setTried(false);
      onCounted(outcome.result);
    } else if (outcome.kind === "refused") {
      setRefusal(countRefusalText(outcome.error));
      const actual = outcome.error.details.actual;
      if (outcome.error.code === "STOCK_CHANGED" && typeof actual === "number")
        setMoved({ shown: target.quantity, actual });
      // A person past their requests (ADR-0020) counted right: the same
      // count is sent again after the wait. Any other refusal asks for a
      // recount.
      if (outcome.error.code !== "TOO_MANY_REQUESTS") setCount("");
      setTried(false);
      onRefused();
    }
  }

  return (
    <fieldset disabled={blocked || busy || pending !== null}>
      <legend>
        Підрахунок: {visible(target.name)} · {visible(target.size)}
      </legend>
      {system !== target.quantity && (
        <p>
          В обліку тепер: <strong>{system}</strong>
        </p>
      )}
      <label>
        Фактично на складі, од.
        <input
          inputMode="numeric"
          value={count}
          onChange={(event) => {
            setCount(event.target.value);
            setRefusal("");
          }}
        />
      </label>
      {typed !== null && !invalid && (
        <p className="total">
          {typed === system
            ? "Збігається з обліком."
            : `Облік ${String(system)} → ${String(typed)} (${signed(typed - system)})`}
        </p>
      )}
      {invalid && (tried || count !== "") && <p role="alert">{invalid}</p>}
      {refusal && <p role="alert">{refusal}</p>}
      <button
        type="button"
        onClick={() => {
          void send();
        }}
      >
        Записати кількість
      </button>
    </fieldset>
  );
}

/**
 * Goods on the shelf that the list does not show, because the system holds
 * none of them here: counted against zero. If it holds some after all, the
 * server says how many, and the form counts against that.
 */
function FoundGoods({
  store,
  token,
  scopeKey,
  journalKey,
  blocked,
  stocktakeId,
  onCounted,
  onCancel,
  onRefused,
}: {
  store: Store;
  token: string;
  scopeKey: string;
  journalKey: string;
  blocked: boolean;
  stocktakeId: string;
  onCounted: (name: string, result: CountResult) => void;
  onCancel: () => void;
  onRefused: () => void;
}): JSX.Element {
  const [variant, setVariant] = useState<ReceivableVariant | null>(null);
  const [sizeId, setSizeId] = useState("");
  const sizes = useQuery({
    queryKey: ["receive-sizes", scopeKey, store.id],
    queryFn: () =>
      api<SizeOption[]>(`/catalog/sizes?store_id=${store.id}`, token),
    retry: false,
  });
  const size = sizes.data?.find((option) => option.size_id === sizeId);
  return (
    <section className="notice">
      <h3>Товар, якого немає в списку</h3>
      <p className="hint">
        Знайдіть модель у каталозі й оберіть розмір. Якщо товар уже є в обліку
        цього складу, сервер скаже, скільки саме.
      </p>
      <CatalogPicker
        store={store}
        token={token}
        scopeKey={scopeKey}
        variant={variant}
        onVariant={setVariant}
      />
      <label>
        Розмір
        <select
          value={sizeId}
          onChange={(event) => {
            setSizeId(event.target.value);
          }}
        >
          <option value="">Оберіть розмір</option>
          {(sizes.data ?? []).map((option) => (
            <option key={option.size_id} value={option.size_id}>
              {visible(option.code)}
            </option>
          ))}
        </select>
      </label>
      {sizes.error && <p role="alert">{errorText(sizes.error)}</p>}
      {variant && size && (
        <CountForm
          key={`${variant.product_variant_id}:${size.size_id}`}
          store={store}
          token={token}
          journalKey={journalKey}
          blocked={blocked}
          stocktakeId={stocktakeId}
          target={{
            product_variant_id: variant.product_variant_id,
            size_id: size.size_id,
            name: variant.display_name,
            size: size.code,
            sizeIsUnknown: false,
            quantity: 0,
          }}
          onCounted={(result) => {
            onCounted(variant.display_name, result);
          }}
          onRefused={onRefused}
        />
      )}
      <button type="button" className="quiet" onClick={onCancel}>
        Скасувати
      </button>
    </section>
  );
}
