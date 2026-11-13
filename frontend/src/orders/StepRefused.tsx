import { useEffect, useRef } from "react";
import type { JSX } from "react";
import type { StepRefusal } from "./types";

/** The last refusal the cursor was brought to: one drawn again — its row
 * moved on, its card read anew — is not brought again, nothing scrolled
 * (review, 2026-11-13). */
let brought = 0;

/**
 * An order's step refused where it was pressed (audit 2026-11-13, orders
 * P1-1): under its tag, at its card's foot, under the return's tick — why,
 * in its own words, the cursor on it. Already in sight, the screen is not
 * scrolled to it: nothing above it moves under the finger.
 */
export function StepRefused({
  refusal,
}: {
  refusal: StepRefusal;
}): JSX.Element {
  const plate = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const node = plate.current;
    if (!node) return;
    const again = refusal.times <= brought;
    // Drawn again with the cursor lost with its old place: back on it, the
    // screen where it is.
    const lost =
      document.activeElement === null ||
      document.activeElement === document.body;
    if (again && !lost) return;
    const box = node.getBoundingClientRect();
    const seen = box.top >= 0 && box.bottom <= window.innerHeight;
    node.focus({ preventScroll: again || seen });
    if (document.activeElement === node)
      brought = Math.max(brought, refusal.times);
  }, [refusal.times]);
  return (
    <p role="alert" ref={plate} tabIndex={-1} className="step-refused">
      {refusal.text}
    </p>
  );
}
