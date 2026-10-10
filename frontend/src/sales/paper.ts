import { create } from "zustand";

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
 * it is ticked on, and the person named carries across them.
 */
interface Paper {
  /** The store whose till is in paper mode; null when none is. */
  storeId: string | null;
  /** «Хто продав»: one of that store's sellers, or null for «Не вказано». */
  soldBy: string | null;
}

export const usePaper = create<Paper>(() => ({ storeId: null, soldBy: null }));

/** The switch, ticked or unticked: either way nobody is named yet. */
export function setPaper(storeId: string, on: boolean): void {
  usePaper.setState({ storeId: on ? storeId : null, soldBy: null });
}

/** «Хто продав», for the store whose till is in paper mode. */
export function setSoldBy(storeId: string, soldBy: string | null): void {
  if (usePaper.getState().storeId === storeId) usePaper.setState({ soldBy });
}

/** Another store chosen, or the app left: no series carries over. */
export function clearPaper(): void {
  usePaper.setState({ storeId: null, soldBy: null });
}

/** The phone's own date, today or yesterday: the paper's day (G1). */
export function paperDay(yesterday: boolean): string {
  const at = new Date();
  if (yesterday) at.setDate(at.getDate() - 1);
  return `${String(at.getFullYear())}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
}
