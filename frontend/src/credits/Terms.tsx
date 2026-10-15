import { useEffect, useRef } from "react";
import type { JSX } from "react";
import { decimal, kopecks, money } from "@/orders/types";
import type { CreditTerms } from "@/sales/types";
import { phoneDigits } from "./types";

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

export function TermsFields({
  value,
  change,
  total,
  hint,
}: {
  value: TermsInput;
  change: (value: TermsInput) => void;
  /** What is being sold, to show what will be left owing. */
  total: bigint;
  hint: string;
}): JSX.Element {
  const paid = kopecks(value.paid);
  // Ticked, the cursor goes to the customer's name: one tap fewer with the
  // customer waiting (redesign P1-9).
  const nameRef = useRef<HTMLInputElement>(null);
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
              inputMode="tel"
              enterKeyHint="next"
              value={value.phone}
              maxLength={40}
              autoComplete="off"
              onChange={(event) => {
                change({ ...value, phone: event.target.value });
              }}
            />
          </label>
          <label>
            Сплачує зараз, грн
            <input
              inputMode="decimal"
              enterKeyHint="done"
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
