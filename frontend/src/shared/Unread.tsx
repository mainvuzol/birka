import type { JSX } from "react";
import { readText } from "./api";

/** What could not be read, and «Спробувати ще раз», over the rows read: a
 * warning's plate, as «Каса»'s, never a debt's red (orders task list,
 * P2-3). While the server does not answer, only «Сервер не відповідає.»:
 * the paper banner says the rest once (stage 2, orders task list, P0-3);
 * otherwise what it answered, in the screen's words if it has them. */
export function Unread({
  error,
  retry,
  said,
}: {
  error: unknown;
  retry: () => void;
  said?: (error: unknown) => string;
}): JSX.Element {
  return (
    <div className="notice read-failure" role="alert">
      <p>{readText(error, said)}</p>
      <button type="button" onClick={retry}>
        Спробувати ще раз
      </button>
    </div>
  );
}
