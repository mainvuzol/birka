import { create } from "zustand";

/**
 * Whether the server refused this phone's token — a 401 to a request sent
 * with it, of any code but `NO_ACCESS`, which is S03's own: the session
 * ended, mid-work or at the door (audit 2026-11-15, frame P1-1).
 *
 * A refused token is never replaced by the launch data (owner decision,
 * 2026-10-03), so asking again with it is refused again: the app shows one
 * screen in S02's words, with nothing to press, and asks nothing more with
 * that token. Only in memory: opening the app again from the bot signs in
 * anew, and the phone checks what it keeps then.
 */
export const useSessionEnd = create<{ ended: boolean }>(() => ({
  ended: false,
}));

/** The server refused the token: the session is over from now. */
export function noteSessionEnded(): void {
  if (!useSessionEnd.getState().ended) useSessionEnd.setState({ ended: true });
}
