import { isId, journal } from "@/shared/journal";
import type { StateBody, StoreRecord } from "./types";

/**
 * One change of a store's state, written down before it is sent
 * (`@/shared/journal`).
 *
 * It carries a permanent `command_id`, so resending the identical attempt
 * returns what the first one did however late it arrives: a store blocked
 * once is never blocked again by a lost answer, even after it was unblocked
 * in between.
 */
const states = journal<StateBody, StoreRecord>({
  path: (body) => `/stores/${body.target_id}/state`,
  payload: (body) => ({
    command_id: body.command_id,
    state: body.state,
    reason: body.reason,
  }),
  scope: "store-state-pending",
  isBody: (body) =>
    isId(body.target_id) &&
    (body.state === "ACTIVE" ||
      body.state === "BLOCKED" ||
      body.state === "ARCHIVED") &&
    typeof body.reason === "string" &&
    body.reason.trim() !== "",
  corrupt: "Некоректна збережена зміна стану магазину. Зверніться до власника.",
  unfinished: "Спершу завершіть збережену зміну стану магазину.",
});

export const useStateCommand = states.use;
export const loadStateCommand = states.load;
export const submitStateCommand = states.submit;
export const resolveStateCommand = states.resolve;
