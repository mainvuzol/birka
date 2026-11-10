import type { JSX } from "react";
import { Eyelet } from "@/shared/Eyelet";

/**
 * What «Каса» just recorded, said as an order's step says it (spec §2 P3;
 * orders and «Каса» task list after stage 2, P1-3): a line with its eyelet
 * filled in ink — money out of the drawer reads as a line of the notebook
 * signed, never as a hint. «… записано один раз» is the same line. Its
 * words are the record's own; it goes with the next action, as before.
 */
export function DoneLine({
  text,
}: {
  text: string | null;
}): JSX.Element | null {
  if (!text) return null;
  return (
    <p role="status" className="step-done tone-ink">
      <Eyelet state="filled" />
      {text}
    </p>
  );
}
