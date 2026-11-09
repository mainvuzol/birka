import { Fragment, useEffect, useId, useRef, useState } from "react";
import type { JSX } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { api, readText } from "@/shared/api";
import { visible } from "@/shared/visible";
import { money } from "@/orders/types";
import type { Store } from "@/orders/types";
import { number } from "@/openings/types";
import { usePanelRoom } from "@/shared/panel";
import { buzz, useMainButton } from "@/shared/telegram";
import { Sum } from "@/shared/Sum";
import { Back } from "@/shared/Back";
import { BackToMore } from "@/shared/More";
import type { MoreBack } from "@/shared/More";
import { Icon } from "@/shared/Icon";
import { Sheet } from "@/shared/Sheet";
import { Toast } from "@/shared/Toast";
import { ScreenHeader } from "@/shared/ScreenHeader";
import { useCreditCommand } from "./commands";
import {
  DebtActions,
  closedShare,
  debtRights,
  entryMeta,
  entryWhat,
  erasedText,
  paidText,
  refusalText,
} from "./Debt";
import { goodsOf, initialsOf, shortDay, shortTime, sinceText } from "./format";
import { erasedCustomer, statusLabels } from "./types";
import type {
  Credit,
  CreditEntry,
  Customer as CustomerDebts,
  CustomerPage,
} from "./types";

/** How many lines of the history show before «Ще N» (spec §6.21). */
const HISTORY_SHOWN = 7;

/** «Сплачено 1 000,00 грн з 3 000,00 грн»: a debt row's line. */
function paidOf(credit: Credit): string {
  return `Сплачено ${money(credit.paid)} з ${money(credit.amount)}`;
}

/**
 * The customer's card (spec S20; «Усе на бірці» sections task list, P0-5):
 * their two letters, name and phone with «Скопіювати»; a block for each
 * store where this person takes payments — the open one first, then the
 * others that trade — each read by the phone from that store alone, with
 * what is owed there as the server summed it: never a sum across stores
 * (owner decision, 2026-10-01). One debt in a store, the block is that
 * debt: how much is paid, since when, and the owner's ⋯; more, a row a
 * debt, opening its detail. Then the history of every debt read, the
 * newest first, and how long the name and phone are kept.
 *
 * «Внесок» is Telegram's MainButton — outside Telegram the dock's one
 * button — where the open store trades and the phone owes it: S21 on the
 * one debt, or with more, «На який борг вносить?» first, nothing chosen.
 * Another store's debt is paid there (owner decision, 2026-10-01).
 *
 * Found among the stores that do not trade, by the whole phone, each debt
 * is its own row with its store, and no total: those are never added up.
 * Gone — nothing left under the phone — it goes back to the list, never
 * showing sums the phone kept.
 */
export function Customer({
  store,
  stores,
  token,
  journalKey,
  blocked,
  readOnly,
  networkOwner,
  mayErase,
  first,
  from,
  elsewhere,
  afresh,
  named,
  choose,
  deposit,
  back,
  away,
}: {
  /** The open store. */
  store: Store;
  /** Its blocks: the open store first, then the others that trade, each
   * where this person takes payments. */
  stores: readonly Store[];
  token: string;
  journalKey: string;
  blocked: boolean;
  readOnly: boolean;
  networkOwner: boolean;
  mayErase: boolean;
  /** As the list showed them: a phone's. */
  first: CustomerDebts & { phone_digits: string };
  /** The store whose list showed them. */
  from: Store;
  /** Found among the stores that do not trade, by their whole phone. */
  elsewhere: boolean;
  /** A debt of theirs changed since the list was read: nothing of the
   * list's row is shown while the card is read again. */
  afresh: boolean;
  /** Told the name the card is headed with, for the «←» that comes back. */
  named: (name: string) => void;
  /** A debt's detail, read in the store it is in. */
  choose: (credit: Credit, store: Store) => void;
  /** S21 on this debt. */
  deposit: (credit: Credit) => void;
  /** Back to the list; with what was done, once the card has nothing
   * left to show. */
  back: (said?: string) => void;
  /** Opened from «Сьогодні»: its «←» goes back there, as `back` does only
   * once the card has nothing left to show (frame task list, P2-2). */
  away?: MoreBack | undefined;
}): JSX.Element {
  const cache = useQueryClient();
  const phone = first.phone_digits;
  const read = elsewhere ? [store] : stores;
  const reads = useQueries({
    queries: read.map((each) => ({
      queryKey: ["credits", store.id, "card", each.id, phone, elsewhere],
      queryFn: () =>
        api<CustomerPage>(
          `/credits/customers?store_id=${each.id}&limit=5&query=${phone}${
            elsewhere ? "&elsewhere=true" : ""
          }`,
          token,
        ),
      retry: false,
      ...(!afresh && each.id === (elsewhere ? store.id : from.id)
        ? { placeholderData: { items: [first], has_more: false } }
        : {}),
    })),
  });
  const blocks = read.map((each, at) => {
    const answer = reads[at] as UseQueryResult<CustomerPage>;
    return {
      store: each,
      answer,
      found: answer.data?.items.find((one) => one.phone_digits === phone),
    };
  });
  const gone = blocks.every(
    ({ answer, found }) =>
      answer.isSuccess && !answer.isPlaceholderData && found === undefined,
  );
  // What the owner's ⋯ did, said here; and carried to the list when the
  // card has nothing left to show.
  const [said, setSaid] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const leaving = useRef<string | null>(null);
  leaving.current = said;
  useEffect(() => {
    if (gone) back(leaving.current ?? undefined);
  }, [gone, back]);
  const customer =
    blocks.find(({ found }) => found !== undefined)?.found ?? first;
  const name = visible(customer.customer_name ?? erasedCustomer);
  useEffect(() => {
    named(name);
  }, [named, name]);
  // Opened from a row far down the list: the card begins at its top.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  const { busy, pending } = useCreditCommand();
  const working = busy || pending !== null;
  const [erasing, setErasing] = useState(false);
  const [acting, setActing] = useState(false);
  const [choosing, setChoosing] = useState(false);
  // The open store's debts still owed, where it trades: paid here (owner
  // decision, 2026-10-01); among the stores that do not trade, theirs.
  const here = blocks[0];
  const payable =
    readOnly || here?.found === undefined
      ? []
      : here.found.credits.filter((credit) => credit.status === "OPEN");
  // Read again — a write-off here, Telegram back in front — what is shown
  // may be paid already: «Внесок» waits for the answer.
  const rereading = reads.some((read) => read.isFetching && read.isFetched);
  const press = (): void => {
    const [only, ...more] = payable;
    if (!only) return;
    if (more.length === 0) deposit(only);
    else setChoosing(true);
  };
  const main = useMainButton("Внесок", press, {
    shown: payable.length > 0 && !choosing && !acting,
    active: !blocked && !working && !rereading,
  });
  const dock = useRef<HTMLDivElement>(null);
  usePanelRoom(dock, payable.length > 0 && !main);
  const reread = (): void => {
    void cache.invalidateQueries({ queryKey: ["credits", store.id] });
  };
  // The phone exactly as it was written; a toast and a buzz (spec S20).
  const [toast, setToast] = useState<{ text: string; times: number } | null>(
    null,
  );
  const tell = (text: string): void => {
    setToast((now) => ({ text, times: (now?.times ?? 0) + 1 }));
  };
  // Absent outside a secure page, whatever the types say.
  const clipboard = (navigator as { clipboard?: Partial<Clipboard> }).clipboard;
  const write = clipboard?.writeText?.bind(clipboard);
  const written = customer.customer_phone;
  const copy =
    written !== null && write !== undefined
      ? () => {
          const failed =
            "Не вдалося скопіювати — виділіть номер і скопіюйте його.";
          try {
            write(written).then(
              () => {
                buzz("success");
                tell("Телефон скопійовано");
              },
              () => {
                tell(failed);
              },
            );
          } catch {
            tell(failed);
          }
        }
      : null;
  const credits = blocks.flatMap(({ found }) => found?.credits ?? []);
  const owner = {
    store,
    token,
    journalKey,
    blocked,
    changed: reread,
    holding: setErasing,
    written: (result: Credit) => {
      setProblem(null);
      setSaid(`Борг списано: ${money(result.written_off)}.`);
      reread();
    },
    erased: (result: Parameters<typeof erasedText>[0]) => {
      setProblem(null);
      setSaid(erasedText(result));
      // The customer is erased in every store of the network.
      void cache.invalidateQueries({ queryKey: ["credits"] });
    },
    refused: (text: string) => {
      setSaid(null);
      setProblem(text);
    },
    opened: setActing,
  };
  return (
    <>
      <ScreenHeader
        title={name}
        back={
          away ? (
            <BackToMore
              back={{ ...away, held: away.held || working || erasing }}
            />
          ) : (
            <Back
              go={() => {
                back();
              }}
              held={working || erasing}
            >
              <span aria-hidden="true">← </span>Покупці
            </Back>
          )
        }
      />
      <section className="credits customer-card">
        <div className="customer-head">
          <span className="debt-mark customer-mark" aria-hidden="true">
            {initialsOf(customer.customer_name)}
          </span>
          <span className="customer-reach">
            {written !== null && (
              <a
                className="customer-phone"
                href={`tel:${written.replace(/[^\d+]/g, "")}`}
              >
                {visible(written)}
              </a>
            )}
            {copy && (
              <button
                type="button"
                className="copy-ttn"
                aria-label="Скопіювати телефон"
                onClick={copy}
              >
                <Icon name="copy" />
                Скопіювати
              </button>
            )}
          </span>
        </div>
        {said && <p role="status">{said}</p>}
        {problem && <p role="alert">{problem}</p>}
        {elsewhere ? (
          <ClosedStores
            answer={here?.answer}
            credits={here?.found?.credits ?? []}
            open={(credit) => {
              choose(credit, store);
            }}
          />
        ) : (
          blocks.map(({ store: each, answer, found }) => (
            <StoreBlock
              key={each.id}
              store={each}
              open={each.id === store.id}
              readOnly={each.id === store.id && readOnly}
              answer={answer}
              found={found}
              choose={(credit) => {
                choose(credit, each);
              }}
              actions={(credit) =>
                // The owner's, on a debt of the open store (spec S20).
                each.id === store.id ? (
                  <DebtActions
                    {...owner}
                    credit={credit}
                    {...debtRights(store, credit, {
                      readOnly,
                      networkOwner,
                      mayErase,
                    })}
                  />
                ) : null
              }
            />
          ))
        )}
        <History credits={credits} />
        <p className="hint customer-kept">
          Ім’я й телефон зберігаємо, поки є борг, і ще рік після того, як його
          закрито (3 роки — після списання).
        </p>
        {payable.length > 0 && !main && (
          // Outside Telegram, its MainButton as the dock's one button.
          <div className="pay-panel order-dock" ref={dock}>
            <button
              type="button"
              className="main-mimic"
              disabled={blocked || working || rereading}
              onClick={press}
            >
              Внесок
            </button>
          </div>
        )}
      </section>
      {choosing && (
        <Sheet
          title="На який борг вносить?"
          close={() => {
            setChoosing(false);
          }}
        >
          <div role="list" aria-label="Борги, на які можна внести">
            {payable.map((credit) => (
              <div role="listitem" key={credit.id}>
                <button
                  type="button"
                  className="sale-row debt-row"
                  aria-label={`${goodsOf(credit)}, винні ${money(credit.owed)}${
                    elsewhere ? `, магазин «${visible(credit.store_name)}»` : ""
                  }`}
                  disabled={blocked || working}
                  onClick={() => {
                    setChoosing(false);
                    deposit(credit);
                  }}
                >
                  <span className="sale-main">
                    <span className="debt-name">{goodsOf(credit)}</span>
                    <span className="sale-meta">
                      {sinceText(credit)}
                      {/* Among the stores that do not trade, each its own
                          (spec S20). */}
                      {elsewhere && (
                        <span className="badge neutral">
                          Магазин «{visible(credit.store_name)}»
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="debt-owed">
                    <Icon name="owed" size={16} />
                    {money(credit.owed)}
                  </span>
                  <Icon name="chevron-right" size={16} className="sale-open" />
                </button>
              </div>
            ))}
          </div>
        </Sheet>
      )}
      {toast && (
        <Toast
          key={toast.times}
          text={toast.text}
          gone={() => {
            setToast(null);
          }}
        />
      )}
    </>
  );
}

/**
 * One store's block (spec §6.20): «Магазину «Центр» винні» and what is owed
 * there, large in the debt's colour with its glyph — the server's sum for
 * that store alone; «Магазин «Ринок»: не винні» where nothing is. Another
 * store's says where its payments are taken; the open one that does not
 * trade, that any store that trades takes them.
 */
function StoreBlock({
  store,
  open,
  readOnly,
  answer,
  found,
  choose,
  actions,
}: {
  store: Store;
  /** The open store's block. */
  open: boolean;
  readOnly: boolean;
  answer: UseQueryResult<CustomerPage>;
  found: CustomerDebts | undefined;
  choose: (credit: Credit) => void;
  actions: (credit: Credit) => JSX.Element | null;
}): JSX.Element {
  const heading = useId();
  const storeName = visible(store.name);
  if (answer.data === undefined)
    return (
      <section className="customer-block" aria-labelledby={heading}>
        <h3 id={heading} className="t-label">
          Магазин «{storeName}»
        </h3>
        {answer.isError ? (
          <div role="alert">
            <p>{readText(answer.error, refusalText)}</p>
            <button
              type="button"
              className="quiet"
              disabled={answer.isFetching}
              onClick={() => {
                void answer.refetch();
              }}
            >
              Спробувати ще раз
            </button>
          </div>
        ) : (
          // Its place while it is read, in its own lines' heights.
          <div className="owed-lines" aria-hidden="true">
            <p className="owed-sum">
              <strong className="sum skeleton-line">
                <span>00 000</span>
              </strong>
            </p>
          </div>
        )}
      </section>
    );
  if (found === undefined)
    return (
      <p className="hint customer-none">Магазин «{storeName}»: не винні</p>
    );
  const owes = found.open_debts > 0;
  const [only] = found.credits.length === 1 ? found.credits : [];
  return (
    <section className="customer-block" aria-labelledby={heading}>
      <div className="customer-block-head">
        <h3 id={heading} className="t-label">
          {owes
            ? `Магазину «${storeName}» винні`
            : `Магазин «${storeName}»: не винні`}
        </h3>
        {only && actions(only)}
      </div>
      {owes && (
        <p className="owed-sum customer-owed">
          <Icon name="owed" size={20} />
          <Sum value={money(found.owed)} />
        </p>
      )}
      {owes && !open && <p className="hint">Внесок приймає «{storeName}»</p>}
      {owes && readOnly && (
        <p className="hint">
          Внески приймає будь-який магазин мережі, що працює.
        </p>
      )}
      {answer.isError && (
        // Read again and refused: what is shown is as it was, and said.
        <div role="alert">
          <p>{readText(answer.error, refusalText)}</p>
          <button
            type="button"
            className="quiet"
            disabled={answer.isFetching}
            onClick={() => {
              void answer.refetch();
            }}
          >
            Спробувати ще раз
          </button>
        </div>
      )}
      {only ? (
        <OneDebt credit={only} />
      ) : (
        <DebtRows
          label={`Борги в магазині «${storeName}»`}
          credits={found.credits}
          open={choose}
        />
      )}
    </section>
  );
}

/** A store's one debt is its block (spec S20): what was taken and since
 * when, and how much is paid on a bar; closed, how and when. */
function OneDebt({ credit }: { credit: Credit }): JSX.Element {
  return credit.status === "OPEN" ? (
    <div className="customer-debt">
      <p className="hint">
        {goodsOf(credit)} · {sinceText(credit)}
      </p>
      <p className="owed-count">{paidText(credit)}</p>
      <div className="debt-bar" aria-hidden="true">
        <span style={{ width: `${String(closedShare(credit))}%` }} />
      </div>
    </div>
  ) : (
    <div className="customer-debt">
      <p>
        <span
          className={
            credit.status === "WRITTEN_OFF" ? "badge neutral" : "badge paid"
          }
        >
          {statusLabels[credit.status]}
        </span>
        {credit.closed_at && ` Закрито ${shortDay(credit.closed_at)}`}
      </p>
      <p className="hint">
        {goodsOf(credit)} · {paidText(credit)}
      </p>
    </div>
  );
}

/** A row a debt: what was taken, how much is paid, what is owed; each
 * opens the debt's detail. */
function DebtRows({
  label,
  credits,
  open,
  stores = false,
}: {
  label: string;
  credits: readonly Credit[];
  open: (credit: Credit) => void;
  /** Each debt names its store: those that do not trade. */
  stores?: boolean;
}): JSX.Element {
  return (
    <div className="list-block" role="list" aria-label={label}>
      {credits.map((credit) => {
        const goods = goodsOf(credit);
        const owed = credit.status === "OPEN";
        return (
          <div role="listitem" key={credit.id}>
            <button
              type="button"
              className="sale-row debt-row"
              aria-label={`Відкрити борг: ${goods}, ${paidOf(credit).toLowerCase()}, ${
                owed
                  ? `винні ${money(credit.owed)}`
                  : statusLabels[credit.status].toLowerCase()
              }`}
              onClick={() => {
                open(credit);
              }}
            >
              <span className="sale-main">
                <span className="debt-name">{goods}</span>
                <span className="sale-meta">
                  {paidOf(credit)}
                  {stores && (
                    <span className="badge neutral">
                      Магазин «{visible(credit.store_name)}»
                    </span>
                  )}
                </span>
              </span>
              {owed ? (
                <span className="debt-owed">
                  <Icon name="owed" size={16} />
                  {money(credit.owed)}
                </span>
              ) : (
                <span
                  className={
                    credit.status === "WRITTEN_OFF"
                      ? "badge neutral"
                      : "badge paid"
                  }
                >
                  {statusLabels[credit.status]}
                </span>
              )}
              <Icon name="chevron-right" size={16} className="sale-open" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** The stores that do not trade, found by the whole phone: a row a debt,
 * each with its store, and no total. */
function ClosedStores({
  answer,
  credits,
  open,
}: {
  answer: UseQueryResult<CustomerPage> | undefined;
  credits: readonly Credit[];
  open: (credit: Credit) => void;
}): JSX.Element {
  return (
    <section className="customer-block" aria-label="Магазини, що не працюють">
      <h3 className="t-label">Магазини, що не працюють</h3>
      {answer?.isError && (
        <div role="alert">
          <p>{readText(answer.error, refusalText)}</p>
          <button
            type="button"
            className="quiet"
            disabled={answer.isFetching}
            onClick={() => {
              void answer.refetch();
            }}
          >
            Спробувати ще раз
          </button>
        </div>
      )}
      <DebtRows label="Борги" credits={credits} open={open} stores />
    </section>
  );
}

/** One line of the history: a debt opened, or an entry of it. */
interface Line {
  key: string;
  at: string;
  credit: Credit;
  entry: CreditEntry | null;
  /** The entry that closed its debt. */
  closing: boolean;
}

/**
 * «ІСТОРІЯ» (spec §6.21): every debt read and each of its entries, the
 * newest first, a thread of eyelets — a knot where a debt closed — each
 * with its day, store, what it was, who, and its sum, in the debt's own
 * words; seven, then «Ще N» opens the rest in place.
 */
function History({ credits }: { credits: readonly Credit[] }): JSX.Element {
  const [all, setAll] = useState(false);
  const eighth = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (all) eighth.current?.focus();
  }, [all]);
  const lines: Line[] = credits
    .flatMap((credit) => [
      ...credit.entries.map((entry, index) => ({
        key: `${credit.id}:${String(index)}`,
        at: entry.at,
        credit,
        entry,
        // The server's oldest first: the last of a closed debt closed it.
        closing:
          index === credit.entries.length - 1 && credit.status !== "OPEN",
      })),
      {
        key: `${credit.id}:opened`,
        at: credit.opened_at,
        credit,
        entry: null,
        closing: false,
      },
    ])
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  if (lines.length === 0) return <></>;
  const shown = all ? lines : lines.slice(0, HISTORY_SHOWN);
  const rest = lines.length - shown.length;
  return (
    <>
      <h3 className="t-label customer-history-title">Історія</h3>
      <ul className="timeline" aria-label="Історія покупця">
        {shown.map((line, at) => (
          <li
            key={line.key}
            className="timeline-row"
            ref={at === HISTORY_SHOWN ? eighth : undefined}
            tabIndex={at === HISTORY_SHOWN ? -1 : undefined}
          >
            <span className="timeline-day">{shortDay(line.at)}</span>
            <span
              className={`timeline-node${line.closing ? " knot" : ""}`}
              aria-hidden="true"
            />
            <span className="timeline-main">
              <span className="timeline-store">
                «{visible(line.credit.store_name)}»
              </span>
              <span className="timeline-what">
                {line.entry ? entryWhat(line.entry) : "Частинами"}
              </span>
              <span className="timeline-meta">
                {[
                  { text: shortTime(line.at) } as {
                    text: string;
                    paper?: true;
                  },
                  ...(line.entry ? entryMeta(line.entry, false) : []),
                  { text: goodsOf(line.credit) },
                ].map((part, index) => (
                  <Fragment key={index}>
                    {index > 0 && " · "}
                    {part.paper ? (
                      <span className="paper-meta">{part.text}</span>
                    ) : (
                      part.text
                    )}
                  </Fragment>
                ))}
              </span>
              {line.entry?.note && (
                <span className="timeline-meta">
                  {visible(line.entry.note)}
                </span>
              )}
              {line.entry?.kind === "WRITE_OFF" && line.entry.note === null && (
                <span className="timeline-meta">
                  причину стерто разом з даними покупця
                </span>
              )}
            </span>
            <span className="timeline-sum">
              {money(line.entry ? line.entry.amount : line.credit.amount)}
            </span>
          </li>
        ))}
      </ul>
      {rest > 0 && (
        <button
          type="button"
          className="quiet history-more"
          aria-expanded={false}
          onClick={() => {
            setAll(true);
          }}
        >
          Ще {number(rest)}
        </button>
      )}
    </>
  );
}
