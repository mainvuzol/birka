import { useId } from "react";
import type { JSX } from "react";
import { carrierLabels } from "./types";
import type { Carrier, Destination } from "./types";

const destinationLabels: Record<Destination, string> = {
  UKRAINE: "По Україні",
  ABROAD: "За кордон",
};

/**
 * Where an order goes (orders task list, P0-5): «По Україні» or «За кордон»
 * by a switch, within Ukraine unless said otherwise, and within Ukraine its
 * carrier by a chip, nothing chosen for the seller (owner decisions,
 * 2026-10-01). Abroad has no carrier: how it went is said when it is sent.
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
  const name = useId();
  return (
    <>
      <fieldset className="way-switch two" disabled={disabled}>
        <legend className="visually-hidden">Куди</legend>
        {(Object.keys(destinationLabels) as Destination[]).map((option) => (
          <label key={option}>
            <input
              type="radio"
              name={name}
              checked={destination === option}
              onChange={() => {
                change(option, option === "UKRAINE" ? carrier : "");
              }}
            />
            <span>{destinationLabels[option]}</span>
          </label>
        ))}
      </fieldset>
      {destination === "UKRAINE" && (
        <div className="chips carriers" role="group" aria-label="Перевізник">
          {(Object.keys(carrierLabels) as Carrier[]).map((key) => (
            <button
              type="button"
              className="chip"
              key={key}
              aria-pressed={carrier === key}
              disabled={disabled}
              onClick={() => {
                change("UKRAINE", key);
              }}
            >
              {carrierLabels[key]}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
