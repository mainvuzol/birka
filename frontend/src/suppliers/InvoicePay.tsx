import { useEffect, useId, useRef, useState } from "react";
import type { JSX } from "react";
import { decimal, kopecks, money, typedKopecks } from "@/orders/types";
import type { Store } from "@/orders/types";
import { asInput } from "@/prices/SuggestedPrice";
import { visible } from "@/shared/visible";
import { Back } from "@/shared/Back";
import { Eyelet } from "@/shared/Eyelet";
import { Keypad } from "@/shared/Keypad";
import { usePanelRoom } from "@/shared/panel";
import { ResultScreen } from "@/shared/ResultScreen";
import { ScreenHeader } from "@/shared/ScreenHeader";
import { SendingLine } from "@/shared/Sending";
import { useAskBeforeClosing } from "@/shared/telegram";
import { shortDay } from "@/credits/format";
import { InvoiceOwed } from "./InvoiceOwed";
import { InvoiceRecorded, useRecordedDone } from "./InvoiceRecorded";
import { OtherStoreInvoice } from "./OtherStoreInvoice";
import type { Command, Sent } from "./invoiceWords";
import type { Invoice } from "./types";

/** «Це більше, ніж винні: залишок 999,50 грн. Сплатіть не більше.» */
function overText(owed: string): string {
  return `Це більше, ніж винні: залишок ${money(owed)}. Сплатіть не більше.`;
}

/**
 * Paying an invoice (spec S21, S22; stage 2, money task list, P0-2): the
 * supplier for a title, what is owed large and in ink, how much is paid;
 * the sum on the app's keypad, «Увесь залишок» beside it, and one button
 * of the app — an invoice's payment has no way to choose (`{command_id,
 * amount, store_id?}`), and money is never paid by Telegram's MainButton.
 * More than is owed is never pressed. The menu stands aside, and Telegram
 * asks before Бірка closes while a sum is typed. Recorded, its stub;
 * refused, the words over the keypad — brought there each time they are
 * said —, the sum kept; its answer lost, the journal's stub over the screen.
 * Another store's invoice: what is owed first, its state's plate under it,
 * last over the keypad — over «Винні» it would push the sum under the dock
 * on a short phone (audit 2026-11-28, money P2-1).
 */
export function InvoicePay({
  store,
  invoice,
  held,
  pressing,
  backTo,
  send,
  readAgain,
  changed,
  back,
  done,
}: {
  store: Store;
  invoice: Invoice;
  held: boolean;
  /** This payment, sent for the first time: its button's ring turns. */
  pressing: boolean;
  /** Where «←» goes: «Накладна», or the list it was opened from. */
  backTo: string;
  send: (command: Command) => Promise<Sent>;
  readAgain: (invoice: Invoice) => Promise<Invoice | null>;
  /** The invoice as the server answered it: paid, or read again after a
   * refusal. */
  changed: (invoice: Invoice) => void;
  back: () => void;
  /** «Готово»: the invoice's card, as the server answered it. */
  done: (invoice: Invoice) => void;
}): JSX.Element {
  const [amount, setAmount] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [paid, setPaid] = useState<{ invoice: Invoice; amount: string } | null>(
    null,
  );
  const elsewhere = invoice.store_id !== store.id;
  const owed = kopecks(invoice.owed) ?? 0n;
  // «1500,» is a sum still being typed: read as 1500, so the button and the
  // line over the keys never blink under the finger, as the set-off's
  // (audit 2026-11-15, money P2-2 (в)); what is sent is the sum shown.
  const cents = typedKopecks(amount);
  const typed = cents !== null && cents > 0n;
  const over = cents !== null && cents > owed;
  // A refusal of the sum pressed says it all: the line waits until the sum
  // is changed, which clears the refusal.
  const overSaid = over && problem === null;
  const overLine = useId();
  const dock = useRef<HTMLDivElement>(null);
  usePanelRoom(dock, paid === null);
  // A refusal is seen where it is said, over the keypad — each time it is
  // said, the same words again included, as «Внесок»'s (audit 2026-11-28,
  // money P2-1 (б)).
  const said = useRef<HTMLParagraphElement>(null);
  const [told, setTold] = useState(0);
  useEffect(() => {
    if (told > 0) said.current?.scrollIntoView({ block: "nearest" });
  }, [told]);
  // A sum typed and not yet paid: Telegram asks before Бірка closes (spec
  // §4.4; «Усе на бірці» task list, P1-2).
  useAskBeforeClosing(paid === null && amount !== "");

  function pay(): void {
    if (cents === null || cents <= 0n || cents > owed) return;
    setProblem(null);
    const sum = decimal(cents);
    void send({
      kind: "payment",
      invoice_id: invoice.id,
      amount: sum,
      ...(elsewhere ? { elsewhere: true } : {}),
    }).then(async (sent) => {
      if (sent.kind === "done") {
        setAmount("");
        setPaid({ invoice: sent.invoice, amount: sum });
        // «←» goes to the card as it is now, as «Готово» does.
        changed(sent.invoice);
        return;
      }
      if (sent.kind !== "refused") return;
      setProblem(sent.text);
      setTold((n) => n + 1);
      // Refused because the invoice moved on: shown as it is now — the
      // refusal brought over the keypad again, what is paid may take
      // another line.
      const current = await readAgain(invoice);
      if (current) {
        changed(current);
        setTold((n) => n + 1);
      }
    });
  }

  // Recorded: a result's screen in the same tree — its header and «←» as
  // they were, «Готово» at the menu's top (audit 2026-11-13, frame P2-9).
  const recordedDone = useRecordedDone(
    paid
      ? () => {
          done(paid.invoice);
        }
      : null,
  );
  return (
    <ResultScreen
      as="div"
      on={paid !== null}
      className={paid ? "invoice-result-screen" : undefined}
      dock={recordedDone}
    >
      <ScreenHeader
        title={visible(invoice.supplier.name)}
        back={
          <Back go={back} held={pressing}>
            <span aria-hidden="true">← </span>
            {backTo}
          </Back>
        }
      />
      <section className="invoices invoice-detail invoice-pay">
        {paid ? (
          <InvoiceRecorded
            title="Оплату записано"
            invoice={paid.invoice}
            sum={paid.amount}
            line={`${visible(paid.invoice.supplier.name)} · накладна від ${shortDay(paid.invoice.at)}`}
          />
        ) : (
          <>
            <InvoiceOwed invoice={invoice} />
            {problem && (
              <p role="alert" ref={said}>
                {problem}
              </p>
            )}
            {elsewhere && <OtherStoreInvoice invoice={invoice} />}
            <div
              className="pay-panel till-dock"
              role="group"
              aria-label="Оплата"
              ref={dock}
            >
              <Keypad
                label="Сума, грн"
                value={amount}
                change={(sum) => {
                  setAmount(sum);
                  setProblem(null);
                }}
                disabled={held}
                invalid={over}
                {...(overSaid ? { describedBy: overLine } : {})}
                aside={
                  <button
                    type="button"
                    className="quiet keypad-all"
                    disabled={held}
                    onClick={() => {
                      setAmount(asInput(invoice.owed));
                      setProblem(null);
                    }}
                  >
                    Увесь залишок {money(invoice.owed)}
                  </button>
                }
              />
              {overSaid && (
                <p id={overLine} className="pay-over" role="alert">
                  {overText(invoice.owed)}
                </p>
              )}
              <SendingLine busy={pressing} />
              <button
                type="button"
                className={
                  pressing ? "sheet-done primary pressed" : "sheet-done primary"
                }
                disabled={held || !typed || over}
                onClick={pay}
              >
                {pressing && <Eyelet state="spin" size={20} />}
                {typed ? `Сплатити ${money(decimal(cents))}` : "Сплатити"}
              </button>
            </div>
          </>
        )}
      </section>
    </ResultScreen>
  );
}
