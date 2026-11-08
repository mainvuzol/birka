import { useEffect, useRef, useState } from "react";
import { BackToMore } from "@/shared/More";
import type { MoreBack } from "@/shared/More";
import type { JSX } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, errorText, inOwnWords, readText } from "@/shared/api";
import { Eyelet, RecordedMark } from "@/shared/Eyelet";
import { Icon } from "@/shared/Icon";
import { usePanelRoom } from "@/shared/panel";
import { Sheet } from "@/shared/Sheet";
import { Stub } from "@/shared/Stub";
import { visible } from "@/shared/visible";
import { ScreenHeader } from "@/shared/ScreenHeader";
import { buzz, useAskBeforeClosing, useMainButton } from "@/shared/telegram";
import { decimal, kopecks, money } from "@/orders/types";
import type { Location, Store } from "@/orders/types";
import { SuggestedPrice } from "@/prices/SuggestedPrice";
import {
  SupplierPicker,
  noSupplierDraft,
  useSuppliers,
} from "@/suppliers/Picker";
import { AddedStub, CatalogPicker } from "./CatalogPicker";
import { submitReceipt, useReceiptCommand } from "./receiptCommands";
import { acquisitionLabels, paidWhenSold } from "./receiptTypes";
import type {
  Acquisition,
  Receipt,
  ReceiptLine,
  ReceivableVariant,
  SizeOption,
} from "./receiptTypes";

interface Draft {
  line: ReceiptLine;
  name: string;
  size: string;
}

/** A delivery's lines at most, as the server takes them. */
const LINES = 200;
/** One line's units at most, as the server takes them. */
const UNITS = 10000;

/** A delivery refused: what the server named, or in the delivery's words —
 * never an order's; the list kept either way. */
function receiptRefusal(error: unknown): string {
  const said = errorText(error);
  const own = inOwnWords(
    said,
    "Нічого не прийнято. Перевірте рядки та спробуйте ще раз — список збережено.",
    "Нічого не прийнято: поки ви працювали, дані змінилися. Перевірте рядки та спробуйте ще раз — список збережено.",
  );
  return own === said ? `${said} Список збережено — нічого не прийнято.` : own;
}

/** «склад «Основний»»: the name as written, never declined. */
function warehouseWords(name: string): string {
  return `склад «${visible(name)}»`;
}

/**
 * The back door, «Прийшов товар» (spec S24; «Усе на бірці» sections task
 * list, P1-4): the warehouse it came into as chips, the model from the
 * catalogue, the organization's sizes as steppers — «S − 2 +» — and how it
 * came, its price and the note in a sheet behind one row; Telegram's
 * MainButton «Записати прихід · N шт.» records it. A delivery still holds
 * several models in one record: «Додати ще модель» puts the counted sizes in
 * the list and clears the model.
 *
 * Differs from the till in what it searches. The till offers what a warehouse
 * holds, because it can only sell that; a delivery is usually of something the
 * shop has run out of, so this screen searches the catalogue instead
 * (`CatalogPicker`) and offers the organization's sizes.
 * "Size not known" is never among them — goods arrive with a size, and that
 * one enters only from a legacy stock list (ADR-0005 §3).
 *
 * Purchase cost is optional and a seller may enter and see it (owner decision,
 * 2026-09-30). The screen shows back the cost the server stored on each lot,
 * not what it typed; the cost is part of the delivery's permanent identity,
 * so the same command at another price is refused as another delivery.
 *
 * The model's selling price sits beside it, and whoever may set prices sets
 * it here as goods arrive (owner decision, 2026-10-01). It is saved on its
 * own, at once: it belongs to the model, not to this delivery.
 *
 * Borrowed goods, and goods under consignment, are owed for once sold: only
 * whoever keeps the suppliers' debts takes them, from a supplier on the list,
 * at a price agreed for each (owner decisions, 2026-10-01). They are marked
 * sold, or sent back, from «Позичене й під реалізацію» (stage 2, money task
 * list, P0-5).
 */
export function Receive({
  store,
  token,
  journalKey,
  blocked,
  back,
  model = null,
}: {
  store: Store;
  token: string;
  journalKey: string;
  blocked: boolean;
  /** «← Ще» over the heading: «Ще» › «Товар» › «Прийшов товар» («Усе на
   * бірці» task list, P0-4); «← {модель}» from a model's detail. */
  back?: MoreBack | undefined;
  /** Opened from a model's detail: that model, chosen (sections task
   * list, P0-6). */
  model?: ReceivableVariant | null;
}): JSX.Element {
  const [locationId, setLocationId] = useState("");
  const [variant, setVariant] = useState<ReceivableVariant | null>(model);
  // A model added from an empty search: its stub, till another is chosen.
  const [added, setAdded] = useState<string | null>(null);
  // The chosen model's units of each size, by the size's id.
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [cost, setCost] = useState("");
  const [acquisition, setAcquisition] = useState<Acquisition>("PURCHASE");
  // Whose goods, when any are borrowed or under consignment; one being
  // added kept while the sheet is closed.
  const [supplierId, setSupplierId] = useState("");
  const supplierDraft = useState(noSupplierDraft);
  const keepsSuppliers = store.permissions.includes("supplier:debt");
  const [notes, setNotes] = useState("");
  const [draft, setDraft] = useState<Draft[]>([]);
  const [commandId, setCommandId] = useState(() => crypto.randomUUID());
  const [validation, setValidation] = useState("");
  const [refusal, setRefusal] = useState<unknown>(null);
  // «Як надійшов»'s sheet, open; the price it holds, said wrong on
  // «Готово».
  const [details, setDetails] = useState(false);
  const [costWrong, setCostWrong] = useState(false);
  const [received, setReceived] = useState<{
    receipt: Receipt;
    names: Draft[];
    warehouse: string;
  } | null>(null);
  const { busy, pending } = useReceiptCommand();

  const locations = useQuery({
    queryKey: ["receive-locations", journalKey, store.id],
    queryFn: () =>
      api<Location[]>(`/stock-locations?store_id=${store.id}`, token),
    retry: false,
  });
  const sizes = useQuery({
    queryKey: ["receive-sizes", journalKey, store.id],
    queryFn: () =>
      api<SizeOption[]>(`/catalog/sizes?store_id=${store.id}`, token),
    retry: false,
  });
  // The supplier's name on the row, once one is chosen.
  const suppliers = useSuppliers(store, token, supplierId !== "");

  // A store's «Брак» takes damaged returns, not deliveries: offering it here
  // would put new goods where nothing sells (owner decision, 2026-10-01).
  // A paused warehouse, or one that takes none, is not offered at all.
  const receivable = (locations.data ?? []).filter(
    (location) =>
      location.is_active && location.can_receive && !location.damaged_returns,
  );
  const onlyWarehouse = receivable.length === 1 ? receivable[0] : undefined;

  useEffect(() => {
    // The client choosing among one option is not the server choosing: the
    // same reasoning, and the same boundary, as the till's warehouse.
    if (!locationId && onlyWarehouse) setLocationId(onlyWarehouse.id);
  }, [locationId, onlyWarehouse]);

  useEffect(() => {
    // A warehouse that no longer takes deliveries is chosen no more.
    if (
      locationId &&
      locations.isSuccess &&
      !locations.data.some(
        (location) =>
          location.id === locationId &&
          location.is_active &&
          location.can_receive &&
          !location.damaged_returns,
      )
    )
      setLocationId("");
  }, [locationId, locations.isSuccess, locations.data]);

  // Where the cursor goes once the model changes: its name once chosen,
  // the catalogue's field once cleared.
  const modelName = useRef<HTMLParagraphElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  const focusNext = useRef<"model" | "search" | null>(null);
  useEffect(() => {
    const next = focusNext.current;
    focusNext.current = null;
    if (next === "model") modelName.current?.focus();
    else if (next === "search") picker.current?.querySelector("input")?.focus();
  }, [variant]);

  // A different list is a different delivery.
  function replaceDraft(next: Draft[]): void {
    setDraft(next);
    setCommandId(crypto.randomUUID());
    setRefusal(null);
    setValidation("");
  }

  function chooseModel(next: ReceivableVariant | null, said?: string): void {
    focusNext.current = next ? "model" : "search";
    setVariant(next);
    setAdded(said ?? null);
    setCounts({});
    // A new model starts without the previous one's price.
    setCost("");
    setValidation("");
  }

  const counted = variant
    ? (sizes.data ?? []).filter((size) => (counts[size.size_id] ?? 0) > 0)
    : [];
  const countedUnits = counted.reduce(
    (sum, size) => sum + (counts[size.size_id] ?? 0),
    0,
  );

  /** A size's units from what they are now: two quick taps are two. */
  function count(size: SizeOption, next: (units: number) => number): void {
    setCounts((now) => ({
      ...now,
      [size.size_id]: Math.min(
        Math.max(next(now[size.size_id] ?? 0), 0),
        UNITS,
      ),
    }));
    setValidation("");
  }

  /** The counted sizes as the delivery's lines, the way and at the price
   * the sheet says; null, with the reason said, when they may not go in. */
  function take(): Draft[] | null {
    if (!variant || counted.length === 0) return [];
    const stated = cost.trim();
    const cents = stated ? kopecks(stated) : null;
    if (stated && cents === null) {
      setValidation(
        "Закупівельну ціну вкажіть у гривнях, до копійок, наприклад 1850,50.",
      );
      return null;
    }
    if (paidWhenSold(acquisition) && (cents === null || cents <= 0n)) {
      setValidation(
        "Вкажіть ціну за одиницю, домовлену з постачальником: її сплатять, коли товар продадуть.",
      );
      return null;
    }
    const lines = counted.map((size) => ({
      line: {
        product_variant_id: variant.product_variant_id,
        size_id: size.size_id,
        quantity: counts[size.size_id] ?? 0,
        acquisition_type: acquisition,
        unit_cost: cents === null ? null : decimal(cents),
      },
      name: variant.display_name,
      size: size.code,
    }));
    if (
      lines.some(({ line }) =>
        draft.some(
          (d) =>
            d.line.product_variant_id === line.product_variant_id &&
            d.line.size_id === line.size_id &&
            d.line.acquisition_type === line.acquisition_type &&
            d.line.unit_cost === line.unit_cost,
        ),
      )
    ) {
      setValidation(
        "Такий рядок уже в списку. Приберіть його, щоб змінити кількість.",
      );
      return null;
    }
    if (draft.length + lines.length > LINES) {
      setValidation(
        `В одній поставці — до ${String(LINES)} рядків. Запишіть цю, а решту прийміть окремою поставкою.`,
      );
      return null;
    }
    return lines;
  }

  /** The model's counted sizes into the list; the next model afresh. */
  function addModel(): void {
    const lines = take();
    if (!lines) return;
    replaceDraft([...draft, ...lines]);
    chooseModel(null);
  }

  async function send(): Promise<void> {
    setRefusal(null);
    const lines = take();
    if (!lines) return;
    const all = [...draft, ...lines];
    if (all.length === 0) return;
    const owed = all.some((d) => paidWhenSold(d.line.acquisition_type));
    if (owed && !supplierId) {
      setValidation("Оберіть постачальника, чий це товар.");
      return;
    }
    // The counted sizes join the list as it is sent: refused, it is kept,
    // and sent again it is the same delivery.
    let id = commandId;
    if (lines.length > 0) {
      id = crypto.randomUUID();
      setDraft(all);
      setCommandId(id);
      setCounts({});
    }
    setValidation("");
    const warehouse =
      locations.data?.find((location) => location.id === locationId)?.name ??
      "";
    const trimmed = notes.trim();
    const outcome = await submitReceipt(journalKey, token, {
      // A new transport key per attempt; the delivery's identity is
      // `command_id`, which is what makes a late retry safe (ADR-0006).
      key: crypto.randomUUID(),
      body: {
        store_id: store.id,
        location_id: locationId,
        command_id: id,
        lines: all.map((d) => d.line),
        notes: trimmed ? trimmed : null,
        // Only when owed for once sold, so a purchase is sent as before.
        ...(owed ? { supplier_id: supplierId } : {}),
      },
    });
    if (outcome.kind === "done") {
      buzz("success");
      setReceived({ receipt: outcome.result, names: all, warehouse });
      setDraft([]);
      setNotes("");
      setCommandId(crypto.randomUUID());
    } else if (outcome.kind === "refused") {
      setRefusal(outcome.error);
    }
  }

  const working = busy || pending !== null;
  const units =
    draft.reduce((sum, d) => sum + d.line.quantity, 0) + countedUnits;
  const costed = draft
    .map((d) => ({ quantity: d.line.quantity, unit_cost: d.line.unit_cost }))
    .filter((line) => line.unit_cost !== null);
  const warehouse = receivable.find((location) => location.id === locationId);
  const words = `Записати прихід · ${String(units)} шт.`;
  const ready = units > 0 && warehouse !== undefined && !blocked && !working;
  const press = (): void => {
    if (ready) void send();
  };
  // The screen's one action, Telegram's: put away under the sheet and once
  // the delivery is recorded.
  const main = useMainButton(words, press, {
    shown: !received && !details,
    progress: busy,
    active: ready,
  });
  const dock = useRef<HTMLDivElement>(null);
  usePanelRoom(dock, !received && !main);
  // Anything counted and not yet recorded: Telegram asks before Бірка
  // closes (spec §4.4).
  useAskBeforeClosing(!received && units > 0);
  const detailsRow = useRef<HTMLButtonElement>(null);
  // The result's heading takes the cursor: the button pressed is gone.
  const done = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (received) done.current?.focus();
  }, [received]);

  if (received) {
    const kinds = [
      ...new Set(
        received.names.map((d) => acquisitionLabels[d.line.acquisition_type]),
      ),
    ];
    const came = received.receipt.lines.reduce(
      (sum, line) => sum + line.quantity_received,
      0,
    );
    return (
      <section className="receipt receive-done">
        <ScreenHeader
          ref={done}
          focusable
          className="result-title t-sheet"
          title={
            <>
              <RecordedMark />
              {`Прийшло ${String(came)} шт. · ${warehouseWords(received.warehouse)} · ${kinds.join(", ")}`}
            </>
          }
        />
        <Stub state="recorded">
          {received.receipt.lines.map((line, index) => (
            <p className="stub-line" key={line.stock_lot_id}>
              <strong>
                {visible(received.names[index]?.name ?? "Товар")} ·{" "}
                {visible(received.names[index]?.size ?? "")}
              </strong>
              <br />+{line.quantity_received} · тепер на складі{" "}
              {line.quantity_after}
              {line.unit_cost !== null && ` · ${money(line.unit_cost)} за шт.`}
            </p>
          ))}
          {received.receipt.lines.some((line) => line.unit_cost !== null) && (
            <p className="total">
              Закупівельна вартість{" "}
              <strong>
                {money(
                  decimal(
                    purchaseValue(
                      received.receipt.lines.map((line) => ({
                        quantity: line.quantity_received,
                        unit_cost: line.unit_cost,
                      })),
                    ),
                  ),
                )}
              </strong>
            </p>
          )}
        </Stub>
        <div className="result-next">
          <button
            type="button"
            onClick={() => {
              setReceived(null);
            }}
          >
            Прийняти ще
          </button>
        </div>
      </section>
    );
  }

  const owing =
    paidWhenSold(acquisition) ||
    draft.some((d) => paidWhenSold(d.line.acquisition_type));
  const stated = kopecks(cost.trim());
  const supplier = owing
    ? suppliers.data?.find((one) => one.id === supplierId)
    : undefined;
  // «Закупівля · ціна не вказана ›»: what the sheet holds, in one row.
  const way = [
    acquisitionLabels[acquisition],
    !cost.trim()
      ? "ціна не вказана"
      : stated === null
        ? "ціна з помилкою"
        : `${money(decimal(stated))} за шт.`,
    supplier ? visible(supplier.name) : null,
    notes.trim() ? visible(notes.trim()) : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");

  return (
    <>
      <ScreenHeader
        title="Прийшов товар"
        back={back && <BackToMore back={back} />}
      />
      <section className="goods-part receive">
        <fieldset disabled={blocked || working}>
          <legend className="visually-hidden">Поставка</legend>
          {locations.isPending ? (
            <p role="status">Завантажуємо склади…</p>
          ) : locations.data === undefined ? (
            <Failure
              error={locations.error}
              retry={() => {
                void locations.refetch();
              }}
            />
          ) : receivable.length === 0 ? (
            // Nothing said of the rule (stage 2, goods task list, P1-5).
            <p>Тут немає складу для приймання.</p>
          ) : onlyWarehouse ? (
            <p className="t-row receive-place">
              Склад «{visible(onlyWarehouse.name)}»
            </p>
          ) : (
            // Chosen by the person, never by the screen (owner decision,
            // 2026-10-01): two or more, none chosen.
            <div
              className="chips receive-place"
              role="group"
              aria-label="Склад"
            >
              {receivable.map((location) => (
                <button
                  type="button"
                  className="chip"
                  key={location.id}
                  aria-pressed={location.id === locationId}
                  onClick={() => {
                    setLocationId(location.id);
                    setValidation("");
                  }}
                >
                  {visible(location.name)}
                </button>
              ))}
            </div>
          )}
          {variant ? (
            <>
              <div className="receive-model">
                <p className="t-row" ref={modelName} tabIndex={-1}>
                  {visible(variant.display_name)}
                </p>
                <button
                  type="button"
                  className="quiet"
                  aria-label={`Змінити модель ${visible(variant.display_name)}`}
                  onClick={() => {
                    chooseModel(null);
                  }}
                >
                  Змінити
                </button>
              </div>
              <AddedStub said={added} />
            </>
          ) : (
            <div ref={picker}>
              <CatalogPicker
                store={store}
                token={token}
                scopeKey={journalKey}
                variant={variant}
                onVariant={(picked, said) => {
                  if (picked) chooseModel(picked, said);
                }}
                adds
              />
            </div>
          )}
          {variant && (
            <>
              <SuggestedPrice
                key={variant.product_variant_id}
                store={store}
                token={token}
                scopeKey={journalKey}
                variantId={variant.product_variant_id}
                blocked={blocked}
              />
              {sizes.isPending ? (
                <p role="status">Завантажуємо розміри…</p>
              ) : sizes.data === undefined ? (
                <Failure
                  error={sizes.error}
                  retry={() => {
                    void sizes.refetch();
                  }}
                />
              ) : (
                <div className="receive-sizes">
                  {sizes.data.map((size) => {
                    const got = counts[size.size_id] ?? 0;
                    const code = visible(size.code);
                    return (
                      <div
                        className={
                          code.length > 3 ? "receive-size long" : "receive-size"
                        }
                        role="group"
                        aria-label={`Розмір ${code}`}
                        key={size.size_id}
                      >
                        <span className="receive-size-code" aria-hidden="true">
                          {code}
                        </span>
                        <button
                          type="button"
                          aria-label="Менше"
                          // Held, not disabled: the cursor stays on it at 0.
                          aria-disabled={got <= 0}
                          onClick={() => {
                            if (got > 0) count(size, (units) => units - 1);
                          }}
                        >
                          −
                        </button>
                        <input
                          // Typed as well: thirty of a size are not thirty
                          // taps.
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
                          aria-disabled={got >= UNITS}
                          onClick={() => {
                            if (got >= UNITS) return;
                            count(size, (units) => units + 1);
                            buzz("light");
                          }}
                        >
                          +
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
          <button
            ref={detailsRow}
            type="button"
            className="quiet receive-way"
            aria-haspopup="dialog"
            onClick={() => {
              setDetails(true);
            }}
          >
            <span>
              <span className="visually-hidden">Як надійшов: </span>
              {way}
            </span>
            <Icon name="chevron-right" size={20} />
          </button>
          {variant && (
            <button
              type="button"
              className="quiet"
              disabled={counted.length === 0}
              onClick={addModel}
            >
              Додати ще модель
            </button>
          )}
          {draft.length > 0 && (
            <section className="receive-list" aria-label="У поставці">
              <h2 className="t-label">У поставці</h2>
              {draft.map((d, index) => (
                <div
                  className="line"
                  key={`${d.line.product_variant_id}:${d.line.size_id}:${d.line.acquisition_type}:${d.line.unit_cost ?? ""}`}
                >
                  <strong>
                    {visible(d.name)} · {visible(d.size)}
                  </strong>
                  <span>
                    {d.line.quantity} шт. ·{" "}
                    {acquisitionLabels[d.line.acquisition_type]}
                    {d.line.unit_cost !== null &&
                      ` · ${money(d.line.unit_cost)} за шт.`}
                  </span>
                  <button
                    type="button"
                    className="quiet"
                    // A model's sizes are lines of their own.
                    aria-label={`Прибрати ${visible(d.name)} · ${visible(d.size)}${d.line.unit_cost !== null ? ` · ${money(d.line.unit_cost)}` : ""}`}
                    onClick={() => {
                      replaceDraft(draft.filter((_, i) => i !== index));
                    }}
                  >
                    Прибрати {visible(d.name)}
                  </button>
                </div>
              ))}
              {costed.length > 0 && (
                <p className="total">
                  Закупівельна вартість{" "}
                  <strong>{money(decimal(purchaseValue(costed)))}</strong>
                </p>
              )}
              {costed.length > 0 && costed.length < draft.length && (
                <p className="hint">
                  Рядків без ціни: {draft.length - costed.length}. Їх вартість
                  не враховано.
                </p>
              )}
            </section>
          )}
          <p className="t-meta receive-total">
            {warehouse
              ? `${String(units)} шт. · ${warehouseWords(warehouse.name)}`
              : `${String(units)} шт.`}
          </p>
          {validation && <p role="alert">{validation}</p>}
        </fieldset>
        {refusal !== null && <p role="alert">{receiptRefusal(refusal)}</p>}
        {!main && (
          // Outside Telegram, its MainButton as the dock's one button.
          <div className="pay-panel order-dock" ref={dock}>
            <button
              type="button"
              className="main-mimic"
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
        )}
      </section>
      {details && (
        <Sheet
          title="Як надійшов"
          close={() => {
            setDetails(false);
          }}
          fallback={detailsRow}
          foot={
            <button
              type="button"
              className="sheet-done"
              onClick={() => {
                // A price typed that is not money is said here, where it
                // is mended.
                if (cost.trim() && kopecks(cost.trim()) === null)
                  setCostWrong(true);
                else setDetails(false);
              }}
            >
              Готово
            </button>
          }
        >
          <fieldset disabled={blocked || working} className="receive-details">
            {keepsSuppliers && (
              <div className="chips" role="group" aria-label="Як надійшов">
                {(Object.keys(acquisitionLabels) as Acquisition[]).map(
                  (key) => (
                    <button
                      type="button"
                      className="chip"
                      key={key}
                      aria-pressed={acquisition === key}
                      onClick={() => {
                        setAcquisition(key);
                        setValidation("");
                      }}
                    >
                      {acquisitionLabels[key]}
                    </button>
                  ),
                )}
              </div>
            )}
            <label>
              {paidWhenSold(acquisition)
                ? "Домовлена ціна за шт., грн"
                : "Закупівельна ціна за шт., грн (необов’язково)"}
              <input
                inputMode="decimal"
                placeholder={paidWhenSold(acquisition) ? "обов’язково" : "0,00"}
                value={cost}
                aria-invalid={costWrong || undefined}
                onChange={(event) => {
                  setCost(event.target.value);
                  setCostWrong(false);
                  setValidation("");
                }}
              />
            </label>
            {costWrong && (
              <p role="alert">
                Закупівельну ціну вкажіть у гривнях, до копійок, наприклад
                1850,50.
              </p>
            )}
            {owing && (
              <>
                <SupplierPicker
                  store={store}
                  token={token}
                  value={supplierId}
                  change={(next) => {
                    setSupplierId(next);
                    setValidation("");
                    // Another supplier's goods are another delivery.
                    setCommandId(crypto.randomUUID());
                  }}
                  disabled={blocked || working}
                  kept={supplierDraft}
                  // In «Як надійшов»: no sheet over a sheet (stage 2, money
                  // task list, P0-3).
                  inPlace
                />
                <p className="hint">
                  Позичене й під реалізацію сплачують, лише коли продадуть, за
                  домовленою ціною. Продане чи непродане позначають на екрані
                  «Позичене й під реалізацію».
                </p>
              </>
            )}
            <label>
              Примітка (накладна, постачальник)
              <input
                value={notes}
                maxLength={1000}
                onChange={(event) => {
                  setNotes(event.target.value);
                }}
              />
            </label>
          </fieldset>
        </Sheet>
      )}
    </>
  );
}

/** Quantity × unit cost over the lines that state a cost, in kopecks. */
function purchaseValue(
  lines: { quantity: number; unit_cost: string | null }[],
): bigint {
  return lines.reduce(
    (sum, line) =>
      line.unit_cost === null
        ? sum
        : sum + (kopecks(line.unit_cost) ?? 0n) * BigInt(line.quantity),
    0n,
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
      <p>{readText(error)}</p>
      <button type="button" onClick={retry}>
        Спробувати ще раз
      </button>
    </div>
  );
}
