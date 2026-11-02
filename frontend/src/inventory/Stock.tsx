import { useEffect, useState } from "react";
import { BackToMore } from "@/shared/More";
import type { MoreBack } from "@/shared/More";
import type { JSX } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, errorText } from "@/shared/api";
import { visible } from "@/shared/visible";
import { ScreenHeader } from "@/shared/ScreenHeader";
import { money } from "@/orders/types";
import type { Location, StockOption, Store } from "@/orders/types";
import { PriceEditor } from "@/prices/SuggestedPrice";
import { Correction } from "./Correction";
import type { Corrected } from "./Correction";
import { reasonLabels } from "./adjustmentTypes";
import { useCountCommand } from "./stocktakeCommands";

const pageSize = 50;

/**
 * Balances at one warehouse, and — for whoever holds `inventory:adjust` —
 * the place to correct one.
 *
 * Correcting lives beside the balance it corrects: a manager looking at a
 * wrong number fixes it from there.
 *
 * Each model shows the price this store's till suggests, and whoever holds
 * `catalog:set_price` changes it from here (owner decision, 2026-10-01).
 *
 * Only for whoever reads the stock but has no till in the store — no
 * `sale:create`, or a store that does not trade: for anyone else the till's
 * search and a model's detail are the stock's place (sections task list,
 * P0-6). A stocktake, and goods found that the list cannot show, are on
 * «Інвентаризація» (P1-5).
 */
export function Stock({
  store,
  token,
  scopeKey,
  journalKey,
  blocked,
  back,
}: {
  store: Store;
  token: string;
  scopeKey: string;
  journalKey: string;
  blocked: boolean;
  /** «← Ще» over the heading: «Ще» › «Товар» › «Залишки» until the model's
   * own screen («Усе на бірці» task list, P0-4). */
  back?: MoreBack | undefined;
}): JSX.Element | null {
  const [locationId, setLocationId] = useState("");
  const [offset, setOffset] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [selectionLost, setSelectionLost] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [corrected, setCorrected] = useState<Corrected | null>(null);
  const [pricing, setPricing] = useState<string | null>(null);
  const [priced, setPriced] = useState<string | null>(null);
  // A correction waits for a count to settle.
  const countCommand = useCountCommand();
  const correcting =
    blocked || countCommand.busy || countCommand.pending !== null;
  const allowed = store.permissions.includes("inventory:view");
  const canAdjust = store.permissions.includes("inventory:adjust");
  const canPrice = store.permissions.includes("catalog:set_price");
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
    }
  }, [locationId, locations.isSuccess, selected]);

  function done(result: Corrected): void {
    setEditing(null);
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

  // Never opened without the right: nothing is said of the rule
  // («Усе на бірці» task list, P2-1).
  if (!allowed) return null;

  return (
    <>
      <ScreenHeader
        title="Залишки"
        back={back && <BackToMore back={back} />}
        aside={
          <button
            className="quiet"
            disabled={refreshing || locations.isFetching || stock.isFetching}
            onClick={() => {
              void refresh();
            }}
          >
            Оновити залишки
          </button>
        }
      />
      <section>
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
                  setCorrected(null);
                  setPricing(null);
                  setPriced(null);
                }}
              >
                <option value="">Оберіть склад</option>
                {locations.data.map((location) => (
                  <option key={location.id} value={location.id}>
                    {visible(location.name)}
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
                <h3>{visible(selected.name)}</h3>
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
                    Коригування записано: {visible(corrected.target.name)} ·{" "}
                    {visible(corrected.target.size)} —{" "}
                    {reasonLabels[corrected.reason]}, облік{" "}
                    {corrected.adjustment.quantity_before} →{" "}
                    {corrected.adjustment.quantity_after}.
                  </p>
                )}
                {priced && (
                  <p role="status">Ціну продажу збережено: {visible(priced)}.</p>
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
                        aria-label={`${visible(item.display_name)} · ${item.size_is_unknown ? "розмір невідомий" : visible(item.size_label)}`}
                        style={{ overflowWrap: "anywhere" }}
                      >
                        <strong>{visible(item.display_name)}</strong>
                        <span>
                          {item.size_is_unknown
                            ? "Розмір невідомий"
                            : `Розмір: ${visible(item.size_label)}`}
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
                        {/* «Брак» is not for sale, so it suggests no price. */}
                        {!selected.damaged_returns && (
                          <span>
                            Ціна продажу:{" "}
                            <strong>
                              {item.suggested_price
                                ? money(item.suggested_price)
                                : "не задана"}
                            </strong>
                          </span>
                        )}
                        {canPrice &&
                          !selected.damaged_returns &&
                          (pricing ===
                          `${item.product_variant_id}:${item.size_id}` ? (
                            <PriceEditor
                              store={store}
                              token={token}
                              scopeKey={scopeKey}
                              variantId={item.product_variant_id}
                              blocked={blocked}
                              onDone={() => {
                                setPricing(null);
                                setPriced(item.display_name);
                              }}
                              onCancel={() => {
                                setPricing(null);
                              }}
                            />
                          ) : (
                            <button
                              type="button"
                              className="quiet"
                              disabled={blocked}
                              onClick={() => {
                                setPricing(
                                  `${item.product_variant_id}:${item.size_id}`,
                                );
                                setPriced(null);
                              }}
                            >
                              Змінити ціну продажу
                            </button>
                          ))}
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
                              blocked={correcting}
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
                  </>
                )}
              </>
            )}
          </>
        )}
      </section>
    </>
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
