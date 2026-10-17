import { useEffect, useMemo, useState } from "react";
import type { JSX, RefObject } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { api } from "@/shared/api";
import { money } from "@/orders/types";
import type { StockOption, Store } from "@/orders/types";
import { visible } from "@/shared/visible";
import { Placeholder } from "@/shared/Placeholder";

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
 * rows onto the list rather than in place of it. `locationId` null asks for
 * every warehouse the store sells from (sale-slice TZ, P2-5).
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
  locationId: string | null;
  query: string;
  enabled: boolean;
}) {
  return useInfiniteQuery({
    queryKey: ["sale-stock", journalKey, store.id, locationId ?? "all", query],
    queryFn: ({ pageParam }) =>
      api<StockPage>(
        `/catalog/stock-options?store_id=${store.id}${locationId === null ? "" : `&location_id=${locationId}`}&limit=${String(pageSize)}&offset=${String(pageParam)}${query ? `&query=${encodeURIComponent(query)}` : ""}`,
        token,
      ),
    initialPageParam: 0,
    getNextPageParam: (last: StockPage, pages: StockPage[]) =>
      last.has_more ? pages.length * pageSize : undefined,
    enabled: enabled && locationId !== "",
    retry: false,
    // A search typed keeps the list in place until the new one comes
    // (P2-6): the same warehouses' list, never another's.
    placeholderData: (
      previous: InfiniteData<StockPage, number> | undefined,
      before,
    ) => (before?.queryKey[3] === (locationId ?? "all") ? previous : undefined),
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

/** Each model's chips: its sizes in the order listed, and within a size
 * each warehouse in the order the store lists them (`places`). */
function tags(items: StockOption[], places: string[]): Tag[] {
  const byModel = new Map<string, Tag>();
  // Each model's own order of sizes, as the server listed them: a size
  // another model lists first is not first here (review, 2026-10-17).
  const sizeRank = new Map<string, number>();
  const ranked = new Map<string, number>();
  for (const item of items) {
    const key = `${item.product_variant_id}:${item.size_id}`;
    if (!sizeRank.has(key)) {
      const next = ranked.get(item.product_variant_id) ?? 0;
      sizeRank.set(key, next);
      ranked.set(item.product_variant_id, next + 1);
    }
  }
  const rankOf = (item: StockOption): number =>
    sizeRank.get(`${item.product_variant_id}:${item.size_id}`) ?? 0;
  for (const item of items) {
    const tag = byModel.get(item.product_variant_id) ?? {
      variantId: item.product_variant_id,
      name: item.display_name,
      price: item.suggested_price,
      sizes: [],
      reserved: 0,
    };
    // A row read twice, when a sale moved a page's edge, is shown once.
    if (
      !tag.sizes.some(
        (size) =>
          size.size_id === item.size_id &&
          size.location_id === item.location_id,
      )
    ) {
      tag.sizes.push(item);
      tag.reserved += item.reserved_quantity;
    }
    byModel.set(item.product_variant_id, tag);
  }
  const placeRank = (item: StockOption): number => {
    const at = places.indexOf(item.location_id);
    return at < 0 ? places.length : at;
  };
  for (const tag of byModel.values())
    tag.sizes.sort(
      (a, b) => rankOf(a) - rankOf(b) || placeRank(a) - placeRank(b),
    );
  return [...byModel.values()];
}

function sizeText(item: StockOption): string {
  return item.size_is_unknown ? "Розмір невідомий" : visible(item.size_label);
}

/**
 * The till's search (redesign P0-2): a few letters of the name or the colour,
 * and each model as a tag whose size chips put a coat in the basket (P0-3).
 * A chip whose every unit is held for an order offers nothing to sell, but
 * from paper.
 */
export function StockSearch({
  text,
  type,
  query,
  stock,
  warehouse,
  places,
  pick,
  canAdd,
  offerHeld,
  searchRef,
  failure,
  offer,
}: {
  text: string;
  type: (text: string) => void;
  /** The search the list shows, settled. */
  query: string;
  stock: ReturnType<typeof useStock>;
  /** The warehouse listed, named; empty when every one the store sells
   * from is. */
  warehouse: string;
  /**
   * The store's warehouses in its order, by id, when the list holds more
   * than one: each chip says its own, «M · Свій 1», and puts the coat in
   * the basket from there (owner decision, 2026-10-17). Null for one.
   */
  places: Map<string, string> | null;
  pick: (item: StockOption) => void;
  /** Whether this chip may still go in the basket: a full one takes more of
   * what it holds, never a new line. */
  canAdd: (item: StockOption) => boolean;
  /** From paper, a size an order holds whole is still offered: the server's
   * refusal says what to do (ADR-0013 §6). */
  offerHeld: boolean;
  searchRef: RefObject<HTMLInputElement>;
  /** What the till shows when the list could not be read. */
  failure: JSX.Element | null;
  /**
   * The way to a coat in hand the list does not show (redesign P1-5): under
   * a search, and when the warehouse holds nothing. Null for whoever may
   * not take it, and from paper.
   */
  offer: JSX.Element | null;
}): JSX.Element {
  const models = useMemo(
    () =>
      tags(
        (stock.data?.pages ?? []).flatMap((page) => page.items),
        [...(places?.keys() ?? [])],
      ),
    [stock.data, places],
  );
  const where = warehouse
    ? `на складі «${visible(warehouse)}»`
    : "на складах магазину";
  return (
    <>
      <label className="till-search">
        Знайти модель
        <input
          ref={searchRef}
          type="search"
          maxLength={200}
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
        // Nothing found before, and the new search not read yet: never the
        // old «нічого немає» under the new words.
        (stock.isPending || (stock.isPlaceholderData && models.length === 0) ? (
          <Placeholder said="Завантажуємо товари…" />
        ) : stock.isSuccess && models.length === 0 ? (
          query ? (
            <div className="empty">
              <p>
                За «{visible(query)}» {where} нічого немає. Перевірте назву або
                очистіть пошук.
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
              {offer}
            </div>
          ) : (
            <div className="empty">
              <p>
                {where.charAt(0).toUpperCase() + where.slice(1)} зараз немає
                товару в обліку.
              </p>
              {offer}
            </div>
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
                      key={`${size.size_id}:${size.location_id}`}
                      data-stock={`${size.product_variant_id}:${size.size_id}`}
                      data-location={size.location_id}
                      disabled={
                        (size.available_quantity <= 0 && !offerHeld) ||
                        !canAdd(size)
                      }
                      onClick={() => {
                        pick(size);
                      }}
                    >
                      {sizeText(size)} ·{" "}
                      {places?.has(size.location_id)
                        ? `${visible(places.get(size.location_id) ?? "")} ${String(size.available_quantity)}`
                        : size.available_quantity}
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
          disabled={stock.isFetchingNextPage || stock.isPlaceholderData}
          onClick={() => {
            void stock.fetchNextPage();
          }}
        >
          Ще товари
        </button>
      )}
      {/* Found something, but maybe not the coat in hand. */}
      {failure === null && query && models.length > 0 && offer}
    </>
  );
}
