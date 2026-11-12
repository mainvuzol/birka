import { useEffect, useId, useRef, useState } from "react";
import type { JSX, ReactNode, RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, api } from "@/shared/api";
import { Unread } from "@/shared/Unread";
import { Placeholder } from "@/shared/Placeholder";
import { decimal, kopecks, money } from "@/orders/types";
import type { Store } from "@/orders/types";
import { visible } from "@/shared/visible";
import { Eyelet } from "@/shared/Eyelet";
import { Icon } from "@/shared/Icon";
import { SendingLine } from "@/shared/Sending";
import { Sheet } from "@/shared/Sheet";
import { shortDay } from "@/credits/format";
import {
  doneText,
  entryLabels,
  invoiceName,
  refusalText,
} from "./invoiceWords";
import type { Command, Sent } from "./invoiceWords";
import type { Invoice, InvoiceEntry, ReturnPage } from "./types";

/** No answer to a cancellation: pressed again, it is answered as it is. */
export const noAnswer =
  "Немає відповіді сервера. Натисніть ще раз — повторне натискання безпечне.";

/**
 * A sheet that asks why before it is done (stage 2, money task list, P0-2):
 * what it does, «Чому …», and its yes, dark until a reason is given; a
 * return's cancel too (P0-4).
 */
export function Reasoned({
  title,
  question,
  label,
  confirm,
  held,
  busy,
  problem,
  fallback,
  close,
  run,
  back = "Скасувати",
}: {
  title: ReactNode;
  question: string;
  /** «Чому скасовуємо». */
  label: string;
  confirm: string;
  held: boolean;
  busy: boolean;
  problem: string | null;
  fallback: RefObject<HTMLElement>;
  close: () => void;
  run: (reason: string) => void;
  /** The quiet way out. */
  back?: string;
}): JSX.Element {
  const [reason, setReason] = useState("");
  return (
    <Sheet
      title={title}
      close={() => {
        if (!busy) close();
      }}
      fallback={fallback}
      foot={
        <>
          <SendingLine busy={busy} />
          <div className="actions">
            <button
              type="button"
              className={busy ? "primary pressed" : "primary"}
              disabled={held || busy || reason.trim() === ""}
              onClick={() => {
                run(reason.trim());
              }}
            >
              {busy && <Eyelet state="spin" size={20} />}
              {confirm}
            </button>
            <button
              type="button"
              className="quiet"
              disabled={busy}
              onClick={close}
            >
              {back}
            </button>
          </div>
        </>
      }
    >
      <p>{question}</p>
      <label className="write-off-why">
        {label}
        <textarea
          // Opened by a tap: the keyboard comes with the sheet (iOS).
          autoFocus
          enterKeyHint="enter"
          value={reason}
          maxLength={1000}
          disabled={busy}
          onChange={(event) => {
            setReason(event.target.value);
          }}
        />
      </label>
      {problem && <p role="alert">{problem}</p>}
    </Sheet>
  );
}

/**
 * What else is done to one invoice, behind the ⋯ by its title (stage 2,
 * money task list, P0-2): rare, so first a sheet that names it and holds
 * the ways — «Зарахувати повернення», «Списати залишок» (the owner's, or
 * the network's for a store that does not trade), «Скасувати накладну»,
 * dark while its payments and set-offs stand. Each asks in a sheet of its
 * own. Nothing for whoever may do none of them.
 */
export function InvoiceActions({
  store,
  token,
  held,
  sending,
  readOnly,
  networkOwner,
  invoice,
  send,
  opened,
  fallback,
  recorded,
  cancelled,
  refused,
  stale,
}: {
  store: Store;
  token: string;
  held: boolean;
  sending: Command["kind"] | null;
  readOnly: boolean;
  networkOwner: boolean;
  invoice: Invoice;
  send: (command: Command) => Promise<Sent>;
  /** A sheet of its own is over the card: its MainButton steps aside. */
  opened: (open: boolean) => void;
  fallback: RefObject<HTMLElement>;
  /** A set-off or a write-off recorded: its words, and the invoice now. */
  recorded: (text: string, invoice: Invoice) => void;
  /** The invoice cancelled: as the server answered it. */
  cancelled: (invoice: Invoice) => void;
  /** A refusal, said on the card: the sheet is gone. */
  refused: (text: string) => void;
  /** A set-off refused, said in its sheet: the card is read again. */
  stale: () => void;
}): JSX.Element | null {
  const [view, setView] = useState<
    "menu" | "set-off" | "write-off" | "cancel" | null
  >(null);
  const [cancelling, setCancelling] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const first = useId();
  const open = view !== null;
  useEffect(() => {
    opened(open);
    // Gone with its sheet open — the invoice read again — it is closed: the
    // card's MainButton comes back.
    return () => {
      if (open) opened(false);
    };
  }, [opened, open]);
  const elsewhere = invoice.store_id !== store.id;
  const owed = invoice.status === "OPEN";
  // The owner writes off; for a store that does not trade, the network's.
  const mayWriteOff =
    invoice.store_state === "ACTIVE"
      ? !readOnly && store.permissions.includes("supplier:write_off")
      : networkOwner;
  const setsOff = owed && !readOnly && !elsewhere;
  const writesOff = owed && mayWriteOff;
  const cancels = owed && !readOnly && !elsewhere;
  // Its payments and set-offs first, so no money disappears by accident.
  const standing = invoice.entries.some(
    (entry) => entry.cancelled === null && entry.kind !== "WRITE_OFF",
  );
  if (!setsOff && !writesOff && !cancels) return null;
  const close = (): void => {
    setView(null);
    setProblem(null);
  };
  const writingOff = sending === "write-off";

  async function cancelInvoice(reason: string): Promise<void> {
    setCancelling(true);
    setProblem(null);
    try {
      const current = await api<Invoice>(
        `/supplier-invoices/${invoice.id}/cancel`,
        token,
        { reason },
      );
      setView(null);
      cancelled(current);
    } catch (error) {
      if (error instanceof ApiError) {
        setView(null);
        refused(refusalText(error));
      } else setProblem(noAnswer);
    } finally {
      setCancelling(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="debt-more"
        ref={opener}
        aria-label="Дії з накладною"
        aria-haspopup="dialog"
        disabled={held}
        onClick={() => {
          setView("menu");
        }}
      >
        <Icon name="more-horizontal" />
      </button>
      {view === "menu" && (
        <Sheet title={invoiceName(invoice)} close={close} fallback={opener}>
          <div className="debt-more-ways">
            {setsOff && (
              <button
                type="button"
                className="sheet-way"
                disabled={held}
                onClick={() => {
                  setView("set-off");
                }}
              >
                Зарахувати повернення
              </button>
            )}
            {writesOff && (
              <button
                type="button"
                className="sheet-way"
                disabled={held}
                onClick={() => {
                  setView("write-off");
                }}
              >
                Списати залишок
              </button>
            )}
            {cancels && (
              <>
                <button
                  type="button"
                  className="sheet-way danger-way"
                  disabled={held || standing}
                  aria-describedby={standing ? first : undefined}
                  onClick={() => {
                    setView("cancel");
                  }}
                >
                  Скасувати накладну
                </button>
                {standing && (
                  <p className="hint" id={first}>
                    Спершу скасуйте її оплати й заліки.
                  </p>
                )}
              </>
            )}
          </div>
        </Sheet>
      )}
      {view === "set-off" && (
        <SetOff
          store={store}
          token={token}
          invoice={invoice}
          held={held}
          pressing={sending === "set-off"}
          fallback={fallback}
          close={close}
          send={(supplierReturnId, cents) =>
            send({
              kind: "set-off",
              invoice_id: invoice.id,
              supplier_return_id: supplierReturnId,
              amount: decimal(cents),
            }).then((sent) => {
              if (sent.kind === "done") {
                setView(null);
                recorded(
                  doneText(sent.invoice, {
                    kind: "set-off",
                    invoice_id: invoice.id,
                    supplier_return_id: supplierReturnId,
                    amount: decimal(cents),
                  }),
                  sent.invoice,
                );
              } else if (sent.kind === "refused") {
                // Said in its sheet, the return chosen and the sum kept, as
                // a refused payment keeps its sum; the card read again.
                stale();
                return sent.text;
              } else setView(null);
              return null;
            })
          }
        />
      )}
      {view === "write-off" && (
        <Reasoned
          title={`Списати залишок ${money(invoice.owed)}?`}
          question={`Залишок ${money(invoice.owed)} закриється без оплати. Скасувати це потім не можна.`}
          label="Чому списуємо"
          confirm={`Так, списати ${money(invoice.owed)}`}
          held={held}
          busy={writingOff}
          problem={null}
          fallback={fallback}
          close={close}
          run={(reason) => {
            const command: Command = {
              kind: "write-off",
              invoice_id: invoice.id,
              reason,
            };
            void send(command).then((sent) => {
              setView(null);
              if (sent.kind === "done")
                recorded(doneText(sent.invoice, command), sent.invoice);
              else if (sent.kind === "refused") refused(sent.text);
            });
          }}
        />
      )}
      {view === "cancel" && (
        <Reasoned
          title="Скасувати накладну"
          question="Накладну записано помилково? Вона лишиться в історії як скасована."
          label="Чому скасовуємо"
          confirm="Так, скасувати накладну"
          back="Не скасовувати"
          held={held}
          busy={cancelling}
          problem={problem}
          fallback={fallback}
          close={close}
          run={(reason) => {
            void cancelInvoice(reason);
          }}
        />
      )}
    </>
  );
}

/**
 * «Зарахувати повернення» (stage 2, money task list, P0-2): the returns of
 * this store to the invoice's supplier still standing, each a choice and
 * none chosen beforehand, what the supplier counted, and «Зарахувати 300,00
 * грн». Never more than is owed.
 */
function SetOff({
  store,
  token,
  invoice,
  held,
  pressing,
  fallback,
  close,
  send,
}: {
  store: Store;
  token: string;
  invoice: Invoice;
  held: boolean;
  pressing: boolean;
  fallback: RefObject<HTMLElement>;
  close: () => void;
  /** Sent: a refusal's words, or nothing once the sheet is done. */
  send: (supplierReturnId: string, cents: bigint) => Promise<string | null>;
}): JSX.Element {
  const [chosen, setChosen] = useState("");
  const [amount, setAmount] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const returns = useQuery({
    queryKey: ["supplier-returns", store.id, invoice.supplier.id, "set-off"],
    queryFn: () =>
      api<ReturnPage>(
        `/supplier-returns?store_id=${store.id}&supplier_id=${invoice.supplier.id}&limit=50`,
        token,
      ),
    retry: false,
  });
  // Only what still stands: a cancelled return's goods came back.
  const standing = (returns.data?.items ?? []).filter(
    (item) => item.cancelled === null,
  );
  const cents = kopecks(amount);

  function submit(): void {
    setProblem(null);
    // A return cancelled meanwhile is chosen no more.
    if (!standing.some((item) => item.id === chosen)) {
      setProblem("Оберіть повернення.");
      return;
    }
    if (cents === null || cents <= 0n) {
      setProblem("Вкажіть суму заліку з точністю до копійок.");
      return;
    }
    if (cents > (kopecks(invoice.owed) ?? 0n)) {
      setProblem(
        `Це більше, ніж винні: залишок ${money(invoice.owed)}. Решту зарахуйте на іншу накладну.`,
      );
      return;
    }
    void send(chosen, cents).then((refusal) => {
      if (refusal === null) return;
      setProblem(refusal);
      void returns.refetch();
    });
  }

  return (
    <Sheet
      title="Зарахувати повернення"
      close={() => {
        if (!pressing) close();
      }}
      fallback={fallback}
      foot={
        standing.length > 0 ? (
          <>
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
              {cents !== null && cents > 0n
                ? `Зарахувати ${money(decimal(cents))}`
                : "Зарахувати"}
            </button>
          </>
        ) : undefined
      }
    >
      <p className="t-meta">
        Повернення постачальнику «{visible(invoice.supplier.name)}» з цього
        магазину
      </p>
      {returns.isPending ? (
        // Three returns' cards in their places (money task list after
        // stage 2, P1-3).
        <Placeholder
          said="Завантажуємо повернення…"
          rows={3}
          day={false}
          rowShape={{ list: "set-off-returns", row: "set-off-return" }}
        />
      ) : returns.error ? (
        <Unread
          error={returns.error}
          retry={() => {
            void returns.refetch();
          }}
        />
      ) : standing.length === 0 ? (
        <p>
          Цей магазин нічого не повертав постачальнику «
          {visible(invoice.supplier.name)}».
        </p>
      ) : (
        <>
          <ul className="set-off-returns" aria-label="Повернення">
            {standing.map((item) => {
              const counted = item.set_offs.reduce(
                (sum, setOff) => sum + (kopecks(setOff.amount) ?? 0n),
                0n,
              );
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className="set-off-return"
                    aria-pressed={chosen === item.id}
                    disabled={held || pressing}
                    onClick={() => {
                      setChosen(item.id);
                      setProblem(null);
                    }}
                  >
                    <span className="t-row">
                      {shortDay(item.at)} ·{" "}
                      {item.lines.reduce(
                        (units, line) => units + line.quantity,
                        0,
                      )}{" "}
                      шт. · склад «{visible(item.location_name)}»
                    </span>
                    {counted > 0n && (
                      <span className="t-meta">
                        уже зараховано {money(decimal(counted))}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          <label>
            Скільки зарахував постачальник, грн
            <input
              inputMode="decimal"
              enterKeyHint="done"
              placeholder="0,00"
              value={amount}
              disabled={pressing}
              onChange={(event) => {
                setAmount(event.target.value);
                setProblem(null);
              }}
            />
          </label>
          {problem && <p role="alert">{problem}</p>}
        </>
      )}
    </Sheet>
  );
}

/**
 * Cancelling one line of the history, a sheet that asks why (stage 2,
 * money task list, P0-2): «Скасувати: оплата 500,00 грн», what it does to
 * the debt, «Чому скасовуємо», «Так, скасувати». Pressed twice, it is
 * answered as it is.
 */
export function EntryCancel({
  store,
  token,
  invoice,
  entry,
  held,
  fallback,
  close,
  cancelled,
  refused,
}: {
  store: Store;
  token: string;
  invoice: Invoice;
  entry: InvoiceEntry;
  held: boolean;
  fallback: RefObject<HTMLElement>;
  close: () => void;
  cancelled: (invoice: Invoice) => void;
  refused: (text: string) => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const elsewhere = invoice.store_id !== store.id;
  const what = `${entryLabels[entry.kind]} ${money(entry.amount)}`;

  async function undo(reason: string): Promise<void> {
    setBusy(true);
    setProblem(null);
    try {
      const current = await api<Invoice>(
        `/supplier-invoices/${invoice.id}/entries/${entry.id}/cancel`,
        token,
        {
          reason,
          // A payment made here for a store that does not trade.
          ...(elsewhere ? { store_id: store.id } : {}),
        },
      );
      cancelled(current);
    } catch (error) {
      if (error instanceof ApiError) refused(refusalText(error));
      else setProblem(noAnswer);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Reasoned
      title={`Скасувати: ${what.toLowerCase()}`}
      question={`${what} записано помилково? Борг зросте на цю суму.`}
      label="Чому скасовуємо"
      confirm="Так, скасувати"
      back="Не скасовувати"
      held={held}
      busy={busy}
      problem={problem}
      fallback={fallback}
      close={close}
      run={(reason) => {
        void undo(reason);
      }}
    />
  );
}
