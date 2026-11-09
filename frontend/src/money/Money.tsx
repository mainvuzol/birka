import { useId } from "react";
import type { JSX, ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { timeOf } from "@/cash/errors";
import { cashDay, signed } from "@/cash/format";
import { movementLabels } from "@/cash/types";
import type { Close, Drawer, Movement } from "@/cash/types";
import type { StoreDebts } from "@/credits/types";
import { plural } from "@/openings/types";
import { kopecks, money } from "@/orders/types";
import type { Store, StoreState } from "@/orders/types";
import { Unread } from "@/shared/Unread";
import type { StoreFigures, WayFigures } from "@/reports/types";
import { Icon } from "@/shared/Icon";
import type { IconName } from "@/shared/icons";
import type { MoreRow } from "@/shared/More";
import { ModeSwitch } from "@/shared/ModeSwitch";
import { methodLabels, notStated } from "@/shared/payment";
import { ScreenHeader } from "@/shared/ScreenHeader";
import { visible } from "@/shared/visible";
import type { SupplierDebts } from "@/suppliers/types";
import { Stamp, Waiting, dayLine, staleOf, useNow } from "@/today/age";
import {
  ageOf,
  reportStores,
  useDayReport,
  useDebts,
  useDrawers,
} from "@/today/reads";
import {
  periods,
  rangeOf,
  useLastCloses,
  useMovementsToday,
  usePeriodReport,
  useSupplierDebts,
} from "./reads";
import type { Period } from "./reads";

/** Anything either way: not «0,00». */
function some(value: string): boolean {
  const parsed = kopecks(value.replace(/^-/, ""));
  return parsed !== null && parsed !== 0n;
}

/** A figure of the table, «грн» said once over it: «1 700,00». */
function figure(value: string): string {
  return signed(value).replace(/\u00a0грн$/, "");
}

/** What a store that does not trade is marked by, as the report marks it. */
const stateWords: Record<StoreState, string> = {
  ACTIVE: "",
  BLOCKED: "заблоковано",
  ARCHIVED: "в архіві",
};

/** «Центр», and its mark when it does not trade: «Гроші»'s and the
 * report's columns alike. */
export function StoreName({
  name,
  state,
}: {
  name: string;
  state: StoreState;
}): JSX.Element {
  return (
    <span className="money-store">
      «{visible(name)}»
      {state !== "ACTIVE" && (
        <>
          {" "}
          <span className="badge">{stateWords[state]}</span>
        </>
      )}
    </span>
  );
}

/** Said where a read of a store failed before it ever answered: the
 * place's plate says why. */
const unread = "не вдалося прочитати";

/** «21.10» of a day the server names. */
function dayMonth(day: string): string {
  const [, month = "", date = ""] = day.split("-");
  return `${date}.${month}`;
}

/** «учора порахували 5 380,00 грн о 20:06»: the cash counted at the last
 * close, by the drawer's day — never what was to be there (G13). */
function countedText(close: Close): string {
  const day =
    close.business_day === cashDay(0)
      ? "сьогодні"
      : close.business_day === cashDay(1)
        ? "учора"
        : dayMonth(close.business_day);
  return `${day} порахували ${money(close.counted)} о ${timeOf(close.closed_at)}`;
}

/** A store's drawer: its last count, or never counted, as «Сьогодні» says
 * it. */
function drawerLine(
  drawer: UseQueryResult<Drawer>,
  close: UseQueryResult<Close> | undefined,
): ReactNode {
  if (drawer.data === undefined)
    return drawer.isError ? unread : <Waiting width="12em" />;
  if (drawer.data.next_is_opening || !drawer.data.last_close)
    return "Каса ще не рахувалась";
  if (close?.data === undefined)
    return close?.isError ? unread : <Waiting width="12em" />;
  return countedText(close.data);
}

/** «Винні 8 400,00 грн · 4 покупці», this store's alone, the count never
 * parted from its word; «Ніхто не винен», as «Сьогодні» says it. */
function debtsText(debts: StoreDebts): string {
  return debts.customers > 0 && some(debts.owed)
    ? `Винні ${money(debts.owed)} · ${String(debts.customers)}\u00a0${plural(
        debts.customers,
        "покупець",
        "покупці",
        "покупців",
      )}`
    : "Ніхто не винен";
}

/** «38 000,00 грн · 3 накладні» this store owes; «Нічого не винні». */
function suppliersText(debts: SupplierDebts): string {
  return debts.invoices > 0 && some(debts.owed)
    ? `${money(debts.owed)} · ${String(debts.invoices)}\u00a0${plural(
        debts.invoices,
        "накладна",
        "накладні",
        "накладних",
      )}`
    : "Нічого не винні";
}

/** A line read by its own read: what it says, held while read. */
function readLine<T>(
  read: UseQueryResult<T> | undefined,
  text: (data: T) => string,
  width: string,
): ReactNode {
  if (read === undefined) return null;
  if (read.data === undefined)
    return read.isError ? unread : <Waiting width={width} />;
  return text(read.data);
}

/** A store's line in a place: its name, then what the place says of it. */
function StoreLine({
  store,
  children,
}: {
  store: Store;
  children: ReactNode;
}): JSX.Element {
  return (
    <li className="money-line">
      <StoreName name={store.name} state={store.state} />
      {": "}
      <span className="money-said">{children}</span>
    </li>
  );
}

/** A place's way to its screen, held as its row in «Ще» is. */
interface Way {
  go: () => void;
  disabled: boolean;
}

/**
 * One place where money is (spec S29): its glyph and name — a way to its
 * screen where there is one — a line a store, how old it is when no longer
 * live, and a plate with «Спробувати ще раз» for what was never read; the
 * other places stand.
 */
function Place({
  icon,
  title,
  open,
  held,
  reads,
  now,
  children,
}: {
  icon: IconName;
  title: string;
  /** Its screen: «Покупці», «Накладні». */
  open?: Way | undefined;
  held: boolean;
  reads: readonly UseQueryResult[];
  now: number;
  children: ReactNode;
}): JSX.Element {
  const name = useId();
  const age = ageOf(reads);
  const failed = reads.filter(
    (read) => read.isError && read.data === undefined,
  );
  return (
    <article className="money-place tag-row tag-outline" aria-labelledby={name}>
      <div className="money-place-body">
        <h3 id={name} className="t-row money-place-title">
          {open ? (
            <button
              type="button"
              className="money-place-open"
              disabled={held || open.disabled}
              onClick={open.go}
            >
              <Icon name={icon} size={16} />
              <span>{title}</span>
              <span className="sale-open" aria-hidden="true">
                ›
              </span>
            </button>
          ) : (
            <>
              <Icon name={icon} size={16} />
              <span>{title}</span>
            </>
          )}
        </h3>
        {age.at !== undefined && staleOf(age, now) && (
          <Stamp age={age} now={now} />
        )}
        {children}
        {failed[0] && (
          <Unread
            error={failed[0].error}
            retry={() => {
              for (const read of failed) void read.refetch();
            }}
          />
        )}
      </div>
    </article>
  );
}

/** A way's money in a store's figures; none, nothing. */
function wayNet(figures: StoreFigures, method: WayFigures["method"]): string {
  return figures.ways.find((way) => way.method === method)?.net ?? "0.00";
}

/** «Надійшло»'s rows: the till's ways, «Не вказано» only where a store has
 * any, as the report shows them. */
const wayRows: { method: WayFigures["method"]; label: string }[] = [
  { method: "CASH", label: methodLabels.CASH },
  { method: "CARD", label: methodLabels.CARD },
  { method: "TRANSFER", label: methodLabels.TRANSFER },
  {
    method: "NOT_STATED",
    label: `${notStated.charAt(0).toUpperCase()}${notStated.slice(1)}`,
  },
];

/**
 * «Гроші» (spec S29; «Усе на бірці» sections task list, P0-7): where every
 * hryvnia is now, each place on its own and a line a store — the drawers'
 * last counts, the card and transfers of today, what customers owe, what is
 * owed to suppliers — and what came in over a period, the ways down and the
 * stores across. Every figure is a field the server answered; nothing is
 * added up here, neither the stores nor the places.
 */
export function Money({
  token,
  scopeKey,
  stores,
  period,
  choose,
  held,
  toCustomers,
  toInvoices,
  toReport,
  rows,
}: {
  token: string;
  /** Whose reads these are: the organisation and the person. */
  scopeKey: string;
  /** Every store of `/me`, with this person's rights in each. */
  stores: readonly Store[];
  /** «Надійшло»'s period, kept while the report is open from here. */
  period: Period;
  choose: (period: Period) => void;
  /** A first send in flight: its ways wait. */
  held: boolean;
  /** «Покупці», where the open store takes payments on debts. */
  toCustomers?: Way | undefined;
  /** The open store's «Накладні», where its invoices are read. */
  toInvoices?: Way | undefined;
  /** «Звіт про продажі», on the period chosen here. */
  toReport: {
    open: (range: { from: string; to: string } | null) => void;
    disabled: boolean;
  };
  /** «Закриття», «Каса · {магазин}», each by its own right. */
  rows: readonly MoreRow[];
}): JSX.Element {
  const shown = reportStores(stores);
  const day = useDayReport(token, scopeKey);
  const drawers = useDrawers(token, shown);
  const closes = useLastCloses(token, drawers);
  const movements = useMovementsToday(token, drawers);
  const debts = useDebts(token, shown);
  const suppliers = useSupplierDebts(token, shown);
  const today = day.data?.today;
  const range = today ? rangeOf(period, today) : null;
  const cameIn = usePeriodReport(token, scopeKey, range);
  const now = useNow();
  const where = useId();
  const came = useId();
  const cameTable = useId();
  const drawerReads = [
    ...drawers.values(),
    ...closes.values(),
    ...movements.values(),
  ];
  const age = ageOf([
    day,
    ...drawerReads,
    ...debts.values(),
    ...suppliers.values(),
  ]);
  const withDrawer = shown.filter((store) => drawers.has(store.id));
  const takenOut: { store: Store; movement: Movement }[] = withDrawer.flatMap(
    (store) =>
      (movements.get(store.id)?.data?.items ?? [])
        // A late record named for an earlier close explains that close:
        // its cash left before the count, not today (B6.3).
        .filter(
          (movement) =>
            movement.direction === "OUT" && movement.for_close_id === null,
        )
        .map((movement) => ({ store, movement })),
  );
  // Today's cash is said only once it is counted: while a drawer of them
  // is still open today (G13). A store that does not trade counts none.
  const allClosed = withDrawer
    .filter((store) => store.state === "ACTIVE")
    .every((store) => drawers.get(store.id)?.data?.closed_today === true);
  const figuresOf = (store: Store): StoreFigures | undefined =>
    day.data?.stores.find((one) => one.store_id === store.id);
  const wayLine = (store: Store, method: "CARD" | "TRANSFER"): ReactNode => {
    if (day.data === undefined)
      return day.isError ? unread : <Waiting width="7em" />;
    const figures = figuresOf(store);
    return figures ? signed(wayNet(figures, method)) : null;
  };
  // The report reads every store of these; one whose right came after it
  // was read waits for the next reading.
  const inReport = day.data
    ? shown.filter((store) => figuresOf(store) !== undefined)
    : shown;
  const owed = shown.filter((store) => debts.has(store.id));
  const owing = shown.filter((store) => suppliers.has(store.id));
  const cameData = cameIn.data;
  const columns = cameData?.stores ?? [];
  const ways = wayRows.filter(
    (way) =>
      way.method !== "NOT_STATED" ||
      columns.some((store) => some(wayNet(store, "NOT_STATED"))),
  );
  const outside = columns.filter(
    (store) =>
      some(store.off_till.prepaid_transfer.net) ||
      some(store.off_till.carrier_cod.net),
  );
  const debtPayments = columns.filter((store) => some(store.debt_payments));
  const cameAge = ageOf([cameIn]);
  return (
    <>
      <ScreenHeader title="Гроші" lead={dayLine(today)} />
      <section className="money" aria-labelledby={where}>
        <div className="money-head">
          <h2 id={where} className="t-label">
            Де гроші зараз
          </h2>
          <Stamp age={age} now={now} />
        </div>
        {withDrawer.length > 0 && (
          <Place
            icon="drawer"
            title="У касах"
            held={held}
            reads={drawerReads}
            now={now}
          >
            <ul className="money-lines">
              {withDrawer.map((store) => {
                const drawer = drawers.get(store.id);
                return (
                  drawer && (
                    <StoreLine key={store.id} store={store}>
                      {drawerLine(drawer, closes.get(store.id))}
                    </StoreLine>
                  )
                );
              })}
            </ul>
            {!allClosed && (
              <p className="t-meta money-note">
                Сьогоднішня готівка — після вечірнього підрахунку.
              </p>
            )}
            {takenOut.length > 0 && (
              <>
                <h4 className="t-meta money-subhead">Видано сьогодні</h4>
                <ul className="money-lines money-out">
                  {takenOut.map(({ store, movement }) => (
                    <li key={movement.id} className="money-line">
                      <StoreName name={store.name} state={store.state} />
                      {" · "}
                      <span className="money-said">
                        {movementLabels[movement.kind]} {money(movement.amount)}{" "}
                        · {timeOf(movement.at)}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Place>
        )}
        {inReport.length > 0 && (
          <>
            <Place
              icon="card"
              title="Картка сьогодні · звірте з чеком"
              held={held}
              reads={[day]}
              now={now}
            >
              <ul className="money-lines">
                {inReport.map((store) => (
                  <StoreLine key={store.id} store={store}>
                    {wayLine(store, "CARD")}
                  </StoreLine>
                ))}
              </ul>
            </Place>
            <Place
              icon="transfer"
              title="Перекази сьогодні"
              held={held}
              reads={[day]}
              now={now}
            >
              <ul className="money-lines">
                {inReport.map((store) => (
                  <StoreLine key={store.id} store={store}>
                    {wayLine(store, "TRANSFER")}
                  </StoreLine>
                ))}
              </ul>
            </Place>
          </>
        )}
        {owed.length > 0 && (
          <Place
            icon="owed"
            title="Вам винні клієнти"
            open={toCustomers}
            held={held}
            reads={[...debts.values()]}
            now={now}
          >
            <ul className="money-lines">
              {owed.map((store) => (
                <StoreLine key={store.id} store={store}>
                  {readLine(debts.get(store.id), debtsText, "10em")}
                </StoreLine>
              ))}
            </ul>
          </Place>
        )}
        {owing.length > 0 && (
          <Place
            icon="supplier"
            title="Ви винні постачальникам"
            open={toInvoices}
            held={held}
            reads={[...suppliers.values()]}
            now={now}
          >
            <ul className="money-lines">
              {owing.map((store) => (
                <StoreLine key={store.id} store={store}>
                  {readLine(suppliers.get(store.id), suppliersText, "10em")}
                </StoreLine>
              ))}
            </ul>
          </Place>
        )}
        <p className="t-meta money-rule">
          Кожне місце окремо — ніколи не складаємо в одну суму.
        </p>
      </section>
      <section className="money money-in" aria-labelledby={came}>
        <div className="money-head">
          <h2 id={came} className="t-label">
            Надійшло
          </h2>
          {cameAge.at !== undefined && staleOf(cameAge, now) && (
            <Stamp age={cameAge} now={now} />
          )}
        </div>
        <ModeSwitch
          label="Період"
          modes={periods}
          current={period}
          // The days are the server's: held until today's report says
          // which day today is.
          disabled={today === undefined}
          choose={choose}
          filters
        />
        {cameData === undefined ? (
          cameIn.isError ? (
            <Unread
              error={cameIn.error}
              retry={() => {
                void cameIn.refetch();
              }}
            />
          ) : (
            <div className="money-table-wait" aria-hidden="true">
              {[0, 1, 2, 3].map((row) => (
                <Waiting key={row} width="100%" />
              ))}
            </div>
          )
        ) : (
          <>
            {/* Wider than the phone, the table scrolls alone — by the
                keyboard too; «грн» is said once, by its caption. */}
            <div
              className="money-table-wrap"
              role="region"
              aria-labelledby={cameTable}
              tabIndex={0}
            >
              <table className="money-table">
                <caption id={cameTable} className="visually-hidden">
                  Надійшло, грн
                </caption>
                <thead>
                  <tr>
                    <td className="money-unit" aria-hidden="true">
                      грн
                    </td>
                    {columns.map((store) => (
                      <th key={store.store_id} scope="col">
                        <StoreName
                          name={store.store_name}
                          state={store.store_state}
                        />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ways.map((way) => (
                    <tr key={way.method}>
                      <th scope="row">{way.label}</th>
                      {columns.map((store) => (
                        <td key={store.store_id}>
                          {figure(wayNet(store, way.method))}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr className="money-total">
                    <th scope="row">Разом</th>
                    {columns.map((store) => (
                      <td key={store.store_id}>{figure(store.money)}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            {/* Orders paid off the till stand outside «Разом» (G24). */}
            {outside.map((store) => (
              <p key={store.store_id} className="t-meta money-outside">
                Окремо від «Разом» — замовлення:{" "}
                {methodLabels.PREPAID_TRANSFER.toLowerCase()}{" "}
                {signed(store.off_till.prepaid_transfer.net)} ·{" "}
                {methodLabels.CARRIER_COD.toLowerCase()}{" "}
                {signed(store.off_till.carrier_cod.net)} (
                <StoreName name={store.store_name} state="ACTIVE" />)
              </p>
            ))}
            {debtPayments.length > 0 && (
              <p className="t-meta money-outside">
                З них внески за борг:{" "}
                {debtPayments.map((store, at) => (
                  <span key={store.store_id}>
                    {at > 0 && " · "}
                    <StoreName name={store.store_name} state="ACTIVE" />{" "}
                    {signed(store.debt_payments)}
                  </span>
                ))}
              </p>
            )}
          </>
        )}
      </section>
      <nav aria-label="Гроші" className="more-list money-rows">
        {/* On a white block, as «Ще»'s rows (spec §6.8; review of the audit
            after stage 2's first batch, 2026-11-09). */}
        <div className="more-group list-block">
          {[
            {
              key: "report",
              label: "Звіт про продажі",
              icon: "report" as const,
              disabled: toReport.disabled,
              open: () => {
                toReport.open(range);
              },
            },
            ...rows,
          ].map((row) => (
            <button
              key={row.key}
              type="button"
              className="sale-row more-row"
              disabled={row.disabled}
              onClick={row.open}
            >
              <Icon name={row.icon} />
              <span className="more-label">{row.label}</span>
              <span className="sale-open" aria-hidden="true">
                ›
              </span>
            </button>
          ))}
        </div>
      </nav>
    </>
  );
}
