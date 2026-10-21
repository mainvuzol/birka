import type { JSX } from "react";
import { kopecks, money } from "@/orders/types";
import { methodLabels, notStated } from "@/shared/payment";
import { keptCashText } from "@/shared/reach";
import { directionOf, isPaymentMethod, movementLabels } from "./types";
import type { CashBody } from "./types";

/** How each kept command is called: in the heading and the button, in its
 * line, and stood for after («Двічі він не запишеться»). */
interface Name {
  heading: string;
  line: string;
  it: "він" | "вона" | "воно";
}

function nameOf(body: CashBody): Name {
  switch (body.command) {
    case "close":
      return { heading: "Підрахунок", line: "Підрахунок", it: "він" };
    case "reason":
      return { heading: "Причину", line: "Причина різниці", it: "вона" };
    case "movement":
      return directionOf(body.movement_kind) === "IN"
        ? { heading: "Внесення", line: "Внесення", it: "воно" }
        : { heading: "Видачу", line: "Видача", it: "вона" };
    case "correction":
      return {
        heading: "Зміну способу оплати",
        line: "Зміна способу оплати",
        it: "вона",
      };
  }
}

/** A sum as the attempt kept it, or null when it does not read. */
function sumOf(value: unknown): string | null {
  return typeof value === "string" && kopecks(value) !== null
    ? money(value)
    : null;
}

/** A way as the attempt kept it: «не вказано» for none, null when it does
 * not read. */
function wayOf(value: unknown): string | null {
  if (value === null) return notStated;
  return isPaymentMethod(value) ? methodLabels[value] : null;
}

/**
 * What the kept command is, from the attempt alone: «Підрахунок 2 000,00
 * грн», «Видача 150,00 грн · Витрати», «Зміна способу оплати: Картка →
 * Готівка». What does not read is left out, never guessed. Read back from
 * storage, whatever TypeScript was told.
 */
function whatOf(body: CashBody, name: Name): string {
  switch (body.command) {
    case "close": {
      const sum = sumOf(body.counted);
      return sum === null ? name.line : `${name.line} ${sum}`;
    }
    case "movement": {
      const sum = sumOf(body.amount);
      const kinds: Partial<Record<string, string>> = movementLabels;
      const kind =
        directionOf(body.movement_kind) === "OUT"
          ? kinds[body.movement_kind]
          : undefined;
      return [sum === null ? name.line : `${name.line} ${sum}`, kind]
        .filter(Boolean)
        .join(" · ");
    }
    case "correction": {
      const from = wayOf(body.from_method);
      const to = wayOf(body.to_method);
      return from === null || to === null
        ? name.line
        : `${name.line}: ${from} → ${to}`;
    }
    case "reason":
      return name.line;
  }
}

/**
 * A kept drawer command's banner (cash task list, P1-1): which command it
 * is and for how much — the count's own sum, the cash moved and what for,
 * the way from and to — as the attempt kept it, never a sum the server
 * worked out: nobody knows yet whether it was recorded, and a count's own
 * sum is not what the drawer should hold (G32). The phone checks it by
 * itself; nothing of the drawer is typed from paper (owner decision,
 * 2026-10-21, В2).
 */
export function Kept({
  body,
  since,
  busy,
  check,
}: {
  body: CashBody;
  since: string | undefined;
  busy: boolean;
  check: () => void;
}): JSX.Element {
  const name = nameOf(body);
  const lower = name.heading.charAt(0).toLowerCase() + name.heading.slice(1);
  return (
    <section className="notice">
      <h3>
        {busy ? `Перевіряємо ${lower}…` : `${name.heading} ще не підтверджено`}
      </h3>
      <p>
        {whatOf(body, name)} — сервер не відповів. Двічі {name.it} не
        запишеться. Поки чекаємо, інші дії недоступні.
      </p>
      <p>{keptCashText(since)}</p>
      <button disabled={busy} onClick={check}>
        Перевірити {lower}
      </button>
    </section>
  );
}
