import type { JSX, ReactNode } from "react";
import { Banner } from "./Banner";
import { Eyelet, Waiting } from "./Eyelet";
import { noteChecked, secondsOf, useReach } from "./reach";
import { Stub } from "./Stub";
import { Sticker } from "./Sticker";

/**
 * The phone checking what it keeps (spec S12; «Усе на бірці» task list,
 * P0-2): «Перевіряємо кожні 20 с · остання перевірка 11:42:20» while the
 * server does not answer, and with no last check before the first; the
 * ring turning while it is asked. With the server answering, the phone
 * does not check by itself, and nothing says it does: a check sent then
 * is the ring alone.
 */
export function CheckLine({ busy }: { busy: boolean }): JSX.Element | null {
  const { down, checked } = useReach();
  if (!down && !busy) return null;
  return (
    <p className="check-line">
      <Eyelet state={busy ? "spin" : "dashed"} />
      {down && (
        <span>
          Перевіряємо кожні 20 с
          {checked !== null && ` · остання перевірка ${secondsOf(checked)}`}
        </span>
      )}
      {busy && <Waiting />}
    </p>
  );
}

/**
 * A kept operation (spec S12, §6.23; P0-2): on its own screen, its stub
 * still attached, «Ще не підтверджено» on it; over any other, a banner. The
 * same words either way — which operation it was, what to do on paper — and
 * the button that sends the identical attempt again.
 *
 * One the phone never checks by itself — an invoice's, a return to a
 * supplier's (G11; stage 2, money task list, P0-6, В1 (а)) — says nothing of
 * checking every 20 s: its ring turns only while its check, pressed, is
 * asked, and the check is the stub's own button, not a quiet one.
 */
export function Kept({
  own,
  title,
  busy,
  check,
  byItself = true,
  children,
}: {
  /** Its own screen is open. */
  own: boolean;
  title: string;
  busy: boolean;
  check: { label: string; run: () => void };
  /** The phone checks it by itself while the server does not answer. */
  byItself?: boolean;
  children: ReactNode;
}): JSX.Element {
  const body = (
    <>
      <h3>{title}</h3>
      {children}
      {byItself ? (
        <CheckLine busy={busy} />
      ) : (
        busy && (
          <p className="check-line">
            <Eyelet state="spin" />
            <Waiting />
          </p>
        )
      )}
      <button
        type="button"
        className={own && byItself ? "quiet" : undefined}
        disabled={busy}
        onClick={() => {
          // «остання перевірка» is the phone's own checking's: a check
          // pressed on one it never checks by itself is not (review,
          // 2026-11-05).
          if (byItself) noteChecked();
          check.run();
        }}
      >
        {check.label}
      </button>
    </>
  );
  if (!own) return <Banner kind="kept">{body}</Banner>;
  return (
    <section className="notice stub-notice">
      <Stub state="kept">
        {/* A sticker, not a line: its words come first. */}
        <div className="stub-head">
          <Sticker tone="kept">Ще не підтверджено</Sticker>
        </div>
        {body}
      </Stub>
    </section>
  );
}

/**
 * A kept operation confirmed once (spec S12, recovered; P0-2): on its own
 * screen its stub tears off; over any other, a banner in the paid colours.
 */
export function Settled({
  own,
  children,
}: {
  own: boolean;
  children: ReactNode;
}): JSX.Element {
  if (!own)
    return (
      <Banner kind="recorded" role="status">
        {children}
      </Banner>
    );
  return (
    <section className="notice stub-notice" role="status">
      <Stub state="recorded">{children}</Stub>
    </section>
  );
}
