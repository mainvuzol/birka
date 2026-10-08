import { useState } from "react";
import type { JSX } from "react";
import { useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { api, errorText } from "@/shared/api";
import { money } from "@/orders/types";
import { markText } from "@/sales/types";
import {
  isTillMethod,
  methodHow,
  methodLabels,
  notStated,
  refundHow,
  type PaymentMethod,
} from "@/shared/payment";
import {
  dayText,
  daysBefore,
  monthStart,
  weekStart,
  type Entries,
  type Entry,
  type Figures,
  type Models,
  type OffTillFigures,
  type SalesReport as Report,
  type StoreFigures,
  type WayFigures,
} from "./types";

type Range = { from: string; to: string };

// A sum that may be below nothing: what a till handed back exceeded what it
// took.
function signed(value: string): string {
  return value.startsWith("-") ? `−${money(value.slice(1))}` : money(value);
}

// What went out: returned goods, money handed back.
function minus(value: string): string {
  return value === "0.00" ? money(value) : signed(`-${value}`);
}

// What a correction moved: «+350,00 грн», «−350,00 грн».
function moved(value: string): string {
  return value.startsWith("-") ? signed(value) : `+${money(value)}`;
}

function nothing(value: string): boolean {
  return value === "0.00";
}

// A way's name in the report: «Не вказано» for money recorded before the way
// was asked (owner decision, 2026-10-04).
const wayLabels: Record<WayFigures["method"], string> = {
  CASH: methodLabels.CASH,
  CARD: methodLabels.CARD,
  TRANSFER: methodLabels.TRANSFER,
  NOT_STATED: `${notStated.charAt(0).toUpperCase()}${notStated.slice(1)}`,
};

type Way = { label: string; came_in: string; corrected: string; net: string };

// An order's money paid off the till, outside «Разом» (owner decision,
// 2026-10-04; ADR-0012 §G24).
function offTill(figures: Figures): Way[] {
  const ways: [string, OffTillFigures][] = [
    [methodLabels.PREPAID_TRANSFER, figures.off_till.prepaid_transfer],
    [methodLabels.CARRIER_COD, figures.off_till.carrier_cod],
  ];
  return ways.map(([label, sums]) => ({ label, ...sums }));
}

// «Виправлення способу оплати: картка −350,00 грн, готівка +350,00 грн» —
// what corrections made in these days moved, the way it left first. A
// correction counts on the day it is made, never back on the day of its sale
// (owner decision, 2026-10-04).
function correctionsText(figures: Figures): string {
  const ways: Way[] = [
    ...figures.ways.map((way) => ({ ...way, label: wayLabels[way.method] })),
    ...offTill(figures),
  ].filter((way) => !nothing(way.corrected));
  const ordered = [
    ...ways.filter((way) => way.corrected.startsWith("-")),
    ...ways.filter((way) => !way.corrected.startsWith("-")),
  ];
  return ordered
    .map((way) => `${way.label.toLowerCase()} ${moved(way.corrected)}`)
    .join(", ");
}

function query(
  range: Range | null,
  storeId = "",
  extra: Record<string, string> = {},
): string {
  const params = new URLSearchParams(extra);
  if (range) {
    params.set("date_from", range.from);
    params.set("date_to", range.to);
  }
  if (storeId) params.set("store_id", storeId);
  const text = params.toString();
  return text ? `?${text}` : "";
}

function periodText(from: string, to: string): string {
  return from === to
    ? `за ${dayText(from)}`
    : `з ${dayText(from)} по ${dayText(to)}`;
}

const stateLabels: Record<StoreFigures["store_state"], string> = {
  ACTIVE: "",
  BLOCKED: "заблоковано",
  ARCHIVED: "в архіві",
};

/**
 * The sales report (owner decisions, 2026-10-02): what each store sold and
 * took back, and the money through its till, for today or any days. The owner
 * and managers read it, each for the stores they hold it in, and the stores
 * together when there are several. Since 2026-10-04 the money is split by the
 * way it was paid, and an order paid off the till has its own lines, outside
 * «Разом» (ADR-0012 §B11, §G24).
 */
export function SalesReport({
  token,
  scopeKey,
}: {
  token: string;
  scopeKey: string;
}): JSX.Element {
  // None is today, as the server counts it where the stores are.
  const [range, setRange] = useState<Range | null>(null);
  const [storeId, setStoreId] = useState("");
  const [offset, setOffset] = useState(0);
  const report = useQuery({
    queryKey: ["sales-report", scopeKey, range],
    queryFn: () => api<Report>(`/reports/sales${query(range)}`, token),
    retry: false,
  });
  const models = useQuery({
    queryKey: ["sales-report-models", scopeKey, range, storeId],
    queryFn: () =>
      api<Models>(`/reports/sales/models${query(range, storeId)}`, token),
    retry: false,
    enabled: report.isSuccess,
  });
  const entries = useQuery({
    queryKey: ["sales-report-entries", scopeKey, range, storeId, offset],
    queryFn: () =>
      api<Entries>(
        `/reports/sales/entries${query(range, storeId, {
          limit: "50",
          offset: String(offset),
        })}`,
        token,
      ),
    retry: false,
    enabled: report.isSuccess,
  });
  const data = report.data;
  function choose(next: Range): void {
    setRange(next);
    setOffset(0);
  }
  const today = data?.today;
  const shortcuts: [string, Range][] = today
    ? [
        ["Сьогодні", { from: today, to: today }],
        ["Вчора", { from: daysBefore(today, 1), to: daysBefore(today, 1) }],
        ["Цей тиждень", { from: weekStart(today), to: today }],
        ["Цей місяць", { from: monthStart(today), to: today }],
      ]
    : [];
  const shown: Range | null = data
    ? { from: data.date_from, to: data.date_to }
    : range;
  return (
    <section>
      <div className="toolbar">
        <h2>Звіт про продажі</h2>
        <button
          className="quiet"
          disabled={report.isFetching}
          onClick={() => {
            void report.refetch();
            void models.refetch();
            void entries.refetch();
          }}
        >
          Оновити
        </button>
      </div>
      <p className="hint">
        Продажі й повернення рахуються магазину, який продав, гроші — магазину,
        через чию касу пройшли. Повернення — у день, коли його прийняли,
        виправлення способу оплати — у день, коли його записали.
      </p>
      <div className="choices" aria-label="Період">
        {shortcuts.map(([label, value]) => (
          <button
            key={label}
            className={
              shown?.from === value.from && shown.to === value.to
                ? "active"
                : "quiet"
            }
            onClick={() => {
              choose(value);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {shown && (
        <div className="fields period">
          <label>
            Від
            <input
              type="date"
              value={shown.from}
              onChange={(event) => {
                if (event.target.value)
                  choose({ from: event.target.value, to: shown.to });
              }}
            />
          </label>
          <label>
            До
            <input
              type="date"
              value={shown.to}
              onChange={(event) => {
                if (event.target.value)
                  choose({ from: shown.from, to: event.target.value });
              }}
            />
          </label>
        </div>
      )}
      {report.isPending ? (
        <p role="status">Рахуємо…</p>
      ) : report.error ? (
        <p role="alert">{errorText(report.error)}</p>
      ) : (
        <>
          <h3>{periodText(report.data.date_from, report.data.date_to)}</h3>
          {report.data.stores.map((store) => (
            <Summary
              key={store.store_id}
              title={store.store_name}
              state={stateLabels[store.store_state]}
              figures={store}
            />
          ))}
          {report.data.total && (
            <Summary
              title="Усі магазини разом"
              state=""
              figures={report.data.total}
            />
          )}
          {report.data.stores.length > 1 && (
            <label>
              Моделі й продажі
              <select
                value={storeId}
                onChange={(event) => {
                  setStoreId(event.target.value);
                  setOffset(0);
                }}
              >
                <option value="">Усі магазини</option>
                {report.data.stores.map((store) => (
                  <option key={store.store_id} value={store.store_id}>
                    {store.store_name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <ModelList models={models} />
          <EntryList
            entries={entries}
            everyStore={storeId === "" && report.data.stores.length > 1}
            offset={offset}
            setOffset={setOffset}
          />
        </>
      )}
    </section>
  );
}

function Summary({
  title,
  state,
  figures,
}: {
  title: string;
  state: string;
  figures: Figures;
}): JSX.Element {
  return (
    <div className="section-block" role="group" aria-label={title}>
      <h3>
        {title}
        {state && <span className="badge">{state}</span>}
      </h3>
      <dl className="debt">
        <dt>
          Продажі: {figures.sales} ({figures.units} од.)
        </dt>
        <dd>{money(figures.sold)}</dd>
        <dt>
          Повернення: {figures.returns} ({figures.returned_units} од.)
        </dt>
        <dd>{minus(figures.returned)}</dd>
        <dt>
          <strong>Продано з урахуванням повернень</strong>
        </dt>
        <dd>
          <strong>{signed(figures.net)}</strong>
        </dd>
      </dl>
      {/* «Гроші», not «Гроші в касі»: card and transfer are in it too, and
          «Каса» is now the cash drawer (ADR-0012 §B11, §G24). */}
      <h4>Гроші</h4>
      <dl className="debt">
        <dt>Оплачено одразу повністю</dt>
        <dd>{money(figures.paid_in_full)}</dd>
        <dt>Внески за борг</dt>
        <dd>{money(figures.debt_payments)}</dd>
        <dt>Віддано при поверненнях</dt>
        <dd>{minus(figures.paid_back)}</dd>
        {!nothing(figures.corrected_into_till) && (
          <>
            <dt>Виправлення способу оплати</dt>
            <dd>{moved(figures.corrected_into_till)}</dd>
          </>
        )}
        <dt>
          <strong>Разом</strong>
        </dt>
        <dd>
          <strong>{signed(figures.money)}</strong>
        </dd>
      </dl>
      {/* The till's ways add up to «Разом». «Не вказано» only when it holds
          something: money recorded before the way was asked. */}
      <h4>За способом оплати</h4>
      <dl className="debt" aria-label="За способом оплати">
        {figures.ways
          .filter(
            (way) =>
              way.method !== "NOT_STATED" ||
              ![way.came_in, way.went_out, way.corrected].every(nothing),
          )
          .map((way) => (
            <Row
              key={way.method}
              label={wayLabels[way.method]}
              value={signed(way.net)}
            />
          ))}
      </dl>
      {offTill(figures).some(
        (way) => !nothing(way.came_in) || !nothing(way.corrected),
      ) && (
        <>
          <h4>Замовлення, оплачені поза касою</h4>
          <dl className="debt">
            {offTill(figures)
              .filter((way) => !nothing(way.came_in) || !nothing(way.corrected))
              .map((way) => (
                <Row
                  key={way.label}
                  label={way.label}
                  value={signed(way.net)}
                />
              ))}
          </dl>
        </>
      )}
      {correctionsText(figures) && (
        <p className="hint">
          Виправлення способу оплати: {correctionsText(figures)}
        </p>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function ModelList({
  models,
}: {
  models: UseQueryResult<Models>;
}): JSX.Element {
  return (
    <div className="section-block">
      <h3>Моделі</h3>
      {models.isPending ? (
        <p role="status">Рахуємо моделі…</p>
      ) : models.error ? (
        <p role="alert">{errorText(models.error)}</p>
      ) : models.data.models.length === 0 ? (
        <p className="hint">Нічого не продано.</p>
      ) : (
        <ul className="nights" aria-label="Моделі">
          {models.data.models.map((model) => (
            <li key={model.product_variant_id}>
              <strong>{model.display_name}</strong>
              <br />
              {model.units} шт. на {money(model.sold)}
              {model.returned_units > 0 &&
                ` · повернено ${String(model.returned_units)} шт. на ${money(model.returned)}`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// How an entry's money moved, after its sum: «готівкою», «на картку».
function how(entry: Entry, method: PaymentMethod): string {
  return entry.kind === "RETURN" && isTillMethod(method)
    ? refundHow[method]
    : methodHow[method];
}

// The way as it was stated; a correction is a note beside it, never a
// rewrite (ADR-0012 §B11).
function wayText(entry: Entry): string {
  const stated =
    entry.payment_method === null
      ? ` · спосіб ${notStated}`
      : ` ${how(entry, entry.payment_method)}`;
  return entry.method_now
    ? `${stated} (виправлено: ${how(entry, entry.method_now)})`
    : stated;
}

function entryNote(entry: Entry, everyStore: boolean): string {
  if (entry.kind === "SALE") {
    const paid = entry.paid_in_parts
      ? `частинами, внесено ${money(entry.money)}${wayText(entry)}`
      : `оплачено повністю${wayText(entry)}`;
    return everyStore ? `${paid} · «${entry.store_name}»` : paid;
  }
  const handed =
    entry.money === "0.00"
      ? "лише зменшило борг"
      : `віддано ${money(entry.money)}${wayText(entry)}`;
  return entry.taken_at_store_id && entry.taken_at_store_id !== entry.store_id
    ? `${handed} · продав «${entry.store_name}», прийняв «${entry.taken_at_store_name ?? ""}»`
    : everyStore
      ? `${handed} · «${entry.store_name}»`
      : handed;
}

/**
 * A sale typed from paper (ADR-0013 §5.6): who sold and the paper's time,
 * from the mark, and who typed it, the entry's `by`. Its figures are the
 * day it was typed.
 */
function OutageLine({ entry }: { entry: Entry }): JSX.Element | null {
  const { outage } = entry;
  if (outage === undefined || outage === null) return null;
  return (
    <>
      <br />
      <small>
        {markText(outage)} · внесено: {entry.by}
      </small>
    </>
  );
}

function EntryList({
  entries,
  everyStore,
  offset,
  setOffset,
}: {
  entries: UseQueryResult<Entries>;
  everyStore: boolean;
  offset: number;
  setOffset: (offset: number) => void;
}): JSX.Element {
  return (
    <div className="section-block">
      <h3>Продажі й повернення</h3>
      {entries.isPending ? (
        <p role="status">Завантажуємо продажі…</p>
      ) : entries.error ? (
        <p role="alert">{errorText(entries.error)}</p>
      ) : entries.data.entries.length === 0 ? (
        <p className="hint">Ні продажів, ні повернень.</p>
      ) : (
        <>
          <ul className="nights" aria-label="Продажі й повернення">
            {entries.data.entries.map((entry) => (
              <li key={entry.id}>
                <strong>
                  {entry.kind === "SALE" ? "Продаж" : "Повернення"}{" "}
                  {entry.kind === "SALE"
                    ? money(entry.amount)
                    : minus(entry.amount)}
                </strong>{" "}
                <small>
                  {new Date(entry.at).toLocaleString("uk-UA", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}{" "}
                  · {entry.by}
                </small>
                <br />
                {entry.goods.join(", ")}
                <br />
                <small>{entryNote(entry, everyStore)}</small>
                <OutageLine entry={entry} />
              </li>
            ))}
          </ul>
          <div className="toolbar">
            <button
              className="quiet"
              disabled={offset === 0}
              onClick={() => {
                setOffset(Math.max(0, offset - 50));
              }}
            >
              Попередні
            </button>
            <button
              className="quiet"
              disabled={!entries.data.has_more}
              onClick={() => {
                setOffset(offset + 50);
              }}
            >
              Наступні
            </button>
          </div>
        </>
      )}
    </div>
  );
}
