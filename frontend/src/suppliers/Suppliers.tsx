import { useEffect, useId, useRef, useState } from "react";
import type { JSX } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "@/shared/api";
import { Unread } from "@/shared/Unread";
import { decimal, kopecks, money } from "@/orders/types";
import type { Store } from "@/orders/types";
import { visible } from "@/shared/visible";
import { Icon } from "@/shared/Icon";
import { shortDay } from "@/credits/format";
import { useReturnToSupplier } from "./commands";
import { NewReturn } from "./NewReturn";
import { SupplierFilter, useSuppliers } from "./Picker";
import { ReturnDetail } from "./ReturnDetail";
import { SupplierList } from "./SupplierList";
import { goodsText, placeText, unitsOf } from "./returnWords";
import type { ReturnPage, SetOff, SupplierReturn } from "./types";
import { BackToMore } from "@/shared/More";
import type { MoreBack } from "@/shared/More";
import { ScreenHeader } from "@/shared/ScreenHeader";

export { refusalText, returnedText } from "./returnWords";

const pageSize = 20;

type View =
  | { screen: "list" }
  | { screen: "return"; item: SupplierReturn }
  | { screen: "new" }
  | { screen: "suppliers" };

/**
 * Goods returned to a supplier (owner decisions, 2026-10-01; stage 2, money
 * task list, P0-4).
 *
 * The owner and managers send goods back from a warehouse — one document
 * with a list — to a supplier picked from the network's list or added on
 * the spot. Only the goods are recorded. A return is cancelled whole, once,
 * saying why, and its goods come back where they left. A confirmed unit
 * from «Брак» goes back from «Брак»; it is listed here too, and cancelled
 * through «Брак».
 *
 * The returns are rows, the newest first, the supplier's field over them
 * and «+» in the heading; a row opens the return, «+» «Повернути
 * постачальнику» with the menu aside. «Позичене й під реалізацію ›» and
 * «Список постачальників ›» stand under them.
 */
export function Suppliers({
  store,
  token,
  journalKey,
  blocked,
  back,
  task,
  opened = null,
  forget,
  openInvoice,
  openBorrowed,
}: {
  store: Store;
  token: string;
  journalKey: string;
  /** Another command's outcome is unknown: nothing new until it is settled. */
  blocked: boolean;
  /** «← Ще» over the heading: a section opened from «Ще» (navigation task
   * list, P0-4). */
  back?: MoreBack | undefined;
  /** Told while a return is made: the menu steps aside. */
  task?: (shown: boolean) => void;
  /** The return open when its invoice was: opened again on the way back. */
  opened?: SupplierReturn | null;
  /** Told once it is: it is never opened again by itself. */
  forget?: () => void;
  /** A set-off's invoice in «Накладні», for whoever keeps them (P1-3). */
  openInvoice?:
    | {
        go: (setOff: SetOff, item: SupplierReturn) => void;
        held: boolean;
      }
    | undefined;
  /** «Позичене й під реалізацію» (P0-5); held while its row is. */
  openBorrowed?: { go: () => void; held: boolean } | undefined;
}): JSX.Element {
  // A kept return is the app's: its stub over this screen, its banner over
  // any other, its check (stage 2, money task list, P0-6).
  const { busy, pending } = useReturnToSupplier();
  const working = busy || pending !== null;
  const [view, setView] = useState<View>(
    opened ? { screen: "return", item: opened } : { screen: "list" },
  );
  // Opened once: a remount — a kept return checked — opens the list.
  useEffect(() => {
    if (opened) forget?.();
    // Once, as it opens.
  }, []);
  const [supplierId, setSupplierId] = useState("");
  const suppliers = useSuppliers(store, token, supplierId !== "");
  // Page by page: the server takes fifty at most (stage 2, money task list,
  // P0-7).
  const returns = useInfiniteQuery({
    queryKey: ["supplier-returns", store.id, supplierId],
    queryFn: ({ pageParam }) =>
      api<ReturnPage>(
        `/supplier-returns?store_id=${store.id}&limit=${String(pageSize)}&offset=${String(pageParam)}${
          supplierId ? `&supplier_id=${supplierId}` : ""
        }`,
        token,
      ),
    initialPageParam: 0,
    getNextPageParam: (last: ReturnPage, pages: ReturnPage[]) =>
      last.has_more ? pages.length * pageSize : undefined,
    retry: false,
  });
  // A return made between two pages moves the older ones down by one: each
  // is shown once.
  const listed = [
    ...new Map(
      (returns.data?.pages ?? [])
        .flatMap((page) => page.items)
        .map((item) => [item.id, item]),
    ).values(),
  ];
  const making = view.screen === "new";
  useEffect(() => {
    task?.(making);
  }, [task, making]);
  useEffect(
    () => () => {
      task?.(false);
    },
    [task],
  );
  // Each screen begins at its top; back on the list, its heading takes the
  // cursor, the button pressed being gone — never as the section opens.
  const screen = view.screen;
  const title = useRef<HTMLHeadingElement>(null);
  const was = useRef(screen);
  useEffect(() => {
    if (was.current === screen) return;
    was.current = screen;
    window.scrollTo(0, 0);
    if (screen === "list") title.current?.focus();
  }, [screen]);
  const toList = (): void => {
    setView({ screen: "list" });
  };

  if (view.screen === "new")
    return (
      <NewReturn
        store={store}
        token={token}
        journalKey={journalKey}
        blocked={blocked}
        back={toList}
        done={toList}
      />
    );

  if (view.screen === "return") {
    const item = view.item;
    return (
      <ReturnDetail
        key={item.id}
        store={store}
        token={token}
        item={item}
        held={blocked || working}
        back={toList}
        openInvoice={
          openInvoice && {
            go: (setOff) => {
              openInvoice.go(setOff, item);
            },
            held: openInvoice.held,
          }
        }
      />
    );
  }

  if (view.screen === "suppliers")
    return <SupplierList store={store} token={token} back={toList} />;

  const make = (): void => {
    setView({ screen: "new" });
  };
  const chosen =
    supplierId === ""
      ? undefined
      : suppliers.data?.find((one) => one.id === supplierId);
  return (
    <>
      <ScreenHeader
        ref={title}
        focusable
        title="Постачальникам"
        back={back && <BackToMore back={back} />}
        aside={
          <span className="invoice-head-ways">
            <button
              type="button"
              className="debt-more"
              aria-label="Повернути товар постачальнику"
              disabled={blocked || working}
              onClick={make}
            >
              <Icon name="plus" />
            </button>
            <button
              type="button"
              className="quiet"
              disabled={returns.isFetching}
              onClick={() => {
                void returns.refetch();
              }}
            >
              Оновити
            </button>
          </span>
        }
      />
      <section className="supplier-returns">
        <SupplierFilter
          store={store}
          token={token}
          value={supplierId}
          change={setSupplierId}
          disabled={false}
        />
        {returns.isPending ? (
          <p role="status">Завантажуємо повернення…</p>
        ) : returns.data === undefined ? (
          <Unread
            error={returns.error}
            retry={() => {
              void returns.refetch();
            }}
          />
        ) : listed.length === 0 ? (
          // Nothing (spec §6.28): the blank mark, what is so now, and what
          // the supplier counts of a return.
          <div className="orders-empty">
            <Icon name="mark-lg" className="orders-empty-mark" />
            <p className="t-row">
              {supplierId
                ? `Постачальнику «${visible(chosen?.name ?? "")}» цей магазин ще нічого не повертав.`
                : "Цей магазин ще нічого не повертав постачальникам."}
            </p>
            <p className="t-meta">
              Скільки постачальник за нього зарахував, записують заліком у
              «Накладних».
            </p>
            <button
              type="button"
              className="quiet"
              disabled={blocked || working}
              onClick={make}
            >
              Повернути товар постачальнику
            </button>
          </div>
        ) : (
          <>
            <ul className="return-rows" aria-label="Повернення постачальникам">
              {listed.map((item) => (
                <ReturnRow
                  key={item.id}
                  item={item}
                  open={() => {
                    setView({ screen: "return", item });
                  }}
                />
              ))}
            </ul>
            {/* A page that failed keeps the returns already read. */}
            {returns.error && (
              <Unread
                error={returns.error}
                retry={() => {
                  void (returns.isFetchNextPageError
                    ? returns.fetchNextPage()
                    : returns.refetch());
                }}
              />
            )}
            {returns.hasNextPage && (
              <button
                className="quiet"
                disabled={returns.isFetching}
                onClick={() => {
                  void returns.fetchNextPage();
                }}
              >
                Показати ще
              </button>
            )}
          </>
        )}
        <div className="cash-rows supplier-ways">
          {openBorrowed && (
            <WayRow
              title="Позичене й під реалізацію"
              held={openBorrowed.held}
              open={openBorrowed.go}
            />
          )}
          <WayRow
            title="Список постачальників"
            open={() => {
              setView({ screen: "suppliers" });
            }}
          />
        </div>
      </section>
    </>
  );
}

/**
 * One return as a row (spec §6.8; stage 2, money task list, P0-4): the
 * supplier, at the right how many went back; the day, where from and who;
 * its goods, two named and «+ ще N»; «Скасовано» and «Зараховано …» as
 * stickers. The whole row opens it.
 */
function ReturnRow({
  item,
  open,
}: {
  item: SupplierReturn;
  open: () => void;
}): JSX.Element {
  const meta = useId();
  const counted = item.set_offs.reduce(
    (sum, setOff) => sum + (kopecks(setOff.amount) ?? 0n),
    0n,
  );
  return (
    <li>
      <button
        type="button"
        className="sale-row return-row"
        aria-describedby={meta}
        onClick={open}
      >
        <span className="sale-main">
          <span className="return-row-head">
            <span className="t-row">{visible(item.supplier.name)}</span>
            <span className="return-row-units">{unitsOf(item)} шт.</span>
          </span>
          <span className="sale-meta" id={meta}>
            {shortDay(item.at)} · {placeText(item)} · {visible(item.by)}
          </span>
          <span className="sale-meta">{goodsText(item)}</span>
          {(item.cancelled || counted > 0n) && (
            <span className="sale-marks">
              {item.cancelled && (
                <span className="sticker tone-offline">
                  <Icon name="close" size={16} />
                  Скасовано
                </span>
              )}
              {counted > 0n && (
                <span className="sticker">
                  Зараховано {money(decimal(counted))}
                </span>
              )}
            </span>
          )}
        </span>
        <Icon name="chevron-right" size={16} />
      </button>
    </li>
  );
}

/** A way to another of the suppliers' screens, a row with its chevron. */
function WayRow({
  title,
  held = false,
  open,
}: {
  title: string;
  held?: boolean;
  open: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className="sale-row cash-row"
      disabled={held}
      onClick={open}
    >
      <span className="sale-main">
        <span className="cash-row-title">{title}</span>
      </span>
      <Icon name="chevron-right" size={16} />
    </button>
  );
}
