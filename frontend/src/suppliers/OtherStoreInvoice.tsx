import type { JSX } from "react";
import { Banner } from "@/shared/Banner";
import { visible } from "@/shared/visible";
import type { Invoice } from "./types";

/**
 * Another store's invoice, open at a store that trades (the card and its
 * payment alike): whose it is and in what state, then who pays and whose
 * the debt stays — the closed store's debt's own form (audit 2026-11-23,
 * money P2-2). «Ви»: only whoever holds `supplier:debt` at a trading store
 * opens it. Over «Винні» on the card; on the payment, under what is owed,
 * last over the keypad (audit 2026-11-28, money P2-1).
 */
export function OtherStoreInvoice({
  invoice,
}: {
  invoice: Pick<Invoice, "store_name" | "store_state">;
}): JSX.Element {
  const name = visible(invoice.store_name);
  return (
    <Banner kind="blocked" as="div">
      <p>
        Накладна магазину «{name}» (
        {invoice.store_state === "ARCHIVED" ? "закрито" : "заблоковано"}).
        Сплачуєте ви, борг — за «{name}».
      </p>
    </Banner>
  );
}
