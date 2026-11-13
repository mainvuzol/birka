import type { JSX } from "react";
import { money } from "@/orders/types";
import { Icon } from "./Icon";

/**
 * What is still owed after a payment, a sale in parts or a return (spec §4,
 * a meaning's colour always with its twin; S10, S22 №7; audit 2026-11-13,
 * sale P2-3): the sum in the debt's colour, its minus arrow before it, as a
 * list's row says it. The rest of the line as it was; the words wait for the
 * owner (В13-П2).
 */
export function OwedSum({ value }: { value: string }): JSX.Element {
  return (
    <span className="owed-left">
      <Icon name="owed" size={16} />
      {money(value)}
    </span>
  );
}
