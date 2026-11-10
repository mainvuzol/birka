import type { JSX } from "react";
import { Sticker } from "@/shared/Sticker";
import type { IconName } from "@/shared/icons";
import { buzz } from "@/shared/telegram";
import { statusLabels } from "./types";
import type { Order, Status } from "./types";

/**
 * Where a parcel is (spec §6.24, «the order string»; «Усе на бірці»
 * sections task list, P0-1, P0-2): to be sent, sent, at the post office,
 * collected — four places, each its colour. Cancelled and come back are
 * no place on the string: a sticker says them.
 */
export type Place = "send" | "sent" | "post" | "collected";

export const places: readonly Place[] = ["send", "sent", "post", "collected"];

export const placeWords: Record<Place, string> = {
  send: "До відправлення",
  sent: "Відправлено",
  post: "Прибув на пошту",
  collected: "Клієнт забрав",
};

/** Each place's colour (spec §4): to be sent waits on you, the two in
 * transit on the carrier and the customer, collected is paid. */
type Tone = "online" | "transit" | "paid" | "offline";

const placeTones: Record<Place, Tone> = {
  send: "online",
  sent: "transit",
  post: "transit",
  collected: "paid",
};

/** The place an open or collected order stands at. */
export const placeOf: Partial<Record<Status, Place>> = {
  READY_TO_DISPATCH: "send",
  DISPATCHED: "sent",
  ARRIVED: "post",
  COLLECTED: "collected",
};

/** «13.10»: a day by the phone's own calendar. */
export function dayOf(iso: string): string {
  const at = new Date(iso);
  return `${String(at.getDate()).padStart(2, "0")}.${String(at.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * The string as the list's filter (spec S16): a 44 button a place, its
 * count under its word once every open order is read — none for «Клієнт
 * забрав», which the server does not count — one chosen, felt as a
 * choice. A mode, never an action; drawn while the orders are read.
 */
export function KnotFilter({
  chosen,
  counts,
  choose,
}: {
  chosen: Place;
  /** None until every open order is read. */
  counts: Partial<Record<Place, number>> | null;
  choose: (place: Place) => void;
}): JSX.Element {
  return (
    <div className="knots knot-filter" role="group" aria-label="Замовлення">
      {places.map((place) => {
        const count = counts?.[place];
        return (
          <button
            key={place}
            type="button"
            className={`knot tone-${placeTones[place]}`}
            aria-pressed={place === chosen}
            onClick={() => {
              if (place === chosen) return;
              buzz("selection");
              choose(place);
            }}
          >
            <span className="knot-dot" aria-hidden="true" />
            <span className="knot-label">{placeWords[place]}</span>{" "}
            {/* Under the word, as the card's days: its line kept while it
                is not counted yet, so nothing moves when it is. */}
            <span className="knot-count">{count}</span>
          </button>
        );
      })}
    </div>
  );
}

/** How many places an order has passed, and the one it stands at: none
 * once it is cancelled or come back, which a sticker says. */
function standing(status: Status): { done: number; at: number | null } {
  switch (status) {
    case "READY_TO_DISPATCH":
      return { done: 0, at: 0 };
    case "DISPATCHED":
      return { done: 1, at: 1 };
    case "ARRIVED":
      return { done: 2, at: 2 };
    case "COLLECTED":
      return { done: 4, at: null };
    case "CANCELLED":
      return { done: 1, at: null };
    case "RETURNED":
      return { done: 2, at: null };
  }
}

/**
 * The string on an order's card (spec S17): the places passed filled in
 * their colours, the one it stands at a ring, those to come hollow; under
 * «До відправлення» the day it was ordered, under «Відправлено» the day of
 * its last sending. The server keeps no day for the other two. Collected,
 * its last knot tied; cancelled or come back, no place is its own, and a
 * sticker says which.
 */
export function KnotString({ order }: { order: Order }): JSX.Element {
  const { done, at } = standing(order.status);
  const sent = order.shipping_history
    ?.filter((change) => change.kind === "DISPATCHED")
    .at(-1)?.at;
  const days: Partial<Record<Place, string>> = {
    ...(order.created_at ? { send: dayOf(order.created_at) } : {}),
    // Sent: standing there or past it.
    ...(sent && (at === 1 || done >= 2) ? { sent: dayOf(sent) } : {}),
  };
  return (
    <>
      <ol className="knots knot-string">
        {places.map((place, index) => {
          const state =
            index < done ? "done" : index === at ? "current" : "future";
          return (
            <li
              key={place}
              className={`knot tone-${placeTones[place]} ${state}`}
              aria-current={state === "current" ? "step" : undefined}
            >
              <span className="knot-dot" aria-hidden="true">
                {state === "done" && place === "collected" && (
                  // Tied: nothing is left to do on it.
                  <svg
                    className="knot-loop"
                    viewBox="0 0 14 12"
                    focusable="false"
                  >
                    <path d="M1 6c3-5 9-5 9-1.5S5 9 5.5 6 10 2.5 13 6" />
                  </svg>
                )}
              </span>
              <span className="knot-label">{placeWords[place]}</span>
              {days[place] !== undefined && (
                <span className="knot-date">{days[place]}</span>
              )}
            </li>
          );
        })}
      </ol>
      {(order.status === "CANCELLED" || order.status === "RETURNED") && (
        <p className="knot-sticker">
          <StatusSticker status={order.status} />
        </p>
      )}
    </>
  );
}

const stickers: Record<Status, { tone: Tone; icon: IconName }> = {
  READY_TO_DISPATCH: { tone: "online", icon: "held" },
  DISPATCHED: { tone: "transit", icon: "sent" },
  ARRIVED: { tone: "transit", icon: "post-office" },
  COLLECTED: { tone: "paid", icon: "collected" },
  CANCELLED: { tone: "offline", icon: "close" },
  RETURNED: { tone: "offline", icon: "return" },
};

/** The colour of an order's status: its sticker's, and the eyelet of the
 * step that took it there (stage 2, orders task list, P1-3). */
export function toneOf(status: Status): Tone {
  return stickers[status].tone;
}

/**
 * An order's status as a printed sticker (spec §6.18): its glyph and its
 * word, on its colour's ground — «До відправлення» the waiting's violet
 * (the design's, 2026-10-27, over the yellow of 2026-10-23's В5 (а)), the
 * two in transit blue, collected green, cancelled and come back grey.
 */
export function StatusSticker({ status }: { status: Status }): JSX.Element {
  const { tone, icon } = stickers[status];
  return (
    <Sticker tone={tone} icon={icon}>
      {statusLabels[status]}
    </Sticker>
  );
}
