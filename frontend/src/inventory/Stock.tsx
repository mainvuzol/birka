import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, errorText } from "@/shared/api";
import type { Location, StockOption, Store } from "@/orders/types";
import { CatalogPicker } from "./CatalogPicker";
import { Correction } from "./Correction";
import type { Corrected } from "./Correction";
import { reasonLabels } from "./adjustmentTypes";
import type { ReceivableVariant, SizeOption } from "./receiptTypes";

const pageSize = 50;

/**
 * Balances at one warehouse, and — for whoever holds `inventory:adjust` —
 * the place to correct one.
 *
 * Correcting lives beside the balance it corrects: a manager looking at a
 * wrong number fixes it from there. Goods found that the list cannot show,
 * because the system holds none, are picked from the catalogue instead.
 */
export function Stock({
  store,
  token,
  scopeKey,
  journalKey,
  blocked,
}: {
  store: Store;
  token: string;
  scopeKey: string;
  journalKey: string;
  blocked: boolean;
}): JSX.Element {
  const [locationId, setLocationId] = useState("");
  const [offset, setOffset] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [selectionLost, setSelectionLost] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const [corrected, setCorrected] = useState<Corrected | null>(null);
  const allowed = store.permissions.includes("inventory:view");
  const canAdjust = store.permissions.includes("inventory:adjust");
  const locations = useQuery({
    queryKey: ["inventory-locations", scopeKey, store.id],
    queryFn: () =>
      api<Location[]>(`/stock-locations?store_id=${store.id}`, token),
    enabled: allowed,
    retry: false,
  });
  const selected = locations.data?.find(
    (location) => location.id === locationId,
  );
  const stock = useQuery({
    queryKey: ["inventory-stock", scopeKey, store.id, locationId, offset],
    queryFn: () =>
      api<{ items: StockOption[]; has_more: boolean }>(
        `/catalog/stock-options?store_id=${store.id}&location_id=${locationId}&limit=${String(pageSize)}&offset=${String(offset)}`,
        token,
      ),
    enabled: allowed && !!selected && !locations.isError,
    retry: false,
  });

  // Adjusting a warehouse is receiving into it as far as access goes: the
  // server requires `can_receive` there, and refuses a paused one.
  // «Брак» changes only through returns and its own section (owner decision,
  // 2026-10-01); the server refuses a correction there too.
  const adjustable =
    canAdjust &&
    !!selected &&
    selected.is_active &&
    selected.can_receive &&
    !selected.damaged_returns;

  useEffect(() => {
    // Revocation clears the selection; later access never restores it implicitly.
    if (locationId && locations.isSuccess && !selected) {
      setLocationId("");
      setOffset(0);
      setSelectionLost(true);
      setEditing(null);
      setFinding(false);
    }
  }, [locationId, locations.isSuccess, selected]);

  function done(result: Corrected): void {
    setEditing(null);
    setFinding(false);
    setCorrected(result);
    void stock.refetch();
  }

  async function refresh(): Promise<void> {
    setRefreshing(true);
    try {
      const current = await locations.refetch();
      if (
        !current.isError &&
        current.data?.some((location) => location.id === locationId)
      ) {
        await stock.refetch();
      }
    } finally {
      setRefreshing(false);
    }
  }

  if (!allowed) return <p role="alert">Немає права переглядати залишки.</p>;

  return (
    <section>
      <div className="toolbar">
        <h2>Залишки</h2>
        <button
          className="quiet"
          disabled={refreshing || locations.isFetching || stock.isFetching}
          onClick={() => {
            void refresh();
          }}
        >
          Оновити залишки
        </button>
      </div>
      <p className="hint">
        Оберіть один склад. «Доступно» — залишок після віднімання резервів
        замовлень.
      </p>
      {selectionLost && (
        <p role="status">
          Обраний склад більше не доступний. Оберіть інший склад зі списку.
        </p>
      )}
      {locations.isPending ? (
        <p role="status">Завантажуємо склади…</p>
      ) : locations.error ? (
        <Failure
          error={locations.error}
          retry={() => {
            void refresh();
          }}
        />
      ) : (
        <>
          <label>
            Склад для перегляду
            <select
              value={selected?.id ?? ""}
              disabled={refreshing}
              onChange={(event) => {
                setLocationId(event.target.value);
                setOffset(0);
                setSelectionLost(false);
                setEditing(null);
                setFinding(false);
                setCorrected(null);
              }}
            >
              <option value="">Оберіть склад</option>
              {locations.data.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                  {location.damaged_returns ? " — брак, не продається" : ""}
                  {!location.is_active ? " — на паузі" : ""}
                </option>
              ))}
            </select>
          </label>
          {locations.data.length === 0 && (
            <p>Доступних складів немає. Зверніться до менеджера.</p>
          )}
          {selected && (
            <>
              <h3>{selected.name}</h3>
              {!selected.is_active && (
                <p className="notice">
                  Склад на паузі. Залишки доступні для перегляду.
                </p>
              )}
              {selected.damaged_returns && (
                <p className="hint">
                  Це склад «Брак»: тут лежить пошкоджений товар із повернень.
                  Він змінюється лише через розділ «Брак».
                </p>
              )}
              {canAdjust && selected.is_active && !selected.can_receive && (
                <p className="hint">
                  Цей магазин не може виправляти залишки на цьому складі.
                </p>
              )}
              {corrected && (
                <p role="status">
                  Коригування записано: {corrected.target.name} ·{" "}
                  {corrected.target.size} — {reasonLabels[corrected.reason]},
                  облік {corrected.adjustment.quantity_before} →{" "}
                  {corrected.adjustment.quantity_after}.
                </p>
              )}
              {refreshing || stock.isPending ? (
                <p role="status">Завантажуємо залишки…</p>
              ) : stock.error ? (
                <Failure
                  error={stock.error}
                  retry={() => {
                    void refresh();
                  }}
                />
              ) : (
                <>
                  {stock.data.items.length === 0 && (
                    <p>
                      {offset === 0
                        ? "На цьому складі немає товарів із додатним залишком."
                        : "На цій сторінці більше немає товарів. Поверніться до попередньої сторінки."}
                    </p>
                  )}
                  {stock.data.items.map((item) => (
                    <article
                      className="line"
                      key={`${item.product_variant_id}:${item.size_id}`}
                      aria-label={`${item.display_name} · ${item.size_is_unknown ? "розмір невідомий" : item.size_label}`}
                      style={{ overflowWrap: "anywhere" }}
                    >
                      <strong>{item.display_name}</strong>
                      <span>
                        {item.size_is_unknown
                          ? "Розмір невідомий"
                          : `Розмір: ${item.size_label}`}
                      </span>
                      <span>
                        На складі: <strong>{item.quantity}</strong>
                      </span>
                      <span>
                        У резерві: <strong>{item.reserved_quantity}</strong>
                      </span>
                      <span>
                        Доступно: <strong>{item.available_quantity}</strong>
                      </span>
                      {adjustable &&
                        (item.reserved_quantity > 0 ? (
                          <span className="hint">
                            Є резерв замовлення — виправити залишок можна після
                            його видачі або скасування.
                          </span>
                        ) : editing ===
                          `${item.product_variant_id}:${item.size_id}` ? (
                          <Correction
                            store={store}
                            token={token}
                            journalKey={journalKey}
                            blocked={blocked}
                            locationId={selected.id}
                            target={{
                              product_variant_id: item.product_variant_id,
                              size_id: item.size_id,
                              name: item.display_name,
                              size: item.size_is_unknown
                                ? "розмір невідомий"
                                : item.size_label,
                              sizeIsUnknown: item.size_is_unknown,
                              quantity: item.quantity,
                            }}
                            onDone={done}
                            onCancel={() => {
                              setEditing(null);
                            }}
                            onRefused={() => {
                              void stock.refetch();
                            }}
                          />
                        ) : (
                          <button
                            type="button"
                            className="quiet"
                            disabled={blocked}
                            onClick={() => {
                              setEditing(
                                `${item.product_variant_id}:${item.size_id}`,
                              );
                              setFinding(false);
                              setCorrected(null);
                            }}
                          >
                            Виправити залишок
                          </button>
                        ))}
                    </article>
                  ))}
                  <div className="toolbar">
                    <button
                      className="quiet"
                      disabled={offset === 0 || stock.isFetching}
                      onClick={() => {
                        setOffset(Math.max(0, offset - pageSize));
                      }}
                    >
                      Попередні товари
                    </button>
                    <button
                      className="quiet"
                      disabled={!stock.data.has_more || stock.isFetching}
                      onClick={() => {
                        setOffset(offset + pageSize);
                      }}
                    >
                      Наступні товари
                    </button>
                  </div>
                  {adjustable &&
                    store.permissions.includes("inventory:receive") &&
                    (finding ? (
                      <FoundGoods
                        store={store}
                        token={token}
                        scopeKey={scopeKey}
                        journalKey={journalKey}
                        blocked={blocked}
                        locationId={selected.id}
                        onDone={done}
                        onCancel={() => {
                          setFinding(false);
                        }}
                        onRefused={() => {
                          void stock.refetch();
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        className="quiet"
                        disabled={blocked}
                        onClick={() => {
                          setFinding(true);
                          setEditing(null);
                          setCorrected(null);
                        }}
                      >
                        Знайшли товар, якого немає в списку
                      </button>
                    ))}
                </>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Goods on the shelf that the system holds none of here.
 *
 * Offered as a count against zero, so if the model and size turn out to be
 * held after all — on another page of the list, or received meanwhile — the
 * server refuses it as `STOCK_CHANGED` and says how many, and the form carries
 * on as an ordinary stocktake against that. "Size not known" is never offered:
 * the organization's sizes exclude it.
 */
function FoundGoods({
  store,
  token,
  scopeKey,
  journalKey,
  blocked,
  locationId,
  onDone,
  onCancel,
  onRefused,
}: {
  store: Store;
  token: string;
  scopeKey: string;
  journalKey: string;
  blocked: boolean;
  locationId: string;
  onDone: (corrected: Corrected) => void;
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
              {option.code}
            </option>
          ))}
        </select>
      </label>
      {sizes.error && (
        <Failure
          error={sizes.error}
          retry={() => {
            void sizes.refetch();
          }}
        />
      )}
      {variant && size ? (
        <Correction
          key={`${variant.product_variant_id}:${size.size_id}`}
          store={store}
          token={token}
          journalKey={journalKey}
          blocked={blocked}
          locationId={locationId}
          target={{
            product_variant_id: variant.product_variant_id,
            size_id: size.size_id,
            name: variant.display_name,
            size: size.code,
            sizeIsUnknown: false,
            quantity: 0,
          }}
          onDone={onDone}
          onCancel={onCancel}
          onRefused={onRefused}
        />
      ) : (
        <button type="button" className="quiet" onClick={onCancel}>
          Скасувати
        </button>
      )}
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
      <button onClick={retry}>Повторити завантаження</button>
    </div>
  );
}
