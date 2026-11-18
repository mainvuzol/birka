import { createContext, useContext, useLayoutEffect, useState } from "react";
import type { JSX, ReactNode } from "react";
import { createPortal } from "react-dom";
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
 * Where a kept operation's stub stands on its own screen: under the
 * screen's title and line (spec S12; audit 2026-11-15, frame P2-9), the
 * place the screen's header gave (`UnderHeaderContext`). None — the screen
 * draws no header — it stands where it is drawn, over the screen, as
 * before. Given to the journals' stubs the app draws; a screen's own stubs
 * stand where the screen draws them — «Моделі»'s and «Перевірка
 * каталогу»'s right under its header too (audit 2026-11-18, goods P2-1).
 */
export const StubPlaceContext = createContext<HTMLElement | null>(null);

/**
 * A stub on its own screen, in its place. It moves as it comes there, as
 * before: drawn again elsewhere on its screens — under another header, a
 * list's row's card opened, «←»; over a result — it keeps still (audit
 * 2026-11-15, frame P2-9; decided here). Told by where it first stood, not
 * by time (review).
 */
function OwnStub({
  state,
  role,
  children,
}: {
  state: "kept" | "recorded";
  role?: "status";
  children: ReactNode;
}): JSX.Element {
  const place = useContext(StubPlaceContext);
  // The first place it stood in under a header.
  const [first, setFirst] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (first === null && place !== null) setFirst(place);
  }, [first, place]);
  const stub = (
    <section className="notice stub-notice" role={role}>
      <Stub state={state} still={first !== null && first !== place}>
        {children}
      </Stub>
    </section>
  );
  return place === null ? stub : createPortal(stub, place);
}

/**
 * What is said of a kept operation besides its stub — a server's answer
 * that settles nothing yet — stands under its stub, where the stub stands
 * on its own screen (audit 2026-11-15, frame P2-9; review); over any other
 * screen, or once the operation is no longer kept, it stays over the
 * screen, as every plate.
 */
export function UnderStub({
  on,
  children,
}: {
  /** Kept, and on its own screen. */
  on: boolean;
  children: ReactNode;
}): JSX.Element {
  const place = useContext(StubPlaceContext);
  return on && place !== null ? createPortal(children, place) : <>{children}</>;
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
  after,
}: {
  /** Its own screen is open. */
  own: boolean;
  title: string;
  busy: boolean;
  check: { label: string; run: () => void };
  /** The phone checks it by itself while the server does not answer. */
  byItself?: boolean;
  children: ReactNode;
  /** What else may be done with it, under its check: an unfinished
   * creation's cancelling (goods task list after stage 2, P1-4). */
  after?: ReactNode;
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
      {after}
    </>
  );
  if (!own) return <Banner kind="kept">{body}</Banner>;
  return (
    <OwnStub state="kept">
      {/* A sticker, not a line: its words come first. */}
      <div className="stub-head">
        <Sticker tone="kept">Ще не підтверджено</Sticker>
      </div>
      {body}
    </OwnStub>
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
    <OwnStub state="recorded" role="status">
      {children}
    </OwnStub>
  );
}
