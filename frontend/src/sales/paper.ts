import { create } from "zustand";
import { backNoted } from "@/shared/reach";

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
 */
interface Paper {
  /** The store whose till is in paper mode; null when none is. */
  storeId: string | null;
  /** «Хто продав»: one of that store's sellers, or null for «Не вказано». */
  soldBy: string | null;
  /** «Хто прийняв» a return, and a debt payment: each screen's own. */
  takenBy: { refund: string | null; credit: string | null };
}

const nobody = { refund: null, credit: null };

export const usePaper = create<Paper>(() => ({
  storeId: null,
  soldBy: null,
  takenBy: nobody,
}));

/**
 * The switch, ticked or unticked: either way nobody is named yet. Ticked on
 * any screen, it answers the till's reminder that the server is back
 * (redesign P1-7): the paper is being typed.
 */
export function setPaper(storeId: string, on: boolean): void {
  if (on) backNoted();
  usePaper.setState({
    storeId: on ? storeId : null,
    soldBy: null,
    takenBy: nobody,
  });
}

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
  usePaper.setState({ storeId: null, soldBy: null, takenBy: nobody });
}

/** The phone's own date, today or yesterday: the paper's day (G1). */
export function paperDay(yesterday: boolean): string {
  const at = new Date();
  if (yesterday) at.setDate(at.getDate() - 1);
  return `${String(at.getFullYear())}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
}
