import { useState } from "react";
import type { JSX } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, errorText } from "@/shared/api";

export interface Family {
  family_id: string;
  concept_name: string;
  source_name: string | null;
  business_category_name: string | null;
  garment_type_name: string | null;
  distinction_note: string | null;
}
export function familyLabel(family: Family): string {
  return [
    family.concept_name,
    family.source_name,
    family.business_category_name,
    family.garment_type_name,
    family.distinction_note,
  ]
    .filter(Boolean)
    .join(" — ");
}
export function FamilySearch({
  storeId,
  decisionId,
  token,
  scopeKey,
  blocked,
  choose,
}: {
  storeId: string;
  decisionId: string;
  token: string;
  scopeKey: string;
  blocked: boolean;
  choose: (family: Family) => void;
}): JSX.Element {
  const [text, setText] = useState("");
  const [search, setSearch] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const result = useQuery({
    queryKey: [
      "catalog-family-search",
      scopeKey,
      decisionId,
      storeId,
      search,
      offset,
    ],
    queryFn: () =>
      api<{ items: Family[]; has_more: boolean }>(
        `/catalog/families?store_id=${storeId}&query=${encodeURIComponent(search ?? "")}&limit=20&offset=${String(offset)}`,
        token,
      ),
    enabled: search !== null,
  });
  function find(): void {
    if (blocked) return;
    setOffset(0);
    setSearch(text.trim());
    if (search === text.trim() && offset === 0) void result.refetch();
  }
  return (
    <section aria-label="Пошук наявної моделі">
      <label>
        Пошук моделі в каталозі
        <input
          maxLength={200}
          value={text}
          disabled={blocked}
          onChange={(e) => {
            setText(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              find();
            }
          }}
        />
      </label>
      <button
        type="button"
        className="quiet"
        disabled={blocked || result.isFetching}
        onClick={find}
      >
        Знайти модель
      </button>
      <p className="hint">
        Пошук за назвою, джерелом або відмінністю. Порожній запит показує всі
        доступні моделі. Схожі назви не означають однаковий товар.
      </p>
      {search !== null &&
        (result.isPending ? (
          <p role="status">Шукаємо моделі…</p>
        ) : result.error ? (
          <div role="alert">
            <p>{errorText(result.error)}</p>
            <button
              type="button"
              disabled={blocked}
              onClick={() => {
                void result.refetch();
              }}
            >
              Повторити пошук
            </button>
          </div>
        ) : (
          <>
            {result.data.items.length === 0 && (
              <p>
                Моделей не знайдено. Спробуйте іншу назву або перевірте дані
                нової моделі.
              </p>
            )}
            {result.data.items.map((family) => (
              <button
                key={family.family_id}
                type="button"
                className="order-card catalog-card"
                disabled={blocked || result.isFetching}
                onClick={() => {
                  choose(family);
                }}
              >
                <strong>Обрати модель: {familyLabel(family)}</strong>
              </button>
            ))}
            <div className="toolbar">
              <button
                type="button"
                className="quiet"
                disabled={blocked || result.isFetching || offset === 0}
                onClick={() => {
                  setOffset(Math.max(0, offset - 20));
                }}
              >
                Попередні моделі
              </button>
              <button
                type="button"
                className="quiet"
                disabled={
                  blocked ||
                  result.isFetching ||
                  !result.data.has_more ||
                  offset >= 10000
                }
                onClick={() => {
                  setOffset(offset + 20);
                }}
              >
                Наступні моделі
              </button>
            </div>
          </>
        ))}
    </section>
  );
}
