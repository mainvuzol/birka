import type { KeyboardEvent } from "react";

/** Which way each arrow goes through a group of radios. */
const steps: Partial<Record<string, number>> = {
  ArrowDown: 1,
  ArrowRight: 1,
  ArrowUp: -1,
  ArrowLeft: -1,
};

/**
 * The arrows in a group of radios drawn as buttons, as a phone's own radios
 * take them (WAI-ARIA radio group): down or right to the next, up or left
 * to the one before, round the ends; the one reached is focused and chosen.
 * Those taking no tap are passed over (audit 2026-11-15, money P2-6 (а)).
 * Only where a choice stays in place: a list whose pick closes it would
 * close on the first arrow.
 */
export function radioArrows(event: KeyboardEvent<HTMLElement>): void {
  const step = steps[event.key];
  // An arrow with a modifier is the browser's or the reader's own.
  if (
    step === undefined ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  )
    return;
  const radios = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      '[role="radio"]:not(:disabled)',
    ),
  );
  const at = radios.findIndex((radio) => radio === document.activeElement);
  if (at < 0) return;
  event.preventDefault();
  const next = radios[(at + step + radios.length) % radios.length];
  next?.focus();
  next?.click();
}
