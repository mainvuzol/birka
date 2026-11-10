import { useLayoutEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { money } from "@/orders/types";
import type { Store } from "@/orders/types";
import { api } from "@/shared/api";
import { Unread } from "@/shared/Unread";
import { useNextPageFailed } from "@/shared/nextPage";
import { Eyelet } from "@/shared/Eyelet";
import { Empty } from "@/shared/Empty";
import { Icon } from "@/shared/Icon";
import { Placeholder } from "@/shared/Placeholder";
import { visible } from "@/shared/visible";
import { Back } from "@/shared/Back";
import { ScreenHeader } from "@/shared/ScreenHeader";
import { Sticker } from "@/shared/Sticker";
import { CloseBody, differenceOf, isOpening } from "./Closed";
import { dayOf, timeOf } from "./errors";
import { daysAgo, isoDay, moved, nothing } from "./format";
import type { Close, ClosePage } from "./types";

/** Closes per page of the history: the server gives at most 100 at once
 * (`GET /cash/closes`), so the history pages by offset, never by a larger
 * limit. */
const pageSize = 20;

/** «2 000,00» of «2 000,00 грн»: a row's figures, the pill saying the sum. */
function bare(value: string): string {
  return value.replace(/\u00a0грн$/, "");
}

/** What a close came to, as a sticker: a shortage or a surplus a warning
 * with its triangle, to the kopeck the till's match with its knot (orders
 * and «Каса» task list after stage 2, P1-4), as the close's result says
 * it; a first count nothing to compare, no sign (owner decision,
 * 2026-10-21, В4 (а); cash task list, P1-4; stage 2, money task list,
 * P1-2). */
function Pill({ close }: { close: Close }): JSX.Element {
  if (isOpening(close))
    return <Sticker className="close-pill">Перший підрахунок</Sticker>;
  const difference = differenceOf(close.difference ?? "0.00");
  return difference.match ? (
    <Sticker tone="match" className="close-pill">
      Збіглося
    </Sticker>
  ) : (
    <Sticker tone="warn" className="close-pill">
      {difference.text}
    </Sticker>
  );
}

/** A close's knot at the row's left (spec §6.9; stage 2, money task list,
 * P1-2): tied — nothing is left to do with it; a ring — its reason waits
 * for whoever counted. Its words say it in the row's meta. */
function Node({ close }: { close: Close }): JSX.Element {
  return (
    <span className="close-node" aria-hidden="true">
      {close.reason_required && close.reason === null ? (
        <span className="eyelet eyelet-8 close-ring" />
      ) : (
        <Eyelet state="knot" size={8} />
      )}
    </span>
  );
}

/** «20:14 · порахували 2 000,00 · мало бути 2 050,00», and a reason not
 * given or what explains the difference. Every figure is the server's. */
function metaOf(close: Close): string {
  return [
    timeOf(close.closed_at),
    `порахували ${bare(money(close.counted))}`,
    ...(isOpening(close)
      ? []
      : [`мало бути ${bare(money(close.expected ?? "0.00"))}`]),
    ...(close.reason_required && close.reason === null
      ? ["причину не вказано"]
      : []),
    // As the close itself says it: only where there is a difference to
    // explain (review, 2026-10-22).
    ...(!isOpening(close) &&
    close.difference !== null &&
    !nothing(close.difference) &&
    close.explained !== null &&
    !nothing(close.explained)
      ? [`пояснено ${bare(moved(close.explained))}`]
      : []),
  ].join(" · ");
}

/**
 * The closes, newest first, for the owner and managers (owner decision:
 * the split and the closes are theirs, as the sales report is): a row each
 * — its day and who closed, what was counted and expected, what it came to
 * as a pill — and each day nobody closed; a close tapped, all of it, as its
 * result showed it (cash task list, P1-4): where it did not add up and why,
 * as a notebook's page is leafed through.
 */
export function History({
  store,
  token,
  back,
  backTo = "Каса",
}: {
  store: Store;
  token: string;
  back: () => void;
  /** The screen it goes back to: «Каса», or «Гроші» («Усе на бірці»
   * sections task list, P0-7). */
  backTo?: "Каса" | "Гроші";
}): JSX.Element {
  // One year, fixed while the screen is open: every page is of the same list.
  const [period] = useState(() => ({
    from: daysAgo(365),
    to: isoDay(new Date()),
  }));
  const closes = useInfiniteQuery({
    queryKey: ["cash-closes", store.id, "history", period.from, period.to],
    queryFn: ({ pageParam }) =>
      api<ClosePage>(
        `/cash/closes?store_id=${store.id}&date_from=${period.from}&date_to=${period.to}&limit=${String(pageSize)}&offset=${String(pageParam)}`,
        token,
      ),
    initialPageParam: 0,
    // The next page starts after the closes read; the server says whether
    // there is one.
    getNextPageParam: (last: ClosePage, pages: ClosePage[]) =>
      last.has_more ? pages.length * pageSize : undefined,
    retry: false,
  });
  // A page that failed, said where «Показати ще» stood until the list is
  // read with no error (P2-6; review).
  const nextFailed = useNextPageFailed(closes);
  // A close made between two pages moves the older ones down by one: each
  // close is shown once.
  const items = [
    ...new Map(
      (closes.data?.pages ?? [])
        .flatMap((page) => page.items)
        .map((close) => [close.id, close]),
    ).values(),
  ];
  // The close tapped, read again by its id: as it is now, and never lost
  // while the list's pages are read again around it (review, 2026-10-22).
  const [tapped, setTapped] = useState<Close | null>(null);
  const detail = useQuery({
    queryKey: ["cash-close", tapped?.id],
    queryFn: () => api<Close>(`/cash/closes/${tapped?.id ?? ""}`, token),
    enabled: tapped !== null,
    retry: false,
  });
  const open = tapped === null ? null : (detail.data ?? tapped);
  const heading = useRef<HTMLHeadingElement>(null);
  // Where the list was read to, and the row tapped, kept while a close is
  // open: back, the same place, the same row in hand, as a notebook falls
  // open where it was left — put there before it is painted, after the
  // header's reset (audit after stage 2, frame P1-3).
  const place = useRef(0);
  const row = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (tapped !== null) {
      heading.current?.focus();
      return;
    }
    window.scrollTo(0, place.current);
    if (row.current !== null)
      document
        .querySelector<HTMLButtonElement>(`[data-close="${row.current}"]`)
        ?.focus({ preventScroll: true });
  }, [tapped]);
  if (open)
    return (
      <>
        <ScreenHeader
          ref={heading}
          focusable
          // Its store, when and who, in the screen's one line (orders and
          // «Каса» task list after stage 2, P2-1).
          context={`${visible(open.store_name)} · ${timeOf(open.closed_at)} · ${visible(open.closed_by)}`}
          title={
            <>
              {isOpening(open) ? "Перший підрахунок" : "Закриття"}{" "}
              {dayOf(open.business_day)}
            </>
          }
          back={
            <Back
              go={() => {
                setTapped(null);
              }}
              label="Назад до закриттів"
            >
              <span aria-hidden="true">← </span>Закриття
            </Back>
          }
        />
        <section className="cash-closed cash-history">
          <CloseBody close={open} now={false} />
        </section>
      </>
    );
  return (
    <>
      <ScreenHeader
        title="Закриття"
        back={
          <Back
            go={back}
            label={backTo === "Каса" ? "Назад до каси" : "Назад до «Гроші»"}
          >
            <span aria-hidden="true">← </span>
            {backTo}
          </Back>
        }
      />
      <section className="cash-history">
        {closes.isPending ? (
          <Placeholder said="Завантажуємо закриття…" rows={4} day={false} />
        ) : closes.data === undefined ? (
          <Unread
            error={closes.error}
            retry={() => {
              void closes.refetch();
            }}
          />
        ) : items.length === 0 ? (
          // The blank tag (spec §6.28; orders and «Каса» task list after
          // stage 2, P2-3).
          <Empty title="Касу цього магазину ще не закривали." />
        ) : (
          <>
            {closes.error && !nextFailed && (
              // Read again and refused: the closes below as they were read,
              // and that said over them.
              <Unread
                error={closes.error}
                held={closes.isFetching}
                retry={() => {
                  void closes.refetch();
                }}
              />
            )}
            <ul className="history close-list" aria-label="Закриття каси">
              {items.map((close) => (
                <HistoryRow
                  key={close.id}
                  close={close}
                  open={() => {
                    place.current = window.scrollY;
                    row.current = close.id;
                    setTapped(close);
                  }}
                />
              ))}
            </ul>
            {/* A page that failed keeps the closes already read: one plate
                where «Показати ще» stood, its retry reading that page
                (orders and «Каса» task list after stage 2, P2-6). */}
            {nextFailed ? (
              <Unread
                error={closes.error}
                held={closes.isFetching}
                retry={() => {
                  void closes.fetchNextPage();
                }}
              />
            ) : (
              closes.hasNextPage && (
                <button
                  className="quiet"
                  disabled={closes.isFetching}
                  onClick={() => {
                    void closes.fetchNextPage();
                  }}
                >
                  Показати ще
                </button>
              )
            )}
          </>
        )}
      </section>
    </>
  );
}

function HistoryRow({
  close,
  open,
}: {
  close: Close;
  open: () => void;
}): JSX.Element {
  return (
    <>
      <li aria-label={`Закриття ${dayOf(close.business_day)}`}>
        <button
          type="button"
          className="sale-row close-row"
          data-close={close.id}
          onClick={open}
        >
          <Node close={close} />
          <span className="sale-main">
            {/* The pill under the day, a column of its own down the list;
                the figures the row's whole width. */}
            <span className="close-head">
              <span className="cash-row-title">
                {dayOf(close.business_day)} · {visible(close.closed_by)}
              </span>
              <Pill close={close} />
            </span>
            <span className="sale-meta">{metaOf(close)}</span>
          </span>
          <Icon name="chevron-right" size={16} className="sale-open" />
        </button>
      </li>
      {/* Newest first: the days nobody closed came before this close. */}
      {[...close.unclosed_days].reverse().map((day) => (
        <li
          key={`${close.id}:${day}`}
          className="close-unclosed"
          aria-label={`${dayOf(day)} — не закрито`}
        >
          {/* No knot: nobody closed it. */}
          <span className="close-node" aria-hidden="true" />
          <span className="close-head">
            <span className="cash-row-title">{dayOf(day)}</span>
            <Sticker className="close-pill">Не закрито</Sticker>
          </span>
        </li>
      ))}
    </>
  );
}
