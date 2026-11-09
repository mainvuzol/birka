import type { JSX, ReactNode } from "react";
import { readText } from "./api";

/** What could not be read, and «Спробувати ще раз», over the rows read: a
 * warning's plate (spec §6.23), never a refusal's red — the one way a read
 * that failed is drawn; the lint holds every other (audit after stage 2,
 * frame P1-2; orders task list, P2-3). While the server does not answer,
 * only «Сервер не відповідає.»: the paper banner says the rest once (stage
 * 2, orders task list, P0-3); otherwise what it answered, in the screen's
 * words if it has them. Its retry the secondary button, never the screen's
 * main (frame P1-1). */
export function Unread({
  error,
  retry,
  said,
  held = false,
  children,
}: {
  error: unknown;
  retry: () => void;
  said?: (error: unknown) => string;
  /** Asked again and not answered yet: no second ask. */
  held?: boolean;
  /** What the screen must still say under the line — «Каса»'s close while
   * the server does not answer. */
  children?: ReactNode;
}): JSX.Element {
  return (
    <div className="notice read-failure" role="alert">
      <p>{readText(error, said)}</p>
      {children}
      <button type="button" disabled={held} onClick={retry}>
        Спробувати ще раз
      </button>
    </div>
  );
}
