import type { JSX } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { shortTime } from "@/credits/format";
import { money } from "@/orders/types";
import { paperText } from "@/sales/paperMark";
import { markText } from "@/sales/types";
import { api } from "@/shared/api";
import {
  isTillMethod,
  methodHow,
  notStated,
  refundHow,
  type PaymentMethod,
} from "@/shared/payment";
import { Placeholder } from "@/shared/Placeholder";
import { Unread } from "@/shared/Unread";
import { visible } from "@/shared/visible";
import { minus, query } from "./format";
import type { Range } from "./format";
import type { Entries, Entry } from "./types";

/** A page of entries, as many as the server gives at once. */
const PAGE = 50;

// How an entry's money moved, after its sum: «готівкою», «на картку».
function how(entry: Entry, method: PaymentMethod): string {
  return entry.kind === "RETURN" && isTillMethod(method)
    ? refundHow[method]
    : methodHow[method];
}

// The way as it was stated; a correction is a note beside it, never a
// rewrite (ADR-0012 §B11).
function wayText(entry: Entry): string {
  const stated =
    entry.payment_method === null
      ? ` · спосіб ${notStated}`
      : ` ${how(entry, entry.payment_method)}`;
  return entry.method_now
    ? `${stated} (виправлено: ${how(entry, entry.method_now)})`
    : stated;
}

/** How it was paid or handed back, and whose it is where several stores
 * are shown together. */
function entryNote(entry: Entry, everyStore: boolean): string {
  if (entry.kind === "SALE") {
    const paid = entry.paid_in_parts
      ? `частинами, внесено ${money(entry.money)}${wayText(entry)}`
      : `оплачено повністю${wayText(entry)}`;
    return everyStore ? `${paid} · «${visible(entry.store_name)}»` : paid;
  }
  const handed =
    entry.money === "0.00"
      ? "лише зменшило борг"
      : `віддано ${money(entry.money)}${wayText(entry)}`;
  return entry.taken_at_store_id && entry.taken_at_store_id !== entry.store_id
    ? `${handed} · продав «${visible(entry.store_name)}», прийняв «${visible(entry.taken_at_store_name ?? "")}»`
    : everyStore
      ? `${handed} · «${visible(entry.store_name)}»`
      : handed;
}

/** An entry's day, «05.11», and its year where it is not the server's
 * today's — under it, as the column holds five characters (review,
 * 2026-11-08). */
function dayOf(
  iso: string,
  today: string | undefined,
): { key: string; day: string; year: string | null } {
  const at = new Date(iso);
  const year = String(at.getFullYear());
  const day = at.toLocaleDateString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
  });
  return {
    key: `${year}-${day}`,
    day,
    year: today === undefined || today.slice(0, 4) === year ? null : year,
  };
}

/**
 * A sale typed from paper (ADR-0013 §5.6): who sold and the paper's time,
 * from the mark, and who typed it, the entry's `by`. Its figures are the
 * day it was typed.
 */
function paperLine(entry: Entry): string | null {
  const { outage } = entry;
  if (outage === undefined || outage === null) return null;
  const mark =
    entry.kind === "RETURN"
      ? paperText("return", {
          by_user_id: null,
          by: outage.sold_by,
          at: outage.sold_at,
          first_days: outage.first_days === true,
        })
      : markText(outage);
  return `${mark} · внесено: ${visible(entry.by)}`;
}

/**
 * «Продажі й повернення» of the report's days (stage 2, money task list,
 * P1-1; spec §6.21), on a screen of their own: a thread by day, the newest
 * first — the day once, at its first entry — each a filled eyelet, what it
 * was and its sum, the hour, who and the goods, how it was paid and the
 * paper it was typed from; «Показати ще» a page at a time.
 */
export function ReportEntries({
  token,
  scopeKey,
  range,
  today,
  storeId,
  everyStore,
}: {
  token: string;
  scopeKey: string;
  range: Range | null;
  /** The server's: a day of another year says it. */
  today: string | undefined;
  /** "" — every store read. */
  storeId: string;
  /** Several stores shown together: each entry says whose it is. */
  everyStore: boolean;
}): JSX.Element {
  const entries = useInfiniteQuery({
    queryKey: ["sales-report-entries", scopeKey, range, storeId],
    queryFn: ({ pageParam }) =>
      api<Entries>(
        `/reports/sales/entries${query(range, storeId, {
          limit: String(PAGE),
          offset: String(pageParam),
        })}`,
        token,
      ),
    initialPageParam: 0,
    // The next page starts after the entries read; the server says whether
    // there is one.
    getNextPageParam: (last: Entries, pages: Entries[]) =>
      last.has_more ? pages.length * PAGE : undefined,
    retry: false,
  });
  if (entries.isPending)
    return <Placeholder said="Завантажуємо продажі…" rows={4} day={false} />;
  if (entries.data === undefined)
    return (
      <Unread
        error={entries.error}
        retry={() => {
          void entries.refetch();
        }}
      />
    );
  // A sale made between two pages moves the older ones down by one: each
  // entry is shown once.
  const items = [
    ...new Map(
      entries.data.pages
        .flatMap((page) => page.entries)
        .map((entry) => [`${entry.kind}:${entry.id}`, entry]),
    ).values(),
  ];
  if (items.length === 0)
    return <p className="report-empty">Ні продажів, ні повернень.</p>;
  return (
    <>
      <ul className="timeline report-thread" aria-label="Продажі й повернення">
        {items.map((entry, at) => {
          const { key, day, year } = dayOf(entry.at, today);
          const before = items[at - 1];
          const first =
            before === undefined || dayOf(before.at, today).key !== key;
          const paper = paperLine(entry);
          return (
            <li key={`${entry.kind}:${entry.id}`} className="timeline-row">
              <span className="timeline-day">
                {first ? (
                  <>
                    {day}
                    {year && <span className="timeline-year"> {year}</span>}
                  </>
                ) : (
                  <span className="visually-hidden">
                    {year ? `${day} ${year}` : day}
                  </span>
                )}
              </span>
              <span className="timeline-node" aria-hidden="true" />
              <span className="timeline-main">
                <span className="timeline-what">
                  {entry.kind === "SALE"
                    ? `Продаж ${money(entry.amount)}`
                    : `Повернення ${minus(entry.amount)}`}
                </span>
                <span className="timeline-meta">
                  {[
                    shortTime(entry.at),
                    visible(entry.by),
                    entry.goods.map(visible).join(", "),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <span className="timeline-meta">
                  {entryNote(entry, everyStore)}
                </span>
                {paper && (
                  <span className="timeline-meta paper-meta">{paper}</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {/* A page that failed keeps the entries already read. */}
      {entries.error && (
        <Unread
          error={entries.error}
          retry={() => {
            void (entries.isFetchNextPageError
              ? entries.fetchNextPage()
              : entries.refetch());
          }}
        />
      )}
      {/* A page that failed is asked again by its own retry. */}
      {entries.hasNextPage && !entries.isFetchNextPageError && (
        <button
          type="button"
          className="quiet history-more"
          disabled={entries.isFetching}
          onClick={() => {
            void entries.fetchNextPage();
          }}
        >
          Показати ще
        </button>
      )}
    </>
  );
}
