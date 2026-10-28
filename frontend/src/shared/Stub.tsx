import type { JSX, ReactNode } from "react";
import { Eyelet } from "./Eyelet";
import { Icon } from "./Icon";
import type { IconName } from "./icons";
import { isTillMethod, methodLabels } from "./payment";
import type { PaymentMethod, TillMethod } from "./payment";

/**
 * The stub «Корінець» (spec §1.4, §6.30; «Усе на бірці» task list, P0-2):
 * every write to the server is a slip on its tag, and its shape says what
 * became of it.
 * - kept: still attached by a dashed perforation, its eyelet dashed — the
 *   press was sent and its answer lost; the phone checks it by itself;
 * - recorded: torn off, its eyelet filled — the server recorded it once;
 * - settled: torn off, its eyelet knotted — nothing is left to check.
 * It tears as it comes, never holding the next tap; still where motion is
 * reduced.
 */
export type StubState = "kept" | "recorded" | "settled";

const eyelets = {
  kept: "dashed",
  recorded: "filled",
  settled: "knot",
} as const;

export function Stub({
  state,
  children,
}: {
  state: StubState;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className={`stub stub-${state}`}>
      <Eyelet state={eyelets[state]} />
      {children}
    </div>
  );
}

/** The perforation across a stub, between what was paid and the goods. */
export function Perforation(): JSX.Element {
  return <div className="perforation" aria-hidden="true" />;
}

const wayIcons: Record<TillMethod, IconName> = {
  CASH: "cash",
  CARD: "card",
  TRANSFER: "transfer",
};

/**
 * The way's sticker on a stub (spec §6.18, §6.30): its glyph and its word,
 * «Картка»; what to do with the money is the line under it. `hidden` where
 * a sentence says it all to a screen reader.
 */
export function WaySticker({
  way,
  hidden = false,
}: {
  way: PaymentMethod;
  hidden?: boolean;
}): JSX.Element {
  return (
    <span className="badge way-pill" aria-hidden={hidden || undefined}>
      {isTillMethod(way) && <Icon name={wayIcons[way]} size={16} />}
      {methodLabels[way]}
    </span>
  );
}
