import { useState } from "react";
import type { JSX } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, errorText } from "@/shared/api";
import type { Store } from "@/orders/types";
import type { ReceivableVariant } from "./receiptTypes";

const pageSize = 20;

/**
 * Pick a model from the whole catalogue, not from what a warehouse holds.
 *
 * Receiving needs it because a delivery is usually of something the shop has
 * run out of; a stocktake needs it for goods found on a shelf the system says
 * is empty. Both are exactly what a stock list can never offer. The endpoint
 * requires `inventory:receive`.
 */
export function CatalogPicker({
  store,
  token,
  scopeKey,
  variant,
  onVariant,
}: {
  store: Store;
  token: string;
  scopeKey: string;
  variant: ReceivableVariant | null;
  onVariant: (variant: ReceivableVariant | null) => void;
}): JSX.Element {
  const [search, setSearch] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const variants = useQuery({
    queryKey: ["receivable-variants", scopeKey, store.id, asked, offset],
    queryFn: () =>
      api<{ items: ReceivableVariant[]; has_more: boolean }>(
        `/catalog/receivable-variants?store_id=${store.id}&query=${encodeURIComponent(asked ?? "")}&limit=${String(pageSize)}&offset=${String(offset)}`,
        token,
      ),
    enabled: asked !== null,
    retry: false,
  });

  return (
    <>
      <form
        className="search"
        onSubmit={(event) => {
          event.preventDefault();
          setOffset(0);
          onVariant(null);
          setAsked(search.trim());
        }}
      >
        <label>
          Пошук у каталозі
          <input
            value={search}
            placeholder="Модель, джерело або колір"
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
        </label>
        <button type="submit" className="quiet">
          Знайти
        </button>
      </form>
      {asked !== null &&
        (variants.isPending ? (
          <p role="status">Шукаємо…</p>
        ) : variants.error ? (
          <div role="alert">
            <p>{errorText(variants.error)}</p>
            <button
              type="button"
              onClick={() => {
                void variants.refetch();
              }}
            >
              Повторити завантаження
            </button>
          </div>
        ) : (
          <>
            {variants.data.items.length === 0 && (
              <p>
                Нічого не знайдено. Якщо це новий товар, спершу створіть його в
                каталозі.
              </p>
            )}
            <div role="radiogroup" aria-label="Знайдені товари">
              {variants.data.items.map((item) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={
                    variant?.product_variant_id === item.product_variant_id
                  }
                  key={item.product_variant_id}
                  className={
                    variant?.product_variant_id === item.product_variant_id
                      ? "active"
                      : "quiet"
                  }
                  onClick={() => {
                    onVariant(item);
                  }}
                >
                  {item.display_name}
                </button>
              ))}
            </div>
            <div className="toolbar">
              <button
                type="button"
                className="quiet"
                disabled={offset === 0}
                onClick={() => {
                  setOffset(Math.max(0, offset - pageSize));
                }}
              >
                Попередні
              </button>
              <button
                type="button"
                className="quiet"
                disabled={!variants.data.has_more}
                onClick={() => {
                  setOffset(offset + pageSize);
                }}
              >
                Ще товари
              </button>
            </div>
          </>
        ))}
      {variant && <p className="hint">Обрано: {variant.display_name}</p>}
    </>
  );
}
