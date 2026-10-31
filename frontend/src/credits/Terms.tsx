import { useEffect, useId, useRef, useState } from "react";
import type { JSX, KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { decimal, kopecks, money } from "@/orders/types";
import { useSettled } from "@/sales/StockSearch";
import type { CreditTerms } from "@/sales/types";
import { api } from "@/shared/api";
import { hideKeyboard } from "@/shared/telegram";
import { visible } from "@/shared/visible";
import { phoneDigits, wholePhone } from "./types";
import type { CustomerPage } from "./types";

/**
 * Paying in parts, as the seller states it (owner decisions, 2026-10-01): the
 * customer takes the goods, pays part now and owes the rest to this store.
 * The till offers it, and so does collecting an order, by the same rules.
 */
export interface TermsInput {
  inParts: boolean;
  name: string;
  phone: string;
  paid: string;
}

export const noTerms: TermsInput = {
  inParts: false,
  name: "",
  phone: "",
  paid: "",
};

/** The customer's terms as the server takes them, or what is wrong with them. */
export function checkTerms(
  input: TermsInput,
  total: bigint,
): CreditTerms | string {
  const name = input.name.trim();
  const phone = input.phone.trim();
  const paid = kopecks(input.paid);
  if (name === "") return "Вкажіть ім’я покупця, який платить частинами.";
  if (phoneDigits(phone) < 10 || phoneDigits(phone) > 15)
    return "Телефон покупця має містити від 10 до 15 цифр.";
  if (paid === null || paid <= 0n)
    return "Вкажіть, скільки покупець сплачує зараз — більше нуля, з точністю до копійок.";
  if (paid >= total)
    return `Покупець сплачує все одразу (${money(decimal(total))}) — це звичайний продаж. Зніміть «Оплата частинами».`;
  return {
    customer_name: name,
    customer_phone: phone,
    paid_now: decimal(paid),
  };
}

/**
 * What this number already owes the store, or that a debt of it was written
 * off: one line under the phone, read as «Борги» reads it (owner decision,
 * 2026-10-18, В4 (а); credits task list, P1-5). It only tells — the seller
 * decides, nothing is refused; a read that fails says nothing, and the sale
 * goes on. Only for the number in the field, once it is whole.
 */
// A Ukrainian number written with what dials it from elsewhere — «+38»,
// «8», «0038» — is its own ten digits, as the server keys a customer
// (`customer_key`).
const ukrainian: [string, number][] = [
  ["380", 12],
  ["80", 11],
  ["00380", 14],
];

/** Whose number this is, as the server keys a customer. */
function numberKey(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  for (const [prefix, length] of ukrainian)
    if (digits.length === length && digits.startsWith(prefix))
      return digits.slice(length - 10);
  return digits;
}

/** «12.03.2026». */
function fullDay(at: number): string {
  return new Date(at).toLocaleDateString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function NumberDebt({
  id,
  storeId,
  token,
  phone,
}: {
  id: string;
  storeId: string;
  token: string;
  phone: string;
}): JSX.Element {
  const settled = useSettled(phone);
  const asked = wholePhone(settled) ? settled : null;
  const query = encodeURIComponent(asked ?? "");
  const read = useQuery({
    queryKey: ["credits", storeId, "number", asked],
    queryFn: () =>
      api<CustomerPage>(
        `/credits/customers?store_id=${storeId}&limit=5&query=${query}`,
        token,
      ),
    enabled: asked !== null,
    retry: false,
    // Never an answer kept from before — a sale in parts since may have
    // changed it: dropped once the line is gone (review, 2026-10-19).
    gcTime: 0,
  });
  // The same number among the stores that do not trade, whose payments
  // this store takes (owner decision, 2026-10-19): what is still owed there.
  const away = useQuery({
    queryKey: ["credits", storeId, "number", "elsewhere", asked],
    queryFn: () =>
      api<CustomerPage>(
        `/credits/customers?store_id=${storeId}&limit=5&status=OPEN&elsewhere=true&query=${query}`,
        token,
      ),
    enabled: asked !== null,
    retry: false,
    gcTime: 0,
  });
  // Said once both have answered, or failed, so the lines come together —
  // but this store's line never waits on the closed stores more than a
  // moment (review, 2026-10-20).
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    setWaited(false);
    if (asked === null) return;
    const moment = setTimeout(() => {
      setWaited(true);
    }, 1500);
    return () => {
      clearTimeout(moment);
    };
  }, [asked]);
  const current =
    asked !== null &&
    asked === phone.trim() &&
    !read.isPending &&
    (!away.isPending || waited);
  // That very number's customer, never one whose number merely holds the
  // digits typed, nor a name the words matched (review, 2026-10-19).
  const whose = (page: CustomerPage | undefined) =>
    current
      ? page?.items.find(
          (customer) => customer.phone_digits === numberKey(asked),
        )
      : undefined;
  const found = whose(read.data);
  const owed = found ? (kopecks(found.owed) ?? 0n) : 0n;
  const writtenOff = found?.credits
    .filter((credit) => credit.status === "WRITTEN_OFF" && credit.closed_at)
    .map((credit) => Date.parse(credit.closed_at ?? ""))
    .filter((at) => !Number.isNaN(at))
    .reduce<number | null>((latest, at) => Math.max(latest ?? at, at), null);
  const closed = whose(away.data);
  const owesAway = closed !== undefined && (kopecks(closed.owed) ?? 0n) > 0n;
  // Stores by who they are, not by name, and only where something is owed.
  const awayStores = [
    ...new Map(
      (closed?.credits ?? [])
        .filter((credit) => (kopecks(credit.owed) ?? 0n) > 0n)
        .map((credit) => [credit.store_id, visible(credit.store_name)]),
    ).values(),
  ];
  return (
    // Heard when it comes, and read with the phone. Its room is kept once
    // the number is whole, before the answer comes: nothing below it moves
    // under the finger (review, 2026-10-19) — but for a closed store's
    // debt beside this one's, rare, which comes as a second line.
    <p
      id={id}
      role="status"
      className={`hint number-debt${wholePhone(phone) ? " reserved" : ""}`}
    >
      {found && owed > 0n ? (
        <span className="owing">За номером уже винні {money(found.owed)}</span>
      ) : writtenOff !== null &&
        writtenOff !== undefined &&
        !away.isPending &&
        !owesAway ? (
        // What is owed, here or in a closed store, is said in place of a
        // debt written off here (owner decisions, 2026-10-19 and 2026-10-21):
        // so it waits for the closed stores' answer, or their failure, past
        // the moment this store's debt waits (review, 2026-10-21).
        <span>За номером борг списано {fullDay(writtenOff)}</span>
      ) : null}
      {closed && owesAway && (
        // One line, the sum first: a long name is cut, never the sum, and
        // nothing below moves (review, 2026-10-20).
        <span className="owing away">
          Винні {money(closed.owed)}{" "}
          {awayStores.length === 1
            ? `магазину «${awayStores[0] ?? ""}»`
            : "магазинам, що не працюють"}
        </span>
      )}
    </p>
  );
}

export function TermsFields({
  value,
  change,
  total,
  hint,
  storeId,
  token,
  done,
}: {
  value: TermsInput;
  change: (value: TermsInput) => void;
  /** What is being sold, to show what will be left owing. */
  total: bigint;
  hint: string;
  /** The keyboard's «Готово» after the sum: the till's sheet closes, its
   * tray's ways under the thumb (P0-5). */
  done?: () => void;
  /** The store the debt is owed to, and who asks what its number owes. */
  storeId: string;
  token: string;
}): JSX.Element {
  const paid = kopecks(value.paid);
  const numberDebt = useId();
  // Ticked, the cursor goes to the customer's name: one tap fewer with the
  // customer waiting (redesign P1-9).
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const paidRef = useRef<HTMLInputElement>(null);
  // The keyboard's action key moves on, and closes after the sum.
  const onEnter =
    (next: HTMLInputElement | null) =>
    (event: KeyboardEvent<HTMLInputElement>): void => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      if (next) next.focus();
      else {
        // The sum confirmed: the keyboard goes (spec §4.4; «Усе на бірці»
        // task list, P1-2).
        hideKeyboard();
        event.currentTarget.blur();
        done?.();
      }
    };
  const wasInParts = useRef(value.inParts);
  useEffect(() => {
    if (value.inParts && !wasInParts.current) nameRef.current?.focus();
    wasInParts.current = value.inParts;
  }, [value.inParts]);
  return (
    <>
      <label className="check">
        <input
          type="checkbox"
          checked={value.inParts}
          onChange={(event) => {
            change({ ...value, inParts: event.target.checked });
          }}
        />
        Оплата частинами
      </label>
      {value.inParts && (
        <div className="section-block">
          <p className="hint">{hint}</p>
          <label>
            Ім’я покупця
            <input
              ref={nameRef}
              enterKeyHint="next"
              onKeyDown={(event) => {
                onEnter(phoneRef.current)(event);
              }}
              value={value.name}
              maxLength={200}
              autoComplete="off"
              onChange={(event) => {
                change({ ...value, name: event.target.value });
              }}
            />
          </label>
          <label>
            Телефон покупця
            <input
              type="tel"
              ref={phoneRef}
              aria-describedby={numberDebt}
              inputMode="tel"
              enterKeyHint="next"
              onKeyDown={(event) => {
                onEnter(paidRef.current)(event);
              }}
              value={value.phone}
              maxLength={40}
              autoComplete="off"
              onChange={(event) => {
                change({ ...value, phone: event.target.value });
              }}
            />
          </label>
          <NumberDebt
            id={numberDebt}
            storeId={storeId}
            token={token}
            phone={value.phone}
          />
          <label>
            Сплачує зараз, грн
            <input
              ref={paidRef}
              inputMode="decimal"
              enterKeyHint="done"
              onKeyDown={(event) => {
                onEnter(null)(event);
              }}
              placeholder="0,00"
              value={value.paid}
              onChange={(event) => {
                change({ ...value, paid: event.target.value });
              }}
            />
          </label>
          {paid !== null && paid > 0n && paid < total && (
            <p>
              Лишиться винен <strong>{money(decimal(total - paid))}</strong>
            </p>
          )}
        </div>
      )}
    </>
  );
}
