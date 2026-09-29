import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, errorText } from "@/shared/api";
import type { Location, StockOption, Store } from "@/orders/types";

const pageSize = 50;

export function Stock({
  store,
  token,
  scopeKey,
}: {
  store: Store;
  token: string;
  scopeKey: string;
}): JSX.Element {
  const [locationId, setLocationId] = useState("");
  const [offset, setOffset] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [selectionLost, setSelectionLost] = useState(false);
  const allowed = store.permissions.includes("inventory:view");
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

  useEffect(() => {
    // Revocation clears the selection; later access never restores it implicitly.
    if (locationId && locations.isSuccess && !selected) {
      setLocationId("");
      setOffset(0);
      setSelectionLost(true);
    }
  }, [locationId, locations.isSuccess, selected]);

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
              }}
            >
              <option value="">Оберіть склад</option>
              {locations.data.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
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
