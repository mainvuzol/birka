import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { api } from "@/shared/api";
import { useNextPageFailed } from "@/shared/nextPage";
import { Placeholder } from "@/shared/Placeholder";
import { SearchField } from "@/shared/SearchField";
import { hideKeyboard } from "@/shared/telegram";
import { Unread } from "@/shared/Unread";
import { visible } from "@/shared/visible";

const pageSize = 20;
/** The farthest the server reads from (`offset` ≤ 10 000). */
const LAST_OFFSET = 10000;
/** Typed letters wait this long before they are asked (spec §5 «Поиск»). */
const PAUSE = 300;
/** What a search starts from: two letters. */
const FROM = 2;

interface FamilyPage {
  items: Family[];
  has_more: boolean;
}

/**
 * What is asked for: from two letters, the words trimmed; fewer, every
 * model, as the empty search was — one letter keeps the list where it
 * stood, never a blank between (review).
 */
function askable(text: string): string {
  const trimmed = text.trim();
  return trimmed.length >= FROM ? trimmed : "";
}

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
    .filter((part): part is string => Boolean(part))
    .map(visible)
    .join(" — ");
}
/**
 * «Інший колір нашої моделі»: the model the new colour belongs to, found as
 * it is typed, from two letters, a moment after the last — no «Знайти
 * модель» (goods task list after stage 2, P1-5), as «Моделі» and the
 * catalogue's search do. Nothing typed, every model is shown, from the
 * first page; «Показати ще» adds the next under them. What is found is
 * searched by its name, its source and its difference, as before; a tap
 * chooses the model, never a likeness by itself (catalogue identity).
 */
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
  // Every model at once; what is typed, after a pause.
  const [asked, setAsked] = useState("");
  // «Показати ще» pressed: the cursor goes to the first model it brings.
  const [focusAt, setFocusAt] = useState<number | null>(null);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const wanted = askable(text);
    if (wanted === asked) return;
    const wait = window.setTimeout(() => {
      setAsked(wanted);
    }, PAUSE);
    return () => {
      window.clearTimeout(wait);
    };
  }, [text, asked]);
  const families = useInfiniteQuery({
    queryKey: ["catalog-family-search", scopeKey, decisionId, storeId, asked],
    queryFn: ({ pageParam }) =>
      api<FamilyPage>(
        `/catalog/families?store_id=${storeId}&query=${encodeURIComponent(asked)}&limit=${String(pageSize)}&offset=${String(pageParam)}`,
        token,
      ),
    initialPageParam: 0,
    getNextPageParam: (last, pages) =>
      last.has_more && pages.length * pageSize <= LAST_OFFSET
        ? pages.length * pageSize
        : undefined,
    retry: false,
    // What was found stands until the new words are answered: the same
    // proposal's, never another's.
    placeholderData: (
      previous: InfiniteData<FamilyPage, number> | undefined,
      before,
    ) =>
      before?.queryKey[1] === scopeKey &&
      before.queryKey[2] === decisionId &&
      before.queryKey[3] === storeId
        ? previous
        : undefined,
  });
  const found = families.data?.pages.flatMap((page) => page.items) ?? [];
  // What could not be read, as the catalogue's search says it: never read,
  // the plate in the list's place; read again and refused, the plate over
  // what was found; a next page, the plate where «Показати ще» stood.
  const nextFailed = useNextPageFailed(families);
  const neverRead = families.error !== null && families.data === undefined;
  const readAgainFailed =
    families.error !== null && families.data !== undefined && !nextFailed;
  const shelf = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusAt === null) return;
    const next =
      shelf.current?.querySelectorAll<HTMLElement>(".catalog-row")[focusAt];
    if (next) {
      next.focus();
      setFocusAt(null);
    }
  });
  return (
    <section aria-label="Пошук наявної моделі">
      <SearchField
        label="Пошук моделі в каталозі"
        placeholder="Назва моделі або джерело"
        value={text}
        change={(next) => {
          // Typed: a page pressed before takes no cursor from the field,
          // as it is typed or once its words are asked (review, batches 16
          // and 17).
          setFocusAt(null);
          setText(next);
        }}
        inputRef={field}
        disabled={blocked}
      />
      {/* The catalogue's identity: a likeness is not the same goods. */}
      <p className="hint">Схожі назви не означають однаковий товар.</p>
      {
        // Nothing found before, and the new words not read yet: never the
        // old «Нічого не знайшли» under them.
        families.isPending ||
        (families.isPlaceholderData && found.length === 0) ? (
          // Rows of what is found in grey, one line each; a screen reader
          // hears it is searched (goods task list after stage 2, P2-2).
          <Placeholder
            said="Шукаємо моделі…"
            rows={3}
            day={false}
            rowShape={{
              list: "catalog-found",
              row: "catalog-row",
              meta: false,
            }}
          />
        ) : neverRead ? (
          // The warning's plate, «Спробувати ще раз» (stage 2's audit,
          // goods P1-1).
          <Unread
            error={families.error}
            held={blocked}
            retry={() => {
              void families.refetch();
            }}
          />
        ) : (
          <>
            {readAgainFailed && (
              <Unread
                error={families.error}
                held={blocked || families.isFetching}
                retry={() => {
                  void families.refetch();
                }}
              />
            )}
            {found.length === 0 && (
              <div className="catalog-none">
                <p role="status">
                  {asked === ""
                    ? "Моделей не знайдено."
                    : `Нічого не знайшли за «${visible(asked)}»`}
                </p>
              </div>
            )}
            {found.length > 0 && (
              <div
                ref={shelf}
                className="catalog-found"
                role="group"
                aria-label="Знайдені моделі"
              >
                {found.map((family) => (
                  <button
                    key={family.family_id}
                    type="button"
                    className="catalog-row"
                    disabled={blocked}
                    aria-label={`Обрати модель: ${familyLabel(family)}`}
                    onClick={() => {
                      hideKeyboard();
                      choose(family);
                    }}
                  >
                    {familyLabel(family)}
                  </button>
                ))}
              </div>
            )}
            {/* A page that failed: its retry alone, where «Показати ще»
                stood. */}
            {nextFailed ? (
              <Unread
                error={families.error}
                held={blocked || families.isFetching}
                retry={() => {
                  void families.fetchNextPage();
                }}
              />
            ) : (
              families.hasNextPage && (
                <button
                  type="button"
                  className="quiet"
                  disabled={
                    blocked ||
                    families.isFetching ||
                    families.isPlaceholderData ||
                    readAgainFailed
                  }
                  onClick={() => {
                    // Kept until the page is read: after its retry too.
                    setFocusAt(found.length);
                    void families.fetchNextPage();
                  }}
                >
                  Показати ще
                </button>
              )
            )}
          </>
        )
      }
    </section>
  );
}
