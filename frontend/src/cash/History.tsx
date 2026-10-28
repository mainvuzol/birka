import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { money } from "@/orders/types";
import type { Store } from "@/orders/types";
import { api, errorText } from "@/shared/api";
import { Placeholder } from "@/shared/Placeholder";
import { visible } from "@/shared/visible";
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

/** What a close came to, as a pill: a shortage or a surplus a warning, to
 * the kopeck the accent's, a first count nothing to compare (owner
 * decision, 2026-10-21, В4 (а); cash task list, P1-4). */
function Pill({ close }: { close: Close }): JSX.Element {
  if (isOpening(close))
    return <span className="badge neutral">Перший підрахунок</span>;
  const difference = differenceOf(close.difference ?? "0.00");
  return difference.match ? (
    <span className="badge match">Збіглося</span>
  ) : (
    <span className="badge warn">{difference.text}</span>
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
}: {
  store: Store;
  token: string;
  back: () => void;
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
  // open where it was left.
  const place = useRef(0);
  const row = useRef<string | null>(null);
  useEffect(() => {
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
      <section className="cash-closed cash-history">
        <button
          type="button"
          className="quiet back"
          aria-label="Назад до закриттів"
          onClick={() => {
            setTapped(null);
          }}
        >
          <span aria-hidden="true">← </span>Закриття
        </button>
        <h2 ref={heading} tabIndex={-1}>
          {isOpening(open) ? "Перший підрахунок" : "Закриття"}{" "}
          {dayOf(open.business_day)}
        </h2>
        <p className="cash-context">
          {timeOf(open.closed_at)} · {visible(open.closed_by)}
        </p>
        <CloseBody close={open} now={false} />
      </section>
    );
  return (
    <section className="cash-history">
      <button
        type="button"
        className="quiet back"
        aria-label="Назад до каси"
        onClick={back}
      >
        <span aria-hidden="true">← </span>Каса
      </button>
      <h2>Закриття</h2>
      {closes.isPending ? (
        <Placeholder said="Завантажуємо закриття…" rows={4} day={false} />
      ) : closes.data === undefined ? (
        <p role="alert">{errorText(closes.error)}</p>
      ) : items.length === 0 ? (
        <p>Касу цього магазину ще не закривали.</p>
      ) : (
        <>
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
          {/* A page that failed keeps the closes already read. */}
          {closes.error && <p role="alert">{errorText(closes.error)}</p>}
          {closes.hasNextPage && (
            <button
              className="quiet"
              disabled={closes.isFetching}
              onClick={() => {
                void closes.fetchNextPage();
              }}
            >
              Показати ще
            </button>
          )}
        </>
      )}
    </section>
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
          <span className="sale-open" aria-hidden="true">
            ›
          </span>
        </button>
      </li>
      {/* Newest first: the days nobody closed came before this close. */}
      {[...close.unclosed_days].reverse().map((day) => (
        <li
          key={`${close.id}:${day}`}
          className="close-unclosed"
          aria-label={`${dayOf(day)} — не закрито`}
        >
          <span className="close-head">
            <span className="cash-row-title">{dayOf(day)}</span>
            <span className="badge neutral">Не закрито</span>
          </span>
        </li>
      ))}
    </>
  );
}
