import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { api } from "@/shared/api";
import { SearchField } from "@/shared/SearchField";
import { hideKeyboard } from "@/shared/telegram";
import { Stub } from "@/shared/Stub";
import { visible } from "@/shared/visible";
import { Unread } from "@/shared/Unread";
import { Placeholder } from "@/shared/Placeholder";
import { useNextPageFailed } from "@/shared/nextPage";
import { NewModel } from "@/catalog/NewModel";
import { useCatalogCommand, useCatalogJournal } from "@/catalog/commands";
import type { Store } from "@/orders/types";
import type { ReceivableVariant } from "./receiptTypes";

const pageSize = 20;
/** The farthest the server reads from (`offset` ≤ 10 000). */
const LAST_OFFSET = 10000;

interface FoundPage {
  items: ReceivableVariant[];
  has_more: boolean;
}

/** «Модель додано: … Кількість впишіть тут.»: a model added from an empty
 * search, said where its screen chose it (stage 2, goods task list, P0-1). */
export function AddedStub({
  said,
}: {
  said: string | null;
}): JSX.Element | null {
  if (said === null) return null;
  return (
    <div className="notice stub-notice">
      <Stub state="recorded">
        <p role="status">{said}</p>
      </Stub>
    </div>
  );
}
/** Typed letters wait this long before they are asked (spec §5 «Поиск»). */
const PAUSE = 300;
/** What a search starts from: two letters. */
const FROM = 2;

/** What is asked for: the text trimmed, once it is long enough. */
function askable(text: string): string | null {
  const trimmed = text.trim();
  return trimmed.length >= FROM ? trimmed : null;
}

/**
 * Pick a model from the whole catalogue, not from what a warehouse holds.
 *
 * Receiving needs it because a delivery is usually of something the shop has
 * run out of; a stocktake needs it for goods found on a shelf the system says
 * is empty. Both are exactly what a stock list can never offer. The endpoint
 * requires `inventory:receive`. A legacy list's review starts from what its
 * line reads, as `initialSearch`.
 *
 * It searches as it is typed, from two letters, a moment after the last
 * (stage 2, goods task list, P0-1): no «Знайти». Found nothing, it says so,
 * and — where the screen lets a model be added (`adds`), and the person may
 * create and confirm in this store — offers «Додати нову модель «…»»: the
 * sheet «Нова модель» over this screen, whose lines stay. Added, the model is
 * chosen, and `onVariant` is told what its stub says.
 */
export function CatalogPicker({
  store,
  token,
  scopeKey,
  variant,
  onVariant,
  initialSearch = "",
  adds = false,
}: {
  store: Store;
  token: string;
  scopeKey: string;
  variant: ReceivableVariant | null;
  onVariant: (variant: ReceivableVariant | null, said?: string) => void;
  initialSearch?: string;
  /** A new model may be added here from an empty search (В-Г1 (а)); never
   * at the till (В-Г2 (а)). */
  adds?: boolean;
}): JSX.Element {
  const [search, setSearch] = useState(initialSearch);
  // What the line reads is asked at once; what is typed, after a pause.
  const [asked, setAsked] = useState<string | null>(() =>
    askable(initialSearch),
  );
  const [adding, setAdding] = useState<string | null>(null);
  // The words a model was added for: their empty answer is not said again,
  // nor its button offered (review).
  const [addedFor, setAddedFor] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const wanted = askable(search);
    if (wanted === asked) return;
    const wait = window.setTimeout(() => {
      setAsked(wanted);
    }, PAUSE);
    return () => {
      window.clearTimeout(wait);
    };
  }, [search, asked]);
  // «Ще товари» adds the next page under what was found, as the till's list
  // does (goods task list after stage 2, P2-1): «Попередні» is gone.
  const variants = useInfiniteQuery({
    queryKey: ["receivable-variants", scopeKey, store.id, asked],
    queryFn: ({ pageParam }) =>
      api<FoundPage>(
        `/catalog/receivable-variants?store_id=${store.id}&query=${encodeURIComponent(asked ?? "")}&limit=${String(pageSize)}&offset=${String(pageParam)}`,
        token,
      ),
    initialPageParam: 0,
    getNextPageParam: (last, pages) =>
      last.has_more && pages.length * pageSize <= LAST_OFFSET
        ? pages.length * pageSize
        : undefined,
    enabled: asked !== null,
    retry: false,
    // A search typed again keeps what was found in place until the new one
    // comes, as the till's list does (review): the same store's, never
    // another's.
    placeholderData: (
      previous: InfiniteData<FoundPage, number> | undefined,
      before,
    ) =>
      before?.queryKey[1] === scopeKey && before.queryKey[2] === store.id
        ? previous
        : undefined,
  });
  const found = variants.data?.pages.flatMap((page) => page.items) ?? [];
  // What could not be read (as the till's list, sale P1-4): never read, the
  // plate in the list's place; read again and refused, the plate over what
  // was found; a next page, the plate where «Ще товари» stood (review).
  const nextFailed = useNextPageFailed(variants);
  const neverRead = variants.error !== null && variants.data === undefined;
  const readAgainFailed =
    variants.error !== null && variants.data !== undefined && !nextFailed;
  // «Ще товари» pressed: the cursor goes to the first model it brings.
  const [focusAt, setFocusAt] = useState<number | null>(null);
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
  const journal = useCatalogJournal((state) => state.key);
  const kept = useCatalogCommand((state) => state.pending !== null);
  const mayAdd =
    adds &&
    journal !== null &&
    store.permissions.includes("catalog:create") &&
    store.permissions.includes("catalog:confirm");

  return (
    <>
      <SearchField
        label="Пошук у каталозі"
        placeholder="Назва моделі або колір"
        value={search}
        change={setSearch}
        inputRef={field}
      />
      {asked !== null &&
        // Nothing found before, and the new search not read yet: never the
        // old «Нічого не знайшли» under the new words.
        (variants.isPending ||
        (variants.isPlaceholderData && found.length === 0) ? (
          // Rows of what is found in grey, one line each (goods task list
          // after stage 2, P2-2); a screen reader hears it is searched.
          <Placeholder
            said="Шукаємо…"
            rows={3}
            day={false}
            rowShape={{
              list: "catalog-found",
              row: "catalog-row",
              meta: false,
            }}
          />
        ) : neverRead ? (
          <Unread
            error={variants.error}
            retry={() => {
              void variants.refetch();
            }}
          />
        ) : (
          <>
            {readAgainFailed && (
              <Unread
                error={variants.error}
                held={variants.isFetching}
                retry={() => {
                  void variants.refetch();
                }}
              />
            )}
            {found.length === 0 && asked !== addedFor && (
              <div className="catalog-none">
                <p>Нічого не знайшли за «{visible(asked)}»</p>
                {mayAdd && (
                  <button
                    type="button"
                    className="quiet"
                    disabled={kept}
                    onClick={() => {
                      hideKeyboard();
                      // The words as typed, unless more came since.
                      setAdding(search.trim() === asked ? search : asked);
                    }}
                  >
                    Додати нову модель «{visible(asked)}»
                  </button>
                )}
              </div>
            )}
            {found.length > 0 && (
              <div
                ref={shelf}
                className="catalog-found"
                role="radiogroup"
                aria-label="Знайдені товари"
              >
                {found.map((item) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={
                      variant?.product_variant_id === item.product_variant_id
                    }
                    key={item.product_variant_id}
                    className="catalog-row"
                    onClick={() => {
                      hideKeyboard();
                      onVariant(item);
                    }}
                  >
                    {visible(item.display_name)}
                  </button>
                ))}
              </div>
            )}
            {/* A page that failed: its retry alone, where «Ще товари»
                stood. */}
            {nextFailed ? (
              <Unread
                error={variants.error}
                held={variants.isFetching}
                retry={() => {
                  void variants.fetchNextPage();
                }}
              />
            ) : (
              variants.hasNextPage && (
                <button
                  type="button"
                  className="quiet"
                  disabled={
                    variants.isFetching ||
                    variants.isPlaceholderData ||
                    readAgainFailed
                  }
                  onClick={() => {
                    // Kept until the page is read: after its retry too.
                    setFocusAt(found.length);
                    void variants.fetchNextPage();
                  }}
                >
                  Ще товари
                </button>
              )
            )}
          </>
        ))}
      {variant && (
        <p className="hint">Обрано: {visible(variant.display_name)}</p>
      )}
      {adding !== null && (
        <NewModel
          store={store}
          token={token}
          raw={adding}
          close={() => {
            setAdding(null);
          }}
          done={(added, said) => {
            setAdding(null);
            setAddedFor(asked);
            onVariant(added, said);
          }}
        />
      )}
    </>
  );
}
