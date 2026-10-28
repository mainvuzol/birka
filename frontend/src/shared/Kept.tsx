import type { JSX, ReactNode } from "react";
import { Banner } from "./Banner";
import { Eyelet, Waiting } from "./Eyelet";
import { noteChecked, secondsOf, useReach } from "./reach";
import { Stub } from "./Stub";

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
 */
export function Kept({
  own,
  title,
  busy,
  check,
  children,
}: {
  /** Its own screen is open. */
  own: boolean;
  title: string;
  busy: boolean;
  check: { label: string; run: () => void };
  children: ReactNode;
}): JSX.Element {
  const body = (
    <>
      <h3>{title}</h3>
      {children}
      <CheckLine busy={busy} />
      <button
        type="button"
        className={own ? "quiet" : undefined}
        disabled={busy}
        onClick={() => {
          noteChecked();
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
          <span className="badge warn">Ще не підтверджено</span>
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
