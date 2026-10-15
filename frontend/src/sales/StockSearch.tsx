import { useEffect, useState } from "react";
import type { JSX, RefObject } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "@/shared/api";
import { money } from "@/orders/types";
import type { StockOption, Store } from "@/orders/types";
import { visible } from "@/shared/visible";

const pageSize = 100;

interface StockPage {
  items: StockOption[];
  has_more: boolean;
}

/**
 * What the seller has typed, once they pause: two letters at least, else the
 * whole warehouse (redesign P0-2).
 */
export function useSettled(text: string): string {
  const typed = text.trim().length >= 2 ? text.trim() : "";
  const [settled, setSettled] = useState(typed);
  useEffect(() => {
    const wait = setTimeout(() => {
      setSettled(typed);
    }, 300);
    return () => {
      clearTimeout(wait);
    };
  }, [typed]);
  return settled;
}

/**
 * One warehouse's stock as the till lists it: by the model's name, its sizes
 * together, narrowed by what was typed. «Ще товари» reads the next hundred
 * rows onto the list rather than in place of it.
 */
export function useStock({
  store,
  token,
  journalKey,
  locationId,
  query,
  enabled,
}: {
  store: Store;
  token: string;
  journalKey: string;
  locationId: string;
  query: string;
  enabled: boolean;
}) {
  return useInfiniteQuery({
    queryKey: ["sale-stock", journalKey, store.id, locationId, query],
    queryFn: ({ pageParam }) =>
      api<StockPage>(
        `/catalog/stock-options?store_id=${store.id}&location_id=${locationId}&limit=${String(pageSize)}&offset=${String(pageParam)}${query ? `&query=${encodeURIComponent(query)}` : ""}`,
        token,
      ),
    initialPageParam: 0,
    getNextPageParam: (last: StockPage, pages: StockPage[]) =>
      last.has_more ? pages.length * pageSize : undefined,
    enabled: enabled && !!locationId,
    retry: false,
  });
}

/** A model's «бирка»: its name, its price, a chip per size held. */
interface Tag {
  variantId: string;
  name: string;
  price: string | null;
  sizes: StockOption[];
  reserved: number;
}

function tags(items: StockOption[]): Tag[] {
  const byModel = new Map<string, Tag>();
  for (const item of items) {
    const tag = byModel.get(item.product_variant_id) ?? {
      variantId: item.product_variant_id,
      name: item.display_name,
      price: item.suggested_price,
      sizes: [],
      reserved: 0,
    };
    // A row read twice, when a sale moved a page's edge, is shown once.
    if (!tag.sizes.some((size) => size.size_id === item.size_id)) {
      tag.sizes.push(item);
      tag.reserved += item.reserved_quantity;
    }
    byModel.set(item.product_variant_id, tag);
  }
  return [...byModel.values()];
}

function sizeText(item: StockOption): string {
  return item.size_is_unknown ? "Розмір невідомий" : visible(item.size_label);
}

/**
 * The till's search (redesign P0-2): a few letters of the name or the colour,
 * and each model as a tag whose size chips put a coat in the basket (P0-3).
 * A chip whose every unit is held for an order offers nothing to sell.
 */
export function StockSearch({
  text,
  type,
  query,
  stock,
  warehouse,
  pick,
  canAdd,
  searchRef,
  failure,
}: {
  text: string;
  type: (text: string) => void;
  /** The search the list shows, settled. */
  query: string;
  stock: ReturnType<typeof useStock>;
  warehouse: string;
  pick: (item: StockOption) => void;
  /** Whether this chip may still go in the basket: a full one takes more of
   * what it holds, never a new line. */
  canAdd: (item: StockOption) => boolean;
  searchRef: RefObject<HTMLInputElement>;
  /** What the till shows when the list could not be read. */
  failure: JSX.Element | null;
}): JSX.Element {
  const items = (stock.data?.pages ?? []).flatMap((page) => page.items);
  const models = tags(items);
  return (
    <>
      <label>
        Знайти модель
        <input
          ref={searchRef}
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          placeholder="Назва або колір"
          value={text}
          onChange={(event) => {
            type(event.target.value);
          }}
        />
      </label>
      {failure ??
        (stock.isPending ? (
          <p role="status">Завантажуємо товари…</p>
        ) : stock.isSuccess && models.length === 0 ? (
          query ? (
            <div className="empty">
              <p>
                За «{visible(query)}» на складі «{visible(warehouse)}» нічого
                немає. Перевірте назву або очистіть пошук.
              </p>
              <button
                type="button"
                className="quiet"
                onClick={() => {
                  type("");
                  searchRef.current?.focus();
                }}
              >
                Очистити
              </button>
            </div>
          ) : (
            <p>На цьому складі немає товарів із додатним залишком.</p>
          )
        ) : (
          <div className="tags">
            {models.map((tag) => (
              <div
                className="tag"
                role="group"
                aria-label={visible(tag.name)}
                key={tag.variantId}
              >
                <p className="tag-head">
                  <strong>{visible(tag.name)}</strong>
                  {tag.price && (
                    <span className="tag-price">{money(tag.price)}</span>
                  )}
                </p>
                <div className="chips">
                  {tag.sizes.map((size) => (
                    <button
                      type="button"
                      className="chip"
                      key={size.size_id}
                      data-stock={`${size.product_variant_id}:${size.size_id}`}
                      disabled={size.available_quantity <= 0 || !canAdd(size)}
                      onClick={() => {
                        pick(size);
                      }}
                    >
                      {sizeText(size)} · {size.available_quantity}
                    </button>
                  ))}
                </div>
                {tag.reserved > 0 && (
                  <p className="hint">
                    Ще {tag.reserved} шт. у резерві замовлення
                  </p>
                )}
              </div>
            ))}
          </div>
        ))}
      {stock.hasNextPage && (
        <button
          type="button"
          className="quiet"
          disabled={stock.isFetchingNextPage}
          onClick={() => {
            void stock.fetchNextPage();
          }}
        >
          Ще товари
        </button>
      )}
    </>
  );
}
