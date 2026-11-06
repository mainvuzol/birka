import type { JSX } from "react";
import { buzz } from "@/shared/telegram";
import { carrierLabels } from "./types";
import type { Carrier, Destination } from "./types";

type Way = Carrier | "ABROAD";

const wayLabels: Record<Way, string> = {
  ...carrierLabels,
  ABROAD: "За кордон",
};

/**
 * Where an order goes (stage 2, orders task list, P0-5, P1-1): one row of
 * deciding chips — «Нова пошта · Укрпошта · Міст · За кордон» — nothing
 * chosen for the seller (owner decisions, 2026-10-01; В-ЗП3 (а)). Within
 * Ukraine its carrier; abroad has none: how it went is said when it is
 * sent.
 */
export function WhereTo({
  destination,
  carrier,
  change,
  disabled,
}: {
  destination: Destination;
  carrier: Carrier | "";
  change: (destination: Destination, carrier: Carrier | "") => void;
  disabled: boolean;
}): JSX.Element {
  const chosen: Way | "" = destination === "ABROAD" ? "ABROAD" : carrier;
  return (
    <div className="chips where-to" role="group" aria-label="Куди">
      {(Object.keys(wayLabels) as Way[]).map((way) => (
        <button
          type="button"
          className="chip"
          key={way}
          aria-pressed={chosen === way}
          disabled={disabled}
          onClick={() => {
            if (chosen !== way) buzz("selection");
            if (way === "ABROAD") change("ABROAD", "");
            else change("UKRAINE", way);
          }}
        >
          {wayLabels[way]}
        </button>
      ))}
    </div>
  );
}
