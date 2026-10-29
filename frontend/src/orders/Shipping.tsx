import { useEffect, useId, useRef, useState } from "react";
import type { JSX } from "react";
import { NoCustomerData } from "@/shared/NoCustomerData";
import { CARRIED_TAP, usePanelRoom } from "@/shared/panel";
import { ScreenHeader } from "@/shared/ScreenHeader";
import { WhereTo } from "./WhereTo";
import type { Carrier, Destination, Order } from "./types";

/**
 * Where an open order goes, as it should stand: corrected, or its waybill
 * written later (owner decisions, 2026-10-01) — its own step, as a new
 * order says it (orders task list, P1-3): «По Україні» or «За кордон» by a
 * switch, the carrier by a chip, the waybill or abroad where and how it
 * went, and «Зберегти доставку» under the thumb. Every earlier version
 * stays in its history. Opened to write the waybill, the cursor is in it.
 */
export function Shipping({
  order,
  title,
  writing,
  blocked,
  back,
  save,
}: {
  order: Order;
  /** The order as its card's title says it. */
  title: string;
  /** Opened by «ТТН ще немає — вписати». */
  writing: boolean;
  blocked: boolean;
  /** «← Замовлення». */
  back: () => void;
  save: (shipping: Record<string, unknown>) => void;
}): JSX.Element {
  const hint = useId();
  const [destination, setDestination] = useState<Destination>(
    order.destination ?? "UKRAINE",
  );
  const [carrier, setCarrier] = useState<Carrier | "">(order.carrier ?? "");
  const [waybill, setWaybill] = useState(order.waybill ?? "");
  const [note, setNote] = useState(order.abroad_note ?? "");
  // The panel's room kept first, so the field in focus is brought over it.
  const panel = useRef<HTMLDivElement>(null);
  usePanelRoom(panel, true);
  const heading = useRef<HTMLHeadingElement>(null);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (writing) field.current?.focus();
    else heading.current?.focus();
  }, [writing]);
  // Opened from the card's foot, «Зберегти доставку» may stand where the
  // row was tapped: a second tap landing on it is let go (review,
  // 2026-10-25).
  const [shownAt] = useState(() => performance.now());
  const noCarrier = destination === "UKRAINE" && carrier === "";
  return (
    <>
      <ScreenHeader
        ref={heading}
        focusable
        title="Доставка"
        back={
          <button type="button" className="quiet" onClick={back}>
            ← Замовлення
          </button>
        }
      />
      <section className="order-shipping">
        <fieldset disabled={blocked}>
          <WhereTo
            destination={destination}
            carrier={carrier}
            disabled={blocked}
            change={(nextDestination, nextCarrier) => {
              setDestination(nextDestination);
              setCarrier(nextCarrier);
            }}
          />
          {destination === "UKRAINE" ? (
            <label>
              Номер ТТН
              <input
                ref={field}
                value={waybill}
                maxLength={64}
                onChange={(event) => {
                  setWaybill(event.target.value);
                }}
              />
            </label>
          ) : (
            <label>
              Куди і як відправили: місто, країна, спосіб
              <textarea
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
        {/* Under the thumb: which order, and the one press, which says the
            carrier first when none is chosen — as a new order's. */}
        <div className="pay-panel order-panel" ref={panel}>
          <p className="pay-what">{title}</p>
          <button
            type="button"
            disabled={blocked || noCarrier}
            onClick={(event) => {
              if (event.timeStamp - shownAt < CARRIED_TAP) return;
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
            }}
          >
            {noCarrier ? "Оберіть перевізника" : "Зберегти доставку"}
          </button>
        </div>
      </section>
    </>
  );
}
