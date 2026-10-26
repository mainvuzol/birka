import { useEffect, useRef, useState } from "react";
import type { JSX, RefObject } from "react";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { api, errorText } from "@/shared/api";
import { visible } from "@/shared/visible";
import { useSettled } from "@/sales/StockSearch";
import { Placeholder } from "@/shared/Placeholder";
import { shippingText, statusLabels, statusPills } from "./types";
import type { Order, OrderItem, Store } from "./types";

interface OrderPage {
  orders: Order[];
  has_more: boolean;
}

/** The open orders a page: all of a shop's at once, as a rule. */
const OPEN_PAGE = 100;
/** The closed and the found, fifty at a time, each page under those read. */
const PAGE = 50;
/** How many of an order's lines a row names before «+ ще N». */
const NAMED = 2;
/** How much of where an order goes abroad a row says (review,
 * 2026-10-23): the note may hold a thousand characters. */
const NOTE_SHOWN = 60;

/** What «Замовлення» keeps while an order is open: what was typed, and
 * whether the closed are shown (review, 2026-10-23). */
export interface OrdersView {
  query: string;
  pressed: string;
  closedShown: boolean;
}
export const freshOrdersView: OrdersView = {
  query: "",
  pressed: "",
  closedShown: false,
};

/** «Лоран шоколад · M», and «× 2» for more than one. */
export function tagOf(
  item: Pick<OrderItem, "display_name" | "size_label" | "quantity">,
): string {
  const size =
    item.size_label === null || item.size_label === "UNKNOWN"
      ? "розмір невідомий"
      : visible(item.size_label);
  return `${visible(item.display_name)} · ${size}${
    item.quantity > 1 ? ` × ${String(item.quantity)}` : ""
  }`;
}

/** How it goes, in a row: an order abroad by the start of its note. */
function goesBy(order: Order): string {
  const note = order.abroad_note ?? "";
  const points = Array.from(note);
  return order.destination === "ABROAD" && points.length > NOTE_SHOWN
    ? `За кордон · ${visible(points.slice(0, NOTE_SHOWN).join(""))}…`
    : shippingText(order);
}

/** « · з 21.10»: since when the order waits, by the phone's own calendar,
 * never broken after «з». */
export function since(iso: string | null | undefined): string {
  return iso ? ` · ${sinceDay(iso)}` : "";
}

/** «з 21.10», alone. */
export function sinceDay(iso: string): string {
  const at = new Date(iso);
  return `з\u00a0${String(at.getDate()).padStart(2, "0")}.${String(at.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * One order as a parcel's tag (orders task list, P0-1): its goods, how it
 * goes and since when, and its status — never its sum or the way it was
 * paid (G32), nor the eight characters of its id (owner decision,
 * 2026-10-23, В1). The pill under the goods, as «Закриття»'s and the
 * correction's.
 */
export function OrderRow({
  order,
  open,
}: {
  order: Order;
  open: () => void;
}): JSX.Element {
  const named = order.items.slice(0, NAMED);
  const more = order.items.length - named.length;
  return (
    <button type="button" className="sale-row order-row" onClick={open}>
      <span className="sale-main">
        <span className="sale-goods">
          {named.map((item) => (
            <span key={item.id}>{tagOf(item)}</span>
          ))}
          {more > 0 && <span>+ ще {more}</span>}
        </span>
        <span className="sale-meta">
          {goesBy(order)}
          {since(order.created_at)}
        </span>
        <span className={statusPills[order.status]}>
          {statusLabels[order.status]}
        </span>
      </span>
      <span className="sale-open" aria-hidden="true">
        ›
      </span>
    </button>
  );
}

/** Pages of orders, each under those read; a row read twice shown once. */
function useOrders(
  store: Store,
  token: string,
  query: string,
  size: number,
  enabled: boolean,
) {
  const pages = useInfiniteQuery({
    queryKey: ["orders", store.id, query],
    queryFn: ({ pageParam }) =>
      api<OrderPage>(
        `/orders?store_id=${store.id}&limit=${String(size)}&offset=${String(pageParam)}${query}`,
        token,
      ),
    initialPageParam: 0,
    getNextPageParam: (last: OrderPage, read: OrderPage[]) =>
      last.has_more ? read.length * size : undefined,
    enabled,
    retry: false,
    // What was typed keeps the rows in place until the new ones come, as at
    // the till.
    placeholderData: keepPreviousData,
  });
  const orders = [
    ...new Map(
      (pages.data?.pages ?? [])
        .flatMap((page) => page.orders)
        .map((order) => [order.id, order]),
    ).values(),
  ];
  return { pages, orders };
}

/** What could not be read, and «Спробувати ще раз», over the rows read: a
 * warning's plate, as «Каса»'s, never a debt's red (orders task list,
 * P2-3). The card's too. */
export function Unread({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}): JSX.Element {
  return (
    <div className="notice read-failure" role="alert">
      <p>{errorText(error)}</p>
      <button type="button" onClick={retry}>
        Спробувати ще раз
      </button>
    </div>
  );
}

/**
 * «Замовлення» (orders task list, P0-1): what is to be sent and what is on
 * its way on top, oldest first, a row a parcel; the closed under «Показати
 * завершені»; an order found by its waybill as it is typed; «+» for a new
 * one. Read again on every step, as the app comes back, and on entering.
 */
export function Orders({
  store,
  token,
  blocked,
  view,
  change,
  open,
  create,
  mode = null,
}: {
  store: Store;
  token: string;
  blocked: boolean;
  /** Kept by the workspace, so an order opened and left finds it so. */
  view: OrdersView;
  change: (view: OrdersView) => void;
  open: (order: Order) => void;
  create: () => void;
  /**
   * «Борги | Замовлення» under the heading, for whoever has both
   * (navigation task list, P0-2); none for anyone else.
   */
  mode?: JSX.Element | null;
}): JSX.Element {
  const mayCreate = store.permissions.includes("sale:create");
  const mayRead = store.permissions.includes("sale:view");
  // A waybill, searched once they pause, from two characters, as the till's
  // search; Enter searches at once.
  const { query, pressed, closedShown } = view;
  const typed = useSettled(query);
  const search = pressed !== "" && pressed === query.trim() ? pressed : typed;
  const field = useRef<HTMLInputElement>(null);
  // The closed shown or put away: the focus on what took the button's
  // place, once it is there — the closed' heading when they come, else
  // «Сховати завершені» (review, 2026-10-23).
  const [focusTo, setFocusTo] = useState<"closed" | "show" | null>(null);
  const closedHeading = useRef<HTMLHeadingElement>(null);
  const showClosed = useRef<HTMLButtonElement>(null);
  const hideClosed = useRef<HTMLButtonElement>(null);
  function setClosedShown(shown: boolean): void {
    setFocusTo(shown ? "closed" : "show");
    change({ ...view, closedShown: shown });
  }

  const found = useOrders(
    store,
    token,
    `&waybill=${encodeURIComponent(search)}`,
    PAGE,
    mayRead && search !== "",
  );
  const opened = useOrders(store, token, "&status=open", OPEN_PAGE, mayRead);
  const nothingOpen =
    opened.pages.data !== undefined && opened.orders.length === 0;
  // Read as soon as nothing is open: whether there was ever an order.
  const closed = useOrders(
    store,
    token,
    "&status=closed",
    PAGE,
    mayRead && (closedShown || nothingOpen),
  );
  useEffect(() => {
    const target =
      focusTo === "show"
        ? showClosed.current
        : focusTo === "closed"
          ? (closedHeading.current ??
            (closed.pages.isPending ? null : hideClosed.current))
          : null;
    if (!target) return;
    target.focus();
    setFocusTo(null);
  });
  const toSend = opened.orders.filter(
    (order) => order.status === "READY_TO_DISPATCH",
  );
  const onWay = opened.orders.filter(
    (order) => order.status === "DISPATCHED" || order.status === "ARRIVED",
  );
  // The open ones counted once every one of them is read.
  const counted = !opened.pages.hasNextPage;

  function group(
    title: string,
    orders: Order[],
    count: boolean,
    heading?: RefObject<HTMLHeadingElement>,
  ): JSX.Element | null {
    if (orders.length === 0) return null;
    return (
      <>
        <h3 className="sale-day" ref={heading} tabIndex={-1}>
          {title}
          {count ? ` · ${String(orders.length)}` : ""}
        </h3>
        <ul className="order-rows" aria-label={title}>
          {orders.map((order) => (
            <li key={order.id}>
              <OrderRow
                order={order}
                open={() => {
                  open(order);
                }}
              />
            </li>
          ))}
        </ul>
      </>
    );
  }

  function more(
    pages: ReturnType<typeof useOrders>["pages"],
  ): JSX.Element | null {
    return pages.hasNextPage ? (
      <button
        type="button"
        className="quiet"
        disabled={pages.isFetching}
        onClick={() => {
          void pages.fetchNextPage();
        }}
      >
        Показати ще
      </button>
    ) : null;
  }

  return (
    <section className="orders">
      <div className="orders-head">
        <h2>Замовлення</h2>
        {mayCreate && (
          <button
            type="button"
            className="orders-add"
            aria-label="Нове замовлення"
            disabled={blocked}
            onClick={create}
          >
            +
          </button>
        )}
      </div>
      {mode}
      {/* Never opened without the right (orders task list, P2-1): nothing
          is said of the rule. */}
      {!mayRead ? null : (
        <>
          <form
            className="search"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              change({
                ...view,
                pressed: query.trim().length >= 2 ? query.trim() : "",
              });
            }}
          >
            <label className="till-search">
              Номер ТТН
              <input
                type="search"
                enterKeyHint="search"
                autoComplete="off"
                ref={field}
                maxLength={64}
                value={query}
                onChange={(event) => {
                  change({ ...view, query: event.target.value });
                }}
              />
            </label>
          </form>
          {search !== "" ? (
            // What was typed before stands until the answer: «not found» is
            // said of this search only (review, 2026-10-23).
            found.pages.isPending ||
            (found.pages.isPlaceholderData && found.orders.length === 0) ? (
              <Placeholder said="Шукаємо…" rows={3} day={false} />
            ) : (
              <>
                {found.pages.error && (
                  <Unread
                    error={found.pages.error}
                    retry={() => {
                      void found.pages.refetch();
                    }}
                  />
                )}
                {found.pages.data && found.orders.length === 0 ? (
                  <div className="orders-empty">
                    <p>
                      За «{visible(search)}» замовлень не знайдено. Перевірте
                      номер ТТН.
                    </p>
                    <button
                      type="button"
                      className="quiet"
                      onClick={() => {
                        change({ ...view, query: "", pressed: "" });
                        field.current?.focus();
                      }}
                    >
                      Очистити
                    </button>
                  </div>
                ) : (
                  <ul className="order-rows" aria-label="Знайдені замовлення">
                    {found.orders.map((order) => (
                      <li key={order.id}>
                        <OrderRow
                          order={order}
                          open={() => {
                            open(order);
                          }}
                        />
                      </li>
                    ))}
                  </ul>
                )}
                {more(found.pages)}
              </>
            )
          ) : opened.pages.isPending ? (
            // A group's heading and its rows' places (orders task list,
            // P2-2).
            <Placeholder said="Завантажуємо замовлення…" rows={3} />
          ) : (
            <>
              {opened.pages.error && (
                <Unread
                  error={opened.pages.error}
                  retry={() => {
                    void opened.pages.refetch();
                  }}
                />
              )}
              {group("Потрібно відправити", toSend, counted)}
              {group("В дорозі", onWay, counted)}
              {more(opened.pages)}
              {nothingOpen &&
                (closed.pages.isPending ? (
                  <Placeholder said="Завантажуємо замовлення…" rows={3} />
                ) : closed.pages.error ? (
                  <Unread
                    error={closed.pages.error}
                    retry={() => {
                      void closed.pages.refetch();
                    }}
                  />
                ) : closed.orders.length === 0 ? (
                  <div className="orders-empty">
                    <p>
                      Замовлень ще немає. Замовлення тримає товар у резерві,
                      поки його не відправили.
                    </p>
                    {mayCreate && (
                      <button type="button" disabled={blocked} onClick={create}>
                        Нове замовлення
                      </button>
                    )}
                  </div>
                ) : (
                  !closedShown && <p>Зараз нічого не треба відправляти.</p>
                ))}
              {closedShown ? (
                <>
                  {closed.pages.error && !nothingOpen && (
                    <Unread
                      error={closed.pages.error}
                      retry={() => {
                        void closed.pages.refetch();
                      }}
                    />
                  )}
                  {closed.pages.isPending
                    ? // Nothing open: its places stand above already.
                      !nothingOpen && (
                        <Placeholder said="Завантажуємо замовлення…" rows={3} />
                      )
                    : !closed.pages.error &&
                      closed.orders.length === 0 && (
                        <p>Завершених замовлень немає.</p>
                      )}
                  {group("Завершені", closed.orders, false, closedHeading)}
                  {more(closed.pages)}
                  <button
                    type="button"
                    className="quiet"
                    ref={hideClosed}
                    onClick={() => {
                      setClosedShown(false);
                    }}
                  >
                    Сховати завершені
                  </button>
                </>
              ) : (
                (!nothingOpen || closed.orders.length > 0) && (
                  <button
                    type="button"
                    className="quiet"
                    ref={showClosed}
                    onClick={() => {
                      setClosedShown(true);
                    }}
                  >
                    Показати завершені
                  </button>
                )
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
