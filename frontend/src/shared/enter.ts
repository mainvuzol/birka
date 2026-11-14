import type { KeyboardEvent } from "react";
import { hideKeyboard } from "./telegram";

/** The fields the cursor goes through, in the page's order: what the
 * phone's keyboard types into. */
const FIELDS = [
  'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="date"]):not([inputmode="none"]):not(:disabled):not([readonly])',
  "textarea:not(:disabled):not([readonly])",
].join(", ");

/**
 * Enter on a field no form sends, as its key is labelled (spec §6.3; audit
 * 2026-11-13, goods P2-3): «next» takes the cursor to the next field of its
 * sheet or screen; «done» — or no field after it — puts the keyboard away,
 * the cursor left on its sheet, where Escape still closes it (review).
 * Nothing is sent: a record is the MainButton's or the dock's.
 */
export function enterGoes(
  event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
): void {
  // A word still being composed takes its own Enter.
  if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
  event.preventDefault();
  const field = event.currentTarget;
  const sheet = field.closest<HTMLElement>('[role="dialog"]');
  // The attribute, not the property: an older WebView has no property.
  if (field.getAttribute("enterkeyhint") === "next") {
    const fields = [
      ...(sheet ?? document).querySelectorAll<HTMLElement>(FIELDS),
    ].filter((one) => one.getClientRects().length > 0);
    const after = fields[fields.indexOf(field) + 1];
    if (after) {
      after.focus();
      return;
    }
  }
  hideKeyboard();
  sheet?.focus({ preventScroll: true });
}
