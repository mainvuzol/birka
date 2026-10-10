import { useState } from "react";
import type { JSX } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, errorText } from "@/shared/api";
import { visible } from "@/shared/visible";
import type { Store } from "@/orders/types";
import { paperDay, setPaper, setSoldBy, usePaper } from "./paper";

/**
 * A return or a debt payment typed from paper (owner decision, 2026-10-10;
 * ADR-0021): the mark «під час збою», as a sale's. It may name who took it
 * and at what hour, as the paper says; both optional. The switch is the
 * till's (`./paper`): one series per store, whichever screen it is ticked
 * on, and the person named carries across; the paper's time is each
 * operation's own.
 */

/** The mark as a return's or a payment's request carries it. */
export interface PaperBody {
  by_user_id: string | null;
  at: string | null;
}

/** The mark as the server answers it: who took it, by name too. */
export interface PaperView {
  by_user_id: string | null;
  by: string | null;
  at: string | null;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A kept command's mark, read back from the phone's storage. */
export function isPaperBody(value: unknown): value is PaperBody {
  if (typeof value !== "object" || value === null) return false;
  const keys = Object.keys(value);
  if (keys.some((name) => name !== "by_user_id" && name !== "at")) return false;
  const { by_user_id: by, at } = value as Record<string, unknown>;
  return (
    (by === undefined ||
      by === null ||
      (typeof by === "string" && uuid.test(by))) &&
    (at === undefined ||
      at === null ||
      (typeof at === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at)))
  );
}

/**
 * «Повернено під час збою · хто прийняв: Ганна · за папером 06.10, 19:40»,
 * by the phone's own clock. What the paper did not name is left out.
 */
export function paperText(kind: "return" | "payment", mark: PaperView): string {
  const parts = [
    kind === "return" ? "Повернено під час збою" : "Внесок під час збою",
  ];
  if (mark.by !== null) parts.push(`хто прийняв: ${visible(mark.by)}`);
  if (mark.at !== null && !Number.isNaN(Date.parse(mark.at))) {
    const at = new Date(mark.at);
    parts.push(
      `за папером ${at.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" })}, ${at.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}`,
    );
  }
  return parts.join(" · ");
}

/** Why a mark was refused, after the command was looked up: nothing was
 * recorded, and the seller fixes the mark and sends it again. */
export function paperRefusal(reason: unknown): string | null {
  switch (reason) {
    case "OUTAGE_SELLER_UNKNOWN":
      return "Ця людина не може приймати це в цьому магазині. Оберіть іншу або залиште «не вказано».";
    case "OUTAGE_TIME_FUTURE":
      return "Цей час ще не настав. Перевірте час і день з паперу.";
    case "OUTAGE_TIME_TOO_OLD":
      return "Час з паперу можна вказати лише за сьогодні або вчора. Для давнішого залиште час порожнім.";
    default:
      return null;
  }
}

/** The paper mode of a return's or a payment's screen. */
export function usePaperMark(
  store: Store,
  token: string,
  journalKey: string,
  namedFor: "refund" | "credit",
) {
  const paper = usePaper((state) => state.storeId === store.id);
  const takenBy = usePaper((state) =>
    state.storeId === store.id ? state.soldBy : null,
  );
  const [time, setTime] = useState("");
  const [yesterday, setYesterday] = useState(false);
  // Who may be named: read only while the switch is on. Only someone this
  // list shows is ever sent, as at the till.
  const people = useQuery({
    queryKey: ["paper-people", namedFor, journalKey, store.id],
    queryFn: () =>
      api<{ sellers: { user_id: string; display_name: string }[] }>(
        `/stores/${store.id}/sellers?for=${namedFor}`,
        token,
      ),
    enabled: paper,
    retry: false,
  });
  const named =
    takenBy === null
      ? undefined
      : people.data?.sellers.find((person) => person.user_id === takenBy);
  return {
    paper,
    named,
    people,
    time,
    yesterday,
    turn(on: boolean): void {
      setPaper(store.id, on);
      setTime("");
      setYesterday(false);
    },
    name(userId: string | null): void {
      setSoldBy(store.id, userId);
    },
    setTime(value: string): void {
      setTime(value);
      if (!value) setYesterday(false);
    },
    setYesterday,
    /** The mark to send, or null when typed live. */
    body(): PaperBody | null {
      if (!paper) return null;
      const at = /^\d{2}:\d{2}/.exec(time)?.[0];
      return {
        by_user_id: named?.user_id ?? null,
        at: at ? `${paperDay(yesterday)}T${at}` : null,
      };
    },
    /** After each one sent: the next line of paper has its own time. */
    forgetTime(): void {
      setTime("");
      setYesterday(false);
    },
  };
}

export type PaperMarkState = ReturnType<typeof usePaperMark>;

/** The switch and, while it is on, what the paper names. */
export function PaperFields({
  mark,
  what,
}: {
  mark: PaperMarkState;
  what: "return" | "payment";
}): JSX.Element {
  return (
    <>
      <label className="check">
        <input
          type="checkbox"
          checked={mark.paper}
          onChange={(event) => {
            mark.turn(event.target.checked);
          }}
        />
        {what === "return"
          ? "Вношу повернення з паперу"
          : "Вношу внесок з паперу"}
      </label>
      {mark.paper && (
        <section className="notice" aria-label="Режим: з паперу">
          <h3>Режим: з паперу</h3>
          <p>
            {what === "return"
              ? "Повернення позначать «під час збою». Воно увійде в сьогоднішній «Звіт» і в касу до наступного закриття. Гроші вже віддали — вдруге не віддавайте."
              : "Внесок позначать «під час збою». Він увійде в касу до наступного закриття. Гроші вже взяли — на терміналі нічого не проводьте."}
          </p>
          <label>
            Хто прийняв
            <select
              value={mark.named?.user_id ?? ""}
              onChange={(event) => {
                mark.name(event.target.value || null);
              }}
            >
              <option value="">Не вказано</option>
              {(mark.people.data?.sellers ?? []).map((person) => (
                <option key={person.user_id} value={person.user_id}>
                  {visible(person.display_name)}
                </option>
              ))}
            </select>
          </label>
          {mark.people.error && (
            <p role="alert">
              {errorText(mark.people.error)}{" "}
              <button
                className="quiet"
                onClick={() => {
                  void mark.people.refetch();
                }}
              >
                Спробувати ще раз
              </button>
            </p>
          )}
          <div className="fields">
            <label>
              Час з паперу
              <input
                type="time"
                value={mark.time}
                onChange={(event) => {
                  mark.setTime(event.target.value);
                }}
              />
            </label>
            {mark.time && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={mark.yesterday}
                  onChange={(event) => {
                    mark.setYesterday(event.target.checked);
                  }}
                />
                Це було вчора
              </label>
            )}
          </div>
        </section>
      )}
    </>
  );
}
