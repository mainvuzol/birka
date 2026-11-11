import { useState } from "react";
import type { JSX } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/shared/api";
import { visible } from "@/shared/visible";
import { Unread } from "@/shared/Unread";
import { Placeholder } from "@/shared/Placeholder";
import type { StockOption, Store } from "@/orders/types";
import { CatalogPicker } from "@/inventory/CatalogPicker";
import type { ReceivableVariant, SizeOption } from "@/inventory/receiptTypes";
import type { Prices } from "@/prices/types";

/**
 * A coat in hand that the till's list does not show: the books hold none
 * of it here (owner decision, 2026-10-14, В1 (а); redesign P1-5). Found in
 * the whole catalogue, its size tapped, it goes in the basket at its price;
 * pressed, the sale says how many the books hold, and «Товар на місці»
 * records the coat found, exactly what the sale is short of (F30, I18).
 * Nothing is recorded before the press, and nothing guesses the shelf.
 *
 * For whoever may answer «Товар на місці» and read the catalogue
 * (`inventory:correct_during_sale`, `inventory:receive`), and never from
 * paper: nobody stands at the shelf then (ADR-0013 §6).
 *
 * A part of the till, not a card of its own: no heading over it, its sizes
 * the till's cells with no count under the letter — the books know none —
 * and grey cells in their place while they are read (audit after stage 2,
 * sale P2-3). Its words wait for the owner's approval and stay as they were.
 */
export function FromCatalog({
  store,
  token,
  scopeKey,
  warehouse,
  locationId,
  pick,
  close,
}: {
  store: Store;
  token: string;
  scopeKey: string;
  /** The warehouse sold from, named, and its id: the seller's choice,
   * never the server's (owner decision, 2026-09-17). */
  warehouse: string;
  locationId: string;
  pick: (item: StockOption) => void;
  close: () => void;
}): JSX.Element {
  const [variant, setVariant] = useState<ReceivableVariant | null>(null);
  // The organization's sizes: the same read as a size given at the counter.
  const sizes = useQuery({
    queryKey: ["sale-sizes", scopeKey, store.id],
    queryFn: () =>
      api<SizeOption[]>(`/catalog/sizes?store_id=${store.id}`, token),
    retry: false,
  });
  // The model's price in this store, which the line starts from.
  const prices = useQuery({
    queryKey: [
      "sale-catalog-price",
      scopeKey,
      store.id,
      variant?.product_variant_id,
    ],
    queryFn: () =>
      api<Prices>(
        `/catalog/prices?store_id=${store.id}&product_variant_id=${variant?.product_variant_id ?? ""}`,
        token,
      ),
    enabled: variant !== null,
    retry: false,
  });
  // A price that could not be read is typed in the line, as for a model
  // with none.
  const priced = prices.isSuccess || prices.isError;
  return (
    <section className="from-catalog" aria-label="Товар з каталогу">
      <p className="hint">
        На складі «{visible(warehouse)}» його немає в обліку. Знайдіть модель і
        торкніться розміру; коли натиснете, як платить покупець, каса спитає, чи
        товар на полиці.
      </p>
      <CatalogPicker
        store={store}
        token={token}
        scopeKey={scopeKey}
        variant={variant}
        onVariant={setVariant}
      />
      {variant !== null &&
        (sizes.error ? (
          // What could not be read: a warning's plate (stage 2, orders task
          // list, P0-2; review, 2026-11-05).
          <Unread
            error={sizes.error}
            retry={() => {
              void sizes.refetch();
            }}
          />
        ) : sizes.isPending ? (
          <Placeholder said="Завантажуємо розміри…" cells={4} />
        ) : (
          <div
            className="cells"
            role="group"
            aria-label={`Розмір: ${visible(variant.display_name)}`}
          >
            {sizes.data.map((size) => (
              <button
                type="button"
                className="size-cell"
                key={size.size_id}
                disabled={!priced}
                onClick={() => {
                  pick({
                    location_id: locationId,
                    product_variant_id: variant.product_variant_id,
                    size_id: size.size_id,
                    display_name: variant.display_name,
                    size_label: size.code,
                    size_is_unknown: false,
                    quantity: 0,
                    reserved_quantity: 0,
                    available_quantity: 0,
                    suggested_price: prices.data?.suggested_price ?? null,
                  });
                  close();
                }}
              >
                <span className="size-letter">{visible(size.code)}</span>
              </button>
            ))}
          </div>
        ))}
      <button type="button" className="quiet" onClick={close}>
        Назад до списку
      </button>
    </section>
  );
}
