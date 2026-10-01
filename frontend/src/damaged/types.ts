/** `GET /damaged-units`: units a return put in the store's «Брак». */
export type DamagedStatus =
  "AWAITING" | "INSPECTING" | "CONFIRMED" | "RETURNED" | "WRITTEN_OFF";

export interface DamagedUnit {
  id: string;
  display_name: string;
  size: string | null;
  status: DamagedStatus;
  /** When the return put it in «Брак». */
  returned_at: string;
  /** Who last changed its status; while INSPECTING, who is looking. */
  status_by: string | null;
  status_at: string | null;
  /** Where it goes if it goes back on sale: where it was sold from. */
  sold_from_location_id: string;
  sold_from_location_name: string;
  /**
   * False for a unit handed back at a store that does not reach that
   * warehouse: it goes to one of this store's the person chooses.
   */
  back_to_sold_from: boolean;
  note: string | null;
}
