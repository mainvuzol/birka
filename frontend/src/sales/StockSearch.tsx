import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX, ReactNode, RefObject } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { api } from "@/shared/api";
import { money } from "@/orders/types";
import type { StockOption, Store } from "@/orders/types";
import { visible } from "@/shared/visible";
import { Placeholder } from "@/shared/Placeholder";
import { Icon } from "@/shared/Icon";
import { SearchField } from "@/shared/SearchField";
import { usePanelRoom } from "@/shared/panel";

const pageSize = 100;

interface StockPage {
  items: StockOption[];
  has_more: boolean;
}

/**
 * What the seller has typed, once they pause: two letters at least, else the
 * whole warehouse (redesign P0-2). Fewer is everything at once, in the same
 * render: what was searched before is never looked for again while the
 * seller starts over (review, 2026-10-18).
 */
export function useSettled(text: string): string {
  const typed = text.trim().length >= 2 ? text.trim() : "";
  const [settled, setSettled] = useState(typed);
  useEffect(() => {
    const wait = setTimeout(
      () => {
        setSettled(typed);
      },
      typed === "" ? 0 : 300,
    );
    return () => {
      clearTimeout(wait);
    };
  }, [typed]);
  return typed === "" ? "" : settled;
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

/** A model's «бирка»: its name, its price, a cell per size held. */
interface Tag {
  variantId: string;
  name: string;
  price: string | null;
  sizes: StockOption[];
}

/** Each model's cells: its sizes in the order listed, and within a size
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
    };
    // A row read twice, when a sale moved a page's edge, is shown once.
    if (
      !tag.sizes.some(
        (size) =>
          size.size_id === item.size_id &&
          size.location_id === item.location_id,
      )
    )
      tag.sizes.push(item);
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

/**
 * One size of a model at one warehouse (spec §6.13; «Усе на бірці» task
 * list, P0-5): its letter large, and under it how many are free to sell —
 * after the warehouse's name where the store sells from two. What orders
 * hold is a pin badge with its count, never counted as free. A size whose
 * every unit an order holds is dashed, «у резерві», and puts nothing in
 * the basket, but from paper. In the basket, it is filled, «×N»; with no
 * room for it, dimmed, as a button that cannot be pressed. Read aloud in
 * one go: «M, вільно 2, у резерві 1, у кошику 1».
 */
function SizeCell({
  size,
  place,
  inBasket,
  chosenIn,
  offerHeld,
  canAdd,
  pick,
}: {
  size: StockOption;
  /** Its warehouse's name, where the store sells from two; else null. */
  place: string | null;
  /** How many of it the basket — or the order — holds. */
  inBasket: number;
  /** Where those are, read aloud: «у кошику», «у замовленні». */
  chosenIn: string;
  offerHeld: boolean;
  canAdd: boolean;
  pick: (item: StockOption) => void;
}): JSX.Element {
  const free = size.available_quantity;
  const held = size.reserved_quantity;
  const heldOnly = free <= 0;
  const off = (heldOnly && !offerHeld) || !canAdd;
  const name = size.size_is_unknown
    ? "розмір невідомий"
    : visible(size.size_label);
  const said = [
    name,
    place === null ? null : visible(place),
    `вільно ${String(Math.max(free, 0))}`,
    held > 0 ? `у резерві ${String(held)}` : null,
    inBasket > 0 ? `${chosenIn} ${String(inBasket)}` : null,
  ]
    .filter((part) => part !== null)
    .join(", ");
  const under = heldOnly ? "у резерві" : String(free);
  const look = [
    "size-cell",
    inBasket > 0 && "chosen",
    heldOnly && "held-only",
    !canAdd && "no-room",
  ].filter((part): part is string => part !== false);
  return (
    <button
      type="button"
      className={look.join(" ")}
      data-stock={`${size.product_variant_id}:${size.size_id}`}
      data-location={size.location_id}
      aria-label={said}
      aria-disabled={off || undefined}
      onClick={() => {
        if (!off) pick(size);
      }}
    >
      <span className="size-letter">
        {size.size_is_unknown ? "?" : visible(size.size_label)}
      </span>
      <span className="size-free">
        {/* A long name gives way, never the count. */}
        {place !== null && (
          <span className="size-place">{visible(place)}</span>
        )}
        {place === null ? under : ` ${under}`}
      </span>
      {held > 0 && (
        <span className="size-held">
          <Icon name="held" size={12} />
          {held}
        </span>
      )}
      {inBasket > 0 && <span className="size-in">×{inBasket}</span>}
    </button>
  );
}

/**
 * The till's search (redesign P0-2): a few letters of the name or the colour,
 * and each model as a tag whose size cells put a coat in the basket (P0-3;
 * «Усе на бірці» task list, P0-5). A cell whose every unit is held for an
 * order offers nothing to sell, but from paper.
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
  chosen,
  chosenIn,
  offerHeld,
  sticky,
  searchRef,
  failure,
  offer,
  under,
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
   * than one: each cell says its own, «M» over «Свій 1», and puts the coat
   * in the basket from there (owner decision, 2026-10-17). Null for one.
   */
  places: Map<string, string> | null;
  pick: (item: StockOption) => void;
  /** Whether this cell may still go in the basket: a full one takes more of
   * what it holds, never a new line. */
  canAdd: (item: StockOption) => boolean;
  /** How many of this cell's the basket holds: «×N» on it. */
  chosen: (item: StockOption) => number;
  /** Where those are, read aloud: «у кошику», «у замовленні». */
  chosenIn: string;
  /** From paper, a size an order holds whole is still offered: the server's
   * refusal says what to do (ADR-0013 §6). */
  offerHeld: boolean;
  /** At the till, the search stays at the top while the tags scroll under
   * it; a field the page scrolls to keeps clear of it (`--find-h`). */
  sticky: boolean;
  searchRef: RefObject<HTMLInputElement>;
  /** What the till shows when the list could not be read. */
  failure: JSX.Element | null;
  /**
   * The way to a coat in hand the list does not show (redesign P1-5): under
   * a search, and when the warehouse holds nothing. Null for whoever may
   * not take it, and from paper.
   */
  offer: JSX.Element | null;
  /** What stands under the search, over the list: the till's paper switch
   * (spec S08; «Усе на бірці» task list, P0-5). */
  under?: ReactNode;
}): JSX.Element {
  const models = useMemo(
    () =>
      tags(
        (stock.data?.pages ?? []).flatMap((page) => page.items),
        [...(places?.keys() ?? [])],
      ),
    [stock.data, places],
  );
  const findRef = useRef<HTMLDivElement>(null);
  usePanelRoom(findRef, sticky, "--find-h");
  const where = warehouse
    ? `на складі «${visible(warehouse)}»`
    : "на складах магазину";
  return (
    <>
      <div ref={findRef} className={sticky ? "find sticky" : "find"}>
        <SearchField
          label="Знайти модель"
          placeholder="Модель або колір"
          value={text}
          change={type}
          inputRef={searchRef}
        />
      </div>
      {under}
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
              // A model's tag (spec §6.12): its name and price, then its
              // cells. Its colour and kind have no field of their own yet:
              // they are in its name, as the catalogue spells it.
              <div
                className="model-tag tag-row tag-outline"
                role="group"
                aria-label={visible(tag.name)}
                key={tag.variantId}
              >
                <div className="model-tag-in">
                  <p className="model-head">
                    <strong className="model-name">{visible(tag.name)}</strong>
                    {tag.price && (
                      <span className="model-price">{money(tag.price)}</span>
                    )}
                  </p>
                  <div className="cells">
                    {tag.sizes.map((size) => (
                      <SizeCell
                        key={`${size.size_id}:${size.location_id}`}
                        size={size}
                        place={
                          places?.has(size.location_id)
                            ? (places.get(size.location_id) ?? null)
                            : null
                        }
                        inBasket={chosen(size)}
                        chosenIn={chosenIn}
                        offerHeld={offerHeld}
                        canAdd={canAdd(size)}
                        pick={pick}
                      />
                    ))}
                  </div>
                  {tag.sizes.some((size) => size.size_is_unknown) && (
                    <p className="cell-note" aria-hidden="true">
                      ? — розмір невідомий
                    </p>
                  )}
                </div>
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
