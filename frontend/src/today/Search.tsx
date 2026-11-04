import { useEffect, useId, useState } from "react";
import type { JSX, ReactNode, RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { CustomerRow } from "@/credits/CustomerRow";
import type { Customer, CustomerPage } from "@/credits/types";
import type { Opened } from "@/inventory/Model";
import { Unread, titleOf } from "@/orders/Orders";
import { shippingText, statusLabels } from "@/orders/types";
import type { Order, StockOption, Store } from "@/orders/types";
import { api } from "@/shared/api";
import { Icon } from "@/shared/Icon";
import { SearchField } from "@/shared/SearchField";
import { hideKeyboard } from "@/shared/telegram";
import { visible } from "@/shared/visible";

/** How many rows a group shows: past them, «Знайдено більше». */
const SHOWN = 5;
/** «Товар»'s one page: the till's own. */
const STOCK_PAGE = 100;
/** The longest waybill the server searches by. */
const WAYBILL_MAX = 64;

interface StockPage {
  items: StockOption[];
  has_more: boolean;
}

interface OrderPage {
  orders: Order[];
  has_more: boolean;
}

/** A customer found by their phone: what opens their card. */
export type Phoned = Customer & { phone_digits: string };

/**
 * «Сьогодні»'s search: what was typed, kept by the app while what a row
 * opened stands, and where each group's row goes — each group only for
 * whoever has its right in the open store — told what was typed, to keep.
 */
export interface Searched {
  typed: string;
  /** «Товар» (`inventory:view`): the model's detail. */
  model?: ((opened: Opened, typed: string) => void) | undefined;
  /** «Покупці» (`sale:credit`): the customer's card. */
  customer?: ((customer: Phoned, typed: string) => void) | undefined;
  /** «Замовлення» (`sale:view`): the order's card. */
  order?: ((order: Order, typed: string) => void) | undefined;
}

/** What may be a waybill: Latin letters and digits, spaces or hyphens
 * between, a digit at least. The server keeps a waybill's letters and
 * digits alone, so any other text would match every order. */
export function waybillLike(text: string): boolean {
  return (
    text.length <= WAYBILL_MAX &&
    /\d/.test(text) &&
    /^[0-9A-Za-z]+(?:[\s-]+[0-9A-Za-z]+)*$/.test(text)
  );
}

/** A model found, and what is free of it by size, the store's warehouses
 * summed: «S 2 · M 1», or «Усе в резерві». */
interface Model {
  variantId: string;
  name: string;
  free: string;
}

/** The page's models in the server's order; a model whose rows may go on
 * past the page is not one of them: no number is made up. */
function modelsOf(page: StockPage): Model[] {
  const byModel = new Map<string, { name: string; rows: StockOption[] }>();
  for (const row of page.items) {
    const model = byModel.get(row.product_variant_id) ?? {
      name: row.display_name,
      rows: [],
    };
    model.rows.push(row);
    byModel.set(row.product_variant_id, model);
  }
  const last = page.items.at(-1)?.product_variant_id;
  return [...byModel]
    .filter(([variantId]) => !page.has_more || variantId !== last)
    .map(([variantId, { name, rows }]) => {
      const sizes = new Map<string, number>();
      for (const row of rows) {
        if (row.available_quantity <= 0) continue;
        const size = row.size_is_unknown
          ? "розмір невідомий"
          : visible(row.size_label);
        sizes.set(size, (sizes.get(size) ?? 0) + row.available_quantity);
      }
      return {
        variantId,
        name,
        free:
          sizes.size === 0
            ? "Усе в резерві"
            : [...sizes]
                .map(([size, units]) => `${size} ${String(units)}`)
                .join(" · "),
      };
    });
}

/** A found row: its title, what it is under it, the chevron. */
function FoundRow({
  title,
  meta,
  held,
  open,
}: {
  title: string;
  meta: string;
  held: boolean;
  open: () => void;
}): JSX.Element {
  const named = useId();
  const said = useId();
  return (
    <button
      type="button"
      className="sale-row found-row"
      aria-labelledby={named}
      aria-describedby={said}
      disabled={held}
      onClick={open}
    >
      <span className="sale-main">
        <span className="cash-row-title" id={named}>
          {title}
        </span>
        <span className="sale-meta" id={said}>
          {meta}
        </span>
      </span>
      <Icon name="chevron-right" size={16} />
    </button>
  );
}

/** A group's place while it is read: two grey rows. */
function Waiting(): JSX.Element {
  return (
    <div aria-hidden="true">
      {Array.from({ length: 2 }, (_, n) => (
        <div className="sale-row found-row" key={n}>
          <span className="sale-main">
            <span className="skeleton skeleton-name" />
            <span className="skeleton skeleton-meta" />
          </span>
        </div>
      ))}
    </div>
  );
}

/** One group under its heading: read, failed, or what it found — five at
 * most, and «Знайдено більше» past them. */
function Group({
  title,
  read,
  rows,
  more,
}: {
  title: string;
  read: UseQueryResult;
  rows: ReactNode[];
  more: boolean;
}): JSX.Element {
  const label = useId();
  return (
    <section className="found-group" aria-labelledby={label}>
      <h2 id={label} className="t-label">
        {title}
      </h2>
      {read.isError ? (
        <Unread
          error={read.error}
          retry={() => {
            void read.refetch();
          }}
        />
      ) : read.isPending ? (
        <Waiting />
      ) : (
        <>
          {rows.slice(0, SHOWN)}
          {(more || rows.length > SHOWN) && (
            <p className="hint found-more">Знайдено більше — уточніть пошук.</p>
          )}
        </>
      )}
    </section>
  );
}

/** A group found: its heading, its read, its rows, and whether the server
 * found more than they show. */
interface FoundGroup {
  key: string;
  title: string;
  read: UseQueryResult;
  rows: ReactNode[];
  more: boolean;
}

/** What the search found, the groups to show; still read; or nothing. */
export interface Finding {
  groups: FoundGroup[];
  reading: boolean;
  none: boolean;
}

/**
 * What the search finds in the open store, a group by right, nothing asked
 * while `query` is "". Each read afresh whenever it is shown again: what a
 * row opened may have changed it — a payment, a receipt, a step — and no
 * figure read before is shown meanwhile (review, 2026-11-04).
 */
export function useFound({
  token,
  store,
  query,
  typed,
  held,
  search,
}: {
  token: string;
  store: Store;
  query: string;
  /** As typed, for the app to keep while what a row opened stands. */
  typed: string;
  held: boolean;
  search: Searched | undefined;
}): Finding {
  const asks = {
    model: query !== "" && search?.model !== undefined,
    customer: query !== "" && search?.customer !== undefined,
    order:
      query !== "" && search?.order !== undefined && waybillLike(query),
  };
  const words = encodeURIComponent(query);
  const stock = useQuery({
    queryKey: ["today-search", store.id, "stock", query],
    queryFn: () =>
      api<StockPage>(
        `/catalog/stock-options?store_id=${store.id}&limit=${String(STOCK_PAGE)}&query=${words}`,
        token,
      ),
    enabled: asks.model,
    retry: false,
    gcTime: 0,
  });
  const customers = useQuery({
    queryKey: ["today-search", store.id, "customers", query],
    queryFn: () =>
      api<CustomerPage>(
        `/credits/customers?store_id=${store.id}&limit=${String(SHOWN)}&query=${words}`,
        token,
      ),
    enabled: asks.customer,
    retry: false,
    gcTime: 0,
  });
  const orders = useQuery({
    queryKey: ["today-search", store.id, "orders", query],
    queryFn: () =>
      api<OrderPage>(
        `/orders?store_id=${store.id}&limit=${String(SHOWN)}&waybill=${words}`,
        token,
      ),
    enabled: asks.order,
    retry: false,
    gcTime: 0,
  });
  // The keyboard goes as a row opens (spec §6.6).
  const opening =
    <T,>(go: ((what: T, typed: string) => void) | undefined, what: T) =>
    (): void => {
      hideKeyboard();
      go?.(what, typed);
    };
  const models = stock.data ? modelsOf(stock.data) : [];
  // An erased customer has no name nor phone to be found by.
  const phoned = (customers.data?.items ?? []).filter(
    (customer): customer is Phoned => customer.phone_digits !== null,
  );
  const groups: (FoundGroup & { asked: boolean })[] = [
    {
      key: "model",
      asked: asks.model,
      title: "Товар",
      read: stock,
      more: stock.data?.has_more === true,
      rows: models.map((model) => (
        <FoundRow
          key={model.variantId}
          title={visible(model.name)}
          meta={model.free}
          held={held}
          open={opening(search?.model, {
            variantId: model.variantId,
            name: model.name,
            query,
          })}
        />
      )),
    },
    {
      key: "customer",
      asked: asks.customer,
      title: "Покупці",
      read: customers,
      more: customers.data?.has_more === true,
      rows: phoned.map((customer) => (
        <CustomerRow
          key={customer.phone_digits}
          customer={customer}
          here={store.id}
          held={held}
          open={opening(search?.customer, customer)}
        />
      )),
    },
    {
      key: "order",
      asked: asks.order,
      title: "Замовлення",
      read: orders,
      more: orders.data?.has_more === true,
      rows: (orders.data?.orders ?? []).map((order) => (
        <FoundRow
          key={order.id}
          title={titleOf(order)}
          meta={`${shippingText(order)} · ${statusLabels[order.status]}`}
          held={held}
          open={opening(search?.order, order)}
        />
      )),
    },
  ].filter((group) => group.asked);
  const shown = groups.filter(
    (group) => !group.read.isSuccess || group.rows.length > 0 || group.more,
  );
  return {
    groups: shown,
    reading: groups.some((group) => group.read.isPending),
    // Nothing asked for what was typed — only «Замовлення»'s right, and no
    // waybill — is nothing found by it too.
    none: shown.length === 0,
  };
}

/** The groups found, in the day's place; or «Нічого не знайшли». */
export function Found({
  found,
  query,
}: {
  found: Finding;
  query: string;
}): JSX.Element {
  return (
    <div className="today-found">
      {found.none ? (
        <p className="hint found-none">
          Нічого не знайшли за «{visible(query)}»
        </p>
      ) : (
        found.groups.map((group) => (
          <Group
            key={group.key}
            title={group.title}
            read={group.read}
            rows={group.rows}
            more={group.more}
          />
        ))
      )}
    </div>
  );
}

/** What «Сьогодні» searches for: from two letters, a pause after the last
 * key, or at once by Enter — and what Enter searched stands while more is
 * typed, until the next pause (review, 2026-11-04); "" while nothing is. */
export function useSearched(typed: string): {
  query: string;
  press: () => void;
} {
  const text = typed.trim().length >= 2 ? typed.trim() : "";
  const [settled, setSettled] = useState(text);
  useEffect(() => {
    // Under two letters, nothing searched before stands to come back.
    if (text === "") {
      setSettled("");
      return;
    }
    const wait = setTimeout(() => {
      setSettled(text);
    }, 300);
    return () => {
      clearTimeout(wait);
    };
  }, [text]);
  return {
    query: text === "" ? "" : settled,
    press: () => {
      setSettled(text);
    },
  };
}

/**
 * The search on «Сьогодні» (spec S04 #3, §6.6; frame task list, P2-2):
 * «Модель, покупець або ТТН» under the title's line. Once something is
 * searched, the groups stand where the day stood (`Found`), and the day
 * comes back as it was when the field is cleared. Each group is the open
 * store's, by its own section's request and right: «Товар», «Покупці»,
 * «Замовлення» by its waybill alone. A row opens the model's detail, the
 * customer's card or the order's card. What a reader hears of it is said
 * in one line that stands all along.
 */
export function Search({
  typed,
  type,
  press,
  said,
  field,
}: {
  typed: string;
  type: (text: string) => void;
  /** Enter: searched at once. */
  press: () => void;
  /** «Шукаємо…», or that nothing was found; "" otherwise. */
  said: string;
  field: RefObject<HTMLInputElement>;
}): JSX.Element {
  return (
    <>
      <form
        className="today-find"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          press();
        }}
      >
        <SearchField
          label="Модель, покупець або ТТН"
          placeholder="Модель, покупець або ТТН"
          value={typed}
          change={type}
          inputRef={field}
        />
      </form>
      <p role="status" className="visually-hidden found-said">
        {said}
      </p>
    </>
  );
}
