import { useEffect, useRef, useState } from "react";
import type { JSX, ReactNode } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/shared/api";
import { Unread } from "@/shared/Unread";
import { decimal, kopecks, money } from "@/orders/types";
import type { Store } from "@/orders/types";
import { plural } from "@/openings/types";
import { visible } from "@/shared/visible";
import { BackToMore } from "@/shared/More";
import type { MoreBack } from "@/shared/More";
import { Back } from "@/shared/Back";
import { Banner } from "@/shared/Banner";
import { Eyelet } from "@/shared/Eyelet";
import { Icon } from "@/shared/Icon";
import { ModeSwitch } from "@/shared/ModeSwitch";
import { usePanelRoom } from "@/shared/panel";
import { ResultScreen } from "@/shared/ResultScreen";
import { ScreenHeader } from "@/shared/ScreenHeader";
import { SendingLine } from "@/shared/Sending";
import { Sum } from "@/shared/Sum";
import { buzz, useAskBeforeClosing, useMainButton } from "@/shared/telegram";
import { Empty } from "@/shared/Empty";
import { Placeholder } from "@/shared/Placeholder";
import { ageOf } from "@/today/reads";
import { Stamp, staleOf, useNow } from "@/today/age";
import { shortDay, shortWhen } from "@/credits/format";
import { submitInvoiceCommand, useInvoiceCommand } from "./invoiceCommands";
import { SupplierFilter, SupplierPicker } from "./Picker";
import { InvoiceActions, EntryCancel } from "./InvoiceActions";
import { InvoiceOwed, Progress } from "./InvoiceOwed";
import { InvoicePay } from "./InvoicePay";
import { InvoiceRecorded, useRecordedDone } from "./InvoiceRecorded";
import { InvoiceSticker } from "./InvoiceSticker";
import { InvoiceTag } from "./InvoiceTag";
import { entryLabels, refusalText } from "./invoiceWords";
import type { Command, Sent } from "./invoiceWords";
import type {
  Invoice,
  InvoiceEntry,
  InvoicePage,
  SupplierDebts,
} from "./types";

export { doneText, refusalText } from "./invoiceWords";

const pageSize = 20;

/** Where the cards and the payment go back to: «outside», the screen that
 * opened the invoice (`InvoiceOpening.leave`). */
type From = "list" | "elsewhere" | "outside";

type View =
  | { screen: "list" }
  | { screen: "elsewhere" }
  /** An invoice opened from outside, being read. */
  | { screen: "finding" }
  | { screen: "new" }
  | { screen: "card"; invoice: Invoice; from: From }
  | { screen: "pay"; invoice: Invoice; from: From; card: boolean };

/**
 * An invoice opened from outside «Накладні» (stage 2, money task list,
 * P1-3): a return's set-off, the stub of borrowed goods marked sold, or the
 * way back from «Позичене й під реалізацію» to the card that opened it.
 * There is no read of one: its supplier's fifty newest are read, and one
 * not among them opens «Накладні» with that supplier's, «Усі».
 */
export interface InvoiceOpening {
  id: string;
  supplierId: string;
  /** Known already: shown at once, then as it is now. */
  invoice?: Invoice;
  /** Where the card's «←» goes, when not to the list: «← Повернення». */
  leave?: MoreBack;
}

/** «3 накладні». */
function invoicesCount(count: number): string {
  return `${String(count)}\u00a0${plural(count, "накладна", "накладні", "накладних")}`;
}

/**
 * What the store owes its suppliers (owner decisions, 2026-10-01; stage 2,
 * money task list, P0-1, P0-2).
 *
 * An invoice is recorded on its own — a supplier from the list, the sum on
 * it, what was paid at once, a note — and each is its own debt, paid in
 * parts with no schedule. Goods returned to that supplier are set off
 * against it for the sum the supplier counted. A payment, a set-off or the
 * invoice itself recorded by mistake is cancelled, saying why; the owner
 * writes off what the supplier forgave. Each store keeps its own; while a
 * store does not trade, any store of the network that trades pays.
 *
 * The invoices are tags, «Винні зараз · Усі» and one field of the
 * supplier over them, the total in ink; an invoice opens its card, and
 * «Сплатити» its payment on the app's keypad, the menu aside.
 */
export function Invoices({
  store,
  token,
  journalKey,
  blocked,
  readOnly = false,
  networkOwner = false,
  back,
  task,
  opening = null,
  openBorrowed,
}: {
  store: Store;
  token: string;
  journalKey: string;
  /** Another command's outcome is unknown: nothing new until it is settled. */
  blocked: boolean;
  /** This store does not trade: its invoices are read, and paid elsewhere. */
  readOnly?: boolean;
  /** The owner of the network, who writes off an invoice of a store that does not trade. */
  networkOwner?: boolean;
  /** «← Ще» over the heading: a section opened from «Ще» (navigation task
   * list, P0-4). */
  back?: MoreBack | undefined;
  /** Told while a payment's sum is typed: the menu steps aside (spec S21). */
  task?: (shown: boolean) => void;
  /** Opened on one invoice, from outside (P1-3). */
  opening?: InvoiceOpening | null;
  /** The sold invoice's «Позичене й під реалізацію ›», for whoever returns
   * goods to suppliers; held while that screen is. */
  openBorrowed?: { go: (invoice: Invoice) => void; held: boolean } | undefined;
}): JSX.Element {
  const cache = useQueryClient();
  // A kept operation is the app's: its stub over this screen, its banner
  // over any other, its check (stage 2, money task list, P0-6).
  const { busy, pending, firstSend } = useInvoiceCommand();
  const working = busy || pending !== null;
  // What is sent for the first time turns its button's ring; a kept one
  // checked again is its stub's to say.
  const sending = busy && firstSend ? (pending?.body.kind ?? null) : null;
  const leave = opening?.leave;
  const [view, setView] = useState<View>(() =>
    opening?.invoice
      ? {
          screen: "card",
          invoice: opening.invoice,
          from: leave ? "outside" : "list",
        }
      : opening
        ? { screen: "finding" }
        : { screen: "list" },
  );
  const [supplierId, setSupplierId] = useState("");
  const [owedOnly, setOwedOnly] = useState(true);
  // Opened from outside: the invoice as it is now, among its supplier's.
  useEffect(() => {
    if (!opening) return;
    let gone = false;
    void api<InvoicePage>(
      `/supplier-invoices?store_id=${store.id}&supplier_id=${opening.supplierId}&limit=50`,
      token,
    ).then(
      (page) => {
        if (gone) return;
        const found = page.items.find((item) => item.id === opening.id);
        if (found)
          setView((now) =>
            now.screen === "finding"
              ? {
                  screen: "card",
                  invoice: found,
                  from: opening.leave ? "outside" : "list",
                }
              : // Only over the invoice it was opened with: one paid or
                // changed meanwhile is newer than this read.
                (now.screen === "card" || now.screen === "pay") &&
                  now.invoice === opening.invoice
                ? { ...now, invoice: found }
                : now,
          );
        else showSupplier(opening.supplierId);
      },
      () => {
        // Not read: shown as it was known, or the list says why.
        if (!gone) showSupplier(opening.supplierId);
      },
    );
    return () => {
      gone = true;
    };
    // Once, as it opens: a remount opens it again.
  }, []);
  /** Not found among the newest: that supplier's, all of them — unless
   * it is shown already, as it was known. */
  function showSupplier(id: string): void {
    if (opening?.invoice) return;
    setSupplierId(id);
    setOwedOnly(false);
    setView({ screen: "list" });
  }
  /** Back where a card or a payment came from. */
  function backTo(from: From): void {
    if (from === "outside") leave?.go();
    else setView({ screen: from });
  }
  const paying = view.screen === "pay";
  useEffect(() => {
    task?.(paying);
  }, [task, paying]);
  useEffect(
    () => () => {
      task?.(false);
    },
    [task],
  );
  // Each screen begins at its top.
  const screen = view.screen;
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screen]);

  // Read again at once, the list not shown too: a card opened from it on the
  // way back is the invoice as it is now, never as it was before.
  function reread(): void {
    void cache.invalidateQueries({
      queryKey: ["supplier-invoices", store.id],
      refetchType: "all",
    });
    void cache.invalidateQueries({ queryKey: ["supplier-returns", store.id] });
  }

  // The invoice as the server answered it, on whichever screen still shows
  // it: an answer that comes once the person has moved on never brings a
  // screen back.
  function shown(invoice: Invoice): void {
    setView((now) =>
      (now.screen === "card" || now.screen === "pay") &&
      now.invoice.id === invoice.id
        ? { ...now, invoice }
        : now,
    );
  }

  /** Send one command that records money, through the journal. */
  async function send(command: Command): Promise<Sent> {
    const outcome = await submitInvoiceCommand(journalKey, token, {
      // A new transport key per attempt; the command's identity is
      // `command_id`, made here once: a resend after a lost answer comes
      // from the journal, which keeps it.
      key: crypto.randomUUID(),
      body: {
        ...command,
        command_id: crypto.randomUUID(),
        store_id: store.id,
      },
    });
    // A buzz in the hand once the server answers (spec §4.4); a lost answer
    // is the journal's, its stub over the screen.
    if (outcome.kind === "done") {
      buzz("success");
      reread();
      return { kind: "done", invoice: outcome.result };
    }
    if (outcome.kind === "refused") {
      buzz("error");
      return { kind: "refused", text: refusalText(outcome.error) };
    }
    return { kind: "unknown" };
  }

  /** The invoice as it is now, read again after a refusal: there is no
   * read of one, so its supplier's are read (no backend change). */
  async function readAgain(invoice: Invoice): Promise<Invoice | null> {
    try {
      const [current] = (
        await api<InvoicePage>(
          `/supplier-invoices?store_id=${store.id}&supplier_id=${invoice.supplier.id}${
            invoice.store_id !== store.id ? "&elsewhere=true" : ""
          }&limit=50`,
          token,
        )
      ).items.filter((item) => item.id === invoice.id);
      return current ?? null;
    } catch {
      // What was shown stays; the refusal says what to do.
      return null;
    }
  }

  const held = blocked || working;

  if (view.screen === "new")
    return (
      <NewInvoice
        store={store}
        token={token}
        held={held}
        pressing={sending === "invoice"}
        send={send}
        back={() => {
          setView({ screen: "list" });
        }}
        opened={(invoice) => {
          setView({ screen: "card", invoice, from: "list" });
        }}
      />
    );

  if (view.screen === "pay")
    return (
      <InvoicePay
        key={view.invoice.id}
        store={store}
        invoice={view.invoice}
        held={held}
        pressing={sending === "payment"}
        backTo={view.card ? "Накладна" : "Накладні"}
        send={send}
        readAgain={readAgain}
        changed={shown}
        back={() => {
          if (view.card)
            setView({ screen: "card", invoice: view.invoice, from: view.from });
          else backTo(view.from);
        }}
        done={(invoice) => {
          setView({ screen: "card", invoice, from: view.from });
        }}
      />
    );

  if (view.screen === "card")
    return (
      <InvoiceDetail
        key={view.invoice.id}
        store={store}
        token={token}
        held={held}
        sending={sending}
        readOnly={readOnly}
        networkOwner={networkOwner}
        invoice={view.invoice}
        send={send}
        readAgain={readAgain}
        changed={(invoice) => {
          shown(invoice);
          reread();
        }}
        pay={() => {
          setView({
            screen: "pay",
            invoice: view.invoice,
            from: view.from,
            card: true,
          });
        }}
        back={() => {
          backTo(view.from);
        }}
        backTo={view.from === "outside" && leave?.to ? leave.to : "Накладні"}
        backHeld={view.from === "outside" && leave ? leave.held : false}
        {...(openBorrowed
          ? {
              openBorrowed: {
                go: () => {
                  openBorrowed.go(view.invoice);
                },
                held: openBorrowed.held,
              },
            }
          : {})}
      />
    );

  const listBack = leave ?? back;
  if (view.screen === "finding")
    return (
      <>
        {/* Its supplier's name not known yet: the title's place held, and
          the place of its ⋯, unseen, so the line under it stays where the
          card's will be (money task list after stage 2, P1-3; review). */}
        <ScreenHeader
          waiting
          pushed
          back={listBack && <BackToMore back={listBack} />}
          aside={<span className="debt-more" aria-hidden="true" />}
        />
        <section className="invoices invoice-detail">
          <InvoicePlaceholder />
        </section>
      </>
    );

  const elsewhere = view.screen === "elsewhere";
  return (
    <InvoiceList
      key={view.screen}
      store={store}
      token={token}
      elsewhere={elsewhere}
      readOnly={readOnly}
      held={held}
      supplierId={supplierId}
      setSupplierId={setSupplierId}
      owedOnly={owedOnly}
      setOwedOnly={setOwedOnly}
      back={
        elsewhere ? (
          <Back
            go={() => {
              setView({ screen: "list" });
            }}
          >
            <span aria-hidden="true">← </span>
            Накладні
          </Back>
        ) : (
          // Opened from outside and not found: back there.
          listBack && <BackToMore back={listBack} />
        )
      }
      open={(invoice) => {
        setView({
          screen: "card",
          invoice,
          from: elsewhere ? "elsewhere" : "list",
        });
      }}
      pay={(invoice) => {
        setView({
          screen: "pay",
          invoice,
          from: elsewhere ? "elsewhere" : "list",
          card: false,
        });
      }}
      make={() => {
        setView({ screen: "new" });
      }}
      toElsewhere={() => {
        setView({ screen: "elsewhere" });
      }}
    />
  );
}

/**
 * «Накладні» (stage 2, money task list, P0-1): «Винні зараз · Усі», the
 * supplier's field, the total in ink and the invoices as tags, the newest
 * first, page by page; «Накладні магазинів, що не працюють ›» under them.
 * Those of the stores that do not trade are the same screen, with no total
 * and nothing new.
 */
function InvoiceList({
  store,
  token,
  elsewhere,
  readOnly,
  held,
  supplierId,
  setSupplierId,
  owedOnly,
  setOwedOnly,
  back,
  open,
  pay,
  make,
  toElsewhere,
}: {
  store: Store;
  token: string;
  elsewhere: boolean;
  readOnly: boolean;
  held: boolean;
  supplierId: string;
  setSupplierId: (id: string) => void;
  owedOnly: boolean;
  setOwedOnly: (owed: boolean) => void;
  back: ReactNode;
  open: (invoice: Invoice) => void;
  pay: (invoice: Invoice) => void;
  make: () => void;
  toElsewhere: () => void;
}): JSX.Element {
  // Page by page, as «Закриття» reads: the server takes fifty at most, so a
  // page that grew past it was refused on the third «Показати ще» (stage 2,
  // money task list, P0-7).
  const invoices = useInfiniteQuery({
    queryKey: ["supplier-invoices", store.id, elsewhere, supplierId, owedOnly],
    queryFn: ({ pageParam }) =>
      api<InvoicePage>(
        `/supplier-invoices?store_id=${store.id}&limit=${String(pageSize)}&offset=${String(pageParam)}${
          owedOnly ? "&status=OPEN" : ""
        }${supplierId ? `&supplier_id=${supplierId}` : ""}${
          elsewhere ? "&elsewhere=true" : ""
        }`,
        token,
      ),
    initialPageParam: 0,
    getNextPageParam: (last: InvoicePage, pages: InvoicePage[]) =>
      last.has_more ? pages.length * pageSize : undefined,
    retry: false,
  });
  // An invoice written between two pages moves the older ones down by one:
  // each is shown once.
  const listed = [
    ...new Map(
      (invoices.data?.pages ?? [])
        .flatMap((page) => page.items)
        .map((invoice) => [invoice.id, invoice]),
    ).values(),
  ];
  const summary = useQuery({
    queryKey: ["supplier-invoices", store.id, "summary"],
    queryFn: () =>
      api<SupplierDebts>(
        `/supplier-invoices/summary?store_id=${store.id}`,
        token,
      ),
    enabled: !elsewhere,
    retry: false,
  });
  const now = useNow();
  const age = ageOf([summary]);
  const debts = summary.data;
  const chosenDebt =
    supplierId === ""
      ? null
      : debts?.suppliers.find((debt) => debt.supplier.id === supplierId);
  // A new invoice and «Сплатити» where the store trades, and only for its
  // own invoices; those of the stores that do not trade are paid here too.
  const makes = !readOnly && !elsewhere;
  const pays = !readOnly;

  return (
    <>
      <ScreenHeader
        title={elsewhere ? "Накладні магазинів, що не працюють" : "Накладні"}
        back={back}
        wraps
        aside={
          <span className="invoice-head-ways">
            {makes && (
              <button
                type="button"
                className="debt-more"
                aria-label="Записати накладну"
                disabled={held}
                onClick={make}
              >
                <Icon name="plus" />
              </button>
            )}
            <button
              type="button"
              className="quiet"
              disabled={invoices.isFetching}
              onClick={() => {
                void invoices.refetch();
                if (!elsewhere) void summary.refetch();
              }}
            >
              Оновити
            </button>
          </span>
        }
      />
      <section className="invoices">
        {readOnly && (
          // The store's own notice says it does not trade; this says who
          // pays, in one line (money task list after stage 2, P2-4).
          <p className="hint">Сплачує будь-який магазин мережі, що працює.</p>
        )}
        <ModeSwitch
          label="Які накладні"
          modes={[
            { mode: "open", label: "Винні зараз" },
            { mode: "all", label: "Усі" },
          ]}
          current={owedOnly ? "open" : "all"}
          choose={(mode) => {
            setOwedOnly(mode === "open");
          }}
          disabled={false}
          filters
        />
        <SupplierFilter
          store={store}
          token={token}
          value={supplierId}
          change={setSupplierId}
          disabled={false}
          {...(debts && !elsewhere
            ? {
                metaOf: (supplier) => {
                  const debt = debts.suppliers.find(
                    (each) => each.supplier.id === supplier.id,
                  );
                  return debt
                    ? `винні ${money(debt.owed)} · ${invoicesCount(debt.invoices)}`
                    : null;
                },
              }
            : {})}
        />
        {!elsewhere && (
          <div className="invoice-total" aria-live="polite">
            {debts === undefined ? (
              summary.isPending && (
                <span className="skeleton-line" aria-hidden="true">
                  <span>Винні 00 000,00 грн · 0 накладних</span>
                </span>
              )
            ) : chosenDebt === undefined ||
              (chosenDebt === null && debts.invoices === 0) ? (
              <p className="invoice-total-line t-row">Нічого не винні</p>
            ) : (
              <p className="invoice-total-line">
                <span className="t-row">
                  {chosenDebt
                    ? `Винні постачальнику «${visible(chosenDebt.supplier.name)}»`
                    : "Винні"}
                </span>{" "}
                <span className="t-money-l">
                  <Sum
                    value={money(chosenDebt ? chosenDebt.owed : debts.owed)}
                  />
                </span>{" "}
                <span className="t-row">
                  ·{" "}
                  {invoicesCount(
                    chosenDebt ? chosenDebt.invoices : debts.invoices,
                  )}
                </span>
              </p>
            )}
            {staleOf(age, now) && <Stamp age={age} now={now} />}
          </div>
        )}
        {invoices.isPending ? (
          // Three tags' places, where the first one comes (money task list
          // after stage 2, P1-3).
          <Placeholder said="Завантажуємо накладні…" lineTags={3} />
        ) : invoices.data === undefined ? (
          <Unread
            error={invoices.error}
            retry={() => {
              void invoices.refetch();
            }}
          />
        ) : listed.length === 0 ? (
          // Nothing (spec §6.28): the blank mark, what is so now, and what an
          // invoice is.
          <Empty
            title={
              elsewhere
                ? "Магазини, що не працюють, нічого не винні постачальникам."
                : owedOnly
                  ? "Зараз магазин нічого не винен постачальникам."
                  : "У цьому магазині ще не записували накладних."
            }
            meta={
              elsewhere
                ? undefined
                : "Кожна накладна — окремий борг: сплачують частинами, без графіка."
            }
          >
            {makes && (
              <button
                type="button"
                className="quiet"
                disabled={held}
                onClick={make}
              >
                Записати накладну
              </button>
            )}
          </Empty>
        ) : (
          <>
            <ul className="order-tags invoice-tags" aria-label="Накладні">
              {listed.map((invoice) => (
                <InvoiceTag
                  key={invoice.id}
                  invoice={invoice}
                  storeId={store.id}
                  open={() => {
                    open(invoice);
                  }}
                  pay={
                    pays && invoice.status === "OPEN"
                      ? {
                          held,
                          go: () => {
                            pay(invoice);
                          },
                        }
                      : undefined
                  }
                />
              ))}
            </ul>
            {/* A page that failed keeps the invoices already read. */}
            {invoices.error && (
              <Unread
                error={invoices.error}
                retry={() => {
                  void (invoices.isFetchNextPageError
                    ? invoices.fetchNextPage()
                    : invoices.refetch());
                }}
              />
            )}
            {/* A page that failed is asked again by its own retry, alone
              (money task list after stage 2, P2-1). */}
            {invoices.hasNextPage && !invoices.isFetchNextPageError && (
              <button
                className="quiet"
                disabled={invoices.isFetching}
                onClick={() => {
                  void invoices.fetchNextPage();
                }}
              >
                Показати ще
              </button>
            )}
          </>
        )}
        {makes && (
          <button
            type="button"
            className="sale-row invoice-elsewhere"
            onClick={toElsewhere}
          >
            <span className="sale-main t-row">
              Накладні магазинів, що не працюють
            </span>
            <Icon name="chevron-right" size={20} />
          </button>
        )}
      </section>
    </>
  );
}

/**
 * «Нова накладна», a screen of its own (stage 2, money task list, P0-1):
 * the supplier from the sheet, nothing chosen beforehand, then the sum on
 * the invoice, what was paid at once — none is a choice too — and a note;
 * «Записати накладну» the dock's own button, never Telegram's: it records
 * money. Recorded, its stub: the supplier and the sum, what is left, and
 * «Готово» to its card.
 */
function NewInvoice({
  store,
  token,
  held,
  pressing,
  send,
  back,
  opened,
}: {
  store: Store;
  token: string;
  held: boolean;
  pressing: boolean;
  send: (command: Command) => Promise<Sent>;
  back: () => void;
  opened: (invoice: Invoice) => void;
}): JSX.Element {
  const [supplier, setSupplier] = useState("");
  const [amount, setAmount] = useState("");
  const [paidNow, setPaidNow] = useState("");
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [recorded, setRecorded] = useState<Invoice | null>(null);
  const sum = useRef<HTMLInputElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  usePanelRoom(dock, recorded === null);
  // A supplier chosen or a sum typed, the invoice not yet recorded:
  // Telegram asks before Бірка closes, as its payment does (audit
  // 2026-11-13, money P2-6).
  useAskBeforeClosing(recorded === null && (supplier !== "" || amount !== ""));

  function submit(): void {
    setProblem(null);
    const total = kopecks(amount);
    // Nothing paid at once is a choice too (owner decision, 2026-10-01).
    const paid = paidNow.trim() === "" ? 0n : kopecks(paidNow);
    if (!supplier) {
      setProblem("Оберіть постачальника.");
      return;
    }
    if (total === null || total <= 0n) {
      setProblem("Вкажіть суму за накладною з точністю до копійок.");
      return;
    }
    if (paid === null) {
      setProblem("Вкажіть, скільки сплачено одразу, з точністю до копійок.");
      return;
    }
    if (paid > total) {
      setProblem("Сплачено одразу не може бути більше, ніж сума накладної.");
      return;
    }
    void send({
      kind: "invoice",
      supplier_id: supplier,
      amount: decimal(total),
      paid_now: decimal(paid),
      note: note.trim() || null,
    }).then((sent) => {
      if (sent.kind === "done") setRecorded(sent.invoice);
      else if (sent.kind === "refused") setProblem(sent.text);
    });
  }

  // Recorded: a result's screen in the same tree — its header and «←» as
  // they were, «Готово» at the menu's top (audit 2026-11-13, frame P2-9).
  const recordedDone = useRecordedDone(
    recorded
      ? () => {
          opened(recorded);
        }
      : null,
  );
  return (
    <ResultScreen
      as="div"
      on={recorded !== null}
      className={recorded ? "invoice-result-screen" : undefined}
      dock={recordedDone}
    >
      <ScreenHeader
        title="Нова накладна"
        back={
          <Back go={back} held={pressing}>
            <span aria-hidden="true">← </span>
            Накладні
          </Back>
        }
      />
      <section className="invoices">
        {recorded ? (
          <InvoiceRecorded
            title="Накладну записано"
            invoice={recorded}
            sum={recorded.amount}
            line={`${visible(recorded.supplier.name)} · ${money(recorded.amount)}`}
          />
        ) : (
          <>
            <fieldset disabled={held}>
              <legend className="visually-hidden">Нова накладна</legend>
              <SupplierPicker
                store={store}
                token={token}
                value={supplier}
                change={setSupplier}
                disabled={held}
                next={sum}
              />
              <label>
                Сума за накладною, грн
                <input
                  ref={sum}
                  inputMode="decimal"
                  enterKeyHint="next"
                  placeholder="0,00"
                  value={amount}
                  onChange={(event) => {
                    setAmount(event.target.value);
                  }}
                />
              </label>
              <label>
                Сплачено одразу, грн
                <input
                  inputMode="decimal"
                  enterKeyHint="next"
                  placeholder="0,00"
                  value={paidNow}
                  onChange={(event) => {
                    setPaidNow(event.target.value);
                  }}
                />
              </label>
              <label>
                Примітка (необов’язково)
                <input
                  value={note}
                  maxLength={1000}
                  enterKeyHint="done"
                  onChange={(event) => {
                    setNote(event.target.value);
                  }}
                />
              </label>
            </fieldset>
            {problem && <p role="alert">{problem}</p>}
            <div className="pay-panel order-dock" ref={dock}>
              <SendingLine busy={pressing} />
              <button
                type="button"
                className={
                  pressing ? "sheet-done primary pressed" : "sheet-done primary"
                }
                disabled={held}
                onClick={submit}
              >
                {pressing && <Eyelet state="spin" size={20} />}
                Записати накладну
              </button>
            </div>
          </>
        )}
      </section>
    </ResultScreen>
  );
}

/**
 * One invoice (stage 2, money task list, P0-2): the supplier for a title,
 * when and who recorded it under it; what is owed large, in ink, and how
 * much is paid; the history as a thread. «Сплатити» is Telegram's
 * MainButton — the dock's one button outside it — and opens the payment;
 * the rare ways stand behind the ⋯ by the title. A set-off or a write-off
 * recorded is said over the sum, by its filled eyelet.
 */
function InvoiceDetail({
  store,
  token,
  held,
  sending,
  readOnly,
  networkOwner,
  invoice,
  send,
  readAgain,
  changed,
  pay,
  back,
  backTo,
  backHeld,
  openBorrowed,
}: {
  store: Store;
  token: string;
  held: boolean;
  /** What the journal sends for the first time. */
  sending: Command["kind"] | null;
  readOnly: boolean;
  networkOwner: boolean;
  invoice: Invoice;
  send: (command: Command) => Promise<Sent>;
  readAgain: (invoice: Invoice) => Promise<Invoice | null>;
  changed: (invoice: Invoice) => void;
  pay: () => void;
  back: () => void;
  /** «← Накладні», or the screen that opened it: «← Повернення». */
  backTo: string;
  /** That screen held, as its row is. */
  backHeld: boolean;
  /** Its borrowed goods' screen, for whoever returns goods (P1-3). */
  openBorrowed?: { go: () => void; held: boolean };
}): JSX.Element {
  const [recorded, setRecorded] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // A sheet over the card: «Сплатити» steps aside.
  const [acting, setActing] = useState(false);
  const [cancelling, setCancelling] = useState<InvoiceEntry | null>(null);
  const name = useRef<HTMLHeadingElement>(null);
  // Another store's invoice, paid here because that one does not trade.
  const elsewhere = invoice.store_id !== store.id;
  const open = invoice.status === "OPEN";
  const takes = open && !readOnly;
  const main = useMainButton("Сплатити", pay, {
    shown: takes && !acting && cancelling === null,
    active: !held,
  });
  const dock = useRef<HTMLDivElement>(null);
  usePanelRoom(dock, takes && !main);
  const said = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (problem !== null || recorded !== null)
      said.current?.scrollIntoView({ block: "nearest" });
  }, [problem, recorded]);

  async function shownAgain(): Promise<void> {
    const current = await readAgain(invoice);
    if (current) changed(current);
  }

  return (
    <>
      <ScreenHeader
        ref={name}
        focusable
        title={visible(invoice.supplier.name)}
        back={
          <Back
            go={back}
            held={(held && sending !== null) || backHeld}
            {...(backTo === "Накладні"
              ? {}
              : { label: `Назад до «${backTo}»` })}
          >
            <span aria-hidden="true">← </span>
            {backTo}
          </Back>
        }
        aside={
          <InvoiceActions
            store={store}
            token={token}
            held={held}
            sending={sending}
            readOnly={readOnly}
            networkOwner={networkOwner}
            invoice={invoice}
            send={send}
            opened={setActing}
            fallback={name}
            recorded={(text, current) => {
              setProblem(null);
              setRecorded(text);
              changed(current);
            }}
            cancelled={(current) => {
              setProblem(null);
              setRecorded(null);
              changed(current);
            }}
            refused={(text) => {
              setRecorded(null);
              setProblem(text);
              void shownAgain();
            }}
            stale={() => {
              void shownAgain();
            }}
          />
        }
      />
      <section className="invoices invoice-detail">
        <p className="hint debt-context">
          Записано {shortWhen(invoice.at)} · {visible(invoice.by)}
          {invoice.note && ` · ${visible(invoice.note)}`}
        </p>
        {invoice.sold && (
          <div className="invoice-sold">
            <p>
              За продане позичене: {visible(invoice.sold.label)} ×{" "}
              {invoice.sold.quantity}. Якщо позначили помилково — скасуйте
              накладну, і товар знову буде «на руках».
            </p>
            {openBorrowed && (
              <button
                type="button"
                className="quiet set-off-open"
                disabled={openBorrowed.held}
                onClick={openBorrowed.go}
              >
                Позичене й під реалізацію
                <Icon name="chevron-right" size={16} />
              </button>
            )}
          </div>
        )}
        {elsewhere && (
          <Banner kind="blocked" as="div">
            <p>
              Накладна магазину «{visible(invoice.store_name)}», який зараз{" "}
              {invoice.store_state === "ARCHIVED" ? "закрито" : "заблоковано"}.
              Сплачує цей магазин; борг лишається за «
              {visible(invoice.store_name)}».
            </p>
          </Banner>
        )}
        {recorded && (
          // Said over the sum by its filled eyelet, as an order's step
          // (stage 2, money task list, P0-2).
          <p className="step-done invoice-done" role="status" ref={said}>
            <Eyelet state="filled" size={12} />
            {recorded}
          </p>
        )}
        {problem && (
          <p role="alert" ref={said}>
            {problem}
          </p>
        )}
        {invoice.status === "OPEN" ? (
          <InvoiceOwed invoice={invoice} />
        ) : (
          <div className="invoice-closed">
            <p className="invoice-closed-head">
              <InvoiceSticker status={invoice.status} />
              {invoice.cancelled && (
                <span className="t-meta">
                  {shortDay(invoice.cancelled.at)} ·{" "}
                  {visible(invoice.cancelled.reason)} ·{" "}
                  {visible(invoice.cancelled.by)}
                </span>
              )}
            </p>
            <p className="invoice-owed-sum t-money-l">
              <Sum value={money(invoice.amount)} />
            </p>
            {invoice.status !== "CANCELLED" && <Progress invoice={invoice} />}
          </div>
        )}
        <h3 className="t-label customer-history-title">Історія</h3>
        {invoice.entries.length === 0 ? (
          <p>Оплат і заліків ще не було.</p>
        ) : (
          <ul className="timeline" aria-label="Історія накладної">
            {invoice.entries.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                // A payment is cancelled where it may be made now; a set-off
                // in the store that owes. A write-off is final.
                cancel={
                  !readOnly &&
                  entry.cancelled === null &&
                  (invoice.status === "OPEN" || invoice.status === "SETTLED") &&
                  (entry.kind === "PAYMENT" ||
                    (entry.kind === "SET_OFF" && !elsewhere))
                    ? {
                        held,
                        go: () => {
                          setCancelling(entry);
                        },
                      }
                    : undefined
                }
              />
            ))}
          </ul>
        )}
        {cancelling && (
          <EntryCancel
            store={store}
            token={token}
            invoice={invoice}
            entry={cancelling}
            held={held}
            fallback={name}
            close={() => {
              setCancelling(null);
            }}
            cancelled={(current) => {
              setCancelling(null);
              setProblem(null);
              setRecorded(null);
              changed(current);
            }}
            refused={(text) => {
              setCancelling(null);
              setRecorded(null);
              setProblem(text);
              void shownAgain();
            }}
          />
        )}
        {takes && !main && (
          // Outside Telegram, its MainButton as the dock's one button.
          <div className="pay-panel order-dock" ref={dock}>
            <button
              type="button"
              className="main-mimic"
              disabled={held}
              onClick={pay}
            >
              Сплатити
            </button>
          </div>
        )}
      </section>
    </>
  );
}

/**
 * An invoice opened from another screen while it is read (money task list
 * after stage 2, P1-3): its «Записано …» line, what is owed large over its
 * bar and what is paid, and two rows of its history, grey in their own
 * sizes — as an order's card waits (`CardPlaceholder`). A screen reader
 * hears «Завантажуємо накладну…».
 */
function InvoicePlaceholder(): JSX.Element {
  return (
    <>
      <p role="status" className="visually-hidden">
        Завантажуємо накладну…
      </p>
      <div className="placeholder invoice-placeholder" aria-hidden="true">
        <p className="hint debt-context">
          <span className="skeleton-line">
            <span>Записано 00.00, 00:00 · Оля</span>
          </span>
        </p>
        <div className="invoice-owed">
          <p className="owed-what">
            <span className="skeleton-line">
              <span>Винні</span>
            </span>
          </p>
          <p className="invoice-owed-sum t-money-l t-money-xl">
            <span className="skeleton-line">
              <span>0 000,00 грн</span>
            </span>
          </p>
          <div className="debt-bar invoice-bar" />
          <p className="owed-count">
            <span className="skeleton-line">
              <span>Сплачено 0,00 грн з 0 000,00 грн</span>
            </span>
          </p>
        </div>
        <p className="t-label customer-history-title">
          <span className="skeleton-line">
            <span>Історія</span>
          </span>
        </p>
        <div className="timeline">
          {[0, 1].map((n) => (
            <div className="timeline-row" key={n}>
              <span className="timeline-day">
                <span className="skeleton-line">
                  <span>00.00</span>
                </span>
              </span>
              <span className="timeline-node skeleton" />
              <span className="timeline-main">
                <span className="skeleton skeleton-name" />
                <span className="skeleton skeleton-meta" />
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/**
 * One line of the invoice's history (spec §6.21): the day, its node on the
 * thread — filled once recorded, hollow once cancelled, with its sticker —
 * what it was and its sum, who, the store that paid and the note. One that
 * may be cancelled is a button the line's whole width, opening the sheet
 * that asks why; the others are never pressed.
 */
function EntryRow({
  entry,
  cancel,
}: {
  entry: InvoiceEntry;
  cancel?: { held: boolean; go: () => void } | undefined;
}): JSX.Element {
  const inside = (
    <>
      <span className="timeline-day">{shortDay(entry.at)}</span>
      <span
        className={`timeline-node${entry.cancelled ? " hollow" : ""}`}
        aria-hidden="true"
      />
      <span className="timeline-main">
        <span className="timeline-what">
          {entryLabels[entry.kind]} {money(entry.amount)}
        </span>
        <span className="timeline-meta">
          {[
            visible(entry.by),
            ...(entry.paid_at
              ? [`сплатив магазин «${visible(entry.paid_at)}»`]
              : []),
            ...(entry.note ? [visible(entry.note)] : []),
          ].join(" · ")}
        </span>
        {entry.cancelled && (
          <>
            <InvoiceSticker status="CANCELLED" />
            <span className="timeline-meta">
              {shortDay(entry.cancelled.at)} · {visible(entry.cancelled.reason)}{" "}
              · {visible(entry.cancelled.by)}
            </span>
          </>
        )}
      </span>
    </>
  );
  return cancel ? (
    <li>
      <button
        type="button"
        className="timeline-row timeline-press"
        aria-haspopup="dialog"
        disabled={cancel.held}
        onClick={cancel.go}
      >
        {/* What a press does, for a reader: the sheet is «Скасувати: …». */}
        <span className="visually-hidden">Скасувати: </span>
        {inside}
      </button>
    </li>
  ) : (
    <li className="timeline-row">{inside}</li>
  );
}
