import { useEffect, useId, useRef, useState } from "react";
import type { JSX } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/shared/api";
import { Eyelet } from "@/shared/Eyelet";
import { Icon } from "@/shared/Icon";
import { NoCustomerData } from "@/shared/NoCustomerData";
import { CARRIED_TAP } from "@/shared/panel";
import { Sheet } from "@/shared/Sheet";
import {
  hideKeyboard,
  useAskBeforeClosing,
  useMainButton,
} from "@/shared/telegram";
import { visible } from "@/shared/visible";
import { tagOf } from "./Orders";
import { placesKey } from "./types";
import type { Location, Order, Store } from "./types";

/** «Кокон графіт · M · склад «Основний»», a line of the parcel: its
 * warehouse where it was read. */
export function parcelLine(
  order: Order,
  places: readonly Location[] | undefined,
): string {
  const names = new Map((places ?? []).map((place) => [place.id, place.name]));
  return order.items
    .map((item) => {
      const name = names.get(item.source_location_id);
      return `${tagOf(item)}${name === undefined ? "" : ` · склад «${visible(name)}»`}`;
    })
    .join(", ");
}

/**
 * «Відправити» (spec S18; «Усе на бірці» sections task list, P0-3): a sheet
 * over the order's card — from its MainButton, or from its row's verb with
 * the card under it — what is in the parcel, the waybill's field in focus,
 * and «Відправлено», Telegram's MainButton or the sheet's own: always
 * pressed, an empty field sends it without one, as it may be written later.
 * The waybill is written as typed and never checked: a duplicate is the
 * server's to find, said once it is recorded (owner decision, 2026-10-01) —
 * the sheet stays with the warning, the order sent, and «Готово» closes it.
 * Refused, why over the field, what was typed kept. Telegram asks before
 * closing while the field holds anything; its «Назад» closes the sheet —
 * hidden, and nothing closes it, while «Відправлено» is on its way (audit
 * 2026-11-13, orders-cash P2-3).
 */
export function Send({
  order,
  store,
  token,
  blocked,
  waiting,
  refusal,
  send,
  close,
}: {
  /** As last read: the list's row, until the card is read. */
  order: Order;
  store: Store;
  token: string;
  blocked: boolean;
  /** «Відправлено» is being asked: the button turns. */
  waiting: boolean;
  /** Why it was refused. */
  refusal: string | null;
  send: (extra?: Record<string, unknown>) => void;
  close: () => void;
}): JSX.Element {
  const meta = useId();
  const hint = useId();
  // The warehouses' names, for whoever reads the stock: the list's read.
  const warehouses = useQuery({
    queryKey: placesKey(store.id),
    queryFn: () =>
      api<Location[]>(`/stock-locations?store_id=${store.id}`, token),
    enabled: store.permissions.includes("inventory:view"),
    retry: false,
  });
  const places = warehouses.status === "success" ? warehouses.data : undefined;
  const [written, setWritten] = useState("");
  // Why it was refused, brought to the finger: the keyboard put away to
  // read it, what was typed kept.
  const why = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (refusal !== null) why.current?.focus();
  }, [refusal]);
  const abroad = order.destination === "ABROAD";
  // Sent, the same waybill on another order: the warning stays.
  const sent = order.status !== "READY_TO_DISPATCH";
  useAskBeforeClosing(!sent && written.trim() !== "");
  function press(): void {
    if (sent) {
      close();
      return;
    }
    if (blocked) return;
    const typed = written.trim();
    hideKeyboard();
    send(
      typed
        ? abroad
          ? { abroad_note: typed }
          : { waybill: typed }
        : undefined,
    );
  }
  const words = sent ? "Готово" : "Відправлено";
  // Telegram's button stands where «Відправити» was: the second tap of the
  // press that opened the sheet is let go, as the sheet lets its own.
  const [openedAt] = useState(() => performance.now());
  const main = useMainButton(
    words,
    () => {
      if (performance.now() - openedAt >= CARRIED_TAP) press();
    },
    { progress: waiting && !sent, active: sent || !blocked },
  );
  return (
    <Sheet
      title="Відправити"
      // «Відправлено» on its way: no way out until it is answered, as
      // «Клієнт забрав» holds (audit 2026-11-13, orders-cash P2-3).
      close={() => {
        if (!(waiting && !sent)) close();
      }}
      held={waiting && !sent}
      said={meta}
      foot={
        main ? undefined : (
          <button
            type="button"
            className="sheet-done main-mimic"
            disabled={blocked && !sent}
            onClick={press}
          >
            {waiting && !sent ? (
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
      <p className="t-meta send-parcel" id={meta}>
        У посилці: {parcelLine(order, places)}
      </p>
      {refusal !== null && (
        <p role="alert" ref={why} tabIndex={-1}>
          {refusal}
        </p>
      )}
      <label className="send-field">
        {abroad ? "Куди і як відправили: місто, країна, спосіб" : "Номер ТТН"}{" "}
        (можна дописати пізніше)
        <input
          // In the same tap as the row's verb: the keyboard rises with the
          // sheet (spec §4.4, rule 5).
          autoFocus
          className={abroad ? undefined : "ttn"}
          value={written}
          maxLength={abroad ? 1000 : 64}
          readOnly={sent || blocked}
          autoComplete="off"
          enterKeyHint="done"
          aria-describedby={abroad ? hint : undefined}
          onChange={(event) => {
            setWritten(event.target.value);
          }}
          onKeyDown={(event) => {
            // Enter puts the keyboard away; «Відправлено» sends.
            if (event.key !== "Enter") return;
            event.preventDefault();
            hideKeyboard();
          }}
        />
        {abroad && <NoCustomerData id={hint} />}
      </label>
      {!abroad && order.carrier === "NOVA_POSHTA" && (
        <p className="t-meta send-note">
          Пишемо як є — з Новою поштою не звіряємо.
        </p>
      )}
      {sent && order.same_waybill && order.same_waybill.length > 0 && (
        // Saved anyway: several orders may go in one parcel (owner
        // decision, 2026-10-01). Which, on the card under it.
        <p className="notice same-waybill send-same" role="status">
          <Icon name="warning" size={16} />
          {order.same_waybill.length === 1
            ? "Ця ТТН є також у замовленні — перевірте, чи це один пакунок."
            : "Ця ТТН є також у замовленнях — перевірте, чи це один пакунок."}
        </p>
      )}
    </Sheet>
  );
}
