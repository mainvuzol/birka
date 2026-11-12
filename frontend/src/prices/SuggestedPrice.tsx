import { useId, useState } from "react";
import type { JSX } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, isConflict, refusedWrite } from "@/shared/api";
import { Eyelet } from "@/shared/Eyelet";
import { Keypad } from "@/shared/Keypad";
import { ModeSwitch } from "@/shared/ModeSwitch";
import { Placeholder } from "@/shared/Placeholder";
import { Unread } from "@/shared/Unread";
import { buzz, useMainButton } from "@/shared/telegram";
import { visible } from "@/shared/visible";
import { decimal, kopecks, money } from "@/orders/types";
import type { Store } from "@/orders/types";
import type { AppliesTo, Prices } from "./types";

/**
 * A model's suggested selling price (owner decisions, 2026-10-01; Q-F).
 *
 * The till prefills it, so a seller does not type it on every sale; the
 * final price is still agreed at the counter. The owner and managers set it
 * (`catalog:set_price`): one price for the whole shop, which a store may
 * override with its own. Holding the permission in this store sets the
 * store's own; holding it organization-wide, or in every store, also the
 * shared one — the server says which (`may_set_shared`).
 *
 * A change states the price the screen showed, so nobody overwrites one they
 * have not seen; saving twice is safe.
 */
export function SuggestedPrice({
  store,
  token,
  scopeKey,
  variantId,
  blocked,
}: {
  store: Store;
  token: string;
  scopeKey: string;
  variantId: string;
  blocked: boolean;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const prices = usePrices(store, token, scopeKey, variantId);
  const maySet = store.permissions.includes("catalog:set_price");

  return (
    <div className="price">
      {prices.isPending ? (
        // A field row in grey where the price comes (audit after stage 2,
        // frame P1-4).
        <Placeholder said="Завантажуємо ціну продажу…" field tags={0} />
      ) : prices.error ? (
        // The warning's plate (stage 2's audit, goods P1-1).
        <Unread
          error={prices.error}
          retry={() => {
            void prices.refetch();
          }}
        />
      ) : (
        <>
          <p>
            Ціна продажу: <strong>{describe(prices.data, store)}</strong>
          </p>
          {saved && !editing && <p role="status">Ціну збережено.</p>}
          {maySet &&
            (editing ? (
              <PriceEditor
                store={store}
                token={token}
                scopeKey={scopeKey}
                variantId={variantId}
                blocked={blocked}
                onDone={() => {
                  setEditing(false);
                  setSaved(true);
                }}
                onCancel={() => {
                  setEditing(false);
                }}
              />
            ) : (
              <button
                type="button"
                className="quiet"
                disabled={blocked}
                onClick={() => {
                  setEditing(true);
                  setSaved(false);
                }}
              >
                {prices.data.suggested_price === null
                  ? "Задати ціну продажу"
                  : "Змінити ціну продажу"}
              </button>
            ))}
        </>
      )}
    </div>
  );
}

/**
 * Change, set or remove one price — the shared one or this store's own.
 *
 * Drawn in the tag's system (stage 2, goods task list, P1-4): «Для всіх
 * магазинів · Лише «{магазин}»» where both may be set; the sum on the app's
 * keypad, with its comma; «Прибрати ціну «{магазин}»» quiet. Its one button,
 * «Зберегти · 3 600,00 грн», is Telegram's MainButton in a sheet — outside
 * Telegram its own, in `foot` —; on a screen, which may have a MainButton
 * of its own («Записати прихід»), the form's own, with «Скасувати».
 */
export function PriceEditor({
  store,
  token,
  scopeKey,
  variantId,
  blocked,
  foot,
  onSaving,
  onDone,
  onCancel,
}: {
  store: Store;
  token: string;
  scopeKey: string;
  variantId: string;
  blocked: boolean;
  /** In a sheet: its foot, where the form's own button stands outside
   * Telegram, null until it is drawn. None on a screen. */
  foot?: HTMLElement | null | undefined;
  /** Whether a price is being saved: a sheet keeps it open till it is. */
  onSaving?: (saving: boolean) => void;
  onDone: (prices: Prices) => void;
  /** On a screen: «Скасувати». In a sheet, «Назад» closes it. */
  onCancel?: (() => void) | undefined;
}): JSX.Element {
  const prices = usePrices(store, token, scopeKey, variantId);
  if (prices.isPending)
    return <Placeholder said="Завантажуємо ціну продажу…" field tags={0} />;
  if (prices.error)
    return (
      <Unread
        error={prices.error}
        retry={() => {
          void prices.refetch();
        }}
      />
    );
  return (
    <Form
      store={store}
      token={token}
      scopeKey={scopeKey}
      variantId={variantId}
      blocked={blocked}
      prices={prices.data}
      refetch={async () => {
        await prices.refetch();
      }}
      foot={foot}
      {...(onSaving ? { onSaving } : {})}
      onDone={onDone}
      onCancel={onCancel}
    />
  );
}

function Form({
  store,
  token,
  scopeKey,
  variantId,
  blocked,
  prices,
  refetch,
  foot,
  onSaving,
  onDone,
  onCancel,
}: {
  store: Store;
  token: string;
  scopeKey: string;
  variantId: string;
  blocked: boolean;
  prices: Prices;
  refetch: () => Promise<void>;
  foot: HTMLElement | null | undefined;
  onSaving?: (saving: boolean) => void;
  onDone: (prices: Prices) => void;
  onCancel: (() => void) | undefined;
}): JSX.Element {
  const cache = useQueryClient();
  // A store with its own price is changing that one; otherwise whoever may
  // set the shared price starts there.
  const mayShare = prices.may_set_shared;
  const [appliesTo, setAppliesTo] = useState<AppliesTo>(
    prices.store_price === null && mayShare ? "ORGANIZATION" : "STORE",
  );
  // Empty: «Зараз: …» names the price that stands, and a sum already full
  // to its kopecks would take no figure typed (review, 2026-11-07).
  const [text, setText] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  // What the screen shows for the chosen price is what the change is stated
  // against: the server refuses it if that no longer stands.
  const current =
    appliesTo === "ORGANIZATION" ? prices.shared_price : prices.store_price;

  async function save(price: string | null): Promise<void> {
    setBusy(true);
    onSaving?.(true);
    setProblem("");
    try {
      const result = await api<Prices>("/catalog/prices", token, {
        store_id: store.id,
        product_variant_id: variantId,
        applies_to: appliesTo,
        expected_price: current,
        suggested_price: price,
      });
      cache.setQueryData(priceKey(scopeKey, store.id, variantId), result);
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["sale-stock"] }),
        cache.invalidateQueries({ queryKey: ["inventory-stock"] }),
      ]);
      buzz("success");
      onDone(result);
    } catch (error) {
      buzz("error");
      if (error instanceof ApiError && error.code === "PRICE_CHANGED") {
        const now = error.details.current;
        setProblem(
          `Цю ціну щойно змінив хтось інший: тепер ${typeof now === "string" ? money(now) : "не задана"}. Перевірте й збережіть ще раз.`,
        );
        await refetch();
      } else {
        if (isConflict(error)) await refetch();
        setProblem(
          error instanceof ApiError
            ? refusedWrite(
                error,
                "Ціну не збережено.",
                "Перевірте суму.",
                "Ціну не збережено: її щойно змінили — перевірте й збережіть ще раз.",
              )
            : "Немає відповіді сервера. Натисніть ще раз — повторне збереження безпечне.",
        );
      }
    } finally {
      setBusy(false);
      onSaving?.(false);
    }
  }

  const zeroId = useId();
  // The sum on the keypad: «1850,5», «1850,» on its way to kopecks, or "".
  const cents = text === "" ? null : kopecks(text.replace(/,$/, ""));
  const held = blocked || busy;
  const ready = cents !== null && cents > 0n && !held;
  const words =
    cents === null || cents === 0n
      ? "Зберегти"
      : `Зберегти · ${money(decimal(cents))}`;
  const press = (): void => {
    if (!ready) return;
    void save(decimal(cents));
  };
  // In a sheet, Telegram's MainButton; on a screen, which may have its own,
  // the form's own button.
  const inSheet = foot !== undefined;
  // Telegram's, only where it was put up: on a screen inside Telegram the
  // form's own button stands (review, 2026-11-07).
  const main =
    useMainButton(words, press, {
      shown: inSheet,
      progress: busy,
      active: ready,
    }) && inSheet;
  const own = (
    <button
      type="button"
      className="sheet-done main-mimic"
      disabled={!ready && !busy}
      aria-disabled={busy || undefined}
      onClick={press}
    >
      {busy ? (
        <>
          <Eyelet state="spin" size={20} />
          <span className="visually-hidden">{words}</span>
        </>
      ) : (
        words
      )}
    </button>
  );

  return (
    // On a screen it is named, as its fieldset named it; in a sheet the
    // sheet's title does (review, 2026-11-07).
    <div className="price-form" role="group" aria-label="Змінити ціну продажу">
      {mayShare ? (
        // For all stores or for this one: seen at once and one tap, two
        // segments, never a list's wheel; the same price first as before
        // (stage 2, admin task list, P1-2).
        <ModeSwitch
          label="Яку ціну змінюємо"
          modes={[
            { mode: "ORGANIZATION", label: "Для всіх магазинів" },
            { mode: "STORE", label: `Лише «${visible(store.name)}»` },
          ]}
          current={appliesTo}
          choose={(mode) => {
            setAppliesTo(mode);
            setProblem("");
          }}
          disabled={held}
          filters
          className="price-scope"
        />
      ) : (
        // Nothing said of the price it may not change (stage 2, admin task
        // list, P1-2).
        <p className="hint">
          Ця ціна діятиме лише в магазині «{visible(store.name)}».
        </p>
      )}
      <p className="hint">
        Зараз:{" "}
        {current !== null
          ? money(current)
          : appliesTo === "STORE" && prices.shared_price !== null
            ? `своєї ціни немає, діє спільна ${money(prices.shared_price)}`
            : "не задана"}
        . На касі продавець може домовитися про іншу ціну.
      </p>
      <Keypad
        label="Нова ціна, грн"
        value={text}
        change={(next) => {
          setText(next);
          setProblem("");
        }}
        disabled={held}
        invalid={cents === 0n}
        {...(cents === 0n ? { describedBy: zeroId } : {})}
      />
      {cents === 0n && (
        <p role="alert" id={zeroId}>
          Ціну вкажіть у гривнях, до копійок, більше нуля, наприклад 1850,50.
        </p>
      )}
      {problem && <p role="alert">{problem}</p>}
      {current !== null && (
        <button
          type="button"
          className="quiet price-remove"
          disabled={held}
          onClick={() => {
            void save(null);
          }}
        >
          {appliesTo === "STORE"
            ? `Прибрати ціну «${visible(store.name)}»`
            : "Прибрати спільну ціну"}
        </button>
      )}
      {!main &&
        (foot === undefined ? (
          <div className="count-foot">{own}</div>
        ) : (
          // A sheet's foot not there yet: it comes at once, the button in it.
          foot && createPortal(own, foot)
        ))}
      {onCancel && (
        <button
          type="button"
          className="quiet"
          disabled={busy}
          onClick={onCancel}
        >
          Скасувати
        </button>
      )}
    </div>
  );
}

function usePrices(
  store: Store,
  token: string,
  scopeKey: string,
  variantId: string,
) {
  return useQuery({
    queryKey: priceKey(scopeKey, store.id, variantId),
    queryFn: () =>
      api<Prices>(
        `/catalog/prices?store_id=${store.id}&product_variant_id=${variantId}`,
        token,
      ),
    retry: false,
  });
}

function priceKey(
  scopeKey: string,
  storeId: string,
  variantId: string,
): string[] {
  return ["catalog-price", scopeKey, storeId, variantId];
}

/** What the till suggests here, and where that price comes from. */
function describe(prices: Prices, store: Store): string {
  if (prices.store_price !== null)
    return `${money(prices.store_price)} — ціна магазину «${visible(store.name)}»`;
  if (prices.shared_price !== null)
    return `${money(prices.shared_price)} — спільна для всіх магазинів`;
  return "не задана";
}

/** A price as the input field takes it: "1850,50". */
export function asInput(price: string): string {
  const cents = kopecks(price);
  return cents === null ? "" : decimal(cents).replace(".", ",");
}
