import type { JSX, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { ApiError, api } from "@/shared/api";
import { buzz } from "@/shared/telegram";
import { Unread } from "@/shared/Unread";
import { visible } from "@/shared/visible";
import { familyKind, familyLabel } from "./FamilySearch";
import type { Family } from "./FamilySearch";

/** The models a name was refused for (`CATALOG_AMBIGUOUS`'s
 * `candidate_family_ids`): none for any other refusal, or for a model the
 * catalogue no longer keeps active. */
export function forkedFamilies(error: unknown): string[] {
  return error instanceof ApiError &&
    error.code === "CATALOG_AMBIGUOUS" &&
    Array.isArray(error.details.candidate_family_ids)
    ? (error.details.candidate_family_ids as unknown[]).filter(
        (id): id is string => typeof id === "string",
      )
    : [];
}

/** Those models read by the name they were refused for, as the rename has
 * read them since its fork came (audit 2026-11-13, goods P2-5). */
export function useForkedFamilies(
  storeId: string,
  token: string,
  name: string,
  candidates: readonly string[],
): UseQueryResult<{ items: Family[] }> {
  return useQuery({
    queryKey: ["catalog-model-families", storeId, name, candidates],
    queryFn: () =>
      api<{ items: Family[] }>(
        `/catalog/families?store_id=${storeId}&query=${encodeURIComponent(
          name.trim(),
        )}&limit=50`,
        token,
      ),
    enabled: candidates.length > 0,
    retry: false,
  });
}

/**
 * A name some models have already, asked as a fork (ADR-0002: point at the
 * model, or declare another with what tells it apart): the question, said
 * to a reader as it comes but never drawn as a refusal; the models as rows,
 * each with «Це вона»; «Окрема модель зі схожою назвою» under them. Nothing
 * chosen beforehand, no plate and no circles. The rename's fork (audit
 * 2026-11-13, goods P2-5) and «Нова модель»'s (audit 2026-11-22, goods
 * P1-2): one fork, one look.
 */
export function NameFork({
  families,
  candidates,
  chosen,
  separate,
  disabled,
  choose,
  chooseSeparate,
  children,
}: {
  families: UseQueryResult<{ items: Family[] }>;
  candidates: readonly string[];
  /** The model «Це вона» was pressed for, while it stands chosen. */
  chosen: string | null;
  /** «Окрема модель зі схожою назвою» chosen. */
  separate: boolean;
  disabled?: boolean;
  choose: (family: Family) => void;
  chooseSeparate: () => void;
  /** What follows the other way: the rename's «Чим відрізняється модель». */
  children?: ReactNode;
}): JSX.Element {
  return (
    <>
      <section className="rename-fork">
        {/* Focusable, so a sheet whose own button the fork holds puts the
          cursor here rather than losing it (audit 2026-11-22, goods P1-2;
          review). */}
        <p className="new-model-ask" role="status" tabIndex={-1}>
          З такою назвою вже є модель. Це вона — чи окрема модель зі схожою
          назвою?
        </p>
        {families.isError && (
          <Unread
            error={families.error}
            retry={() => {
              void families.refetch();
            }}
          />
        )}
        {/* In the sheet, white already: rows 64 with no block (audit
          2026-11-15, goods P2-2). */}
        <ul className="new-model-candidates">
          {/* The models' places while they are read: never the other way
            alone in sight, the way to a double (audit 2026-11-22, goods
            P1-2; review). */}
          {families.isPending &&
            candidates.slice(0, 3).map((id) => (
              <li className="sale-row" key={id} aria-hidden="true">
                <span className="new-model-name">
                  <span className="skeleton skeleton-name" />
                </span>
                <span className="skeleton skeleton-choose" />
              </li>
            ))}
          {(families.data?.items ?? [])
            .filter((item) => candidates.includes(item.family_id))
            .map((item) => (
              <li className="sale-row" key={item.family_id}>
                {/* Its name, then what it is, then what tells it apart — as
                  «Схожі» and the proposal's rows say it; nothing of its
                  label lost, grouped (audit 2026-11-20, goods P2-3 (б)). */}
                <span className="new-model-name">
                  <strong>{visible(item.concept_name)}</strong>
                  {familyKind(item) && (
                    <span className="t-meta">{familyKind(item)}</span>
                  )}
                  {item.distinction_note && (
                    <span className="t-meta">
                      Відмінність моделі: {visible(item.distinction_note)}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  className="quiet"
                  aria-pressed={!separate && chosen === item.family_id}
                  aria-label={`Це вона: ${familyLabel(item)}`}
                  disabled={disabled}
                  onClick={() => {
                    // A choice changed, felt (spec §4.4; audit 2026-11-15,
                    // goods P2-3).
                    if (separate || chosen !== item.family_id)
                      buzz("selection");
                    choose(item);
                  }}
                >
                  Це вона
                </button>
              </li>
            ))}
        </ul>
        <button
          type="button"
          className="quiet"
          aria-pressed={separate}
          disabled={disabled}
          onClick={() => {
            if (!separate) buzz("selection");
            chooseSeparate();
          }}
        >
          Окрема модель зі схожою назвою
        </button>
        {children}
      </section>
      {/* Said to a reader alone while they are read, beside the fork, not in
        it: the fork says one thing, its question (review). */}
      {families.isPending && (
        <p role="status" className="visually-hidden">
          Завантажуємо моделі…
        </p>
      )}
    </>
  );
}
