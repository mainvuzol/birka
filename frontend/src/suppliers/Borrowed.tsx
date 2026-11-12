import { useEffect, useId, useRef, useState } from "react";
import type { JSX, RefObject } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, errorText, inOwnWords, isConflict } from "@/shared/api";
import { Unread } from "@/shared/Unread";
import { Placeholder } from "@/shared/Placeholder";
import { money } from "@/orders/types";
import { sizeLabel } from "@/returns/types";
import type { Store } from "@/orders/types";
import { visible } from "@/shared/visible";
import { Eyelet, RecordedMark } from "@/shared/Eyelet";
import { Icon } from "@/shared/Icon";
import { ModeSwitch } from "@/shared/ModeSwitch";
import { ScreenHeader } from "@/shared/ScreenHeader";
import { SendingLine } from "@/shared/Sending";
import { Sheet } from "@/shared/Sheet";
import { Perforation, Stub } from "@/shared/Stub";
import { Sum } from "@/shared/Sum";
import { usePanelRoom } from "@/shared/panel";
import { buzz, useMainButton } from "@/shared/telegram";
import type { JournalOutcome } from "@/shared/journal";
import { BackToMore } from "@/shared/More";
import type { MoreBack } from "@/shared/More";
import { Empty } from "@/shared/Empty";
import { shortDay } from "@/credits/format";
import { submitReturnToSupplier, useReturnToSupplier } from "./commands";
import { submitInvoiceCommand, useInvoiceCommand } from "./invoiceCommands";
import type { Invoice, Borrowed as Lot, BorrowedPage } from "./types";

const pageSize = 20;

/** What was recorded, its stub's words: «Продано» with its invoice. */
type Done =
  | { kind: "sold"; lot: Lot; quantity: number; invoice: Invoice }
  | { kind: "returned"; lot: Lot; quantity: number };

/** «Кокон графіт, M». */
function lotName(lot: Lot): string {
  return `${visible(lot.display_name)}, ${sizeLabel(lot.size)}`;
}

/** «Позичено у «Ганна» · 14.10 · Основний». */
function lotWhence(lot: Lot): string {
  return `${lot.acquisition_type === "BORROWED" ? "Позичено" : "Під реалізацію"} у «${visible(lot.supplier.name)}» · ${shortDay(lot.at)} · ${visible(lot.location_name)}`;
}

/** «1 500,00 грн за шт. · взято 3 · продано 1 · повернено 0». */
function lotCounts(lot: Lot): string {
  return `${lot.unit_cost ? `${money(lot.unit_cost)} за шт. · ` : ""}взято ${String(lot.received)} · продано ${String(lot.sold)} · повернено ${String(lot.returned)}`;
}

/**
 * «Позичене й під реалізацію» (owner decisions, 2026-10-01; stage 2, money
 * task list, P0-5): goods borrowed from another shop, and goods under
 * consignment.
 *
 * They arrive through «Прийшов товар», from a supplier, at a price agreed
 * for each, and the till sells them as any goods. Here each lot is a tag —
 * its eyelet filled while some are in hand, a knot once none are — under
 * «На руках · Усе»; a tap, or its verb «Продано», opens its sheet: how many,
 * «Позначити проданим», which records an invoice in «Накладні» for their
 * price, or «Повернути постачальнику», which sends unsold ones back for
 * nothing. Recorded, its stub. A mistaken «Продано» is undone by cancelling
 * its invoice; a return, by cancelling the return.
 */
export function Borrowed({
  store,
  token,
  journalKey,
  invoiceJournalKey,
  blocked,
  back,
  openInvoice,
}: {
  store: Store;
  token: string;
  /** The returns' journal, which a return of borrowed goods goes through. */
  journalKey: string;
  /** The invoices' journal, which a mark of sold goes through. */
  invoiceJournalKey: string;
  /** Another command's outcome is unknown: nothing new until it is settled. */
  blocked: boolean;
  /** «← Ще», «← Постачальникам» or «← Накладна»: where it was opened. */
  back?: MoreBack | undefined;
  /** A mark's invoice in «Накладні», from its stub (P1-3); held while
   * «Накладні» are. */
  openInvoice?: { go: (invoice: Invoice) => void; held: boolean } | undefined;
}): JSX.Element {
  const cache = useQueryClient();
  // Either journal's kept operation is the app's: its stub over this
  // screen, its banner over any other (stage 2, money task list, P0-6).
  const returning = useReturnToSupplier();
  const marking = useInvoiceCommand();
  const held =
    blocked ||
    returning.busy ||
    returning.pending !== null ||
    marking.busy ||
    marking.pending !== null;
  const [onHandOnly, setOnHandOnly] = useState(true);
  const [lot, setLot] = useState<Lot | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const maySell = store.permissions.includes("supplier:debt");
  // Page by page: the server takes fifty at most (stage 2, money task list,
  // P0-7).
  const lots = useInfiniteQuery({
    queryKey: ["borrowed", store.id, onHandOnly],
    queryFn: ({ pageParam }) =>
      api<BorrowedPage>(
        `/borrowed?store_id=${store.id}&limit=${String(pageSize)}&offset=${String(pageParam)}${
          onHandOnly ? "" : "&on_hand=false"
        }`,
        token,
      ),
    initialPageParam: 0,
    getNextPageParam: (last: BorrowedPage, pages: BorrowedPage[]) =>
      last.has_more ? pages.length * pageSize : undefined,
    retry: false,
  });
  // A lot borrowed between two pages moves the older ones down by one: each
  // is shown once.
  const listed = [
    ...new Map(
      (lots.data?.pages ?? [])
        .flatMap((page) => page.items)
        .map((one) => [one.stock_lot_id, one]),
    ).values(),
  ];
  const title = useRef<HTMLHeadingElement>(null);

  async function changed(): Promise<void> {
    await Promise.all([
      ...["borrowed", "supplier-invoices", "supplier-returns"].map((name) =>
        cache.invalidateQueries({ queryKey: [name, store.id] }),
      ),
      cache.invalidateQueries({ queryKey: ["sale-stock"] }),
    ]);
  }

  /** Mark some sold: an invoice for their price, the server's sum. */
  async function sell(chosen: Lot, quantity: number): Promise<string | null> {
    const outcome = await submitInvoiceCommand(invoiceJournalKey, token, {
      // The mark's permanent name, made once: a resend after a lost answer
      // comes from the journal, which keeps it.
      key: crypto.randomUUID(),
      body: {
        kind: "sold",
        command_id: crypto.randomUUID(),
        store_id: store.id,
        stock_lot_id: chosen.stock_lot_id,
        quantity,
      },
    });
    return settle(outcome, (invoice) => ({
      kind: "sold",
      lot: chosen,
      quantity,
      invoice,
    }));
  }

  /** Send some back unsold, through the returns' journal, as their lot. */
  async function sendBack(
    chosen: Lot,
    quantity: number,
  ): Promise<string | null> {
    const outcome = await submitReturnToSupplier(journalKey, token, {
      key: crypto.randomUUID(),
      body: {
        command_id: crypto.randomUUID(),
        store_id: store.id,
        location_id: chosen.location_id,
        supplier_id: chosen.supplier.id,
        lines: [
          {
            product_variant_id: chosen.held_as_variant_id,
            size_id: chosen.size_id,
            quantity,
          },
        ],
        note: null,
        stock_lot_id: chosen.stock_lot_id,
      },
    });
    return settle(outcome, () => ({
      kind: "returned",
      lot: chosen,
      quantity,
    }));
  }

  /** Done: its stub. Refused: its words, in the sheet. Unknown: the sheet
   * goes, so the kept one's stub over the screen is seen. */
  async function settle<T>(
    outcome: JournalOutcome<T>,
    stub: (result: T) => Done,
  ): Promise<string | null> {
    if (outcome.kind === "done") {
      buzz("success");
      setLot(null);
      setDone(stub(outcome.result));
      await changed();
      return null;
    }
    if (outcome.kind === "refused") {
      buzz("error");
      // Changed in a way it does not name: the lots read again.
      if (isConflict(outcome.error))
        await cache.invalidateQueries({ queryKey: ["borrowed", store.id] });
      return refusalText(outcome.error);
    }
    setLot(null);
    return null;
  }

  // The stub's one action, Telegram's: «Готово», the lots again.
  const main = useMainButton(
    "Готово",
    () => {
      setDone(null);
    },
    { shown: done !== null },
  );
  const dock = useRef<HTMLDivElement>(null);
  usePanelRoom(dock, done !== null && !main);
  // The stub's words take the cursor, the button pressed being gone; and
  // the heading once «Готово» is — never as the screen opens.
  const said = useRef<HTMLParagraphElement>(null);
  const stub = useId();
  const was = useRef(done);
  useEffect(() => {
    if (was.current === done) return;
    was.current = done;
    (done ? said : title).current?.focus();
  }, [done]);

  const heading = (
    <ScreenHeader
      ref={title}
      focusable
      title="Позичене й під реалізацію"
      back={back && <BackToMore back={back} />}
      wraps
      aside={
        done === null && (
          <button
            type="button"
            className="quiet"
            disabled={lots.isFetching}
            onClick={() => {
              void lots.refetch();
            }}
          >
            Оновити
          </button>
        )
      }
    />
  );

  if (done)
    return (
      <>
        {heading}
        <section className="receipt receive-done borrowed-done">
          <p
            className="result-title t-sheet"
            ref={said}
            tabIndex={-1}
            // Focused, «Продано» is heard with the debt it recorded and
            // where it is (money task list after stage 2, P2-3; review).
            aria-describedby={
              done.kind === "sold" ? `${stub}-sum ${stub}-where` : undefined
            }
          >
            <RecordedMark />
            {done.kind === "sold"
              ? `Продано ${String(done.quantity)} шт.`
              : `Повернено постачальнику «${visible(done.lot.supplier.name)}»: ${String(done.quantity)} шт.`}
          </p>
          {done.kind === "sold" ? (
            // A debt recorded is money: its sum large, the server's, as
            // the invoice's own stub (spec §6.30; money task list after
            // stage 2, P2-3).
            <Stub state="recorded">
              <div className="hand-back">
                <p className="hand-back-sum stub-sum" id={`${stub}-sum`}>
                  <Sum value={money(done.invoice.amount)} />
                </p>
                <p className="stub-say">
                  {visible(done.lot.supplier.name)} · {lotName(done.lot)} ×{" "}
                  {done.quantity}
                </p>
              </div>
              <Perforation />
              <p className="stub-line" id={`${stub}-where`}>
                Борг «{visible(done.lot.supplier.name)}» — у «Накладних».
              </p>
              {openInvoice && (
                <button
                  type="button"
                  className="quiet set-off-open"
                  disabled={openInvoice.held}
                  onClick={() => {
                    openInvoice.go(done.invoice);
                  }}
                >
                  Відкрити накладну
                  <Icon name="chevron-right" size={16} />
                </button>
              )}
            </Stub>
          ) : (
            <Stub state="recorded">
              <p className="stub-line">
                <strong>{lotName(done.lot)}</strong>
                <br />× {done.quantity}
              </p>
            </Stub>
          )}
          {!main && (
            // Outside Telegram, its MainButton as the dock's one button.
            <div className="pay-panel order-dock" ref={dock}>
              <button
                type="button"
                className="main-mimic"
                onClick={() => {
                  setDone(null);
                }}
              >
                Готово
              </button>
            </div>
          )}
        </section>
      </>
    );

  return (
    <>
      {heading}
      <section className="borrowed">
        <ModeSwitch
          label="Яке позичене"
          modes={[
            { mode: "on", label: "На руках" },
            { mode: "all", label: "Усе" },
          ]}
          current={onHandOnly ? "on" : "all"}
          choose={(mode) => {
            setOnHandOnly(mode === "on");
          }}
          disabled={false}
          filters
        />
        {lots.isPending ? (
          // Three tags' places, where the first one comes (money task list
          // after stage 2, P1-3): a long read is seen to be coming.
          <Placeholder said="Завантажуємо позичене…" lineTags={3} />
        ) : lots.data === undefined ? (
          <Unread
            error={lots.error}
            retry={() => {
              void lots.refetch();
            }}
          />
        ) : listed.length === 0 ? (
          // Nothing (spec §6.28): the blank mark, what is so now, and what
          // these goods are — said here alone.
          <Empty
            title={
              onHandOnly
                ? "Позиченого на руках немає."
                : "Цей магазин нічого не позичав."
            }
            meta="Товар інших магазинів і постачальників: сплачують лише продане, за домовленою ціною, непродане повертають. Береться через «Прийшов товар»."
          />
        ) : (
          <>
            <ul className="order-tags" aria-label="Позичене">
              {listed.map((one) => (
                <LotTag
                  key={one.stock_lot_id}
                  lot={one}
                  verb={maySell ? { held } : undefined}
                  open={() => {
                    setLot(one);
                  }}
                />
              ))}
            </ul>
            {/* A page that failed keeps the lots already read. */}
            {lots.error && (
              <Unread
                error={lots.error}
                retry={() => {
                  void (lots.isFetchNextPageError
                    ? lots.fetchNextPage()
                    : lots.refetch());
                }}
              />
            )}
            {/* A page that failed is asked again by its own retry, alone
              (money task list after stage 2, P2-1). */}
            {lots.hasNextPage && !lots.isFetchNextPageError && (
              <button
                className="quiet"
                disabled={lots.isFetching}
                onClick={() => {
                  void lots.fetchNextPage();
                }}
              >
                Показати ще
              </button>
            )}
          </>
        )}
      </section>
      {lot && (
        <LotSheet
          key={lot.stock_lot_id}
          lot={
            listed.find((one) => one.stock_lot_id === lot.stock_lot_id) ?? lot
          }
          maySell={maySell}
          held={held}
          selling={marking.busy && marking.firstSend}
          returning={returning.busy && returning.firstSend}
          fallback={title}
          close={() => {
            setLot(null);
          }}
          sell={(quantity) => sell(lot, quantity)}
          sendBack={(quantity) => sendBack(lot, quantity)}
        />
      )}
    </>
  );
}

/**
 * One lot as a row tag (spec §6.9; stage 2, money task list, P0-5): its
 * eyelet filled while some are in hand, a knot once none are; the model and
 * size, at the right how many are in hand; whose and since when, its price
 * and its counts under them. The tag, or its verb «Продано», opens its
 * sheet; one with none in hand opens nothing.
 */
function LotTag({
  lot,
  verb,
  open,
}: {
  lot: Lot;
  /** «Продано», for whoever keeps the invoices. */
  verb: { held: boolean } | undefined;
  open: () => void;
}): JSX.Element {
  const title = useId();
  const inHand = lot.on_hand > 0;
  const body = (
    <>
      <span className="invoice-tag-head">
        <span className="order-tag-title t-row" id={title}>
          {lotName(lot)}
        </span>
        <span className="lot-on-hand t-row">на руках {lot.on_hand}</span>
      </span>
      <span className="order-tag-meta t-meta">{lotWhence(lot)}</span>
      <span className="order-tag-meta t-meta">{lotCounts(lot)}</span>
    </>
  );
  return (
    <li>
      <article
        className={`order-tag lot-tag tag-row tag-outline ${inHand ? "filled" : "tied"}`}
        aria-labelledby={title}
      >
        <div className="order-tag-body">
          <span className="order-tag-eyelet" aria-hidden="true">
            {!inHand && <Eyelet state="knot" size={8} />}
          </span>
          {inHand ? (
            <button
              type="button"
              className="order-row"
              aria-haspopup="dialog"
              onClick={open}
            >
              {body}
            </button>
          ) : (
            <div className="order-row">{body}</div>
          )}
          {inHand && verb && (
            <button
              type="button"
              className="tag-verb"
              aria-describedby={title}
              aria-haspopup="dialog"
              disabled={verb.held}
              onClick={open}
            >
              Продано
            </button>
          )}
        </div>
      </article>
    </li>
  );
}

/**
 * A lot's sheet (stage 2, money task list, P0-5; В7 (а)): what it is, how
 * many with «− 1 +», from one to all in hand; «Позначити проданим · 1 шт.»,
 * the price for each under it as the server keeps it — nothing multiplied
 * here —, and, quiet, «Повернути постачальнику · 1 шт.». Refused, the words
 * say why here.
 */
function LotSheet({
  lot,
  maySell,
  held,
  selling,
  returning,
  fallback,
  close,
  sell,
  sendBack,
}: {
  lot: Lot;
  maySell: boolean;
  held: boolean;
  /** A mark of sold, or a return, sent for the first time. */
  selling: boolean;
  returning: boolean;
  fallback: RefObject<HTMLElement>;
  close: () => void;
  sell: (quantity: number) => Promise<string | null>;
  sendBack: (quantity: number) => Promise<string | null>;
}): JSX.Element {
  const [chosen, setCount] = useState(1);
  const [problem, setProblem] = useState<string | null>(null);
  const sending = selling || returning;
  const most = lot.on_hand;
  // Fewer in hand once read again: never more than they are.
  const count = Math.max(Math.min(chosen, most), 1);
  return (
    <Sheet
      title={lotName(lot)}
      close={() => {
        if (!sending) close();
      }}
      fallback={fallback}
      foot={
        <>
          <SendingLine busy={sending} />
          <div className="lot-ways">
            {maySell && (
              <>
                <button
                  type="button"
                  className={selling ? "primary pressed" : "primary"}
                  disabled={held}
                  onClick={() => {
                    setProblem(null);
                    void sell(count).then(setProblem);
                  }}
                >
                  {selling && <Eyelet state="spin" size={20} />}
                  Позначити проданим · {count} шт.
                </button>
                {lot.unit_cost && (
                  <p className="t-meta lot-price">
                    {money(lot.unit_cost)} за шт.
                  </p>
                )}
              </>
            )}
            <button
              type="button"
              className={returning ? "quiet pressed" : "quiet"}
              disabled={held}
              onClick={() => {
                setProblem(null);
                void sendBack(count).then(setProblem);
              }}
            >
              {returning && <Eyelet state="spin" size={20} />}
              Повернути постачальнику · {count} шт.
            </button>
          </div>
        </>
      }
    >
      <p className="t-meta">{lotWhence(lot)}</p>
      <p className="t-meta">{lotCounts(lot)}</p>
      <div className="lot-count" role="group" aria-label="Скільки, шт.">
        <span className="t-row">На руках {most}</span>
        <span className="stepper">
          <button
            type="button"
            aria-label="Менше"
            // Held, not disabled: the cursor stays on it.
            aria-disabled={count <= 1}
            onClick={() => {
              // ±1 is felt, both ways (spec §6 rule 9; money task list
              // after stage 2, P2-4).
              if (count > 1) {
                setCount(count - 1);
                buzz("light");
              }
              setProblem(null);
            }}
          >
            −
          </button>
          <output aria-live="polite">{count}</output>
          <button
            type="button"
            aria-label="Більше"
            aria-disabled={count >= most}
            onClick={() => {
              if (count >= most) return;
              setCount(count + 1);
              setProblem(null);
              buzz("light");
            }}
          >
            +
          </button>
        </span>
      </div>
      {problem && <p role="alert">{problem}</p>}
    </Sheet>
  );
}

/** Why a mark or a return of borrowed goods was not taken, in this screen's
 * words: here, and under a kept one checked (stage 2, money task list,
 * P0-6). */
export function refusalText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "INSUFFICIENT_STOCK")
      return "На складі цього товару вже менше: можливо, його продали. Позначте проданим.";
    switch (error.details.reason) {
      case "MORE_THAN_ON_HAND":
        return `На руках лише ${String(error.details.on_hand)} шт.`;
      case "NO_PRICE":
        return "Для цього товару не вказали домовлену ціну.";
    }
  }
  return inOwnWords(
    errorText(error),
    "Не записано. Перевірте кількість та спробуйте ще раз.",
    "Не записано: дані змінилися — перегляньте їх і спробуйте ще раз.",
  );
}
