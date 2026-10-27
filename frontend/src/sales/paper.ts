import { create } from "zustand";
import { backNoted, useReach } from "@/shared/reach";

/**
 * The till's paper mode, «Вношу продаж з паперу» (ADR-0013 §7; owner
 * decision, 2026-10-07): sales written on paper while the server did not
 * answer, typed in once it does, each marked «продано під час збою».
 *
 * The switch stays on for a series of paper sales, and «Хто продав» with it:
 * they live here, in memory, keyed by the store, so a tab change or the
 * till's remount after a kept sale settles keeps them. They are cleared when
 * the seller unticks the switch, when the store changes, and on reload —
 * nothing is on disk, so a reload partway through a series shows the band
 * gone before the next press. A wrong mark is permanent (§5.5), which is why
 * the mode and the name are on the very buttons that sell.
 *
 * The paper's time is not here: it is the till's own, cleared after each
 * sale, since a wrong time is permanent too.
 *
 * Since 2026-10-10 the same switch types returns and debt payments from
 * paper (owner decision; ADR-0021): one series per store, whichever screen
 * it is ticked on. Who is named is each screen's own — who sold, who took a
 * return, who took a payment — so a name chosen for one is never sent,
 * unseen, for another: a wrong mark is permanent.
 *
 * Since 2026-10-16 the series says once which paper it is (owner decision):
 * the first days', «з паперу», written while a warehouse waited for its
 * opening list, or an outage's, «під час збою». Nothing guesses it: until
 * it is said, nothing typed from paper is sent. The till's reminder that the
 * server is back says it is an outage's; it can still be changed.
 */
interface Paper {
  /** The store whose till is in paper mode; null when none is. */
  storeId: string | null;
  /** «Хто продав»: one of that store's sellers, or null for «Не вказано». */
  soldBy: string | null;
  /** «Хто прийняв» a return, and a debt payment: each screen's own. */
  takenBy: { refund: string | null; credit: string | null };
  /**
   * Which paper the series is: the first days' (true) or an outage's
   * (false); null until it is said.
   */
  firstDays: boolean | null;
  /**
   * Every tick and untick counted: the till's basket kept while it is left
   * learns from it that the switch moved meanwhile, however often
   * (navigation task list, P0-5; review, 2026-10-27). The store left clears
   * the basket itself (`forgetBasket`).
   */
  moved: number;
}

const nobody = { refund: null, credit: null };

export const usePaper = create<Paper>(() => ({
  storeId: null,
  soldBy: null,
  takenBy: nobody,
  firstDays: null,
  moved: 0,
}));

/**
 * The switch, ticked or unticked: either way nobody is named yet. Ticked on
 * any screen, it answers the till's reminder that the server is back
 * (redesign P1-7): the paper is being typed.
 */
export function setPaper(
  storeId: string,
  on: boolean,
  firstDays: boolean | null = null,
): void {
  if (on) backNoted();
  usePaper.setState((state) => ({
    storeId: on ? storeId : null,
    soldBy: null,
    takenBy: nobody,
    firstDays: on ? firstDays : null,
    moved: state.moved + 1,
  }));
}

/** Which paper the series is, said for the store in paper mode. */
export function setFirstDays(storeId: string, firstDays: boolean): void {
  if (usePaper.getState().storeId === storeId) usePaper.setState({ firstDays });
}

/**
 * The first days' paper may be dated any of the last 14 days, today among
 * them (owner decision, 2026-10-16: two weeks); the server holds the same
 * bound.
 */
export const firstDaysSpan = 14;

// The server back while the paper mode is on: the paper is being typed, so
// the till's reminder is answered already, and is not said once the switch
// is unticked (redesign P1-7).
useReach.subscribe((state, previous) => {
  if (state.back && !previous.back && usePaper.getState().storeId !== null)
    backNoted();
});

/** «Хто прийняв» on «Повернення» or in «Борги», for the store in paper mode. */
export function setTakenBy(
  storeId: string,
  kind: "refund" | "credit",
  takenBy: string | null,
): void {
  const state = usePaper.getState();
  if (state.storeId === storeId)
    usePaper.setState({ takenBy: { ...state.takenBy, [kind]: takenBy } });
}

/** «Хто продав», for the store whose till is in paper mode. */
export function setSoldBy(storeId: string, soldBy: string | null): void {
  if (usePaper.getState().storeId === storeId) usePaper.setState({ soldBy });
}

/** Another store chosen, or the app left: no series carries over. */
export function clearPaper(): void {
  usePaper.setState({
    storeId: null,
    soldBy: null,
    takenBy: nobody,
    firstDays: null,
  });
}

/** The phone's own date, today or yesterday: the paper's day (G1). */
export function paperDay(yesterday: boolean): string {
  return daysAgo(yesterday ? 1 : 0);
}

/** The phone's own date this many days ago, `YYYY-MM-DD`. */
export function daysAgo(days: number): string {
  const at = new Date();
  at.setDate(at.getDate() - days);
  return `${String(at.getFullYear())}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
}
