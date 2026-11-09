import { useId, useRef, useState } from "react";
import type { JSX } from "react";
import { decimal, kopecks, money } from "@/orders/types";
import type { Store } from "@/orders/types";
import { asInput } from "@/prices/SuggestedPrice";
import { visible } from "@/shared/visible";
import { Back } from "@/shared/Back";
import { Banner } from "@/shared/Banner";
import { Eyelet } from "@/shared/Eyelet";
import { Keypad } from "@/shared/Keypad";
import { usePanelRoom } from "@/shared/panel";
import { ScreenHeader } from "@/shared/ScreenHeader";
import { SendingLine } from "@/shared/Sending";
import { useAskBeforeClosing } from "@/shared/telegram";
import { shortDay } from "@/credits/format";
import { InvoiceOwed } from "./InvoiceOwed";
import { InvoiceRecorded } from "./InvoiceRecorded";
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
 * refused, the words over the keypad, the sum kept; its answer lost, the
 * journal's stub over the screen.
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
  const cents = kopecks(amount);
  const typed = cents !== null && cents > 0n;
  const over = cents !== null && cents > owed;
  // A refusal of the sum pressed says it all: the line waits until the sum
  // is changed, which clears the refusal.
  const overSaid = over && problem === null;
  const overLine = useId();
  const dock = useRef<HTMLDivElement>(null);
  usePanelRoom(dock, paid === null);
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
      // Refused because the invoice moved on: shown as it is now.
      const current = await readAgain(invoice);
      if (current) changed(current);
    });
  }

  return (
    <>
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
            next={() => {
              done(paid.invoice);
            }}
          />
        ) : (
          <>
            {elsewhere && (
              <Banner kind="blocked" as="div">
                <p>
                  Накладна магазину «{visible(invoice.store_name)}», який зараз{" "}
                  {invoice.store_state === "ARCHIVED"
                    ? "закрито"
                    : "заблоковано"}
                  . Сплачує цей магазин; борг лишається за «
                  {visible(invoice.store_name)}».
                </p>
              </Banner>
            )}
            <InvoiceOwed invoice={invoice} />
            {problem && <p role="alert">{problem}</p>}
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
    </>
  );
}
