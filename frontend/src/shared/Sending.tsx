import { useEffect, useState } from "react";
import type { JSX } from "react";
import { Waiting } from "./Eyelet";

/** How long a press waits before the dock says it is still sending. */
export const STILL_SENDING = 3000;

/**
 * The dock while its press is sent (spec §6.5; «Усе на бірці» task list,
 * P0-2): past 3 s, «Ще надсилаємо…» over it, so a slow answer is never
 * taken for a press that did nothing. It stands over the dock, never
 * moving it. Where motion is reduced the
 * pressed button's ring stands still, and the words say it waits from the
 * start. Nothing at all while nothing is sent.
 */
export function SendingLine({ busy }: { busy: boolean }): JSX.Element | null {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!busy) {
      setLate(false);
      return;
    }
    const timer = setTimeout(() => {
      setLate(true);
    }, STILL_SENDING);
    return () => {
      clearTimeout(timer);
    };
  }, [busy]);
  if (!busy) return null;
  return (
    <p className="sending-line" role="status">
      {late ? (
        <span className="sending-words">Ще надсилаємо…</span>
      ) : (
        <Waiting />
      )}
    </p>
  );
}
