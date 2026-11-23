import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ListMore } from "@/shared/ListMore";
import { ApiError, isConflict } from "@/shared/api";
import { Back } from "@/shared/Back";
import { Empty } from "@/shared/Empty";
import { Eyelet, RecordedMark } from "@/shared/Eyelet";
import { Unread } from "@/shared/Unread";
import { Placeholder } from "@/shared/Placeholder";
import { ResultScreen } from "@/shared/ResultScreen";
import { SearchField } from "@/shared/SearchField";
import { ScreenHeader } from "@/shared/ScreenHeader";
import { Sticker } from "@/shared/Sticker";
import { Stub } from "@/shared/Stub";
import { usePanelRoom } from "@/shared/panel";
import { buzz, useAskBeforeClosing, useMainButton } from "@/shared/telegram";
import { visible } from "@/shared/visible";
import { enterGoes } from "@/shared/enter";
import { sizeLabel } from "@/returns/types";
import type { StockOption, Store } from "@/orders/types";
import { useBackOnSale } from "@/returns/places";
import { useSettled, useStock } from "@/sales/StockSearch";
import { submitReturnToSupplier, useReturnToSupplier } from "./commands";
import { SupplierPicker } from "./Picker";
import { placeText, refusalText, returnedText } from "./returnWords";
import type { ReturnBody, SupplierReturn } from "./types";

/** A return's lines at most, as the server takes them. */
const LINES = 100;

/** One model as the search finds it on the warehouse: its sizes free. */
interface Model {
  variantId: string;
  name: string;
  sizes: StockOption[];
}

interface Listed {
  line: ReturnBody["lines"][number];
  name: string;
  size: string;
}

/** A line refused as more than is free: where, which, and how many are. */
interface Short {
  place: string;
  variant: string;
  size: string;
  available: number;
}

/** The line the server named in `INSUFFICIENT_STOCK` for the warehouse the
 * return was sent from, as it names it (its model, its size, what is
 * free); null for any other answer, another warehouse, and a server that
 * names none. */
function shortOf(error: unknown, place: string): Short | null {
  if (!(error instanceof ApiError) || error.code !== "INSUFFICIENT_STOCK")
    return null;
  const {
    location_id: location,
    product_variant_id: variant,
    size_id: size,
    available,
  } = error.details;
  return location === place &&
    typeof variant === "string" &&
    typeof size === "string" &&
    typeof available === "number"
    ? { place, variant, size, available: Math.max(0, available) }
    : null;
}

/** A size's code on its stepper: «?» for one not known. */
function codeOf(size: StockOption): string {
  return size.size_is_unknown ? "?" : visible(size.size_label);
}

/** The warehouse's rows as models, each with its sizes free to go back: a
 * size an order holds whole is not offered, nor one with none (business
 * rules, «Повернення постачальнику»: only free goods go back). */
function modelsOf(items: StockOption[]): Model[] {
  const byModel = new Map<string, Model>();
  for (const item of items) {
    if (item.available_quantity <= 0) continue;
    const model = byModel.get(item.product_variant_id) ?? {
      variantId: item.product_variant_id,
      name: item.display_name,
      sizes: [],
    };
    // A row read twice, when a sale moved a page's edge, is shown once.
    if (!model.sizes.some((size) => size.size_id === item.size_id))
      model.sizes.push(item);
    byModel.set(item.product_variant_id, model);
  }
  return [...byModel.values()];
}

/**
 * «Повернути постачальнику» (stage 2, money task list, P0-4), after
 * «Прийшов товар» (spec S24): the warehouse as chips — said in a line when
 * there is one, none chosen beforehand —, the supplier's field, then the
 * till's search, the server's, from two letters, over that warehouse. A
 * model found is a row with «Змінити», its sizes free there as steppers two
 * to a row, «вільно N» the most; «Додати ще модель» puts them in «У
 * поверненні». Telegram's MainButton «Повернути постачальнику · 3 шт.»
 * records it: a return moves goods, never money. Refused, the words say
 * why over it and what was counted stays; recorded, its stub, and «Готово»
 * goes back to «Постачальникам», as its «←» and Telegram's «Назад» still
 * do. The menu is aside meanwhile, and back under the result's dock
 * (audit 2026-11-18, money P2-2; review).
 */
export function NewReturn({
  store,
  token,
  journalKey,
  blocked,
  back,
  done,
  recorded,
}: {
  store: Store;
  token: string;
  journalKey: string;
  /** Another command's outcome is unknown: nothing new until it is settled. */
  blocked: boolean;
  /** «← Постачальникам». */
  back: () => void;
  /** «Готово» on the stub: «Постачальникам» again. */
  done: () => void;
  /** Told while the result stands: the menu is back under its dock, as on
   * «Прийшов товар»'s and a payment's on «Борги». */
  recorded?: (shown: boolean) => void;
}): JSX.Element {
  const cache = useQueryClient();
  const { busy, pending, firstSend } = useReturnToSupplier();
  const working = busy || pending !== null;
  const sending = busy && firstSend;
  const places = useBackOnSale(store, token, true);
  const warehouses = places.data ?? [];
  const only = warehouses.length === 1 ? warehouses[0] : undefined;
  // Chosen by the person, never by the screen, among two or more (owner
  // decision, 2026-10-01); one is said in a line. Chosen, it stays: the
  // warehouses read again never move what was counted to another.
  const [chosenPlace, setChosenPlace] = useState("");
  const locationId = chosenPlace || (only?.id ?? "");
  const warehouse = warehouses.find((place) => place.id === locationId);
  const [supplierId, setSupplierId] = useState("");
  const [typed, setTyped] = useState("");
  const query = useSettled(typed);
  const stock = useStock({
    store,
    token,
    journalKey,
    locationId: warehouse ? warehouse.id : "",
    query,
    enabled: warehouse !== undefined,
  });
  const found = modelsOf((stock.data?.pages ?? []).flatMap((p) => p.items));
  const [model, setModel] = useState<Model | null>(null);
  // The chosen model's units of each size, by the size's id.
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [list, setList] = useState<Listed[]>([]);
  const [note, setNote] = useState("");
  const [validation, setValidation] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  // The line refused as more than is free, marked in the list with what is
  // free until that line is taken out, the warehouse changes or the return
  // is sent again (audit 2026-11-15, money P1-3).
  const [short, setShort] = useState<Short | null>(null);
  const shortId = useId();
  const [returned, setReturned] = useState<SupplierReturn | null>(null);
  // Before the result is painted: its dock on the menu from the first frame
  // (audit 2026-11-13, sale P1-2; audit 2026-11-18, money P2-2, review).
  useLayoutEffect(() => {
    recorded?.(returned !== null);
  }, [recorded, returned]);
  useLayoutEffect(
    () => () => {
      recorded?.(false);
    },
    [recorded],
  );

  // Where the cursor goes once the model changes: its name once chosen,
  // the search once cleared.
  const search = useRef<HTMLInputElement>(null);
  const modelName = useRef<HTMLParagraphElement>(null);
  const focusNext = useRef<"model" | "search" | null>(null);
  useEffect(() => {
    const next = focusNext.current;
    focusNext.current = null;
    if (next === "model") modelName.current?.focus();
    else if (next === "search") search.current?.focus();
  }, [model]);

  function chooseModel(next: Model | null): void {
    // A model found and taken, felt as «Прийшов товар»'s choices; put away,
    // nothing (audit 2026-11-18, money P2-1 (б)).
    if (next && next.variantId !== model?.variantId) buzz("selection");
    focusNext.current = next ? "model" : "search";
    setModel(next);
    setCounts({});
    setValidation("");
  }

  /** Another warehouse is another return: what was counted goes. */
  function choosePlace(id: string): void {
    if (id === locationId) return;
    // Another warehouse chosen, felt, as «Прийшов товар»'s chip (audit
    // 2026-11-18, money P2-1 (б)); the same one again, nothing.
    buzz("selection");
    setChosenPlace(id);
    setModel(null);
    setCounts({});
    setList([]);
    setValidation("");
    setRefusal(null);
    setShort(null);
  }

  const counted = model
    ? model.sizes.filter((size) => (counts[size.size_id] ?? 0) > 0)
    : [];

  /** A size's units from what they are now, from none to all free. */
  function count(size: StockOption, next: (units: number) => number): void {
    setCounts((now) => ({
      ...now,
      [size.size_id]: Math.min(
        Math.max(next(now[size.size_id] ?? 0), 0),
        size.available_quantity,
      ),
    }));
    setValidation("");
  }

  /** Why what was pressed may not go in, said under the list and felt, as
   * «Прийшов товар»'s (audit 2026-11-18, money P2-1 (б)): an error said as
   * it is typed is not. */
  function refuse(text: string): void {
    setValidation(text);
    buzz("error");
  }

  /** The counted sizes as the return's lines; null, with the reason said,
   * when they may not go in. */
  function take(): Listed[] | null {
    if (!model || counted.length === 0) return [];
    const lines = counted.map((size) => ({
      line: {
        product_variant_id: model.variantId,
        size_id: size.size_id,
        quantity: counts[size.size_id] ?? 0,
      },
      name: model.name,
      size: size.size_is_unknown ? "розмір невідомий" : size.size_label,
    }));
    // One model and size, one line (`DUPLICATE_LINE`).
    if (
      lines.some(({ line }) =>
        list.some(
          (one) =>
            one.line.product_variant_id === line.product_variant_id &&
            one.line.size_id === line.size_id,
        ),
      )
    ) {
      refuse(
        "Такий рядок уже в списку. Приберіть його, щоб змінити кількість.",
      );
      return null;
    }
    if (list.length + lines.length > LINES) {
      refuse(
        `В одному поверненні — до ${String(LINES)} рядків. Поверніть ці, а решту — окремим поверненням.`,
      );
      return null;
    }
    return lines;
  }

  /** The model's counted sizes into the list; the next model afresh. */
  function addModel(): void {
    const lines = take();
    if (!lines) return;
    setList([...list, ...lines]);
    setRefusal(null);
    chooseModel(null);
  }

  async function send(): Promise<void> {
    setRefusal(null);
    setShort(null);
    if (!warehouse) return;
    if (!supplierId) {
      refuse("Оберіть постачальника.");
      return;
    }
    const lines = take();
    if (!lines) return;
    const all = [...list, ...lines];
    if (all.length === 0) return;
    // The counted sizes join the list as it is sent: refused, it is kept.
    if (lines.length > 0) {
      setList(all);
      setModel(null);
      setCounts({});
    }
    setValidation("");
    const outcome = await submitReturnToSupplier(journalKey, token, {
      // A new transport key per attempt; the return's identity is
      // `command_id`, made here once: a resend after a lost answer comes
      // from the journal, which keeps it (I20).
      key: crypto.randomUUID(),
      body: {
        command_id: crypto.randomUUID(),
        store_id: store.id,
        location_id: warehouse.id,
        supplier_id: supplierId,
        lines: all.map((one) => one.line),
        note: note.trim() || null,
      },
    });
    if (outcome.kind === "done") {
      buzz("success");
      setReturned(outcome.result);
      // What went back is on the warehouse no more.
      void Promise.all([
        cache.invalidateQueries({ queryKey: ["supplier-returns", store.id] }),
        cache.invalidateQueries({ queryKey: ["sale-stock"] }),
      ]);
    } else if (outcome.kind === "refused") {
      buzz("error");
      // Changed in a way it does not name, or less is free than is sent:
      // the warehouse read again, so a model found again shows what is
      // free now (audit 2026-11-15, money P1-3). Nothing is counted here.
      // A model left open, nothing counted on it, is put away: its sizes
      // were what was free before (review).
      if (
        isConflict(outcome.error) ||
        (outcome.error instanceof ApiError &&
          outcome.error.code === "INSUFFICIENT_STOCK")
      ) {
        void cache.invalidateQueries({ queryKey: ["sale-stock"] });
        setModel(null);
      }
      setShort(shortOf(outcome.error, warehouse.id));
      setRefusal(refusalText(outcome.error));
    }
  }

  const units =
    list.reduce((sum, one) => sum + one.line.quantity, 0) +
    counted.reduce((sum, size) => sum + (counts[size.size_id] ?? 0), 0);
  const words = returned
    ? "Готово"
    : `Повернути постачальнику · ${String(units)} шт.`;
  const ready = units > 0 && warehouse !== undefined && !blocked && !working;
  const press = (): void => {
    if (returned) done();
    else if (ready) void send();
  };
  // The screen's one action, Telegram's; «Готово» on the stub. Hidden
  // while the supplier's sheet is over the screen: its own button is the
  // main there (frame P1-1; review).
  const [picking, setPicking] = useState(false);
  const main = useMainButton(words, press, {
    shown: !picking,
    progress: sending,
    active: returned !== null || ready,
  });
  const dock = useRef<HTMLDivElement>(null);
  // The form's dock; the result's is its screen's own (money P2-2).
  usePanelRoom(dock, returned === null && !main);
  // Anything counted and not yet returned: Telegram asks before Бірка
  // closes (spec §4.4).
  useAskBeforeClosing(returned === null && units > 0);
  // The stub's title takes the cursor: the button pressed is gone.
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (returned) title.current?.focus();
  }, [returned]);

  const dockButton = !main && (
    // Outside Telegram, its MainButton as the dock's one button.
    <div className="pay-panel order-dock" ref={dock}>
      <button
        type="button"
        className="main-mimic"
        disabled={!ready && !sending}
        aria-disabled={sending || undefined}
        onClick={press}
      >
        {sending ? (
          <>
            <Eyelet state="spin" size={20} />
            <span className="visually-hidden">{words}</span>
          </>
        ) : (
          words
        )}
      </button>
    </div>
  );

  if (returned)
    return (
      // A result's screen, as «Прийшов товар»'s and an invoice's: outside
      // Telegram «Готово» in its dock at the menu's top, its MainButton's
      // place; inside it, the MainButton (audit 2026-11-18, money P2-2).
      <ResultScreen
        className="receipt receive-done"
        dock={
          !main && (
            <button type="button" className="main-mimic" onClick={press}>
              Готово
            </button>
          )
        }
      >
        {/* «← Постачальникам» and Telegram's «Назад» stay, as the form's
            and an invoice's result's (audit 2026-11-13, money P2-2 (б)):
            «Готово» is not the one way out. */}
        <ScreenHeader
          ref={title}
          focusable
          // The result's own heading, never a pushed screen's 28 under its
          // «←», as receiving's result.
          pushed={false}
          className="result-title t-sheet"
          title={
            <>
              <RecordedMark />
              {returnedText(returned)}
            </>
          }
          back={
            <Back go={back}>
              <span aria-hidden="true">← </span>
              Постачальникам
            </Back>
          }
        />
        <Stub state="recorded">
          {returned.lines.map((line) => (
            <p
              className="stub-line"
              key={`${line.product_variant_id}:${line.size_id}`}
            >
              <strong>
                {visible(line.display_name)} · {sizeLabel(line.size)}
              </strong>
              <br />× {line.quantity}
            </p>
          ))}
          <p className="t-meta">{placeText(returned)}</p>
        </Stub>
      </ResultScreen>
    );

  return (
    <>
      <ScreenHeader
        title="Повернути постачальнику"
        back={
          <Back go={back} held={sending}>
            <span aria-hidden="true">← </span>
            Постачальникам
          </Back>
        }
      />
      <section className="goods-part receive supplier-return-new">
        <fieldset disabled={blocked || working}>
          <legend className="visually-hidden">Повернення постачальнику</legend>
          {places.isPending ? (
            // Two choices in grey where they come (money task list after
            // stage 2, P1-3).
            <Placeholder
              said="Завантажуємо склади…"
              chips={2}
              className="receive-place"
            />
          ) : places.data === undefined ? (
            <Unread
              error={places.error}
              retry={() => {
                void places.refetch();
              }}
            />
          ) : warehouses.length === 0 ? (
            // The blank tag, the same line (audit 2026-11-13, money P2-1).
            <Empty title="Тут немає складу, з якого повертають." />
          ) : only && locationId === only.id ? (
            <p className="t-row receive-place">Склад «{visible(only.name)}»</p>
          ) : (
            <div
              className="chips receive-place"
              role="group"
              aria-label="Склад"
            >
              {warehouses.map((place) => (
                <button
                  type="button"
                  className="chip"
                  key={place.id}
                  aria-pressed={place.id === locationId}
                  onClick={() => {
                    choosePlace(place.id);
                  }}
                >
                  {visible(place.name)}
                </button>
              ))}
            </div>
          )}
          <SupplierPicker
            store={store}
            token={token}
            value={supplierId}
            change={(next) => {
              setSupplierId(next);
              setValidation("");
              setRefusal(null);
            }}
            disabled={blocked || working}
            next={search}
            sheetOpen={setPicking}
          />
          {warehouse &&
            (model ? (
              <>
                <div className="receive-model">
                  <p className="t-row" ref={modelName} tabIndex={-1}>
                    {visible(model.name)}
                  </p>
                  <button
                    type="button"
                    className="quiet"
                    aria-label={`Змінити модель ${visible(model.name)}`}
                    onClick={() => {
                      chooseModel(null);
                    }}
                  >
                    Змінити
                  </button>
                </div>
                <div className="receive-sizes">
                  {model.sizes.map((size, at) => {
                    const got = counts[size.size_id] ?? 0;
                    const last = at === model.sizes.length - 1;
                    const code = codeOf(size);
                    const free = size.available_quantity;
                    return (
                      <div
                        className={
                          code.length > 3 ? "receive-size long" : "receive-size"
                        }
                        role="group"
                        aria-label={`${
                          size.size_is_unknown
                            ? "Розмір невідомий"
                            : `Розмір ${code}`
                        }, вільно ${String(free)}`}
                        key={size.size_id}
                      >
                        <span className="receive-size-code" aria-hidden="true">
                          {code}
                        </span>
                        <button
                          type="button"
                          aria-label="Менше"
                          // Held, not disabled: the cursor stays on it.
                          aria-disabled={got <= 0}
                          onClick={() => {
                            if (got <= 0) return;
                            count(size, (n) => n - 1);
                            // ±1 is felt, both ways (spec §6 rule 9; money
                            // task list after stage 2, P2-4).
                            buzz("light");
                          }}
                        >
                          −
                        </button>
                        <input
                          enterKeyHint={last ? "done" : "next"}
                          onKeyDown={enterGoes}
                          inputMode="numeric"
                          aria-label={`${code}, шт.`}
                          value={String(got)}
                          onFocus={(event) => {
                            event.target.select();
                          }}
                          onChange={(event) => {
                            const digits = event.target.value
                              .replace(/\D/g, "")
                              .slice(0, 5);
                            count(size, () => Number(digits || "0"));
                          }}
                        />
                        <button
                          type="button"
                          aria-label="Більше"
                          aria-disabled={got >= free}
                          onClick={() => {
                            if (got >= free) return;
                            count(size, (n) => n + 1);
                            buzz("light");
                          }}
                        >
                          +
                        </button>
                        <span
                          className="receive-size-free t-meta"
                          aria-hidden="true"
                        >
                          вільно {free}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <button
                  type="button"
                  className="quiet"
                  disabled={counted.length === 0}
                  onClick={addModel}
                >
                  Додати ще модель
                </button>
              </>
            ) : (
              <>
                <SearchField
                  label="Пошук моделі"
                  placeholder="Модель або колір"
                  value={typed}
                  change={setTyped}
                  inputRef={search}
                />
                {stock.isPending ||
                (stock.isPlaceholderData && found.length === 0) ? (
                  // Three rows 64 as the models found come, no day (audit
                  // 2026-11-13, money P2-1), on the list's white block
                  // (audit 2026-11-20, money P2-2 (а)).
                  <Placeholder
                    said="Завантажуємо товари…"
                    rows={3}
                    day={false}
                    block
                    rowShape={{
                      list: "return-models",
                      row: "sale-row return-model",
                    }}
                  />
                ) : stock.data === undefined ? (
                  <Unread
                    error={stock.error}
                    retry={() => {
                      void stock.refetch();
                    }}
                  />
                ) : found.length === 0 ? (
                  // Said to a reader too (audit 2026-11-13, money P2-1); a
                  // block among others, so a line — `meta` in pencil, as
                  // an empty search's (audit 2026-11-18, money P2-4 (в)).
                  <p className="t-meta nothing-yet" role="status">
                    {query
                      ? `За «${visible(query)}» на складі «${visible(warehouse.name)}» вільного товару немає.`
                      : `На складі «${visible(warehouse.name)}» немає вільного товару.`}
                  </p>
                ) : (
                  // Rows 64 on a white block, as «Прийшов товар»'s found
                  // (spec §6.8; audit 2026-11-20, money P2-2 (а)).
                  <ul
                    className="return-models list-block"
                    aria-label="Товар на складі"
                  >
                    {found.map((one) => (
                      <li key={one.variantId}>
                        <button
                          type="button"
                          className="sale-row return-model"
                          onClick={() => {
                            chooseModel(one);
                          }}
                        >
                          <span className="sale-main">
                            <span className="t-row">{visible(one.name)}</span>
                            <span className="sale-meta">
                              {one.sizes
                                .map(
                                  (size) =>
                                    `${size.size_is_unknown ? "розмір невідомий" : visible(size.size_label)} ${String(size.available_quantity)}`,
                                )
                                .join(" · ")}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {stock.hasNextPage && (
                  <ListMore
                    reading={stock.isFetchingNextPage}
                    held={stock.isPlaceholderData}
                    more={() => {
                      void stock.fetchNextPage();
                    }}
                  />
                )}
              </>
            ))}
          {list.length > 0 && (
            <section className="receive-list" aria-label="У поверненні">
              <h2 className="t-label">У поверненні</h2>
              {/* Rows on a white block, as its twin «У поставці»: the model
                  and its size, how many under them, «Прибрати» under that
                  (audit 2026-11-18, money P2-1 (а)). */}
              <ul className="receive-lines list-block">
                {list.map((one, index) => {
                  // The line the server named short: what is free, on a
                  // warning's sticker under its count, heard with its
                  // «Прибрати».
                  const marked =
                    short !== null &&
                    short.place === warehouse?.id &&
                    one.line.product_variant_id === short.variant &&
                    one.line.size_id === short.size
                      ? short
                      : null;
                  return (
                    <li
                      className="sale-row receive-line"
                      key={`${one.line.product_variant_id}:${one.line.size_id}`}
                    >
                      <span className="sale-main">
                        <span className="receive-line-what">
                          {visible(one.name)} · {visible(one.size)}
                        </span>
                        <span className="sale-meta">
                          {one.line.quantity} шт.
                        </span>
                        {marked && (
                          <span className="return-short" id={shortId}>
                            <Sticker tone="warn">
                              вільно {marked.available}
                            </Sticker>
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        className="quiet"
                        aria-label={`Прибрати ${visible(one.name)} · ${visible(one.size)}`}
                        {...(marked ? { "aria-describedby": shortId } : {})}
                        onClick={() => {
                          setList(list.filter((_, at) => at !== index));
                          setValidation("");
                          setRefusal(null);
                          // Only its own mark goes with it: another line
                          // still short keeps what is free (review).
                          if (marked) setShort(null);
                        }}
                      >
                        Прибрати {visible(one.name)}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          <label>
            Примітка (необов’язково)
            <input
              enterKeyHint="done"
              onKeyDown={enterGoes}
              value={note}
              maxLength={1000}
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
          </label>
          <p className="t-meta receive-total">
            {warehouse
              ? `${String(units)} шт. · склад «${visible(warehouse.name)}»`
              : `${String(units)} шт.`}
          </p>
          {validation && <p role="alert">{validation}</p>}
        </fieldset>
        {refusal !== null && <p role="alert">{refusal}</p>}
        {dockButton}
      </section>
    </>
  );
}
