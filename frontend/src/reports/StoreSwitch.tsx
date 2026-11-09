import type { JSX } from "react";
import { ModeSwitch } from "@/shared/ModeSwitch";
import { buzz } from "@/shared/telegram";
import { visible } from "@/shared/visible";
import type { StoreFigures } from "./types";

/**
 * Whose models, sales and returns are shown, for whoever reads two stores
 * or more (stage 2, money task list, P1-1): «Усі · «Центр» · «Ринок»» as a
 * switch that filters; four stores or more, a row of chips that scrolls
 * alone. One store: none. «Усі» is "" — no store asked.
 */
export function StoreSwitch({
  stores,
  current,
  choose,
}: {
  stores: readonly StoreFigures[];
  current: string;
  choose: (storeId: string) => void;
}): JSX.Element | null {
  if (stores.length < 2) return null;
  const modes = [
    { mode: "", label: "Усі" },
    ...stores.map((store) => ({
      mode: store.store_id,
      label: `«${visible(store.store_name)}»`,
    })),
  ];
  if (stores.length < 4)
    return (
      <ModeSwitch
        label="Магазин"
        modes={modes}
        current={current}
        choose={choose}
        disabled={false}
        filters
        className="report-stores"
      />
    );
  return (
    <div className="chips report-chips" role="group" aria-label="Магазин">
      {modes.map(({ mode, label }) => (
        <button
          type="button"
          className="chip"
          key={mode}
          aria-pressed={mode === current}
          onClick={() => {
            if (mode === current) return;
            // A choice, felt (spec §4.4).
            buzz("selection");
            choose(mode);
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
