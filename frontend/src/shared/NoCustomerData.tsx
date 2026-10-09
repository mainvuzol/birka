import type { JSX } from "react";

/** What a field where people explain something says under it. */
export const noCustomerData = "Без імен і телефонів покупців.";

/**
 * Under a field about a customer's purchase where people explain something:
 * a return's reason, a write-off's, a drawer's difference (owner decision,
 * 2026-10-09; ADR-0015). A customer's name and phone are kept only on their
 * debt, and erased from it in time; written here, they would stay.
 *
 * Inside the field's label, after the field, which names this `id` in its
 * `aria-describedby`: it describes the field and is left out of its name.
 */
export function NoCustomerData({ id }: { id: string }): JSX.Element {
  return (
    <span className="hint" id={id} aria-hidden="true">
      {noCustomerData}
    </span>
  );
}
