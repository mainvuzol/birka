import type { JSX } from "react";
import type { Backups } from "@/backups/types";
import { timeOf } from "@/cash/errors";
import { plural } from "@/openings/types";
import type { Store } from "@/orders/types";
import { listsWaiting, useDebts, useStockLists } from "@/today/reads";

/**
 * The lines under «Ще»'s rows (spec S07; «Усе на бірці» task list, P1-5):
 * what waits there, read as its screen reads it, its count the row's one
 * colour. Grey while read; unread, none — no number is made up (review,
 * 2026-10-26).
 */
function Reading(): JSX.Element {
  return (
    <span className="more-meta">
      <span className="skeleton skeleton-meta" aria-hidden="true" />
    </span>
  );
}

/** «4 людини винні», «1 людина винна», «5 людей винні». */
export function owingText(count: number): string {
  return `${String(count)} ${plural(count, "людина винна", "людини винні", "людей винні")}`;
}

/** «Покупці»: how many people owe the open store now, «Покупці»'s own read
 * (`GET /credits/summary`), in the debts' colour; never the network's. */
export function DebtsLine({
  store,
  token,
}: {
  store: Store;
  token: string;
}): JSX.Element | null {
  const debts = useDebts(token, [store]).get(store.id);
  if (debts === undefined || debts.isError) return null;
  if (debts.isPending) return <Reading />;
  const count = debts.data.customers;
  return count > 0 ? (
    <span className="more-meta">
      <span className="more-count owed">{owingText(count)}</span>
    </span>
  ) : (
    // As «Покупці» says «Зараз ніхто не винен».
    <span className="more-meta">ніхто не винен</span>
  );
}

/** The lists waiting on this person — to approve, to finish — and whether
 * more lists were left unread past the read's hundred. */
export type Awaiting =
  { approve: number; finish: number; more: boolean } | "reading" | null;

/** How many lists of existing stock wait on this person in the open store
 * (stage 2, admin task list, P0-1): ready, where they approve them
 * (`snapshot:approve`); not ready yet, where they make them
 * (`snapshot:import`) — a list of a warehouse two stores share waits in the
 * store that keeps it; null while none is known. */
export function useAwaitingApproval(
  store: Store,
  token: string,
  scopeKey: string,
): Awaiting {
  const lists = useStockLists(token, scopeKey, [store]).get(store.id);
  if (lists === undefined || lists.isError) return null;
  if (lists.isPending) return "reading";
  const waiting = listsWaiting(store, lists.data.items);
  return {
    approve: waiting.approve.length,
    finish: waiting.finish.length,
    more: lists.data.has_more,
  };
}

/** «1 на затвердження · 1 доробити»: «Початкові залишки»'s, and «Товар і
 * каталог»'s that holds it; «2+» when more lists were left unread (as
 * «Сьогодні»'s parcels say theirs); nothing while none is known to wait.
 * `then`, what follows it. */
export function ApprovalsLine({
  count,
  then,
}: {
  count: Awaiting;
  then?: string;
}): JSX.Element | null {
  if (count === "reading") return <Reading />;
  const more = count !== null && count.more ? "+" : "";
  const parts =
    count === null
      ? []
      : (
          [
            [count.approve, "на затвердження"],
            [count.finish, "доробити"],
          ] as const
        )
          .filter(([n]) => n > 0)
          .map(([n, what]) => `${String(n)}${more} ${what}`);
  if (parts.length === 0)
    return then === undefined ? null : (
      <span className="more-meta">{then}</span>
    );
  return (
    <span className="more-meta">
      {parts.map((part, at) => (
        <span key={part}>
          {at > 0 && " · "}
          <span className="more-count">{part}</span>
        </span>
      ))}
      {then !== undefined && ` · ${then}`}
    </span>
  );
}

/** «Резервні копії»: «в порядку, уночі о 03:15» — the last copy's end, by
 * this phone's clock — or a dot in the warning's colour and «потрібна ваша
 * увага», whenever the backups' screen has something to say: a copy
 * failed, late or not set up, or the server in trouble (owner decision,
 * 2026-10-03). */
export function BackupsLine({
  backups,
  needYou,
}: {
  backups: Backups | undefined;
  needYou: boolean;
}): JSX.Element | null {
  if (backups === undefined) return null;
  if (needYou)
    return (
      <span className="more-meta more-attention">
        <span className="attention-dot" aria-hidden="true" />
        потрібна ваша увага
      </span>
    );
  return (
    <span className="more-meta">
      {backups.latest
        ? `в порядку, уночі о ${timeOf(backups.latest.finished_at)}`
        : "в порядку"}
    </span>
  );
}
