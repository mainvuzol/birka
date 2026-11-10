import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { BackToMore } from "@/shared/More";
import type { MoreBack } from "@/shared/More";
import { api } from "@/shared/api";
import { Unread } from "@/shared/Unread";
import { Icon } from "@/shared/Icon";
import { Placeholder } from "@/shared/Placeholder";
import { ScreenHeader } from "@/shared/ScreenHeader";
import { buzz } from "@/shared/telegram";
import { visible } from "@/shared/visible";
import { money } from "@/orders/types";
import type { Location, StockOption, Store } from "@/orders/types";
import type { Opened } from "./Model";

const pageSize = 50;

interface Page {
  items: StockOption[];
  has_more: boolean;
}

/** A model's tag: its rows at the warehouse, a cell a size. */
interface Tag {
  variantId: string;
  name: string;
  price: string | null;
  sizes: StockOption[];
}

/**
 * The warehouse's rows, a model's next to each other — the server lists them
 * so, by name and then by size — glued into one tag a model (stage 2, goods
 * task list, P2-5, as P0-3), across the pages read; a row read twice, when
 * the stock moved a page's edge, counts once.
 */
function tagsOf(pages: readonly Page[]): Tag[] {
  const tags = new Map<string, Tag>();
  for (const item of pages.flatMap((page) => page.items)) {
    const tag = tags.get(item.product_variant_id) ?? {
      variantId: item.product_variant_id,
      name: item.display_name,
      price: item.suggested_price,
      sizes: [],
    };
    if (!tag.sizes.some((size) => size.size_id === item.size_id))
      tag.sizes.push(item);
    tags.set(item.product_variant_id, tag);
  }
  return [...tags.values()];
}

/** A warehouse the store sells from: what is free there may be sold. */
function sells(location: Location): boolean {
  return location.is_active && location.can_sell && !location.damaged_returns;
}

/**
 * «Залишки» for whoever reads the stock but has no till in the store — no
 * `sale:create`: for anyone else the till's search and a model's detail are
 * the stock's place (sections task list, P0-6).
 *
 * One warehouse at a time, chosen by its chip — the only one said and
 * taken. Its models as the till shows them (stage 2, goods task list,
 * P2-5): one tag a model, its name and price, a cell a size with what is
 * free under its letter and what orders hold as a pin; «Можна продати N
 * шт.» where the store sells from it. A tap opens the model's detail
 * (S23), where its stock is corrected and its price changed. A stocktake,
 * and goods found that the list cannot show, are on «Інвентаризація» (P1-5).
 */
export function Stock({
  store,
  token,
  scopeKey,
  place: locationId,
  choose: setLocationId,
  open,
  back,
}: {
  store: Store;
  token: string;
  scopeKey: string;
  /** The warehouse chosen, kept by whoever opens this screen: a model's
   * detail opened from here comes back to it. "" for none. */
  place: string;
  choose: (place: string) => void;
  /** A model's detail, «← Залишки» over it. */
  open: (opened: Opened) => void;
  /** «← Ще» over the heading: «Ще» › «Товар» › «Залишки» until the model's
   * own screen («Усе на бірці» task list, P0-4). */
  back?: MoreBack | undefined;
}): JSX.Element | null {
  const [refreshing, setRefreshing] = useState(false);
  const [selectionLost, setSelectionLost] = useState(false);
  // «Показати ще» pressed: the cursor goes to the first tag it brings.
  const [focusAt, setFocusAt] = useState<number | null>(null);
  const shelf = useRef<HTMLDivElement>(null);
  const allowed = store.permissions.includes("inventory:view");
  const locations = useQuery({
    queryKey: ["inventory-locations", scopeKey, store.id],
    queryFn: () =>
      api<Location[]>(`/stock-locations?store_id=${store.id}`, token),
    enabled: allowed,
    retry: false,
  });
  const only =
    locations.data?.length === 1 ? (locations.data[0] ?? null) : null;
  // The only warehouse is no choice: said and taken (decided in chat,
  // 2026-11-08, as at a delivery and a stocktake).
  const chosen = locationId || (only && !selectionLost ? only.id : "");
  const selected = locations.data?.find((location) => location.id === chosen);
  const stock = useInfiniteQuery({
    queryKey: ["inventory-stock", scopeKey, store.id, chosen],
    queryFn: ({ pageParam }) =>
      api<Page>(
        `/catalog/stock-options?store_id=${store.id}&location_id=${chosen}&limit=${String(pageSize)}&offset=${String(pageParam)}`,
        token,
      ),
    initialPageParam: 0,
    getNextPageParam: (last, pages) =>
      last.has_more ? pages.length * pageSize : undefined,
    enabled: allowed && !!selected && !locations.isError,
    retry: false,
  });

  useEffect(() => {
    // Revocation clears the selection; later access never restores it implicitly.
    if (locationId && locations.isSuccess && !selected) {
      setLocationId("");
      setSelectionLost(true);
    }
  }, [locationId, locations.isSuccess, selected, setLocationId]);

  useEffect(() => {
    if (focusAt === null) return;
    const next =
      shelf.current?.querySelectorAll<HTMLElement>(".model-open")[focusAt];
    if (next) {
      next.focus();
      setFocusAt(null);
    }
  });

  async function refresh(): Promise<void> {
    setRefreshing(true);
    try {
      const current = await locations.refetch();
      if (
        !current.isError &&
        current.data?.some((location) => location.id === chosen)
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

  const selling = selected ? sells(selected) : false;
  const read = tagsOf(stock.data?.pages ?? []);
  // The last model read may go on past the page: shown once it is whole,
  // with the next page — its cells and «Можна продати» all there (review,
  // 2026-11-08). Alone on its page, shown as it is.
  const tags = stock.hasNextPage && read.length > 1 ? read.slice(0, -1) : read;

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
            Оновити
          </button>
        }
      />
      <section className="stock-screen">
        {selectionLost && (
          <p role="status">
            Обраний склад більше не доступний. Оберіть інший склад.
          </p>
        )}
        {locations.isPending ? (
          <p role="status">Завантажуємо склади…</p>
        ) : locations.error ? (
          <Unread
            error={locations.error}
            retry={() => {
              void refresh();
            }}
          />
        ) : locations.data.length === 0 ? (
          // Nothing said of the rule (stage 2, goods task list, P1-5).
          <p>Тут немає складів.</p>
        ) : (
          <>
            {only && !selectionLost ? (
              <p className="t-row stock-place">Склад «{visible(only.name)}»</p>
            ) : (
              <div
                className="chips stock-places"
                role="group"
                aria-label="Склад"
              >
                {locations.data.map((location) => (
                  <button
                    type="button"
                    className="chip"
                    key={location.id}
                    aria-pressed={location.id === chosen}
                    disabled={refreshing}
                    onClick={() => {
                      // A choice, felt (spec §4.4).
                      buzz("selection");
                      setLocationId(location.id);
                      setSelectionLost(false);
                    }}
                  >
                    {visible(location.name)}
                  </button>
                ))}
              </div>
            )}
            {selected && (
              <>
                {!selected.is_active && (
                  <p className="t-meta">
                    Склад на паузі. Залишки доступні для перегляду.
                  </p>
                )}
                {selected.damaged_returns && (
                  <p className="t-meta">
                    Це склад «Брак»: тут лежить пошкоджений товар із повернень,
                    він не продається. Змінюється лише через розділ «Брак».
                  </p>
                )}
                {refreshing || stock.isPending ? (
                  <Placeholder said="Завантажуємо залишки…" />
                ) : stock.error && !stock.isFetchNextPageError ? (
                  // Read again and refused: nothing of what was read before
                  // stays in sight.
                  <Unread
                    error={stock.error}
                    retry={() => {
                      void refresh();
                    }}
                  />
                ) : (
                  <>
                    {stock.isFetchNextPageError && (
                      <Unread
                        error={stock.error}
                        retry={() => {
                          void stock.fetchNextPage();
                        }}
                      />
                    )}
                    {tags.length === 0 && (
                      <p className="t-meta">
                        На цьому складі зараз немає товару.
                      </p>
                    )}
                    <div className="tags stock-tags" ref={shelf}>
                      {tags.map((tag) => (
                        <StockTag
                          key={tag.variantId}
                          tag={tag}
                          selling={selling}
                          priced={!selected.damaged_returns}
                          open={() => {
                            open({
                              variantId: tag.variantId,
                              name: tag.name,
                              query: "",
                            });
                          }}
                        />
                      ))}
                    </div>
                    {stock.hasNextPage && (
                      <button
                        type="button"
                        className="quiet"
                        disabled={stock.isFetchingNextPage}
                        onClick={() => {
                          setFocusAt(tags.length);
                          void stock.fetchNextPage();
                        }}
                      >
                        Показати ще
                      </button>
                    )}
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

/**
 * A model's tag at the warehouse (spec §6.12): its name — the button that
 * opens its detail, a tap anywhere on the tag doing the same — its price,
 * and a cell a size. «Можна продати N шт.» where the store sells from it.
 */
function StockTag({
  tag,
  selling,
  priced,
  open,
}: {
  tag: Tag;
  selling: boolean;
  /** «Брак» is not for sale: no price. */
  priced: boolean;
  open: () => void;
}): JSX.Element {
  const free = tag.sizes.reduce(
    (sum, size) => sum + Math.max(size.available_quantity, 0),
    0,
  );
  return (
    // Its name is its button's: read once (review, 2026-11-08).
    <div
      className="model-tag tag-row tag-outline stock-tag"
      data-model={tag.variantId}
      onClick={(event) => {
        // The name's own button says it once.
        if (event.target instanceof Element && event.target.closest("button"))
          return;
        open();
      }}
    >
      <div className="model-tag-in">
        <p className="model-head">
          <button
            type="button"
            className="model-name model-open"
            onClick={open}
          >
            {visible(tag.name)}
          </button>
          {priced && tag.price && (
            <span className="model-price">{money(tag.price)}</span>
          )}
        </p>
        <ul className="cells" aria-label="Розміри">
          {tag.sizes.map((size) => (
            <StockCell key={size.size_id} size={size} selling={selling} />
          ))}
        </ul>
        {tag.sizes.some((size) => size.size_is_unknown) && (
          <p className="cell-note" aria-hidden="true">
            ? — розмір невідомий
          </p>
        )}
        {selling && free > 0 && (
          <p className="t-meta stock-free">Можна продати {free} шт.</p>
        )}
      </div>
    </div>
  );
}

/**
 * A size at the warehouse (spec §6.13), as the till's cell: its letter
 * large, under it what is free — or, where every unit is held, «у
 * резерві», dashed; what orders hold is the pin. Where the store does not
 * sell from the warehouse, what lies there. Read aloud in one go: «M,
 * вільно 2, у резерві 1».
 */
function StockCell({
  size,
  selling,
}: {
  size: StockOption;
  selling: boolean;
}): JSX.Element {
  const free = Math.max(size.available_quantity, 0);
  const held = size.reserved_quantity;
  const heldOnly = selling && free <= 0;
  const name = size.size_is_unknown
    ? "розмір невідомий"
    : visible(size.size_label);
  const said = [
    name,
    selling ? `вільно ${String(free)}` : `${String(size.quantity)} шт.`,
    held > 0 ? `у резерві ${String(held)}` : null,
  ]
    .filter((part) => part !== null)
    .join(", ");
  return (
    <li
      className={heldOnly ? "size-cell held-only" : "size-cell"}
      data-stock={`${size.product_variant_id}:${size.size_id}`}
    >
      <span className="visually-hidden">{said}</span>
      <span className="size-letter" aria-hidden="true">
        {size.size_is_unknown ? "?" : visible(size.size_label)}
      </span>
      <span className="size-free" aria-hidden="true">
        {selling ? (heldOnly ? "у резерві" : free) : size.quantity}
      </span>
      {held > 0 && (
        <span className="size-held" aria-hidden="true">
          <Icon name="held" size={12} />
          {held}
        </span>
      )}
    </li>
  );
}
