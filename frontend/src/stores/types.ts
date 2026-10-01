import type { StoreState } from "@/orders/types";

/** `GET /stores`: every store of the network, for its owner only. */
export interface StoreChange {
  from_state: StoreState;
  to_state: StoreState;
  reason: string;
  by: string;
  at: string;
}

export interface StoreRecord {
  id: string;
  name: string;
  code: string;
  kind: "PRIMARY" | "SECONDARY";
  state: StoreState;
  state_since: string | null;
  /** Newest first. */
  changes: StoreChange[];
}

/**
 * What the journal keeps of a change. `store_id` is the journal's own — the
 * store the owner is working in — and `target_id` the store whose state
 * changes, which the path names.
 */
export interface StateBody {
  store_id: string;
  target_id: string;
  command_id: string;
  state: StoreState;
  reason: string;
}

/** What keeps a store from being archived (`NOT_EMPTY`). */
export type Leftover =
  | {
      kind: "STOCK" | "DAMAGED";
      location_id: string;
      name: string;
      units: number;
    }
  | { kind: "ORDERS"; count: number };

export const stateLabels: Record<StoreState, string> = {
  ACTIVE: "Працює",
  BLOCKED: "Заблоковано",
  ARCHIVED: "В архіві",
};
