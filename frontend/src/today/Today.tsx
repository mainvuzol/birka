import { useEffect, useId, useRef, useState } from "react";
import type { JSX, MouseEvent } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { Drawer } from "@/cash/types";
import { timeOf } from "@/cash/errors";
import { signed } from "@/cash/format";
import type { StoreDebts } from "@/credits/types";
import { plural } from "@/openings/types";
import { kopecks, money } from "@/orders/types";
import type { Store } from "@/orders/types";
import type { Figures, StoreFigures } from "@/reports/types";
import { Eyelet } from "@/shared/Eyelet";
import { Icon } from "@/shared/Icon";
import { CARRIED_TAP } from "@/shared/panel";
import { ScreenHeader } from "@/shared/ScreenHeader";
import { Sheet } from "@/shared/Sheet";
import { Sum } from "@/shared/Sum";
import { Toast } from "@/shared/Toast";
import { buzz } from "@/shared/telegram";
import { visible } from "@/shared/visible";
import {
  STALE_AFTER,
  ageOf,
  dayStores,
  reportStores,
  useDayReport,
  useDebts,
  useDrawers,
  useOpenOrders,
} from "./reads";
import type { Age, OpenOrders } from "./reads";
import { see, unsee } from "./seen";
import { useWaiting, whenText } from "./waiting";
import type { Kind, Tag, Waiting as Work } from "./waiting";

const weekdays = [
  "Неділя",
  "Понеділок",
  "Вівторок",
  "Середа",
  "Четвер",
  "П’ятниця",
  "Субота",
];
const months = [
  "січня",
  "лютого",
  "березня",
  "квітня",
  "травня",
  "червня",
  "липня",
  "серпня",
  "вересня",
  "жовтня",
  "листопада",
  "грудня",
];

/** «Четвер, 22 жовтня»: the stores' own day once the report gives it, the
 * phone's before. */
function dayLine(day: string | undefined): string {
  const date = day ? new Date(`${day}T12:00:00`) : new Date();
  const weekday = weekdays[date.getDay()] ?? "";
  const month = months[date.getMonth()] ?? "";
  return `${weekday}, ${String(date.getDate())} ${month}`;
}

/** Below this much of Telegram's steady height, the day-tag is one line. */
const FOLDED_BELOW = 700;

/** Telegram's steady height, or the window's outside it: the keyboard and a
 * sheet dragged leave it as it was. */
function steadyHeight(): number {
  const said = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(
      "--tg-viewport-stable-height",
    ),
  );
  return Number.isFinite(said) && said > 0 ? said : window.innerHeight;
}

function useSteadyHeight(): number {
  const [height, setHeight] = useState(steadyHeight);
  useEffect(() => {
    const read = (): void => {
      setHeight(steadyHeight());
    };
    // Telegram's height is written on the page's root as it changes.
    const watch = new MutationObserver(read);
    watch.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style"],
    });
    window.addEventListener("resize", read);
    return () => {
      watch.disconnect();
      window.removeEventListener("resize", read);
    };
  }, []);
  return height;
}

/** The clock, read again every quarter of a minute: what was live five
 * minutes ago is said to be old. */
function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = window.setInterval(() => {
      setNow(Date.now());
    }, 15_000);
    return () => {
      window.clearInterval(tick);
    };
  }, []);
  return now;
}

/** «4 шт.» */
function units(count: number): string {
  return `${String(count)} шт.`;
}

/** Anything either way: not «0,00». */
function some(value: string): boolean {
  const parsed = kopecks(value.replace(/^-/, ""));
  return parsed !== null && parsed !== 0n;
}

/** «Каса відкрита», «Касу закрито о 20:06», or never counted (cash task
 * list, P0-1). */
function drawerText(drawer: Drawer): string {
  const last = drawer.last_close;
  if (drawer.closed_today && last)
    return `Касу закрито о ${timeOf(last.closed_at)}`;
  if (drawer.next_is_opening || !last) return "Каса ще не рахувалась";
  return "Каса відкрита";
}

/** «1 людина», «2 людини», «5 людей». */
function people(count: number): string {
  return plural(count, "людина", "людини", "людей");
}

function owes(debts: StoreDebts): boolean {
  return debts.customers > 0 && some(debts.owed);
}

/** «Винні 8 400,00 грн · 4 людини» — this store's alone, never the
 * network's; «Ніхто не винен», as «Борги» says «Зараз ніхто не винен». */
function owedParts(debts: StoreDebts): string[] {
  return owes(debts)
    ? [
        `Винні ${money(debts.owed)}`,
        `${String(debts.customers)} ${people(debts.customers)}`,
      ]
    : ["Ніхто не винен"];
}

/** Parts said in one line, «·» between them, each kept whole: the line
 * breaks between them, never inside one. */
function Parts({ parts }: { parts: readonly string[] }): JSX.Element {
  return (
    <>
      {parts.map((part, at) => (
        // Two parts may read the same: two coats alike.
        <span key={at}>
          {at > 0 && " · "}
          <span className="day-part">{part}</span>
        </span>
      ))}
    </>
  );
}

/**
 * «Гроші 10 850,00 грн · поза касою: накладений платіж 1 200,00 грн ·
 * переказ наперед 500,00 грн»: the report's «Разом», and what orders were
 * paid outside it, each only when there is any.
 */
function moneyParts(figures: Figures): string[] {
  const outside = (
    [
      ["накладений платіж", figures.off_till.carrier_cod.net],
      ["переказ наперед", figures.off_till.prepaid_transfer.net],
    ] as const
  ).filter(([, sum]) => some(sum));
  return [
    `Гроші ${signed(figures.money)}`,
    ...outside.map(
      ([way, sum], at) =>
        `${at === 0 ? "поза касою: " : ""}${way} ${signed(sum)}`,
    ),
  ];
}

/** «Онлайн: відправити 3 · в дорозі 2 · на пошті 2», each only when there
 * is any; «+» after each when a store holds more than the hundred read. */
function onlineParts(
  reads: readonly UseQueryResult<OpenOrders>[],
): string[] {
  const read = reads.flatMap((one) => (one.data ? [one.data] : []));
  const more = read.some((page) => page.has_more);
  const count = (status: string): number =>
    read.reduce(
      (all, page) =>
        all + page.orders.filter((order) => order.status === status).length,
      0,
    );
  const parts = [
    ["відправити", count("READY_TO_DISPATCH")],
    ["в дорозі", count("DISPATCHED")],
    ["на пошті", count("ARRIVED")],
  ] as const;
  return parts
    .filter(([, n]) => more || n > 0)
    .map(
      ([what, n], at) =>
        `${at === 0 ? "Онлайн: " : ""}${what} ${String(n)}${more ? "+" : ""}`,
    );
}

/** A line still read, in its place. */
function Waiting({ width }: { width: string }): JSX.Element {
  return (
    <span
      className="skeleton-line day-wait"
      style={{ width }}
      aria-hidden="true"
    />
  );
}

/** Not live: older than five minutes, or the last asking of a read
 * failed. */
function staleOf(age: Age, now: number): boolean {
  return age.failed || (age.at !== undefined && now - age.at > STALE_AFTER);
}

/** How old the day-tag's figures are (spec §6.17): «● наживо · 11:40», or
 * «дані на 11:32» in a warning's colour when older than five minutes or
 * the last asking failed — «— сервер не відповідає» when it went
 * unanswered. */
function Stamp({ age, now }: { age: Age; now: number }): JSX.Element {
  if (age.at === undefined)
    return age.failed ? (
      <span className="day-stamp stale">
        <Icon name="warning" size={16} />
        {age.silent ? "сервер не відповідає" : "не вдалося прочитати"}
      </span>
    ) : (
      <Waiting width="7em" />
    );
  const at = timeOf(new Date(age.at).toISOString());
  if (!staleOf(age, now))
    return (
      <span className="day-stamp live">
        <span className="live-dot" aria-hidden="true" />
        наживо · {at}
      </span>
    );
  return (
    <span className="day-stamp stale">
      <Icon name="warning" size={16} />
      дані на {at}
      {age.silent && " — сервер не відповідає"}
    </span>
  );
}

/** Past this many, the rest fold into «+ ще N» (spec §6.9). */
const SHOWN_TAGS = 7;

/** Each kind's glyph and colour: the eyelet in it, the glyph left of the
 * title (spec §6.9; S04). Filled, it waits on you; a ring, it is news of
 * what someone else did. */
const looks: Record<
  Kind,
  {
    icon: "backup" | "warning" | "parcel" | "damaged" | "paper" | "stocktake";
    tone: string;
    ring?: true;
  }
> = {
  backups: { icon: "backup", tone: "warning" },
  drawer: { icon: "warning", tone: "warning" },
  parcels: { icon: "parcel", tone: "online" },
  damaged: { icon: "damaged", tone: "damaged" },
  openings: { icon: "paper", tone: "ink" },
  stocktake: { icon: "stocktake", tone: "offline", ring: true },
};

/** Each kind of work's one verb, and where it goes. */
const verbWords: Partial<Record<Kind, string>> = {
  backups: "Переглянути",
  parcels: "Зібрати й відправити",
  damaged: "Оглянути",
  openings: "Переглянути й затвердити",
};

/** A tag of «Чекає на вас» (spec §6.9): its eyelet, its title, up to two
 * lines of meta, and one verb — work's only where it can be done from here:
 * the open store's, or the network's backups; another store's says what
 * waits there, done there (В-Т2 (а)). News has «Бачу» wherever it is of:
 * it is only what this phone keeps. */
function TagRow({
  tag,
  open,
  verb,
  held,
  seen,
}: {
  tag: Tag;
  open: Store;
  verb: (() => void) | undefined;
  held: boolean;
  /** «Бачу», for news. */
  seen: (event: MouseEvent) => void;
}): JSX.Element {
  const title = useId();
  const look = looks[tag.kind];
  const here = tag.store === undefined || tag.store.id === open.id;
  const words = verbWords[tag.kind];
  return (
    <article
      className={`today-tag tag-row tag-outline tone-${look.tone}${
        look.ring ? " ring" : ""
      }`}
      aria-labelledby={title}
      tabIndex={-1}
      data-tag={tag.key}
    >
      <div className="today-tag-body">
        <span className="today-tag-eyelet" aria-hidden="true" />
        <h3 id={title} className="t-row today-tag-title">
          <Icon name={look.icon} size={16} />
          <span>{tag.title}</span>
        </h3>
        {tag.meta.length > 0 && (
          <p className="t-meta today-tag-meta">
            <Parts parts={tag.meta} />
          </p>
        )}
        {tag.seen !== undefined ? (
          <button type="button" className="today-verb" onClick={seen}>
            Бачу
          </button>
        ) : (
          here &&
          verb &&
          words !== undefined && (
            <button
              type="button"
              className="today-verb"
              disabled={held}
              onClick={() => {
                // A tag's verb, felt (spec S04; «Усе на бірці» task list,
                // P1-2).
                buzz("light");
                verb();
              }}
            >
              {words}
            </button>
          )
        )}
      </div>
    </article>
  );
}

/**
 * «Чекає на вас · N» (spec S04 #10–17; P0-6, items 3–6): the tags, seven and
 * «+ ще N» for the rest; a place held while a read is still read; «Вас
 * нічого не чекає.» once every read has answered with nothing; and, for
 * whoever reads the backups, «Копії в порядку · …» under it all. How old
 * it all is, the oldest of its reads, is said once for the block, as the
 * day-tag says it: a read that failed again may have taken its tag with
 * it, and «nothing waits» is only as new as what was read. News seen
 * («Бачу») goes, with «Повернути» for five seconds, and stands in
 * «Зроблено сьогодні» for the rest of the day.
 */
function WaitingTags({
  work,
  open,
  scopeKey,
  verbs,
  held,
  now,
}: {
  work: Work;
  open: Store;
  /** Whose «Бачу» this phone keeps. */
  scopeKey: string;
  verbs: Partial<Record<Kind, () => void>>;
  held: boolean;
  now: number;
}): JSX.Element | null {
  const label = useId();
  const [all, setAll] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [doneShown, setDoneShown] = useState(false);
  // The tag seen last, while its toast may still bring it back; a new
  // toast each time.
  const [hidden, setHidden] = useState<{
    tag: Tag;
    seen: string;
    times: number;
  } | null>(null);
  // Where the cursor goes as a tag is seen — the one after it, else the one
  // before, else the heading — or as it comes back: on it.
  const cursor = useRef<{ at: number } | { key: string } | null>(null);
  // The last «Бачу»'s tap: the next tag rises under the finger, and a
  // double tap's second half would hide it too, past its toast's reach
  // (review, 2026-10-31). A key's press is never one.
  const seenAt = useRef(-Infinity);
  useEffect(() => {
    const to = cursor.current;
    if (to === null) return;
    cursor.current = null;
    const tags = [
      ...(list.current?.querySelectorAll<HTMLElement>(".today-tag") ?? []),
    ];
    const next =
      "key" in to
        ? tags.find((tag) => tag.dataset.tag === to.key)
        : (tags[to.at] ?? tags[to.at - 1]);
    (next ?? heading.current)?.focus();
  });
  // Unfolded: the cursor on the first tag that was folded.
  useEffect(() => {
    if (!all) return;
    const tags = list.current?.querySelectorAll<HTMLElement>(".today-tag");
    tags?.item(SHOWN_TAGS).focus();
  }, [all]);
  if (!work.asked) return null;
  const { tags, done } = work;
  const folded = !all && tags.length > SHOWN_TAGS;
  const shown = folded ? tags.slice(0, SHOWN_TAGS) : tags;
  const empty = tags.length === 0 && !work.unread;
  const old = work.age.at !== undefined && staleOf(work.age, now);
  const seenOf = (tag: Tag, at: number) => (event: MouseEvent): void => {
    const id = tag.seen;
    if (id === undefined) return;
    if (event.detail !== 0 && event.timeStamp - seenAt.current < CARRIED_TAP)
      return;
    seenAt.current = event.timeStamp;
    // «Бачу», felt as a choice, as S04 has it (P1-2).
    buzz("selection");
    see(scopeKey, id);
    cursor.current = { at };
    setHidden((last) => ({ tag, seen: id, times: (last?.times ?? 0) + 1 }));
  };
  const doneLink = done.length > 0 && (
    <button
      type="button"
      className="today-done"
      onClick={() => {
        // What was seen is all there, the last one too: its toast, which
        // the sheet would cover and hold out of reach, goes.
        setHidden(null);
        setDoneShown(true);
      }}
    >
      Зроблено сьогодні · {done.length}
      <span aria-hidden="true"> ›</span>
    </button>
  );
  return (
    <>
      {empty ? (
        <section className="today-empty" aria-labelledby={label}>
          <Icon name="mark-lg" className="today-empty-mark" />
          <h2 ref={heading} id={label} className="t-row" tabIndex={-1}>
            Вас нічого не чекає.
          </h2>
          {old && <Stamp age={work.age} now={now} />}
          {doneLink}
        </section>
      ) : (
        <section className="today-waiting" aria-labelledby={label}>
          <div className="today-waiting-head">
            <h2 ref={heading} id={label} className="t-label" tabIndex={-1}>
              Чекає на вас{tags.length > 0 && ` · ${String(tags.length)}`}
            </h2>
            {(doneLink !== false || old) && (
              <span className="today-waiting-side">
                {doneLink}
                {old && <Stamp age={work.age} now={now} />}
              </span>
            )}
          </div>
          <ul ref={list} className="today-tags">
            {shown.map((tag, at) => (
              <li key={tag.key}>
                <TagRow
                  tag={tag}
                  open={open}
                  verb={verbs[tag.kind]}
                  held={held}
                  seen={seenOf(tag, at)}
                />
              </li>
            ))}
            {work.unread && (
              // Grey and unread aloud until its read fails.
              <li
                className="today-tag-wait"
                aria-hidden={!work.unreadAge.failed}
              >
                <div className="tag-row tag-outline">
                  <div className="today-tag-body">
                    <Waiting width="70%" />
                    <Waiting width="45%" />
                    {work.unreadAge.failed && (
                      <Stamp age={work.unreadAge} now={now} />
                    )}
                  </div>
                </div>
              </li>
            )}
          </ul>
          {folded && (
            <button
              type="button"
              className="today-more"
              onClick={() => {
                setAll(true);
              }}
            >
              + ще {tags.length - SHOWN_TAGS}
            </button>
          )}
        </section>
      )}
      {work.backupsOk && (
        <p className="t-meta today-backups">
          <Icon name="backup" size={16} />
          <span>
            Копії в порядку · {whenText(work.backupsOk.at, now)}
          </span>
        </p>
      )}
      {doneShown && (
        <Sheet
          title="Зроблено сьогодні"
          close={() => {
            setDoneShown(false);
          }}
          fallback={heading}
        >
          <ul className="today-done-list">
            {done.map(({ tag, at }) => (
              <li key={tag.key} className="today-done-row">
                <Eyelet state="knot" size={8} />
                <div>
                  <p className="t-row">{tag.title}</p>
                  <p className="t-meta">
                    Побачили о {timeOf(new Date(at).toISOString())}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Sheet>
      )}
      {hidden && (
        <Toast
          key={hidden.times}
          text="Бірку сховано."
          action="Повернути"
          act={() => {
            unsee(scopeKey, hidden.seen);
            cursor.current = { key: hidden.tag.key };
            seenAt.current = -Infinity;
            setHidden(null);
          }}
          gone={() => {
            setHidden(null);
          }}
        />
      )}
    </>
  );
}

/** A store's drawer and debts, each by its own read: a line in its place
 * until it comes. */
function StoreLines({
  drawer,
  debts,
}: {
  drawer: UseQueryResult<Drawer> | undefined;
  debts: UseQueryResult<StoreDebts> | undefined;
}): JSX.Element {
  return (
    <>
      {drawer && (
        <p className="t-meta day-drawer">
          {drawer.data ? drawerText(drawer.data) : <Waiting width="8em" />}
        </p>
      )}
      {debts && (
        <p
          className={
            debts.data && owes(debts.data)
              ? "t-meta day-owed owes"
              : "t-meta day-owed"
          }
        >
          {debts.data ? (
            <>
              {owes(debts.data) && <Icon name="owed" size={16} />}
              <span>
                <Parts parts={owedParts(debts.data)} />
              </span>
            </>
          ) : (
            <Waiting width="10em" />
          )}
        </p>
      )}
    </>
  );
}

/** One store of the day: its name, what it sold, its drawer, its debts. */
function StoreColumn({
  store,
  figures,
  read,
  drawer,
  debts,
}: {
  store: Store;
  /** None while the report is read, or where it has none of this store's:
   * its rights came after the report was read. */
  figures: StoreFigures | undefined;
  /** Whether the report has been read: its place held in grey before. */
  read: boolean;
  drawer: UseQueryResult<Drawer> | undefined;
  debts: UseQueryResult<StoreDebts> | undefined;
}): JSX.Element {
  const name = useId();
  return (
    <div className="day-store" role="group" aria-labelledby={name}>
      <h3 id={name} className="t-label">
        {visible(store.name)}
      </h3>
      {figures ? (
        <p className="day-store-sold">
          <span
            className={
              Number(figures.sold) >= 1_000_000
                ? "day-store-sum long"
                : "day-store-sum"
            }
          >
            <Sum value={money(figures.sold)} />
          </span>
          <span className="t-meta">{units(figures.units)}</span>
        </p>
      ) : (
        !read && (
          <p className="day-store-sold">
            <Waiting width="7em" />
          </p>
        )
      )}
      <StoreLines drawer={drawer} debts={debts} />
    </div>
  );
}

/**
 * «Сьогодні» (spec S04–S05; «Усе на бірці» task list, P0-6): the day of
 * every store this person reads the report in, in one look — what was sold
 * and returned, the money through the tills and outside them, each store's
 * drawer and debts, the parcels on their way. Every figure is a field the
 * server answered; debts are a store's own, never summed.
 */
export function Today({
  token,
  scopeKey,
  stores,
  open,
  readsBackups,
  verbs,
  held,
  toOrders,
}: {
  token: string;
  /** Whose reads these are: the organisation and the person. */
  scopeKey: string;
  /** Every store of `/me`, with this person's rights in each. */
  stores: readonly Store[];
  /** The store open in Бірка: its tags' verbs are done here. */
  open: Store;
  /** Whether the network's backups are this person's to read. */
  readsBackups: boolean;
  /** Where each kind's verb goes, where this person may open it. */
  verbs: Partial<Record<Kind, () => void>>;
  /** A kept operation holds every other section: the verbs wait too. */
  held: boolean;
  /** «Замовлення», where this person reads the open store's orders. */
  toOrders?: (() => void) | undefined;
}): JSX.Element {
  const report = useDayReport(token, scopeKey);
  const shown = dayStores(stores);
  const drawers = useDrawers(token, shown);
  const debts = useDebts(token, shown);
  const orders = [...useOpenOrders(token, scopeKey, shown).values()];
  // What waits, read as the tab's badge reads it.
  const work = useWaiting({ token, scopeKey, stores, open, readsBackups });
  const age = ageOf([
    report,
    ...drawers.values(),
    ...debts.values(),
    ...orders,
  ]);
  const now = useNow();
  const steady = useSteadyHeight();
  const [opened, setOpened] = useState(false);
  const folded = steady < FOLDED_BELOW && !opened;
  const label = useId();
  // Opened from its one line: the cursor on its heading, where the line
  // stood.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (opened) heading.current?.focus();
  }, [opened]);
  const data = report.data;
  // The stores together where there are two or more, as the report adds
  // them; one store's own figures otherwise.
  const day: Figures | undefined = data
    ? (data.total ?? data.stores[0])
    : undefined;
  const figuresOf = (store: Store): StoreFigures | undefined =>
    data?.stores.find((one) => one.store_id === store.id);
  const online = onlineParts(orders);
  // One store's lines stand unnamed in the tag only where the report reads
  // that store alone: beside a store that does not trade, it is named.
  const one =
    reportStores(stores).length === 1 && shown.length === 1
      ? shown[0]
      : undefined;
  return (
    <>
      <ScreenHeader title="Сьогодні" lead={dayLine(data?.today)} />
      <section className="today" aria-label="Сьогодні">
        {folded ? (
          <button
            type="button"
            className="tag-hero tag-outline day-folded"
            aria-expanded="false"
            onClick={() => {
              setOpened(true);
            }}
          >
            <span className="day-folded-inner">
              <span className="day-folded-line">
                {/* Too long for 360 px: it wraps between its two parts
                    only, as the money's line does. */}
                <span className="day-folded-text">
                  <span className="t-label day-part">Сьогодні досі</span>
                  {" · "}
                  {day ? (
                    <span className="day-part">
                      {money(day.sold)} · {units(day.units)}
                    </span>
                  ) : (
                    <Waiting width="9em" />
                  )}
                </span>
                <Icon name="chevron-down" size={16} />
              </span>
              {/* Old, or not read: said here too. */}
              {staleOf(age, now) && <Stamp age={age} now={now} />}
            </span>
          </button>
        ) : (
          <div className="day-hang">
            <div className="tag-hero tag-outline">
              <div className="day-tag" role="group" aria-labelledby={label}>
                <span className="day-eyelet" aria-hidden="true" />
                <div className="day-head">
                  <h2
                    ref={heading}
                    id={label}
                    className="t-label"
                    tabIndex={-1}
                  >
                    Сьогодні досі
                  </h2>
                  <Stamp age={age} now={now} />
                </div>
                {day ? (
                  <>
                    <p className="day-total">
                      <span className="t-money-hero">
                        <Sum value={money(day.sold)} />
                      </span>
                      <span className="day-total-words">
                        продано · {units(day.units)}
                        {day.returned_units > 0 &&
                          ` · повернули ${units(day.returned_units)}`}
                      </span>
                    </p>
                    <p className="t-meta day-money">
                      <Parts parts={moneyParts(day)} />
                    </p>
                  </>
                ) : (
                  <div className="day-total-wait" aria-hidden="true">
                    <span className="skeleton day-total-skeleton" />
                    <Waiting width="70%" />
                  </div>
                )}
                {one ? (
                  <StoreLines
                    drawer={drawers.get(one.id)}
                    debts={debts.get(one.id)}
                  />
                ) : (
                  shown.length > 0 && (
                    <>
                      <div className="perforation" aria-hidden="true" />
                      <div
                        className={
                          shown.length === 2 ? "day-columns" : "day-rows"
                        }
                      >
                        {shown.map((store) => (
                          <StoreColumn
                            key={store.id}
                            store={store}
                            figures={figuresOf(store)}
                            read={data !== undefined}
                            drawer={drawers.get(store.id)}
                            debts={debts.get(store.id)}
                          />
                        ))}
                      </div>
                    </>
                  )
                )}
                {orders.length > 0 &&
                  (orders.some((read) => read.data === undefined) ? (
                    <p className="t-meta day-online">
                      <Waiting width="14em" />
                    </p>
                  ) : (
                    online.length > 0 &&
                    (toOrders ? (
                      <button
                        type="button"
                        className="day-online"
                        onClick={toOrders}
                      >
                        <Icon name="chat" size={16} />
                        <span>
                          <Parts parts={online} />
                        </span>
                      </button>
                    ) : (
                      <p className="t-meta day-online">
                        <Icon name="chat" size={16} />
                        <span>
                          <Parts parts={online} />
                        </span>
                      </p>
                    ))
                  ))}
              </div>
            </div>
          </div>
        )}
      </section>
      <WaitingTags
        work={work}
        open={open}
        scopeKey={scopeKey}
        verbs={verbs}
        held={held}
        now={now}
      />
    </>
  );
}
