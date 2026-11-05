import { useEffect, useId, useRef, useState } from "react";
import type { JSX } from "react";
import { Eyelet } from "@/shared/Eyelet";
import { NoCustomerData } from "@/shared/NoCustomerData";
import { CARRIED_TAP } from "@/shared/panel";
import { Sheet } from "@/shared/Sheet";
import {
  hideKeyboard,
  useAskBeforeClosing,
  useMainButton,
} from "@/shared/telegram";
import { titleOf } from "./Orders";
import { WhereTo } from "./WhereTo";
import type { Carrier, Destination, Order } from "./types";

/**
 * Where an open order goes, as it should stand: corrected, or its waybill
 * written later (owner decisions, 2026-10-01) — a sheet over its card
 * (stage 2, orders task list, P1-1), as «Відправити» is: the order in a
 * line, where it goes by one row of chips with the current one chosen, the
 * waybill or abroad where and how it went, and «Зберегти доставку»,
 * Telegram's MainButton or the sheet's own. Every earlier version stays in
 * its history. Opened to write the waybill, the cursor is in it. Refused,
 * why over what was typed; Telegram asks before closing while anything was
 * changed; its «Назад» closes the sheet.
 */
export function Shipping({
  order,
  writing,
  blocked,
  waiting,
  refusal,
  save,
  close,
}: {
  order: Order;
  /** Opened by «ТТН ще немає — вписати». */
  writing: boolean;
  blocked: boolean;
  /** «Зберегти доставку» is being asked: the button turns. */
  waiting: boolean;
  /** Why it was refused. */
  refusal: string | null;
  save: (shipping: Record<string, unknown>) => void;
  close: () => void;
}): JSX.Element {
  const meta = useId();
  const hint = useId();
  // As it stands now: Telegram asks before closing once any of it changed.
  const [was] = useState<{
    destination: Destination;
    carrier: Carrier | "";
    waybill: string;
    note: string;
  }>(() => ({
    destination: order.destination ?? "UKRAINE",
    carrier: order.carrier ?? "",
    waybill: order.waybill ?? "",
    note: order.abroad_note ?? "",
  }));
  const [destination, setDestination] = useState<Destination>(was.destination);
  const [carrier, setCarrier] = useState<Carrier | "">(was.carrier);
  const [waybill, setWaybill] = useState(was.waybill);
  const [note, setNote] = useState(was.note);
  // The cursor in the field as the sheet rises, only then: a chip tapped
  // later raises no keyboard.
  const [focusField, setFocusField] = useState(writing);
  // Why it was refused, brought to the finger: the keyboard put away to
  // read it, what was typed kept.
  const why = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (refusal !== null) why.current?.focus();
  }, [refusal]);
  const noCarrier = destination === "UKRAINE" && carrier === "";
  useAskBeforeClosing(
    destination !== was.destination ||
      carrier !== was.carrier ||
      waybill !== was.waybill ||
      note !== was.note,
  );
  function press(): void {
    if (blocked || noCarrier || waiting) return;
    hideKeyboard();
    save(
      destination === "UKRAINE"
        ? {
            destination,
            carrier,
            ...(waybill.trim() ? { waybill: waybill.trim() } : {}),
          }
        : {
            destination,
            ...(note.trim() ? { abroad_note: note.trim() } : {}),
          },
    );
  }
  const words = noCarrier ? "Оберіть перевізника" : "Зберегти доставку";
  // Telegram's button stands where the card's was: the second tap of the
  // press that opened the sheet is let go, as the sheet lets its own
  // (review, 2026-10-25).
  const [openedAt] = useState(() => performance.now());
  const main = useMainButton(
    words,
    () => {
      if (performance.now() - openedAt >= CARRIED_TAP) press();
    },
    { progress: waiting, active: !blocked && !noCarrier },
  );
  return (
    <Sheet
      title="Доставка"
      close={close}
      said={meta}
      foot={
        main ? undefined : (
          <button
            type="button"
            className="sheet-done main-mimic"
            disabled={blocked || noCarrier}
            onClick={press}
          >
            {waiting ? (
              <>
                <Eyelet state="spin" size={20} />
                <span className="visually-hidden">{words}</span>
              </>
            ) : (
              words
            )}
          </button>
        )
      }
    >
      <div className="shipping-sheet">
        <p className="t-meta send-parcel" id={meta}>
          {titleOf(order)}
        </p>
        {refusal !== null && (
          <p role="alert" ref={why} tabIndex={-1}>
            {refusal}
          </p>
        )}
        <fieldset disabled={blocked}>
          <WhereTo
            destination={destination}
            carrier={carrier}
            disabled={blocked}
            change={(nextDestination, nextCarrier) => {
              setDestination(nextDestination);
              setCarrier(nextCarrier);
              setFocusField(false);
            }}
          />
          {destination === "UKRAINE" ? (
            <label className="send-field">
              Номер ТТН
              <input
                // «ТТН ще немає — вписати»: the keyboard rises with the
                // sheet (spec §4.4, rule 5).
                autoFocus={focusField}
                className="ttn"
                value={waybill}
                maxLength={64}
                autoComplete="off"
                enterKeyHint="done"
                onChange={(event) => {
                  setWaybill(event.target.value);
                }}
                onKeyDown={(event) => {
                  // Enter puts the keyboard away; «Зберегти доставку» saves.
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  hideKeyboard();
                }}
              />
            </label>
          ) : (
            <label className="send-field">
              Куди і як відправили: місто, країна, спосіб
              <textarea
                autoFocus={focusField}
                value={note}
                maxLength={1000}
                aria-describedby={hint}
                onChange={(event) => {
                  setNote(event.target.value);
                }}
              />
              <NoCustomerData id={hint} />
            </label>
          )}
        </fieldset>
      </div>
    </Sheet>
  );
}
