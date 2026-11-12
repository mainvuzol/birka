import type { JSX } from "react";
import { useQuery } from "@tanstack/react-query";
import { money } from "@/orders/types";
import { api } from "@/shared/api";
import { Placeholder } from "@/shared/Placeholder";
import { Unread } from "@/shared/Unread";
import { visible } from "@/shared/visible";
import { Empty } from "@/shared/Empty";
import { query } from "./format";
import type { Range } from "./format";
import type { ModelFigures, Models } from "./types";

/** «15 шт. · повернено 1 шт. на 1 850,00 грн»: what was sold of a model,
 * and what came back where some did. */
function metaOf(model: ModelFigures): string {
  return model.returned_units > 0
    ? `${String(model.units)} шт. · повернено ${String(model.returned_units)} шт. на ${money(model.returned)}`
    : `${String(model.units)} шт.`;
}

/**
 * «Моделі» of the report's days (stage 2, money task list, P1-1), on a
 * screen of their own: a row a model — its name, how many and what came
 * back, what it sold for on the right — of every store read, or of the one
 * chosen.
 */
export function ReportModels({
  token,
  scopeKey,
  range,
  storeId,
}: {
  token: string;
  scopeKey: string;
  range: Range | null;
  /** "" — every store read. */
  storeId: string;
}): JSX.Element {
  const models = useQuery({
    queryKey: ["sales-report-models", scopeKey, range, storeId],
    queryFn: () =>
      api<Models>(`/reports/sales/models${query(range, storeId)}`, token),
    retry: false,
  });
  if (models.isPending)
    return <Placeholder said="Рахуємо моделі…" rows={4} day={false} />;
  if (models.data === undefined)
    return (
      <Unread
        error={models.error}
        retry={() => {
          void models.refetch();
        }}
      />
    );
  if (models.data.models.length === 0)
    // Nothing in the period (spec §6.28; money task list after stage 2,
    // P2-2): the blank tag and its one line; the period is the line of
    // context's.
    return <Empty title="Нічого не продано." />;
  return (
    <>
      <ul className="report-rows" aria-label="Моделі">
        {models.data.models.map((model) => (
          <li key={model.product_variant_id} className="sale-row report-row">
            <span className="sale-main">
              <span className="t-row">{visible(model.display_name)}</span>
              <span className="sale-meta">{metaOf(model)}</span>
            </span>
            <span className="report-sum">{money(model.sold)}</span>
          </li>
        ))}
      </ul>
      {/* Read again and failed: the rows read stand, and it is said. */}
      {models.isError && (
        <Unread
          error={models.error}
          retry={() => {
            void models.refetch();
          }}
        />
      )}
    </>
  );
}
