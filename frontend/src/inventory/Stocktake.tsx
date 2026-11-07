import { useEffect, useId, useRef, useState } from "react";
import type { JSX, RefObject } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  InfiniteData,
  UseInfiniteQueryResult,
} from "@tanstack/react-query";
import {
  api,
  ApiError,
  errorText,
  inOwnWords,
  isConflict,
  recordedNothing,
} from "@/shared/api";
import { Back } from "@/shared/Back";
import { Eyelet, RecordedMark } from "@/shared/Eyelet";
import { Icon } from "@/shared/Icon";
import { Keypad } from "@/shared/Keypad";
import { ModeSwitch } from "@/shared/ModeSwitch";
import { CARRIED_TAP, usePanelRoom } from "@/shared/panel";
import { Placeholder } from "@/shared/Placeholder";
import { ScreenHeader } from "@/shared/ScreenHeader";
import { Sheet } from "@/shared/Sheet";
import { Stub } from "@/shared/Stub";
import {
  buzz,
  useAskBeforeClosing,
  useLockPortrait,
  useMainButton,
} from "@/shared/telegram";
import { Toast } from "@/shared/Toast";
import { Unread } from "@/shared/Unread";
import { visible } from "@/shared/visible";
import { keptUnconfirmed, twiceOf } from "@/cash/errors";
import { shortDay, shortTime } from "@/credits/format";
import type { Location, Store } from "@/orders/types";
import { CatalogPicker } from "./CatalogPicker";
import { submitCount, useCountCommand } from "./stocktakeCommands";
import type {
  CountResult,
  LastCount,
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
 *
 * Drawn in the tag's system in stage 2 (goods task list, P0-2, P0-3): the
 * open one a tag, its start and its end a sheet, the history a thread, the
 * positions a tag a model whose cells open the count's sheet.
 */

const pageSize = 50;

/** The entry's history: the last three, and «Ще N» for the rest (spec
 * §6.21; goods task list, P0-2). */
const HISTORY = 3;

/** A result's differences: five, and «Ще N» for the rest (P0-2). */
const FOLDED = 5;

type Page = { items: StocktakePosition[]; has_more: boolean };

function signed(delta: number): string {
  return delta > 0 ? `+${String(delta)}` : `−${String(Math.abs(delta))}`;
}

/** «1 позиція», «2 позиції», «5 позицій». */
function positionsOf(count: number): string {
  const tens = count % 100;
  const ones = count % 10;
  const word =
    tens >= 11 && tens <= 14
      ? "позицій"
      : ones === 1
        ? "позиція"
        : ones >= 2 && ones <= 4
          ? "позиції"
          : "позицій";
  return `${String(count)} ${word}`;
}

function sameDay(iso: string, now: Date): boolean {
  return new Date(iso).toDateString() === now.toDateString();
}

/** «10:20» today, «06.11, 10:20» another day. */
function when(iso: string, now = new Date()): string {
  return sameDay(iso, now)
    ? shortTime(iso)
    : `${shortDay(iso, now)}, ${shortTime(iso)}`;
}

/** «о 10:20» today, «06.11 о 10:20» another day. */
function since(iso: string, now = new Date()): string {
  return sameDay(iso, now)
    ? `о ${shortTime(iso)}`
    : `${shortDay(iso, now)} о ${shortTime(iso)}`;
}

/** «нестача 2 шт. · надлишок 1 шт.», or «розбіжностей немає». */
function differencesOf(sums: StocktakeSums): string {
  const parts = [
    ...(sums.shortage_units > 0
      ? [`нестача ${String(sums.shortage_units)} шт.`]
      : []),
    ...(sums.surplus_units > 0
      ? [`надлишок ${String(sums.surplus_units)} шт.`]
      : []),
  ];
  return parts.length > 0 ? parts.join(" · ") : "розбіжностей немає";
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A finished one in the history: «Нестача 2 шт. · надлишок 1 шт. · не
 * перевірено 140». */
function historyText(sums: StocktakeSums): string {
  return capital(
    [
      differencesOf(sums),
      ...(sums.unchecked_positions > 0
        ? [`не перевірено ${String(sums.unchecked_positions)}`]
        : []),
    ].join(" · "),
  );
}

function differs(sums: StocktakeSums): boolean {
  return sums.shortage_units + sums.surplus_units > 0;
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
    return `Цей товар уже є в обліку цього складу: ${String(details.actual)} шт. Перерахуйте його й введіть кількість ще раз.${after}`;
  if (error.code === "STOCK_CHANGED" && typeof details.actual === "number")
    return `Поки ви рахували, облік змінився: було ${String(details.expected)}, тепер ${String(details.actual)}. Перерахуйте цей товар і введіть кількість ще раз.${after}`;
  if (error.code === "STOCKTAKE_FINISHED")
    return `Цю інвентаризацію вже завершили. Щоб рахувати далі, почніть нову.${after}`;
  if (details.reason === "RESERVED" && typeof details.reserved === "number")
    return `На цей товар є резерв замовлення (${String(details.reserved)} шт.). Якщо кількість не збігається, виправити облік можна після видачі або скасування замовлення.${after}`;
  if (error.status === 422 && typeof details.size_id === "string")
    return `Облік товару з невідомим розміром можна лише зменшити.${after}`;
  return `${inOwnWords(
    errorText(error),
    "Перевірте кількість та спробуйте ще раз.",
    "Облік змінився — перерахуйте товар і спробуйте ще раз.",
  )}${after}`;
}

/** What App says of a kept count once it is settled as refused. */
export function countErrorText(error: unknown, misses = 0): string {
  if (!recordedNothing(error) || !(error instanceof ApiError))
    return (
      keptUnconfirmed(error, "Підрахунок", twiceOf("він"), misses) ??
      errorText(error)
    );
  return `Підрахунок не записано. ${countRefusalText(error, "")}`;
}

/** One position as the count's sheet takes it. */
interface Target {
  key: string;
  product_variant_id: string;
  size_id: string;
  name: string;
  size: string;
  sizeIsUnknown: boolean;
  /** The balance the count is made against. */
  quantity: number;
  /** What orders hold of it. */
  reserved: number;
}

function keyOf(item: { product_variant_id: string; size_id: string }): string {
  return `${item.product_variant_id}:${item.size_id}`;
}

function targetOf(position: StocktakePosition): Target {
  return {
    key: keyOf(position),
    product_variant_id: position.product_variant_id,
    size_id: position.size_id,
    name: position.display_name,
    size: position.size_label,
    sizeIsUnknown: position.size_is_unknown,
    quantity: position.quantity,
    reserved: position.reserved_quantity,
  };
}

function sizeWord(target: Target): string {
  return target.sizeIsUnknown ? "розмір невідомий" : visible(target.size);
}

/** «облік 5 → 3 (−2)», or «збігається з обліком (5)». */
function resultWords(result: CountResult): string {
  return result.quantity_delta === 0
    ? `збігається з обліком (${String(result.counted_quantity)})`
    : `облік ${String(result.quantity_before)} → ${String(result.counted_quantity)} (${signed(result.quantity_delta)})`;
}

/** A position counted, in «Пораховані»: «3 → 1 (−2)» — from what it was
 * before the stocktake changed it — or «3, збігається». */
function countedWords(count: LastCount): string {
  return count.net_delta === 0
    ? `${String(count.counted_quantity)}, збігається`
    : `${String(count.counted_quantity - count.net_delta)} → ${String(count.counted_quantity)} (${signed(count.net_delta)})`;
}

/** A list's pages, each position once: a page read after another moved
 * may show one again. */
function itemsOf(data: InfiniteData<Page> | undefined): StocktakePosition[] {
  const seen = new Set<string>();
  const items: StocktakePosition[] = [];
  for (const page of data?.pages ?? [])
    for (const item of page.items) {
      const key = keyOf(item);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  return items;
}

/** A stocktake's positions, fifty at a time, each next page read under
 * those read; read again whole, from the top, as positions leave. */
function usePositions(
  store: Store,
  token: string,
  scopeKey: string,
  stocktakeId: string,
  state: "uncounted" | "counted" | "differences",
  enabled = true,
): UseInfiniteQueryResult<InfiniteData<Page>> {
  return useInfiniteQuery({
    queryKey:
      state === "differences"
        ? ["stocktake-differences", scopeKey, stocktakeId]
        : ["stocktake-positions", scopeKey, stocktakeId, state],
    queryFn: ({ pageParam }) =>
      api<Page>(
        `/stocktakes/${stocktakeId}/positions?store_id=${store.id}&state=${state}&limit=${String(pageSize)}&offset=${String(pageParam)}`,
        token,
      ),
    initialPageParam: 0,
    getNextPageParam: (last, _all, lastParam) =>
      last.has_more ? lastParam + last.items.length : undefined,
    retry: false,
    enabled,
  });
}

/** A model's tag of positions not counted: its sizes in the order of the
 * organization's sizes where it is read, else as the server gave them. */
interface Card {
  variantId: string;
  name: string;
  cells: Target[];
}

/** The server's positions, a model's next to each other, glued into one
 * tag a model (В-Г5 (а): no change on the server). */
function cardsOf(
  items: StocktakePosition[],
  order: SizeOption[] | undefined,
): Card[] {
  const byModel = new Map<string, Card>();
  for (const item of items) {
    const card = byModel.get(item.product_variant_id) ?? {
      variantId: item.product_variant_id,
      name: item.display_name,
      cells: [],
    };
    card.cells.push(targetOf(item));
    byModel.set(item.product_variant_id, card);
  }
  if (order) {
    const rank = new Map(order.map((size, at) => [size.size_id, at]));
    for (const card of byModel.values())
      card.cells.sort(
        (a, b) =>
          (rank.get(a.size_id) ?? Infinity) - (rank.get(b.size_id) ?? Infinity),
      );
  }
  return [...byModel.values()];
}

/** The warehouse's stocktakes (goods task list, P0-2): the open one a tag
 * with «Продовжити»; none open, Telegram's MainButton «Почати
 * інвентаризацію» and its sheet; under them the finished ones as a thread. */
export function Stocktakes({
  store,
  token,
  scopeKey,
  blocked,
  location,
  onCount,
}: {
  store: Store;
  token: string;
  scopeKey: string;
  blocked: boolean;
  location: Location;
  onCount: (record: StocktakeRecord) => void;
}): JSX.Element {
  const [asking, setAsking] = useState(false);
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
  // None open: the screen's one action, Telegram's — set on entry, gone as
  // the person leaves or one is open (spec §6.4).
  const startable = list.isSuccess && open === undefined;
  const ask = (): void => {
    if (!blocked) setAsking(true);
  };
  const main = useMainButton("Почати інвентаризацію", ask, {
    shown: startable,
    active: !blocked,
  });
  const dock = useRef<HTMLDivElement>(null);
  usePanelRoom(dock, startable && !main);
  const opener = useRef<HTMLButtonElement>(null);

  return (
    // Its heading is the screen's own title, «Інвентаризація» (sections
    // task list, P1-5).
    <section aria-label="Інвентаризація складу" className="stocktakes">
      {list.isPending ? (
        <p role="status">Завантажуємо інвентаризації…</p>
      ) : list.isError ? (
        <Unread
          error={list.error}
          retry={() => {
            void list.refetch();
          }}
        />
      ) : (
        <>
          {open && (
            <OpenTag
              record={open}
              blocked={blocked}
              verb={opener}
              onCount={() => {
                onCount(open);
              }}
            />
          )}
          <History
            store={store}
            token={token}
            scopeKey={scopeKey}
            finished={finished}
          />
        </>
      )}
      {startable && !main && (
        // Outside Telegram, its MainButton as the dock's one button.
        <div className="pay-panel order-dock" ref={dock}>
          <button
            ref={opener}
            type="button"
            className="main-mimic"
            aria-haspopup="dialog"
            disabled={blocked}
            onClick={ask}
          >
            Почати інвентаризацію
          </button>
        </div>
      )}
      {asking && (
        <StartSheet
          store={store}
          token={token}
          location={location}
          held={blocked}
          fallback={opener}
          started={(record) => {
            setAsking(false);
            void list.refetch();
            onCount(record);
          }}
          conflict={() => {
            void list.refetch();
          }}
          close={() => {
            setAsking(false);
          }}
        />
      )}
    </section>
  );
}

/** The open stocktake (spec §6.9): its eyelet live, since when and who
 * began it, what is counted so far, and «Продовжити». */
function OpenTag({
  record,
  blocked,
  verb,
  onCount,
}: {
  record: StocktakeRecord;
  blocked: boolean;
  /** Where the start's sheet sends the cursor back when a start refused as
   * one is open shows this tag in place of «Почати інвентаризацію»
   * (review, 2026-11-07). */
  verb: RefObject<HTMLButtonElement>;
  onCount: () => void;
}): JSX.Element {
  const title = useId();
  return (
    <article
      className="today-tag tag-row tag-outline tone-live stocktake-open"
      aria-labelledby={title}
    >
      <div className="today-tag-body">
        <span className="today-tag-eyelet" aria-hidden="true" />
        <h2 id={title} className="t-row today-tag-title">
          <Icon name="stocktake" size={16} />
          <span>
            Триває з {when(record.started_at)} · {visible(record.started_by)}
          </span>
        </h2>
        <p className="t-meta today-tag-meta">
          Пораховано {record.sums.counted_positions} ·{" "}
          {differencesOf(record.sums)}
        </p>
        <button
          ref={verb}
          type="button"
          className="tag-verb"
          disabled={blocked}
          onClick={() => {
            // A tag's verb, felt (spec §6.9).
            buzz("light");
            onCount();
          }}
        >
          Продовжити
        </button>
      </div>
    </article>
  );
}

/**
 * «Почати інвентаризацію складу «…»?» (P0-2): what it means, as it was
 * said, and Telegram's MainButton «Почати» — outside Telegram, the sheet's
 * own. A press sooner than `CARRIED_TAP` after it opened was meant for
 * «Почати інвентаризацію», which stood where «Почати» stands: let go.
 * Started, it buzzes and the count opens at once.
 */
function StartSheet({
  store,
  token,
  location,
  held,
  fallback,
  started,
  conflict,
  close,
}: {
  store: Store;
  token: string;
  location: Location;
  held: boolean;
  fallback: RefObject<HTMLElement>;
  started: (record: StocktakeRecord) => void;
  conflict: () => void;
  close: () => void;
}): JSX.Element {
  const [openedAt] = useState(() => performance.now());
  const [starting, setStarting] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  async function start(): Promise<void> {
    if (held || starting || performance.now() - openedAt < CARRIED_TAP) return;
    setStarting(true);
    setFailure(null);
    try {
      const record = await api<StocktakeRecord>("/stocktakes", token, {
        store_id: store.id,
        location_id: location.id,
      });
      buzz("success");
      if (live.current) started(record);
    } catch (error) {
      buzz("error");
      if (isConflict(error)) conflict();
      if (live.current) setFailure(error);
    } finally {
      if (live.current) setStarting(false);
    }
  }
  const press = (): void => {
    void start();
  };
  const main = useMainButton("Почати", press, {
    progress: starting,
    active: !held,
  });
  return (
    <Sheet
      title={`Почати інвентаризацію складу «${visible(location.name)}»?`}
      close={() => {
        if (!starting) close();
      }}
      fallback={fallback}
      foot={
        <div className="count-foot">
          {!main && (
            <button
              type="button"
              className="sheet-done main-mimic"
              disabled={held}
              aria-disabled={starting || undefined}
              onClick={press}
            >
              {starting ? (
                <>
                  <Eyelet state="spin" size={20} />
                  <span className="visually-hidden">Почати</span>
                </>
              ) : (
                "Почати"
              )}
            </button>
          )}
          <button
            type="button"
            className="quiet"
            disabled={starting}
            onClick={close}
          >
            Скасувати
          </button>
        </div>
      }
    >
      <p>
        Склад продає далі. Кожну позицію звіряють з обліком, коли її записують:
        якщо її тим часом продали чи прийняли, система попросить перерахувати
        лише її. Те, що не порахують, лишиться як є. Кожна різниця одразу змінює
        облік.
      </p>
      {failure !== null && (
        <p role="alert">
          {inOwnWords(
            errorText(failure),
            "Інвентаризацію не почато. Спробуйте ще раз.",
            "Інвентаризацію не почато: дані складу змінилися — перегляньте їх і спробуйте ще раз.",
          )}
        </p>
      )}
    </Sheet>
  );
}

/** «Попередні» (spec §6.21): the day on the left, a knot each, what it
 * found and who finished it; the last three, and «Ще N». */
function History({
  store,
  token,
  scopeKey,
  finished,
}: {
  store: Store;
  token: string;
  scopeKey: string;
  finished: StocktakeRecord[];
}): JSX.Element | null {
  const [all, setAll] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  if (finished.length === 0) return null;
  const rows = all ? finished : finished.slice(0, HISTORY);
  return (
    <>
      <h2 className="t-label customer-history-title">Попередні</h2>
      <ul
        className="timeline stocktake-history"
        aria-label="Попередні інвентаризації"
      >
        {rows.map((record) => {
          const at = record.finished_at ?? record.started_at;
          return (
            <li className="timeline-row" key={record.id}>
              <span className="timeline-day">{shortDay(at)}</span>
              <span className="timeline-node knot" aria-hidden="true" />
              <div className="timeline-main">
                <span className="timeline-what">
                  {historyText(record.sums)}
                </span>
                <span className="timeline-meta">
                  {visible(record.finished_by ?? "")} · {shortTime(at)}
                </span>
                {differs(record.sums) &&
                  (shown === record.id ? (
                    <Differences
                      store={store}
                      token={token}
                      scopeKey={scopeKey}
                      stocktakeId={record.id}
                      total={
                        record.sums.shortage_positions +
                        record.sums.surplus_positions
                      }
                    />
                  ) : (
                    <button
                      type="button"
                      className="quiet stocktake-show"
                      onClick={() => {
                        setShown(record.id);
                      }}
                    >
                      Показати розбіжності
                    </button>
                  ))}
              </div>
            </li>
          );
        })}
      </ul>
      {!all && finished.length > HISTORY && (
        <button
          type="button"
          className="today-more"
          onClick={() => {
            setAll(true);
          }}
        >
          Ще {finished.length - HISTORY}
        </button>
      )}
    </>
  );
}

/** Where a finished stocktake found the shelf and the balance apart: five,
 * and «Ще N» for the rest of `total`. */
function Differences({
  store,
  token,
  scopeKey,
  stocktakeId,
  total,
}: {
  store: Store;
  token: string;
  scopeKey: string;
  stocktakeId: string;
  total: number;
}): JSX.Element {
  const [folded, setFolded] = useState(true);
  const pages = usePositions(
    store,
    token,
    scopeKey,
    stocktakeId,
    "differences",
  );
  if (pages.isPending) return <p role="status">Завантажуємо розбіжності…</p>;
  if (pages.isError)
    return (
      <Unread
        error={pages.error}
        retry={() => {
          void pages.refetch();
        }}
      />
    );
  const items = itemsOf(pages.data);
  const shown = folded ? items.slice(0, FOLDED) : items;
  return (
    <>
      <ul className="stocktake-differences" aria-label="Розбіжності">
        {shown.map((item) => (
          <li key={keyOf(item)}>
            {visible(item.display_name)} · {sizeWord(targetOf(item))} —{" "}
            {item.count ? signed(item.count.net_delta) : ""} шт.
            {item.count
              ? ` (пораховано ${String(item.count.counted_quantity)}, ${visible(item.count.counted_by)})`
              : ""}
          </li>
        ))}
      </ul>
      {folded && total > FOLDED ? (
        <button
          type="button"
          className="quiet"
          onClick={() => {
            setFolded(false);
          }}
        >
          Ще {total - FOLDED}
        </button>
      ) : (
        pages.hasNextPage && (
          <button
            type="button"
            className="quiet"
            disabled={pages.isFetching}
            onClick={() => {
              void pages.fetchNextPage();
            }}
          >
            Показати ще
          </button>
        )
      )}
    </>
  );
}

/** What the count's sheet counts: a model's cells, from the one tapped. */
interface Counting {
  targets: readonly [Target, ...Target[]];
  at: number;
  /** Goods found that the list did not show: their form goes with it. */
  found: boolean;
  /** A new sheet each time it opens. */
  times: number;
}

/**
 * Counting, a task's screen of its own (goods task list, P0-3): the menu
 * steps aside and the phone is kept upright; «Інвентаризація · «…»» over
 * «Почато о 10:20 · Тетяна», «←» back to the entry and a quiet «Завершити»
 * — never Telegram's MainButton, so it does not draw a finish too soon.
 * «Не пораховані · Пораховані»: a tag a model, its cells opening the
 * count's sheet; the positions counted, newest first, each «Перерахувати».
 * Finished: the stub, its sums and differences, and «До інвентаризації».
 */
export function Stocktake({
  store,
  token,
  scopeKey,
  journalKey,
  blocked,
  location,
  record,
  onLeave,
  task,
}: {
  store: Store;
  token: string;
  scopeKey: string;
  journalKey: string;
  blocked: boolean;
  location: Location;
  record: StocktakeRecord;
  onLeave: () => void;
  /** The menu steps aside while it stands (spec §5). */
  task?: ((shown: boolean) => void) | undefined;
}): JSX.Element {
  const cache = useQueryClient();
  const [mode, setMode] = useState<"uncounted" | "counted">("uncounted");
  const [finding, setFinding] = useState(false);
  const [asked, setAsked] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [done, setDone] = useState<StocktakeRecord | null>(null);
  const [counting, setCounting] = useState<Counting | null>(null);
  // What was recorded last: in the sheet while it counts on, a toast once
  // it has closed by itself (spec §6.23).
  const [told, setTold] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; times: number } | null>(
    null,
  );
  const canReceive = store.permissions.includes("inventory:receive");
  const current = useQuery({
    queryKey: ["stocktake", scopeKey, record.id],
    queryFn: () =>
      api<StocktakeRecord>(
        `/stocktakes/${record.id}?store_id=${store.id}`,
        token,
      ),
    retry: false,
  });
  const uncounted = usePositions(
    store,
    token,
    scopeKey,
    record.id,
    "uncounted",
    mode === "uncounted" && done === null,
  );
  const counted = usePositions(
    store,
    token,
    scopeKey,
    record.id,
    "counted",
    mode === "counted" && done === null,
  );
  // The organization's order of sizes is receiving's to read; without it,
  // as the server gave them (P0-3).
  const sizes = useQuery({
    queryKey: ["receive-sizes", scopeKey, store.id],
    queryFn: () =>
      api<SizeOption[]>(`/catalog/sizes?store_id=${store.id}`, token),
    enabled: canReceive,
    retry: false,
  });
  const shown = done ?? current.data ?? record;
  const heading = useRef<HTMLHeadingElement>(null);
  const result = useRef<HTMLHeadingElement>(null);
  const finder = useRef<HTMLButtonElement>(null);
  // The sheet gone by itself after a model's last cell: the model's tag goes
  // as the list is read again, and with it the cell the cursor went back
  // to — or the cursor went to the title, the cell tapped gone with its
  // own count. Then the cursor goes to the next model's first cell, or
  // stays on the title, none left (review, 2026-11-07).
  const refocus = useRef<{ gone: string; next: string | null } | null>(null);
  useEffect(() => {
    const wanted = refocus.current;
    if (wanted === null || counting !== null) return;
    if (document.querySelector(`[data-model="${wanted.gone}"]`)) return;
    refocus.current = null;
    const at = document.activeElement;
    if (
      at !== null &&
      at !== document.body &&
      at !== heading.current &&
      at.isConnected
    )
      return;
    const next =
      wanted.next === null
        ? null
        : document.querySelector<HTMLElement>(
            `[data-model="${wanted.next}"] .count-cell`,
          );
    if (next) next.focus();
    else heading.current?.focus({ preventScroll: true });
  });
  // «До інвентаризації» stands where «Так, завершити» was pressed: the
  // press's second tap, landing on it, is let go (review, 2026-11-07).
  const doneAt = useRef(-Infinity);
  const late = (at: number): boolean => at - doneAt.current < CARRIED_TAP;

  useEffect(() => {
    task?.(true);
    return () => {
      task?.(false);
    };
  }, [task]);
  useLockPortrait(done === null);
  // Opened from the entry: the count begins at its top, and a reader at its
  // title — the tag or the button that opened it is gone.
  useEffect(() => {
    window.scrollTo(0, 0);
    heading.current?.focus();
  }, []);
  useEffect(() => {
    if (!done) return;
    window.scrollTo(0, 0);
    result.current?.focus();
  }, [done]);
  // Finished: the stub's one way on, Telegram's.
  const leave = useMainButton(
    "До інвентаризації",
    () => {
      if (!late(performance.now())) onLeave();
    },
    { shown: done !== null },
  );
  const dock = useRef<HTMLDivElement>(null);
  usePanelRoom(dock, done !== null && !leave);

  function reread(): void {
    void current.refetch();
    void cache.invalidateQueries({
      queryKey: ["stocktake-positions", scopeKey, record.id],
    });
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
      buzz("success");
      doneAt.current = performance.now();
      setAsked(false);
      setDone(finished);
    } catch (error) {
      buzz("error");
      if (isConflict(error)) void current.refetch();
      setFailure(error);
    } finally {
      setFinishing(false);
    }
  }

  function count(targets: Target[], at: number, found = false): void {
    const [first, ...rest] = targets;
    if (!first) return;
    setTold(null);
    // A toast of the last sheet is gone with the next: never back after it
    // (review, 2026-11-07).
    setToast(null);
    setCounting((was) => ({
      targets: [first, ...rest],
      at,
      found,
      times: (was?.times ?? 0) + 1,
    }));
  }

  if (done) {
    return (
      <>
        <ScreenHeader
          ref={result}
          focusable
          className="result-title t-sheet"
          title={
            <>
              <RecordedMark />
              Інвентаризацію завершено
            </>
          }
          context={`Склад «${visible(location.name)}» · ${visible(done.finished_by ?? "")}`}
        />
        <section
          className="stocktake-done"
          aria-label="Інвентаризацію завершено"
        >
          <Stub state="settled">
            <p className="stub-line">
              <strong>Пораховано позицій: {done.sums.counted_positions}</strong>
            </p>
            {done.sums.shortage_units > 0 && (
              <p className="stub-line">
                Нестача {done.sums.shortage_units} шт. ·{" "}
                {positionsOf(done.sums.shortage_positions)}
              </p>
            )}
            {done.sums.surplus_units > 0 && (
              <p className="stub-line">
                Надлишок {done.sums.surplus_units} шт. ·{" "}
                {positionsOf(done.sums.surplus_positions)}
              </p>
            )}
            {!differs(done.sums) && (
              <p className="stub-line">Розбіжностей немає</p>
            )}
            {done.sums.unchecked_positions > 0 && (
              <p className="t-meta">
                Не перевірено позицій: {done.sums.unchecked_positions} — їхні
                залишки не змінювались.
              </p>
            )}
            {differs(done.sums) && (
              <Differences
                store={store}
                token={token}
                scopeKey={scopeKey}
                stocktakeId={done.id}
                total={
                  done.sums.shortage_positions + done.sums.surplus_positions
                }
              />
            )}
          </Stub>
          {!leave && (
            // Outside Telegram, its MainButton as the dock's one button.
            <div className="pay-panel order-dock" ref={dock}>
              <button
                type="button"
                className="main-mimic"
                onClick={(event) => {
                  // A key's press is never one.
                  if (event.detail !== 0 && late(event.timeStamp)) return;
                  onLeave();
                }}
              >
                До інвентаризації
              </button>
            </div>
          )}
        </section>
      </>
    );
  }

  const list = mode === "uncounted" ? uncounted : counted;
  const items = itemsOf(list.data);
  // A position the sheet counts, as read now: a balance read again is the
  // one counted against (review, 2026-10-10).
  const known = new Map(items.map((item) => [keyOf(item), item]));
  const fresh = (target: Target): Target => {
    const item = known.get(target.key);
    return item ? targetOf(item) : target;
  };
  const targets: readonly [Target, ...Target[]] | null = counting
    ? [fresh(counting.targets[0]), ...counting.targets.slice(1).map(fresh)]
    : null;
  const cards =
    mode === "uncounted"
      ? cardsOf(items, canReceive ? sizes.data : undefined)
      : [];
  const waiting =
    list.isPending || (mode === "uncounted" && canReceive && sizes.isPending);

  return (
    <>
      <ScreenHeader
        ref={heading}
        focusable
        wraps
        title={`Інвентаризація · «${visible(location.name)}»`}
        context={`Почато ${since(shown.started_at)} · ${visible(shown.started_by)}`}
        back={
          <Back go={onLeave} label="Назад до інвентаризації">
            <span aria-hidden="true">← </span>Інвентаризація
          </Back>
        }
        aside={
          <button
            type="button"
            className="quiet"
            aria-haspopup="dialog"
            disabled={blocked}
            onClick={() => {
              void current.refetch();
              setFailure(null);
              setAsked(true);
            }}
          >
            Завершити
          </button>
        }
      />
      <section className="stocktake" aria-label="Інвентаризація">
        <ModeSwitch
          label="Які позиції"
          filters
          className="stocktake-modes"
          modes={[
            {
              mode: "uncounted",
              label: `Не пораховані ${String(shown.sums.unchecked_positions)}`,
            },
            {
              mode: "counted",
              label: `Пораховані ${String(shown.sums.counted_positions)}`,
            },
          ]}
          current={mode}
          choose={setMode}
          disabled={false}
        />
        {waiting ? (
          <Placeholder
            said="Завантажуємо позиції…"
            {...(mode === "uncounted" ? { tags: 2 } : { rows: 3, day: false })}
          />
        ) : list.isError ? (
          <Unread error={list.error} retry={reread} />
        ) : items.length === 0 ? (
          <p className="stocktake-empty">
            {mode === "uncounted"
              ? "Усі позиції з залишком пораховано."
              : "Ще нічого не пораховано."}
          </p>
        ) : mode === "uncounted" ? (
          <div className="tags">
            {cards.map((card) => (
              <CountCard
                key={card.variantId}
                card={card}
                disabled={blocked}
                pick={(at) => {
                  count(card.cells, at);
                }}
              />
            ))}
          </div>
        ) : (
          <ul className="counted-rows" aria-label="Пораховані позиції">
            {items.map(
              (item) =>
                item.count && (
                  <CountedRow
                    key={keyOf(item)}
                    position={item}
                    count={item.count}
                    disabled={blocked}
                    recount={() => {
                      count([targetOf(item)], 0);
                    }}
                  />
                ),
            )}
          </ul>
        )}
        {list.hasNextPage && !waiting && !list.isError && (
          // A next page asked while the list is read again from its top
          // would cancel that read and be read from where the old pages
          // ended, past a position that moved up (review, 2026-11-07).
          <button
            type="button"
            className="quiet stocktake-more"
            disabled={list.isFetching}
            onClick={() => {
              void list.fetchNextPage();
            }}
          >
            Показати ще
          </button>
        )}
        {finding ? (
          <FoundGoods
            store={store}
            token={token}
            scopeKey={scopeKey}
            disabled={blocked}
            pick={(target) => {
              count([target], 0, true);
            }}
            onCancel={() => {
              setFinding(false);
            }}
          />
        ) : (
          <button
            ref={finder}
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
      </section>
      {counting && targets && (
        <CountSheet
          key={counting.times}
          store={store}
          token={token}
          journalKey={journalKey}
          blocked={blocked}
          stocktakeId={record.id}
          place={location.name}
          targets={targets}
          start={counting.at}
          told={told}
          // Goods found: their form goes with the sheet, and the cursor to
          // «Знайшли товар…» in its place, never the title far above.
          fallback={counting.found ? finder : heading}
          left={(key) => mode !== "uncounted" || known.has(key)}
          counted={(answer, target, last) => {
            const said = `Записано: ${visible(target.name)} · ${sizeWord(target)} — ${resultWords(answer)}`;
            reread();
            if (last && !counting.found && mode === "uncounted") {
              const at = cards.findIndex(
                (card) => card.variantId === target.product_variant_id,
              );
              const next = cards[at + 1] ?? cards[at - 1];
              refocus.current = {
                gone: target.product_variant_id,
                next: next?.variantId ?? null,
              };
            }
            if (last) {
              if (counting.found) setFinding(false);
              setCounting(null);
              setTold(null);
              setToast((was) => ({
                text: said,
                times: (was?.times ?? 0) + 1,
              }));
            } else setTold(said);
          }}
          refused={reread}
          unknown={() => {
            // The kept count is App's stub, over the screen: the sheet goes.
            setCounting(null);
            setTold(null);
          }}
          close={() => {
            setCounting(null);
            setTold(null);
          }}
        />
      )}
      {asked && (
        <FinishSheet
          location={location}
          sums={shown.sums}
          held={blocked}
          finishing={finishing}
          failure={failure}
          fallback={heading}
          finish={() => {
            void finish();
          }}
          close={() => {
            setAsked(false);
          }}
        />
      )}
      {toast && counting === null && (
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

/** A model's tag of positions not counted (spec §6.12): its name, and a
 * cell a size. */
function CountCard({
  card,
  disabled,
  pick,
}: {
  card: Card;
  disabled: boolean;
  pick: (at: number) => void;
}): JSX.Element {
  return (
    <div
      className="model-tag tag-row tag-outline"
      role="group"
      aria-label={visible(card.name)}
      data-model={card.variantId}
    >
      <div className="model-tag-in">
        <p className="model-head">
          <strong className="model-name">{visible(card.name)}</strong>
        </p>
        <div className="cells">
          {card.cells.map((cell, at) => (
            <CountCell
              key={cell.key}
              cell={cell}
              disabled={disabled}
              pick={() => {
                pick(at);
              }}
            />
          ))}
        </div>
        {card.cells.some((cell) => cell.sizeIsUnknown) && (
          <p className="cell-note" aria-hidden="true">
            ? — розмір невідомий
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * A size to count (spec §6.13): its letter large — «?» where it is not
 * known — and under it what the ledger holds, «в обліку 3»; what orders
 * hold is the pin badge. Read aloud in one go: «M, в обліку 3, у резерві
 * 1». A tap opens the count's sheet.
 */
function CountCell({
  cell,
  disabled,
  pick,
}: {
  cell: Target;
  disabled: boolean;
  pick: () => void;
}): JSX.Element {
  const said = [
    sizeWord(cell),
    `в обліку ${String(cell.quantity)}`,
    ...(cell.reserved > 0 ? [`у резерві ${String(cell.reserved)}`] : []),
  ].join(", ");
  return (
    <button
      type="button"
      className="size-cell count-cell"
      aria-label={said}
      aria-haspopup="dialog"
      data-position={cell.key}
      disabled={disabled}
      onClick={() => {
        // A cell chosen, felt (spec §6.9).
        buzz("selection");
        pick();
      }}
    >
      <span className="size-letter">
        {cell.sizeIsUnknown ? "?" : visible(cell.size)}
      </span>
      <span className="size-free">в обліку {cell.quantity}</span>
      {cell.reserved > 0 && (
        <span className="size-held">
          <Icon name="held" size={12} />
          {cell.reserved}
        </span>
      )}
    </button>
  );
}

/** A position counted (P0-3): «Марсель · M — 3 → 1 (−2)», who and when,
 * and «Перерахувати» in the same sheet. */
function CountedRow({
  position,
  count,
  disabled,
  recount,
}: {
  position: StocktakePosition;
  count: LastCount;
  disabled: boolean;
  recount: () => void;
}): JSX.Element {
  const what = `${visible(position.display_name)} · ${sizeWord(targetOf(position))}`;
  return (
    <li className="counted-row">
      <div className="counted-main">
        <p className="t-row counted-what">
          {what} — {countedWords(count)}
        </p>
        <p className="t-meta">
          {visible(count.counted_by)}, {when(count.counted_at)}
        </p>
      </div>
      <button
        type="button"
        className="tag-verb"
        aria-label={`Перерахувати: ${what}`}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={recount}
      >
        Перерахувати
      </button>
    </li>
  );
}

/** The next cell of the model not yet counted — in this sheet, or by
 * anyone as the list was last read — round from the one counted; none,
 * and the sheet closes. */
function nextOf(
  targets: readonly Target[],
  at: number,
  recorded: ReadonlySet<string>,
  left: (key: string) => boolean,
): number | null {
  for (let step = 1; step < targets.length; step += 1) {
    const next = (at + step) % targets.length;
    const target = targets[next];
    if (target && !recorded.has(target.key) && left(target.key)) return next;
  }
  return null;
}

/**
 * The count's sheet (P0-3): «Марсель молочний · M», «В обліку 3 · склад
 * «Основний»», what orders hold, and the app's keypad for pieces —
 * «Фактично, шт.», the phone's keyboard never open — with the line «3 → 1 ·
 * −2» as it is typed and Telegram's MainButton «Записати · 1 шт.». Telegram
 * asks before Бірка closes while a number is typed. Recorded, it buzzes
 * lightly and goes to the model's next cell not counted, until none is
 * left; refused, it buzzes a warning and stays, the keypad empty, saying
 * why. A count equal to the balance is recorded as checked. Each count is
 * one command, applied at once; never several sizes in one press.
 */
function CountSheet({
  store,
  token,
  journalKey,
  blocked,
  stocktakeId,
  place,
  targets,
  start,
  told,
  fallback,
  left,
  counted,
  refused,
  unknown,
  close,
}: {
  store: Store;
  token: string;
  journalKey: string;
  blocked: boolean;
  stocktakeId: string;
  place: string;
  targets: readonly [Target, ...Target[]];
  start: number;
  /** What was recorded last in it: «Записано: … · M — облік 3 → 1 (−2)». */
  told: string | null;
  fallback: RefObject<HTMLElement>;
  /** Whether a position is still to count, as the list was last read. */
  left: (key: string) => boolean;
  /** Recorded; `last` when no cell of it is left, and the sheet goes. */
  counted: (result: CountResult, target: Target, last: boolean) => void;
  refused: () => void;
  /** Its outcome lost: kept on the phone, App's to check. */
  unknown: () => void;
  close: () => void;
}): JSX.Element {
  const [at, setAt] = useState(start);
  const [recorded, setRecorded] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [count, setCount] = useState("");
  const [refusal, setRefusal] = useState("");
  // Where the count is judged from: what the cell showed, or what the server
  // saw under its lock when it refused a count made against that — but only
  // while the cell still shows the balance it replaced. Read again, the cell
  // is the newer (review, 2026-10-10).
  const [moved, setMoved] = useState<{
    key: string;
    shown: number;
    actual: number;
  } | null>(null);
  const { busy, pending } = useCountCommand();
  // As the list is read when the answer comes, not when it was sent.
  const stillLeft = useRef(left);
  stillLeft.current = left;
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const target = targets[at] ?? targets[0];
  const system =
    moved !== null &&
    moved.key === target.key &&
    moved.shown === target.quantity
      ? moved.actual
      : target.quantity;
  const typed = count === "" ? null : Number(count);
  const invalid =
    typed === null
      ? ""
      : typed > 10000
        ? "Не більше 10000 шт. однієї позиції."
        : target.sizeIsUnknown && typed > system
          ? "Облік товару з невідомим розміром можна лише зменшити."
          : "";
  const held = blocked || busy || pending !== null;
  const ready = typed !== null && invalid === "" && !held;
  const words = typed === null ? "Записати" : `Записати · ${String(typed)} шт.`;
  // A number typed and not recorded: Telegram asks before Бірка closes
  // (spec §6.2).
  useAskBeforeClosing(count !== "");

  async function send(): Promise<void> {
    if (!ready) return;
    setRefusal("");
    const sent = target;
    const outcome = await submitCount(journalKey, token, {
      // A new transport key per attempt, and a new command per count: a
      // definite refusal wrote nothing, and an unknown outcome is settled by
      // resending the kept attempt, never by counting again.
      key: crypto.randomUUID(),
      body: {
        store_id: store.id,
        stocktake_id: stocktakeId,
        command_id: crypto.randomUUID(),
        product_variant_id: sent.product_variant_id,
        size_id: sent.size_id,
        counted_quantity: typed,
        expected_quantity: system,
      },
    });
    if (!live.current) return;
    if (outcome.kind === "done") {
      buzz("light");
      const now = new Set(recorded).add(sent.key);
      setRecorded(now);
      setCount("");
      setMoved(null);
      const next = nextOf(targets, at, now, stillLeft.current);
      if (next !== null) setAt(next);
      counted(outcome.result, sent, next === null);
    } else if (outcome.kind === "refused") {
      buzz("warning");
      setRefusal(countRefusalText(outcome.error));
      const actual = outcome.error.details.actual;
      if (outcome.error.code === "STOCK_CHANGED" && typeof actual === "number")
        setMoved({ key: sent.key, shown: sent.quantity, actual });
      // A person past their requests (ADR-0020) counted right: the same
      // count is sent again after the wait. Any other refusal asks for a
      // recount.
      if (outcome.error.code !== "TOO_MANY_REQUESTS") setCount("");
      refused();
    } else unknown();
  }
  const press = (): void => {
    void send();
  };
  const main = useMainButton(words, press, {
    progress: busy,
    active: ready,
  });
  const lineId = useId();
  return (
    <Sheet
      title={`${visible(target.name)} · ${sizeWord(target)}`}
      close={() => {
        if (!busy) close();
      }}
      fallback={fallback}
      foot={
        main ? undefined : (
          <div className="count-foot">
            <button
              type="button"
              className="sheet-done main-mimic"
              disabled={!ready && !busy}
              aria-disabled={busy || undefined}
              onClick={press}
            >
              {busy ? (
                <>
                  <Eyelet state="spin" size={20} />
                  <span className="visually-hidden">{words}</span>
                </>
              ) : (
                words
              )}
            </button>
          </div>
        )
      }
    >
      {/* On the page from the start: a status line put there with its words
          is often not read (review, 2026-11-07). The title moves to the
          next cell without a word, so a reader is told it. */}
      <p role="status" className="t-meta count-told">
        {told !== null && (
          <>
            {told}
            <span className="visually-hidden"> Далі: {sizeWord(target)}.</span>
          </>
        )}
      </p>
      <p className="t-row count-place">
        В обліку {system} · склад «{visible(place)}»
      </p>
      {target.reserved > 0 && (
        <p className="hint">
          У резерві замовлень: {target.reserved}. Якщо кількість не збігається,
          виправити облік можна після видачі або скасування замовлення.
        </p>
      )}
      <Keypad
        pieces
        label="Фактично, шт."
        value={count}
        change={(next) => {
          setCount(next);
          setRefusal("");
        }}
        disabled={held}
        invalid={invalid !== ""}
        describedBy={lineId}
      />
      {invalid !== "" ? (
        <p id={lineId} role="alert">
          {invalid}
        </p>
      ) : (
        typed !== null && (
          <p
            id={lineId}
            className={typed < system ? "count-live short" : "count-live"}
          >
            {typed === system
              ? "Збігається з обліком."
              : `${String(system)} → ${String(typed)} · ${signed(typed - system)}`}
          </p>
        )
      )}
      {refusal && <p role="alert">{refusal}</p>}
    </Sheet>
  );
}

/**
 * «Завершити інвентаризацію складу «…»?» (P0-2): the shortage and the
 * surplus large, in pieces; how many positions were not checked and that
 * their balances stay; that nothing is counted after, and the bot; and
 * Telegram's MainButton «Так, завершити» — outside Telegram, the sheet's
 * own.
 */
function FinishSheet({
  location,
  sums,
  held,
  finishing,
  failure,
  fallback,
  finish,
  close,
}: {
  location: Location;
  sums: StocktakeSums;
  held: boolean;
  finishing: boolean;
  failure: unknown;
  fallback: RefObject<HTMLElement>;
  finish: () => void;
  close: () => void;
}): JSX.Element {
  const [openedAt] = useState(() => performance.now());
  const press = (): void => {
    if (held || finishing || performance.now() - openedAt < CARRIED_TAP) return;
    finish();
  };
  const main = useMainButton("Так, завершити", press, {
    progress: finishing,
    active: !held,
  });
  return (
    <Sheet
      title={`Завершити інвентаризацію складу «${visible(location.name)}»?`}
      close={() => {
        if (!finishing) close();
      }}
      fallback={fallback}
      foot={
        <div className="count-foot">
          {!main && (
            <button
              type="button"
              className="sheet-done main-mimic"
              disabled={held}
              aria-disabled={finishing || undefined}
              onClick={press}
            >
              {finishing ? (
                <>
                  <Eyelet state="spin" size={20} />
                  <span className="visually-hidden">Так, завершити</span>
                </>
              ) : (
                "Так, завершити"
              )}
            </button>
          )}
          <button
            type="button"
            className="quiet"
            disabled={finishing}
            onClick={close}
          >
            Ще ні
          </button>
        </div>
      }
    >
      <div className="finish-sums">
        {differs(sums) ? (
          <>
            {sums.shortage_units > 0 && (
              <p className="finish-sum">
                <span className="t-label">Нестача</span>{" "}
                <span className="finish-big short">
                  {sums.shortage_units} шт.
                </span>
              </p>
            )}
            {sums.surplus_units > 0 && (
              <p className="finish-sum">
                <span className="t-label">Надлишок</span>{" "}
                <span className="finish-big">{sums.surplus_units} шт.</span>
              </p>
            )}
          </>
        ) : (
          <p className="finish-sum">
            <span className="finish-big">Розбіжностей немає</span>
          </p>
        )}
      </div>
      {sums.unchecked_positions > 0 && (
        <p>
          Не перевірено позицій: {sums.unchecked_positions} — їхні залишки не
          зміняться.
        </p>
      )}
      <p>
        Після завершення рахувати в цій інвентаризації вже не можна. Бот надішле
        підсумок власнику мережі, якщо завершує не власник.
      </p>
      {failure !== null && (
        <p role="alert">
          {inOwnWords(
            errorText(failure),
            "Інвентаризацію не завершено. Спробуйте ще раз.",
            "Інвентаризацію не завершено: дані складу змінилися — перегляньте їх і спробуйте ще раз.",
          )}
        </p>
      )}
    </Sheet>
  );
}

/**
 * Goods on the shelf that the list does not show, because the system holds
 * none of them here: found in the catalogue, their size chosen, and their
 * cell, «в обліку 0», counted in the same sheet against zero. If it holds
 * some after all, the server says how many, and the sheet counts against
 * that.
 */
function FoundGoods({
  store,
  token,
  scopeKey,
  disabled,
  pick,
  onCancel,
}: {
  store: Store;
  token: string;
  scopeKey: string;
  disabled: boolean;
  pick: (target: Target) => void;
  onCancel: () => void;
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
  const target: Target | null =
    variant && size
      ? {
          key: `${variant.product_variant_id}:${size.size_id}`,
          product_variant_id: variant.product_variant_id,
          size_id: size.size_id,
          name: variant.display_name,
          size: size.code,
          sizeIsUnknown: false,
          quantity: 0,
          reserved: 0,
        }
      : null;
  return (
    <section
      className="notice stocktake-found"
      aria-label="Товар, якого немає в списку"
    >
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
      {sizes.isError && (
        <Unread
          error={sizes.error}
          retry={() => {
            void sizes.refetch();
          }}
        />
      )}
      {target && (
        <div className="cells">
          <CountCell
            cell={target}
            disabled={disabled}
            pick={() => {
              pick(target);
            }}
          />
        </div>
      )}
      <button type="button" className="quiet" onClick={onCancel}>
        Скасувати
      </button>
    </section>
  );
}
