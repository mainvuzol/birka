import { useEffect, useId, useRef, useState } from "react";
import type { JSX } from "react";
import { useQuery } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { api } from "@/shared/api";
import { visible } from "@/shared/visible";
import { NoCustomerData } from "@/shared/NoCustomerData";
import { Placeholder } from "@/shared/Placeholder";
import { CARRIED_TAP, usePanelRoom } from "@/shared/panel";
import { ScreenHeader } from "@/shared/ScreenHeader";
import { tagOf } from "./Orders";
import type { Location, Order, OrderItem, Store } from "./types";

/** The store's warehouses, read for an order coming back: what each is
 * called (orders task list, P2-4). */
export function placesKey(storeId: string): readonly unknown[] {
  return ["order-places", storeId];
}

/** The warehouses as last read, only while that read stood: one read again
 * and refused — the right to see them gone — names none (review,
 * 2026-10-25). */
export function placesRead(
  cache: QueryClient,
  storeId: string,
): Location[] | undefined {
  const read = cache.getQueryState<Location[]>(placesKey(storeId));
  return read?.status === "success" ? read.data : undefined;
}

/** An order's lines by the warehouse each left from, in the card's order:
 * the server puts each back there. */
export function byPlace(order: Order): [string, OrderItem[]][] {
  const places = new Map<string, OrderItem[]>();
  for (const item of order.items)
    places.set(item.source_location_id, [
      ...(places.get(item.source_location_id) ?? []),
      item,
    ]);
  return [...places];
}

/**
 * «Товар повернувся на склад», its own step (orders task list, P2-4): which
 * warehouse each coat goes back to, as the server puts it — the one it left
 * from — then the reason, never a customer's name, the units confirmed in
 * hand, and «Прийняти повернення» under the thumb. A warehouse not read is
 * said as before, unnamed.
 */
export function Returned({
  order,
  store,
  token,
  title,
  blocked,
  back,
  take,
}: {
  order: Order;
  store: Store;
  token: string;
  /** The order as its card's title says it. */
  title: string;
  blocked: boolean;
  /** «← Замовлення». */
  back: () => void;
  take: (body: Record<string, unknown>) => void;
}): JSX.Element {
  const hint = useId();
  const [reason, setReason] = useState("");
  const [received, setReceived] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  usePanelRoom(panel, true);
  // What comes back where is read first; the keyboard only once the reason
  // is tapped.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const places = useQuery({
    queryKey: placesKey(store.id),
    queryFn: () =>
      api<Location[]>(`/stock-locations?store_id=${store.id}`, token),
    retry: false,
  });
  const read = places.status === "success" ? places.data : [];
  const names = new Map(read.map((place) => [place.id, place.name]));
  // Named only where the server will take them: a warehouse paused, or one
  // that does not receive, refuses the return (review, 2026-10-25).
  const taking = new Set(
    read
      .filter((place) => place.is_active && place.can_receive)
      .map((place) => place.id),
  );
  const lines = byPlace(order);
  const named = lines.every(([id]) => taking.has(id));
  // Opened from the card's foot, the tick may stand where the row was
  // tapped: what is ticked says the goods are in hand, so a second tap
  // landing on it is let go (review, 2026-10-25).
  const [shownAt] = useState(() => performance.now());
  return (
    <>
      <ScreenHeader
        ref={heading}
        focusable
        title="Товар повернувся на склад"
        back={
          <button type="button" className="quiet" onClick={back}>
            ← Замовлення
          </button>
        }
      />
      <section className="order-returned">
        {places.isPending ? (
          <Placeholder
            said="Завантажуємо склади…"
            rows={lines.length}
            day={false}
          />
        ) : named ? (
          <ul className="returned-places" aria-label="Куди повернеться товар">
            {lines.map(([id, items]) => (
              <li key={id}>
                Повернеться на склад «{visible(names.get(id) ?? "")}»:{" "}
                {items.map((item) => tagOf(item)).join(", ")}
              </li>
            ))}
          </ul>
        ) : (
          <p>Товар повернеться на ті склади, звідки його відправили.</p>
        )}
        <fieldset disabled={blocked}>
          <legend>Фізичне повернення всього замовлення</legend>
          <label>
            Причина повернення
            <textarea
              maxLength={1000}
              value={reason}
              aria-describedby={hint}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
            <NoCustomerData id={hint} />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={received}
              onChange={(event) => {
                if (event.timeStamp - shownAt < CARRIED_TAP) return;
                setReceived(event.target.checked);
              }}
            />
            Усі товари фізично отримані на складах відправлення
          </label>
        </fieldset>
        <div className="pay-panel order-panel" ref={panel}>
          <p className="pay-what">{title}</p>
          <button
            type="button"
            disabled={blocked || !received || !reason.trim()}
            // Held until the reason and the tick: no tap carried from the
            // row can take it.
            onClick={() => {
              take({ reason: reason.trim(), physically_received: true });
            }}
          >
            Прийняти повернення
          </button>
        </div>
      </section>
    </>
  );
}
