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
import { Sticker } from "@/shared/Sticker";
import { Sum } from "@/shared/Sum";
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
 * report's columns alike; a place's store named as the day's tag names it
 * (`label`; audit 2026-11-13, money P1-1). */
export function StoreName({
  name,
  state,
  label = false,
}: {
  name: string;
  state: StoreState;
  label?: boolean;
}): JSX.Element {
  return (
    <span className={label ? "money-store t-label" : "money-store"}>
      «{visible(name)}»
      {state !== "ACTIVE" && (
        <>
          {" "}
          <Sticker>{stateWords[state]}</Sticker>
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

/**
 * What a place says of a store, in its parts (audit 2026-11-13, money
 * P1-1): the words before its figure, the figure, the words after — a line
 * each in the store's column — or one line where there is no figure. The
 * parts stand in the phrase's order, its colon and joints hidden from the
 * eye alone: «Центр»: учора порахували 5 380,00 грн о 20:06. A phone's
 * reader may stop on each line (not measured).
 */
type Said =
  | {
      before?: string | undefined;
      /** The figure as the server answered it, signed where it may be. */
      sum: string;
      /** A million or more: smaller, to keep to its column. */
      long: boolean;
      after?: string | undefined;
      /** Between the figure and `after`, heard, never seen. */
      joint?: string | undefined;
    }
  | {
      line: ReactNode;
      /** In pencil: what was never read. */
      unread?: boolean | undefined;
    };

/** A figure of a place: its sum, and whether it is a million or more. */
function sumOf(value: string): { sum: string; long: boolean } {
  return {
    sum: signed(value),
    long: Math.abs(Number(value)) >= 1_000_000,
  };
}

/** A store not read: what failed, or its figure's place in grey. */
function unreadOr(failed: boolean): Said {
  return failed
    ? { line: unread, unread: true }
    : { line: <Waiting width="6em" /> };
}

/** «учора порахували · 5 380,00 грн · о 20:06»: the cash counted at the
 * last close, by the drawer's day — never what was to be there (G13). */
function counted(close: Close): Said {
  const day =
    close.business_day === cashDay(0)
      ? "сьогодні"
      : close.business_day === cashDay(1)
        ? "учора"
        : dayMonth(close.business_day);
  return {
    before: `${day} порахували`,
    ...sumOf(close.counted),
    after: `о ${timeOf(close.closed_at)}`,
    joint: " ",
  };
}

/** A store's drawer: its last count, or never counted, as «Сьогодні» says
 * it. */
function drawerSaid(
  drawer: UseQueryResult<Drawer>,
  close: UseQueryResult<Close> | undefined,
): Said {
  if (drawer.data === undefined) return unreadOr(drawer.isError);
  if (drawer.data.next_is_opening || !drawer.data.last_close)
    return { line: "Каса ще не рахувалась" };
  if (close?.data === undefined) return unreadOr(close?.isError === true);
  return counted(close.data);
}

/** Customers owe this store something. */
function owes(debts: StoreDebts): boolean {
  return debts.customers > 0 && some(debts.owed);
}

/** «Винні · 8 400,00 грн · 4 людини», this store's alone, the count never
 * parted from its word; «Ніхто не винен» — both as «Сьогодні» says them
 * (money task list after stage 2, P1-1; В-ГР1 (а)). */
function debtsSaid(debts: StoreDebts): Said {
  return owes(debts)
    ? {
        before: "Винні",
        ...sumOf(debts.owed),
        after: `${String(debts.customers)}\u00a0${plural(
          debts.customers,
          "людина",
          "людини",
          "людей",
        )}`,
        joint: " · ",
      }
    : { line: "Ніхто не винен" };
}

/** A customers' store in the colour of what it says: a debt's on «Винні»
 * and its figure; «Ніхто не винен» in pencil; nothing while read. */
function debtsTone(
  read: UseQueryResult<StoreDebts> | undefined,
): string | undefined {
  if (read?.data === undefined) return undefined;
  return owes(read.data) ? "money-owes" : "money-none";
}

/** «38 000,00 грн · 3 накладні» this store owes; «Нічого не винні». */
function suppliersSaid(debts: SupplierDebts): Said {
  return debts.invoices > 0 && some(debts.owed)
    ? {
        ...sumOf(debts.owed),
        after: `${String(debts.invoices)}\u00a0${plural(
          debts.invoices,
          "накладна",
          "накладні",
          "накладних",
        )}`,
        joint: " · ",
      }
    : { line: "Нічого не винні" };
}

/** A store read by its own read: what it says, held while read. */
function readSaid<T>(
  read: UseQueryResult<T> | undefined,
  said: (data: T) => Said,
): Said {
  if (read === undefined) return { line: null };
  if (read.data === undefined) return unreadOr(read.isError);
  return said(read.data);
}

/** The phrase a store is heard as, after its name: «учора порахували
 * 5 380,00 грн о 20:06»; none while read. */
function phrase(said: Said): string | undefined {
  if ("line" in said)
    return typeof said.line === "string" ? said.line : undefined;
  return `${said.before === undefined ? "" : `${said.before} `}${said.sum}${
    said.after === undefined ? "" : `${said.joint ?? " "}${said.after}`
  }`;
}

/** A store's parts in its column or row, after its name: the colon and
 * the joint for a reader, never seen. */
function Parts({ said }: { said: Said }): JSX.Element {
  if ("line" in said)
    return (
      <>
        <span className="visually-hidden">: </span>
        <span
          className={said.unread ? "money-said money-unread" : "money-said"}
        >
          {said.line}
        </span>
      </>
    );
  return (
    <>
      <span className="visually-hidden">: </span>
      {said.before !== undefined && (
        <span className="t-meta money-before">{said.before} </span>
      )}
      <span className={said.long ? "money-figure long" : "money-figure"}>
        <Sum value={said.sum} />
      </span>
      {said.after !== undefined && (
        <>
          <span className="visually-hidden">{said.joint}</span>
          <span className="t-meta money-after">{said.after}</span>
        </>
      )}
    </>
  );
}

/** A store in a place: its name, then what the place says of it. */
function StoreSaid({
  store,
  said,
  tone,
}: {
  store: Store;
  said: Said;
  /** The colour of what it says: a debt's, or pencil. */
  tone?: string | undefined;
}): JSX.Element {
  return (
    <li
      className={
        tone === undefined
          ? "money-line money-cell"
          : `money-line money-cell ${tone}`
      }
    >
      <StoreName name={store.name} state={store.state} label />
      <Parts said={said} />
    </li>
  );
}

/** A place's stores (audit 2026-11-13, money P1-1), as the day's tag lays
 * them: two, two columns; one, or three and more, a row each. */
function Stores({
  count,
  children,
}: {
  count: number;
  children: ReactNode;
}): JSX.Element {
  return (
    <ul
      className={
        count === 2
          ? "money-lines money-store-columns"
          : "money-lines money-store-rows"
      }
    >
      {children}
    </ul>
  );
}

/** A place's way to its screen, held as its row in «Ще» is. */
interface Way {
  go: () => void;
  disabled: boolean;
}

/** The open store of «Ви винні постачальникам»: the way to its
 * «Накладні», which read this store alone — the other stores are no way
 * (money task list after stage 2, P1-2; Q-1 «if not»). Its whole column,
 * or its whole row, the button, its chevron by what follows the figure
 * (audit 2026-11-13, money P1-1). */
function InvoicesStore({
  store,
  read,
  open,
  held,
}: {
  store: Store;
  read: UseQueryResult<SupplierDebts> | undefined;
  open: Way;
  held: boolean;
}): JSX.Element {
  const said = readSaid(read, suppliersSaid);
  const heard = phrase(said);
  const mark = store.state === "ACTIVE" ? "" : ` ${stateWords[store.state]}`;
  return (
    <li className="money-line money-way">
      <button
        type="button"
        className="money-line-open money-cell"
        disabled={held || open.disabled}
        onClick={open.go}
        // What it shows, after where it goes.
        aria-label={`Накладні магазину «${visible(store.name)}»${mark}${
          heard === undefined ? "" : `: ${heard}`
        }`}
      >
        <StoreName name={store.name} state={store.state} label />
        <Parts said={said} />
        <Icon
          name="chevron-right"
          size={16}
          className="sale-open money-chevron"
        />
      </button>
    </li>
  );
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
  glyph,
  open,
  held,
  reads,
  now,
  children,
}: {
  icon: IconName;
  title: string;
  /** The glyph's colour: a debt's, while one is owed. */
  glyph?: string | undefined;
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
              <Icon name={icon} size={16} className={glyph} />
              <span>{title}</span>
              <Icon name="chevron-right" size={16} className="sale-open" />
            </button>
          ) : (
            <>
              <Icon name={icon} size={16} className={glyph} />
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
  here,
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
  /** The open store: its line of «Ви винні постачальникам» first, the way
   * to its «Накладні». */
  here: string;
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
  const waySaid = (store: Store, method: "CARD" | "TRANSFER"): Said => {
    if (day.data === undefined) return unreadOr(day.isError);
    const figures = figuresOf(store);
    return figures ? sumOf(wayNet(figures, method)) : { line: null };
  };
  // The report reads every store of these; one whose right came after it
  // was read waits for the next reading.
  const inReport = day.data
    ? shown.filter((store) => figuresOf(store) !== undefined)
    : shown;
  const owed = shown.filter((store) => debts.has(store.id));
  const owedNow = owed.some(
    (store) => debtsTone(debts.get(store.id)) === "money-owes",
  );
  // The open store's line first, as in «Покупці»; the others in the
  // report's order.
  const owing = shown
    .filter((store) => suppliers.has(store.id))
    .sort((a, b) => Number(b.id === here) - Number(a.id === here));
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
            <Stores count={withDrawer.length}>
              {withDrawer.map((store) => {
                const drawer = drawers.get(store.id);
                return (
                  drawer && (
                    <StoreSaid
                      key={store.id}
                      store={store}
                      said={drawerSaid(drawer, closes.get(store.id))}
                    />
                  )
                );
              })}
            </Stores>
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
              <Stores count={inReport.length}>
                {inReport.map((store) => (
                  <StoreSaid
                    key={store.id}
                    store={store}
                    said={waySaid(store, "CARD")}
                  />
                ))}
              </Stores>
            </Place>
            <Place
              icon="transfer"
              title="Перекази сьогодні"
              held={held}
              reads={[day]}
              now={now}
            >
              <Stores count={inReport.length}>
                {inReport.map((store) => (
                  <StoreSaid
                    key={store.id}
                    store={store}
                    said={waySaid(store, "TRANSFER")}
                  />
                ))}
              </Stores>
            </Place>
          </>
        )}
        {owed.length > 0 && (
          <Place
            icon="owed"
            title="Вам винні клієнти"
            glyph={owedNow ? "money-owes" : undefined}
            open={toCustomers}
            held={held}
            reads={[...debts.values()]}
            now={now}
          >
            <Stores count={owed.length}>
              {owed.map((store) => (
                <StoreSaid
                  key={store.id}
                  store={store}
                  tone={debtsTone(debts.get(store.id))}
                  said={readSaid(debts.get(store.id), debtsSaid)}
                />
              ))}
            </Stores>
          </Place>
        )}
        {owing.length > 0 && (
          // Its title no way: «Накладні» read the open store alone, so its
          // column is (money task list after stage 2, P1-2).
          <Place
            icon="supplier"
            title="Ви винні постачальникам"
            held={held}
            reads={[...suppliers.values()]}
            now={now}
          >
            <Stores count={owing.length}>
              {owing.map((store) =>
                store.id === here && toInvoices ? (
                  <InvoicesStore
                    key={store.id}
                    store={store}
                    read={suppliers.get(store.id)}
                    open={toInvoices}
                    held={held}
                  />
                ) : (
                  <StoreSaid
                    key={store.id}
                    store={store}
                    said={readSaid(suppliers.get(store.id), suppliersSaid)}
                  />
                ),
              )}
            </Stores>
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
              <Icon name="chevron-right" size={16} className="sale-open" />
            </button>
          ))}
        </div>
      </nav>
    </>
  );
}
