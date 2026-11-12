import { useEffect, useId, useRef, useState } from "react";
import type { JSX, ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  api,
  ApiError,
  errorText,
  inOwnWords,
  isConflict,
  refusedWrite,
} from "@/shared/api";
import { Unread } from "@/shared/Unread";
import { visible } from "@/shared/visible";
import { money } from "@/orders/types";
import type { Store } from "@/orders/types";
import { familyLabel } from "./FamilySearch";
import type { Family } from "./FamilySearch";
import {
  resolveCorrectionCommand,
  submitCorrectionCommand,
  useCorrectionCommand,
} from "./modelCommands";
import type { CorrectionBody } from "./modelCommands";
import { Similar } from "./Similar";
import { blockerText, similarFrom, statusText, wordLabels } from "./modelTypes";
import type {
  Correction,
  MergeModel,
  ModelCard,
  ModelItem,
  ModelPage,
  MergePreview,
  StockLine,
} from "./modelTypes";
import { BackToMore } from "@/shared/More";
import type { MoreBack } from "@/shared/More";
import { Back } from "@/shared/Back";
import { Eyelet } from "@/shared/Eyelet";
import { Icon } from "@/shared/Icon";
import { Kept } from "@/shared/Kept";
import { keptCashText, useAutoCheck } from "@/shared/reach";
import { ScreenHeader } from "@/shared/ScreenHeader";
import { SearchField } from "@/shared/SearchField";
import { Sheet } from "@/shared/Sheet";
import { Stub } from "@/shared/Stub";
import { usePanelRoom } from "@/shared/panel";
import { askPopup, buzz, popupHere, useMainButton } from "@/shared/telegram";
import { Sticker } from "@/shared/Sticker";

const pageSize = 20;
/** The search asks what is typed once typing pauses (stage 2, goods task
 * list, P1-2, as P0-1), from two letters. */
const PAUSE = 300;
const FROM = 2;
/** Telegram's popup says at most this much. */
const POPUP_WORDS = 256;

type Field =
  | "concept"
  | "source"
  | "color"
  | "material"
  | "texture"
  | "fur"
  | "collar"
  | "length_cm"
  | "business_category"
  | "garment_type";
/** Folded under «Ще ознаки»: the name's words but the model and its colour
 * (P1-2). */
const moreWords = ["source", "material", "texture", "fur", "collar"] as const;
// Sent without `store_id` and `command_id`, which `send` adds once.
type Command =
  | Omit<Extract<CorrectionBody, { kind: "rename" }>, "store_id" | "command_id">
  | Omit<Extract<CorrectionBody, { kind: "merge" }>, "store_id" | "command_id">
  | Omit<
      Extract<CorrectionBody, { kind: "retire" | "restore" }>,
      "store_id" | "command_id"
    >;

function doneText(correction: Correction): string {
  const before = visible(correction.name_before);
  const after = visible(correction.name_after);
  switch (correction.kind) {
    case "RENAME":
      return correction.correction_id === null
        ? "Назва та сама — нічого не змінено."
        : `Назву змінено: «${before}» → «${after}».`;
    case "MERGE":
      return `Об’єднано: «${before}» тепер веде до «${after}». Залишок і ціни перенесено.`;
    case "RETIRE":
      return `«${after}» прибрано: залишок продають, нового не приймають.`;
    case "RESTORE":
      return `«${after}» повернуто: її знову приймають.`;
  }
}

function askable(text: string): string | null {
  const trimmed = text.trim();
  return trimmed.length >= FROM ? trimmed : null;
}

/** A model's row as found: its name, and its state where it is not «Діє». */
function foundName(item: ModelItem): string {
  return `${visible(item.display_name)}${
    item.status === "ACTIVE" ? "" : ` — ${statusText[item.status]}`
  }`;
}

/**
 * «Об’єднати «А» з «Б»? Скасувати не можна.» — the merge's question, as
 * Telegram's popup takes it: at most 256 characters, the names shortened
 * alike when they are longer than that.
 */
export function mergeQuestion(from: string, into: string): string {
  const said = (a: string, b: string): string =>
    `Об’єднати «${a}» з «${b}»? Скасувати не можна.`;
  const whole = said(from, into);
  if (whole.length <= POPUP_WORDS) return whole;
  const room = POPUP_WORDS - (whole.length - from.length - into.length);
  // Cut between characters, never inside one (an emoji is two units).
  const cut = (name: string, most: number): string => {
    if (name.length <= most) return name;
    let kept = "";
    for (const char of name) {
      if (kept.length + char.length > Math.max(most - 1, 1)) break;
      kept += char;
    }
    return `${kept}…`;
  };
  const half = Math.floor(room / 2);
  const first = cut(from, Math.max(half, room - into.length));
  return said(first, cut(into, room - first.length));
}

/**
 * A model found by its words, retired ones too (ADR-0008): asked as it is
 * typed, from two letters, once typing pauses — no «Знайти» (stage 2, goods
 * task list, P1-2). Each model a row; a tap chooses it.
 */
function ModelSearch({
  store,
  token,
  label,
  except,
  choose,
  autoFocus = false,
  text: given,
  change,
}: {
  store: Store;
  token: string;
  label: string;
  except?: string;
  choose: (model: ModelItem) => void;
  /** Mounted by a tap: the cursor in it at once. */
  autoFocus?: boolean;
  /** What is typed, kept by whoever shows the search: it comes back as it
   * was left, its rows with it. */
  text?: string;
  change?: (text: string) => void;
}): JSX.Element {
  const [own, setOwn] = useState("");
  const text = given ?? own;
  const setText = change ?? setOwn;
  const [asked, setAsked] = useState<string | null>(() => askable(text));
  const [shown, setShown] = useState(pageSize);
  const field = useRef<HTMLInputElement>(null);
  // Mounted by a tap: the cursor in it at once — once the sheet the tap was
  // in has let go of the page, whose `inert` a field's own autofocus would
  // meet.
  useEffect(() => {
    if (autoFocus) field.current?.focus();
  }, [autoFocus]);
  useEffect(() => {
    const wanted = askable(text);
    if (wanted === asked) return;
    const wait = window.setTimeout(() => {
      setShown(pageSize);
      setAsked(wanted);
    }, PAUSE);
    return () => {
      window.clearTimeout(wait);
    };
  }, [text, asked]);
  const found = useQuery({
    queryKey: ["catalog-models", store.id, asked, shown],
    queryFn: () =>
      api<ModelPage>(
        `/catalog/models?store_id=${store.id}&query=${encodeURIComponent(
          asked ?? "",
        )}&limit=${String(Math.min(shown, 50))}`,
        token,
      ),
    enabled: asked !== null,
    retry: false,
    // The rows found stand while the next words are asked: no flicker.
    placeholderData: keepPreviousData,
  });
  const items =
    asked === null
      ? []
      : (found.data?.items ?? []).filter(
          (item) => item.product_variant_id !== except,
        );
  return (
    <section className="models-search">
      <SearchField
        label={label}
        placeholder="Модель або колір"
        value={text}
        change={setText}
        inputRef={field}
      />
      {asked !== null && found.isError && (
        <Unread
          error={found.error}
          retry={() => {
            void found.refetch();
          }}
        />
      )}
      {asked !== null &&
        found.data &&
        !found.isPlaceholderData &&
        items.length === 0 && (
          <p className="t-meta" role="status">
            Нічого не знайшли за «{visible(asked)}».
          </p>
        )}
      {items.length > 0 && (
        <ul className="catalog-rows" aria-label="Знайдені моделі">
          {items.map((item) => (
            <li key={item.product_variant_id}>
              <button
                type="button"
                className="catalog-proposal"
                data-model={item.product_variant_id}
                aria-label={foundName(item)}
                onClick={() => {
                  // A row chosen, felt (spec §6.9).
                  buzz("selection");
                  choose(item);
                }}
              >
                <span className="catalog-raw">
                  {visible(item.display_name)}
                </span>
                {item.status !== "ACTIVE" && (
                  <Sticker>{statusText[item.status]}</Sticker>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {asked !== null && found.data?.has_more && shown < 50 && (
        <button
          type="button"
          className="quiet"
          disabled={found.isFetching}
          onClick={() => {
            setShown(shown + pageSize);
          }}
        >
          Показати ще
        </button>
      )}
    </section>
  );
}

/**
 * A model being read (goods task list after stage 2, P2-2): its hero tag in
 * its place — the eyelet, the name's line 42 in grey, ⋯'s place beside it —
 * under «← Моделі», which stands already. A screen reader hears that it is
 * read.
 */
function ModelPlaceholder(): JSX.Element {
  return (
    <>
      <p role="status" className="visually-hidden">
        Завантажуємо модель…
      </p>
      <section className="model-screen placeholder" aria-hidden="true">
        <div className="model-hang">
          <div className="tag-hero tag-outline">
            <div className="model-hero">
              <span className="hero-eyelet" />
              <div className="model-hero-head">
                <span className="skeleton skeleton-title" />
                <span className="debt-more" />
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

/** The button a screen's MainButton is outside Telegram: its words, or its
 * ring while it is asked. */
function Mimic({
  words,
  busy,
  ready,
  press,
  className = "main-mimic",
}: {
  words: string;
  busy: boolean;
  ready: boolean;
  press: () => void;
  className?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      className={className}
      disabled={!ready && !busy}
      aria-disabled={busy || undefined}
      onClick={() => {
        if (!busy) press();
      }}
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
}

/**
 * A model's new name in a sheet (stage 2, goods task list, P1-2): «Назва
 * моделі» and «Колір», the rest of its words folded under «Ще ознаки»;
 * «Зберегти назву» is Telegram's MainButton. A similar word, a name another
 * model has and a name of several models are asked here, as before.
 */
function RenameSheet({
  store,
  token,
  card,
  busy,
  blocked,
  send,
  mergeInto,
  close,
  fallback,
}: {
  store: Store;
  token: string;
  card: ModelCard;
  /** Its own send is on its way. */
  busy: boolean;
  /** Anything else holds it. */
  blocked: boolean;
  send: (command: Command) => Promise<ApiError | null>;
  mergeInto: (model: string) => void;
  close: () => void;
  fallback: RefObject<HTMLElement>;
}): JSX.Element {
  const [fields, setFields] = useState<Record<Field, string>>({
    concept: card.concept,
    source: card.source ?? "",
    color: card.color ?? "",
    material: card.material ?? "",
    texture: card.texture ?? "",
    fur: card.fur ?? "",
    collar: card.collar ?? "",
    length_cm: card.length_cm === null ? "" : String(card.length_cm),
    business_category: card.business_category ?? "",
    garment_type: card.garment_type ?? "",
  });
  const [more, setMore] = useState(false);
  const [refusal, setRefusal] = useState<ApiError | null>(null);
  const [family, setFamily] = useState<string | null>(null);
  const [separate, setSeparate] = useState(false);
  const [note, setNote] = useState("");
  const [foot, setFoot] = useState<HTMLElement | null>(null);
  const similar = similarFrom(refusal);
  const candidates =
    refusal?.code === "CATALOG_AMBIGUOUS" &&
    Array.isArray(refusal.details.candidate_family_ids)
      ? (refusal.details.candidate_family_ids as unknown[]).filter(
          (id): id is string => typeof id === "string",
        )
      : [];
  const families = useQuery({
    queryKey: ["catalog-model-families", store.id, fields.concept, candidates],
    queryFn: () =>
      api<{ items: Family[] }>(
        `/catalog/families?store_id=${store.id}&query=${encodeURIComponent(
          fields.concept.trim(),
        )}&limit=50`,
        token,
      ),
    enabled: candidates.length > 0,
    retry: false,
  });
  const sameAs =
    refusal?.code === "SAME_AS" && typeof refusal.details.same_as === "string"
      ? refusal.details.same_as
      : null;
  const length = fields.length_cm.trim().replace(",", ".");
  const lengthValid =
    !length || (/^\d{1,4}(\.\d)?$/.test(length) && Number(length) > 0);
  const ready =
    fields.concept.trim() !== "" &&
    lengthValid &&
    !(candidates.length > 0 && !family && !(separate && note.trim()));

  function value(name: Field): string | null {
    const trimmed = fields[name].trim();
    return trimmed ? trimmed : null;
  }

  function change(name: Field, text: string): void {
    setFields({ ...fields, [name]: text });
    setRefusal(null);
  }

  async function submit(similarConfirmed: boolean): Promise<void> {
    if (blocked || busy || !fields.concept.trim() || !lengthValid) return;
    const variant: Record<string, string> = {};
    for (const name of [
      "color",
      "material",
      "texture",
      "fur",
      "collar",
    ] as const) {
      const given = value(name);
      if (given) variant[name] = given;
    }
    if (length) variant.length_cm = length;
    const refused = await send({
      kind: "rename",
      product_variant_id: card.product_variant_id,
      concept: fields.concept.trim(),
      source: value("source"),
      variant,
      business_category: value("business_category"),
      garment_type: value("garment_type"),
      product_family_id: separate ? null : family,
      new_model: separate,
      distinction_note: separate ? note.trim() : null,
      similar_confirmed: similarConfirmed,
    });
    setRefusal(refused);
    // Refused for what it says of the words: every word in sight.
    if (
      refused &&
      !similarFrom(refused) &&
      refused.code !== "SAME_AS" &&
      refused.code !== "CATALOG_AMBIGUOUS"
    )
      setMore(true);
  }

  const press = (): void => {
    if (ready && !blocked && !busy) void submit(false);
  };
  const words = "Зберегти назву";
  const main = useMainButton(words, press, {
    progress: busy,
    active: ready && !blocked,
  });

  return (
    <Sheet
      title="Перейменувати модель"
      held={busy}
      // While its answer is waited for, the sheet stands: it is the
      // rename's to say.
      close={() => {
        if (!busy) close();
      }}
      fallback={fallback}
      foot={<div ref={setFoot} />}
    >
      <form
        className="model-rename"
        aria-label="Нова назва моделі"
        onSubmit={(e) => {
          e.preventDefault();
          press();
        }}
      >
        <fieldset disabled={blocked || busy}>
          <p className="t-meta">
            Змінюється лише ця модель. Старі продажі зберігають назву, під якою
            продали.
          </p>
          <label>
            {wordLabels.concept}
            <input
              required
              maxLength={200}
              value={fields.concept}
              onChange={(e) => {
                change("concept", e.target.value);
              }}
            />
          </label>
          <label>
            {wordLabels.color}
            <input
              maxLength={120}
              value={fields.color}
              onChange={(e) => {
                change("color", e.target.value);
              }}
            />
          </label>
          <button
            type="button"
            className="quiet new-model-more"
            aria-expanded={more}
            onClick={() => {
              setMore(!more);
            }}
          >
            Ще ознаки
          </button>
          {more && (
            <div className="new-model-extra">
              {moreWords.map((name) => (
                <label key={name}>
                  {wordLabels[name]}
                  <input
                    maxLength={name === "source" ? 200 : 120}
                    value={fields[name]}
                    onChange={(e) => {
                      change(name, e.target.value);
                    }}
                  />
                </label>
              ))}
              <label>
                Довжина, см
                <input
                  inputMode="decimal"
                  value={fields.length_cm}
                  onChange={(e) => {
                    change("length_cm", e.target.value);
                  }}
                />
              </label>
              <label>
                Категорія
                <input
                  maxLength={120}
                  value={fields.business_category}
                  onChange={(e) => {
                    change("business_category", e.target.value);
                  }}
                />
              </label>
              <label>
                Тип виробу
                <input
                  maxLength={120}
                  value={fields.garment_type}
                  onChange={(e) => {
                    change("garment_type", e.target.value);
                  }}
                />
              </label>
              <p className="t-meta">
                Категорія й тип виробу потрібні, лише якщо такої назви моделі ще
                немає в каталозі.
              </p>
            </div>
          )}
          {!lengthValid && (
            <p role="alert">
              Вкажіть додатну довжину до 9999,9 см, з одним знаком після коми.
            </p>
          )}
          {similar && (
            <>
              <Similar
                words={similar}
                take={(field, spelling) => {
                  if (Object.prototype.hasOwnProperty.call(fields, field)) {
                    setFields({ ...fields, [field as Field]: spelling });
                    // Taken for a folded word: shown as it changes.
                    if ((moreWords as readonly string[]).includes(field))
                      setMore(true);
                  }
                  setRefusal(null);
                }}
              />
              <button
                type="button"
                onClick={() => {
                  void submit(true);
                }}
              >
                Це інша назва — зберегти як є
              </button>
            </>
          )}
          {sameAs && (
            <section className="notice" role="alert">
              {card.may_merge ? (
                <>
                  <p>Така назва вже є в іншої моделі. Об’єднати їх?</p>
                  <button
                    type="button"
                    onClick={() => {
                      mergeInto(sameAs);
                    }}
                  >
                    Об’єднати з тією моделлю
                  </button>
                </>
              ) : (
                // Nothing said of who may join them (stage 2, goods task
                // list, P1-5).
                <p>Така назва вже є в іншої моделі.</p>
              )}
            </section>
          )}
          {candidates.length > 0 && (
            <section className="notice" role="alert">
              <p>
                З такою назвою вже є модель. Це вона — чи окрема модель зі
                схожою назвою?
              </p>
              {families.isError && (
                <Unread
                  error={families.error}
                  retry={() => {
                    void families.refetch();
                  }}
                />
              )}
              {(families.data?.items ?? [])
                .filter((item) => candidates.includes(item.family_id))
                .map((item) => (
                  <label key={item.family_id} className="check">
                    <input
                      type="radio"
                      name="family"
                      checked={!separate && family === item.family_id}
                      onChange={() => {
                        setFamily(item.family_id);
                        setSeparate(false);
                      }}
                    />
                    {familyLabel(item)}
                  </label>
                ))}
              <label className="check">
                <input
                  type="radio"
                  name="family"
                  checked={separate}
                  onChange={() => {
                    setSeparate(true);
                    setFamily(null);
                  }}
                />
                Окрема модель зі схожою назвою
              </label>
              {separate && (
                <label>
                  Чим відрізняється модель
                  <textarea
                    required
                    maxLength={1000}
                    value={note}
                    onChange={(e) => {
                      setNote(e.target.value);
                    }}
                  />
                </label>
              )}
            </section>
          )}
          {refusal && !similar && !sameAs && candidates.length === 0 && (
            <p role="alert">
              {refusedWrite(
                refusal,
                "Назву не змінено.",
                "Перевірте поля.",
                "Назву не змінено: модель щойно змінили — перегляньте її.",
              )}
            </p>
          )}
          {/* Enter in a field saves, as the button at the foot does. */}
          <button type="submit" hidden>
            {words}
          </button>
        </fieldset>
      </form>
      {!main &&
        foot &&
        createPortal(
          <Mimic
            words={words}
            busy={busy}
            ready={ready && !blocked}
            press={press}
            className="sheet-done main-mimic"
          />,
          foot,
        )}
    </Sheet>
  );
}

/**
 * A model's stock as the merge's preview shows it (P1-2): a row a
 * warehouse, a cell a size, the count under its letter — «є» where this
 * person may not read that warehouse's count.
 */
function StockCells({ lines }: { lines: StockLine[] }): JSX.Element {
  if (lines.length === 0) return <p className="t-meta">Залишку немає.</p>;
  const places: { id: string; name: string; lines: StockLine[] }[] = [];
  for (const line of lines) {
    const place = places.find((p) => p.id === line.location_id);
    if (place) place.lines.push(line);
    else
      places.push({
        id: line.location_id,
        name: line.location_name,
        lines: [line],
      });
  }
  return (
    <>
      {places.map((place) => (
        <div className="merge-place" key={place.id}>
          <p className="t-meta">{visible(place.name)}</p>
          <ul className="cells merge-cells" aria-label={visible(place.name)}>
            {place.lines.map((line) => {
              const size =
                line.size_label === null ? "розмір" : visible(line.size_label);
              const count =
                line.quantity === null
                  ? "є залишок, кількість не видно"
                  : `${String(line.quantity)} шт.`;
              return (
                <li className="size-cell merge-cell" key={line.size_id}>
                  <span className="visually-hidden">{`${size} — ${count}`}</span>
                  <span className="size-letter" aria-hidden="true">
                    {line.size_label === null ? "?" : visible(line.size_label)}
                  </span>
                  <span className="size-free" aria-hidden="true">
                    {line.quantity === null ? "є" : line.quantity}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {lines.some((line) => line.quantity === null) && (
        <p className="cell-note" aria-hidden="true">
          є — залишок є, кількість не видно
        </p>
      )}
    </>
  );
}

/** One of the merge's two models: what becomes of it, its name, its price,
 * its stock. */
function MergeTag({
  role,
  model,
  stock,
}: {
  role: "Зникне" | "Лишається";
  model: MergeModel;
  stock: StockLine[];
}): JSX.Element {
  const id = useId();
  return (
    <div
      className="tag-row tag-outline merge-tag"
      role="group"
      aria-labelledby={id}
    >
      <div className="merge-tag-in">
        <p className="merge-tag-head">
          <Sticker>{role}</Sticker>
          {model.status === "RETIRED" && (
            <Sticker>{statusText.RETIRED}</Sticker>
          )}
        </p>
        <p className="t-row merge-name" id={id}>
          {visible(model.display_name)}
        </p>
        {model.shared_price && (
          <p className="t-meta">Ціна {money(model.shared_price)}</p>
        )}
        <StockCells lines={stock} />
      </div>
    </div>
  );
}

/**
 * Merging a duplicate into the model that stays, a screen of its own (stage
 * 2, goods task list, P1-2): the two models' tags with their stock, what
 * stops it as rows, and «Об’єднати» as Telegram's MainButton. What cannot be
 * undone is asked by Telegram's popup — «Об’єднати «А» з «Б»? Скасувати не
 * можна.» — or, where it has none, a sheet of the same words; the box to
 * tick is gone (§6.6).
 */
function MergeScreen({
  store,
  token,
  duplicate,
  into: initial,
  busy,
  blocked,
  send,
  leave,
  notice,
}: {
  store: Store;
  token: string;
  duplicate: ModelCard;
  into: string | null;
  busy: boolean;
  blocked: boolean;
  send: (command: Command) => Promise<ApiError | null>;
  leave: () => void;
  /** A kept change's stub, what a check said: under the heading. */
  notice: ReactNode;
}): JSX.Element {
  const [into, setInto] = useState<string | null>(initial);
  const [swapped, setSwapped] = useState(false);
  const [refusal, setRefusal] = useState<ApiError | null>(null);
  const [asking, setAsking] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const from = swapped && into ? into : duplicate.product_variant_id;
  const to = swapped ? duplicate.product_variant_id : into;
  const preview = useQuery({
    queryKey: ["catalog-merge-preview", store.id, from, to],
    queryFn: () =>
      api<MergePreview>(
        `/catalog/models/${from}/merge/${to ?? ""}?store_id=${store.id}`,
        token,
      ),
    enabled: to !== null,
    retry: false,
    // Swapped, the tags stand while they are read again: the way pressed
    // keeps the cursor.
    placeholderData: keepPreviousData,
  });
  // The model that stays unchosen, nothing is shown of the one before.
  const seen = to === null ? undefined : preview.data;
  const blockers = seen?.blockers ?? [];
  const ready =
    to !== null &&
    seen !== undefined &&
    !preview.isFetching &&
    blockers.length === 0 &&
    !blocked;
  // Its two models known — opened so, or the one that stays chosen: the
  // cursor on its heading, the tags under it; on the search for the one
  // that stays, in the search.
  useEffect(() => {
    if (into !== null) heading.current?.focus();
  }, [into]);

  function merge(): void {
    if (!to || !ready || busy) return;
    void send({ kind: "merge", product_variant_id: from, into: to }).then(
      (error) => {
        setRefusal(error);
        // Something opened since the preview: shown afresh, and asked
        // again once it is finished.
        if (error?.code === "MERGE_BLOCKED") void preview.refetch();
      },
    );
  }

  const question = seen
    ? mergeQuestion(
        visible(seen.duplicate.display_name),
        visible(seen.into.display_name),
      )
    : "";
  const press = (): void => {
    if (!ready || busy) return;
    setRefusal(null);
    if (popupHere()) {
      void askPopup("", question, [
        { id: "no", text: "Ні" },
        { id: "merge", text: "Об’єднати", destructive: true },
      ]).then((pressed) => {
        if (pressed === "merge") merge();
      });
      return;
    }
    setAsking(true);
  };
  const main = useMainButton("Об’єднати", press, {
    shown: !asking && to !== null,
    progress: busy,
    active: ready,
  });
  usePanelRoom(dock, !main && !asking && to !== null);
  const name = visible(duplicate.display_name);

  return (
    <>
      <ScreenHeader
        ref={heading}
        focusable
        title="Об’єднати моделі"
        back={
          <Back go={leave} held={busy} label={`Назад до моделі «${name}»`}>
            <span aria-hidden="true">← </span>
            {name}
          </Back>
        }
      />
      {notice}
      <section className="models-merge">
        {!into && (
          <>
            {/* The search's label is read, not seen: what it is for, said. */}
            <p className="t-meta">
              Знайдіть модель, що лишиться: «{name}» зникне, її залишок перейде
              туди.
            </p>
            <ModelSearch
              store={store}
              token={token}
              label="Модель, що лишиться"
              except={duplicate.product_variant_id}
              autoFocus
              choose={(model) => {
                setInto(model.product_variant_id);
              }}
            />
          </>
        )}
        {to !== null && preview.isError && (
          <Unread
            error={preview.error}
            retry={() => {
              void preview.refetch();
            }}
          />
        )}
        {seen && (
          <>
            <MergeTag role="Зникне" model={seen.duplicate} stock={seen.stock} />
            <MergeTag
              role="Лишається"
              model={seen.into}
              stock={seen.stock_into}
            />
            <p className="t-meta">
              Ціна моделі, що лишається, зберігається; якщо її немає — береться
              ціна дубліката. Так само з ціною кожного магазину.
            </p>
            {blockers.length > 0 && (
              <section className="notice merge-blockers" role="alert">
                <h3>Поки що не можна об’єднати</h3>
                <ul>
                  {blockers.map((blocker) => (
                    <li key={blocker.reason}>{blockerText(blocker)}</li>
                  ))}
                </ul>
              </section>
            )}
            {refusal && (
              <p role="alert">
                {refusedWrite(
                  refusal,
                  "Моделі не об’єднано.",
                  "Перевірте, яка модель лишається.",
                  "Моделі не об’єднано: їх щойно змінили — перегляньте їх.",
                )}
              </p>
            )}
            <div className="toolbar">
              <button
                type="button"
                className="quiet"
                disabled={blocked || busy}
                onClick={() => {
                  setSwapped(!swapped);
                  setRefusal(null);
                }}
              >
                Поміняти місцями
              </button>
              <button
                type="button"
                className="quiet"
                disabled={blocked || busy}
                onClick={() => {
                  setInto(null);
                  setSwapped(false);
                  setRefusal(null);
                }}
              >
                Обрати іншу модель
              </button>
            </div>
          </>
        )}
        {!main && !asking && to !== null && (
          // Outside Telegram, its MainButton as the dock's one button.
          <div className="pay-panel order-dock" ref={dock}>
            <Mimic words="Об’єднати" busy={busy} ready={ready} press={press} />
          </div>
        )}
      </section>
      {asking && seen && (
        <Sheet
          title={question.replace(/ Скасувати не можна\.$/, "")}
          close={() => {
            setAsking(false);
          }}
          fallback={heading}
        >
          <div className="merge-ask">
            <p className="t-row">Скасувати не можна.</p>
            <div className="debt-more-ways">
              <button
                type="button"
                // Outlined, its words red: red on the black of a main
                // button is not read (under 3:1).
                className="sheet-way quiet danger-way"
                onClick={() => {
                  setAsking(false);
                  merge();
                }}
              >
                Об’єднати
              </button>
              <button
                type="button"
                className="sheet-way quiet"
                onClick={() => {
                  setAsking(false);
                }}
              >
                Ні
              </button>
            </div>
          </div>
        </Sheet>
      )}
    </>
  );
}

export function Models({
  store,
  token,
  journalKey,
  loaded = false,
  blocked,
  back,
}: {
  store: Store;
  token: string;
  journalKey: string;
  /** Its kept change was read from the phone's storage as the store
   * opened: checked once by itself. */
  loaded?: boolean;
  /** Another command's outcome is unknown: nothing new until it is settled. */
  blocked: boolean;
  /** «← Ще» over the heading: a section opened from «Ще» (navigation task
   * list, P0-4). */
  back?: MoreBack | undefined;
}): JSX.Element {
  const cache = useQueryClient();
  const { busy, pending, firstSend } = useCorrectionCommand();
  const [selected, setSelected] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"ways" | "rename" | null>(null);
  // The search's words, kept while a model, or a merge, is open over it.
  const [searchText, setSearchText] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // Where the cursor goes once the screen it is for is drawn.
  const [focus, setFocus] = useState<"name" | "row" | "kept" | null>(null);
  const shownBefore = useRef<string | null>(null);
  // The model shown now, for an answer that comes by itself.
  const shownNow = useRef<string | null>(null);
  shownNow.current = selected;
  const keptBox = useRef<HTMLDivElement>(null);
  const nameId = useId();
  const name = useRef<HTMLHeadingElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const found = useRef<HTMLDivElement>(null);
  const working = blocked || busy || pending !== null;
  // Its first send is the press's to say; kept, its stub (spec S12).
  const kept = busy && firstSend ? null : pending;
  // Opened again with a change kept: the server may have come back while
  // this screen was not open, and nothing here saw it. Checked once, at
  // once, as a change read from the phone is (ADR-0013 §4.3; review,
  // 2026-11-08); with no answer it stays kept, and the server's return
  // checks it.
  const [keptOnOpen] = useState(
    () => useCorrectionCommand.getState().pending !== null,
  );
  const card = useQuery({
    queryKey: ["catalog-model", store.id, selected],
    queryFn: () =>
      api<ModelCard>(
        `/catalog/models/${selected ?? ""}?store_id=${store.id}`,
        token,
      ),
    enabled: selected !== null,
    retry: false,
  });

  useEffect(() => {
    if (focus === "kept" && kept) {
      keptBox.current?.focus();
      setFocus(null);
    }
    if (focus === "name" && card.data && !merging) {
      name.current?.focus();
      setFocus(null);
    }
    if (focus === "row" && selected === null) {
      found.current
        ?.querySelector<HTMLElement>(
          `[data-model="${shownBefore.current ?? ""}"]`,
        )
        ?.focus();
      setFocus(null);
    }
  }, [focus, card.data, merging, selected, kept]);

  /**
   * A correction recorded: said, and its model shown — unless it was
   * answered by itself while the person is on the search, which then says
   * it where they are, their words and cursor left alone.
   */
  async function settled(correction: Correction, moved = true): Promise<void> {
    setDone(doneText(correction));
    if (moved) {
      setMerging(false);
      setMergeTarget(null);
      setSheet(null);
      setSelected(correction.into_variant_id ?? correction.product_variant_id);
      setFocus("name");
    }
    await reread();
  }

  /** The models, the card and a merge's preview, as they are now. */
  async function reread(): Promise<void> {
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["catalog-models", store.id] }),
      cache.invalidateQueries({ queryKey: ["catalog-model", store.id] }),
      cache.invalidateQueries({ queryKey: ["catalog-merge-preview"] }),
    ]);
  }

  /** Send one correction through the journal; a refusal comes back. */
  async function send(command: Command): Promise<ApiError | null> {
    setDone(null);
    setFailure(null);
    const outcome = await submitCorrectionCommand(journalKey, token, {
      // A new transport key per attempt; `command_id` is the correction's
      // identity, made once here: a resend after a lost answer comes from
      // the journal, which keeps it.
      key: crypto.randomUUID(),
      body: {
        ...command,
        store_id: store.id,
        command_id: crypto.randomUUID(),
      },
    });
    if (outcome.kind === "done") {
      // A first answer felt; a kept one's later checks, nothing.
      buzz("success");
      await settled(outcome.result);
      return null;
    }
    if (outcome.kind === "refused") {
      buzz("error");
      // Changed in a way it does not name: what it shows read again.
      if (isConflict(outcome.error)) await reread();
      return outcome.error;
    }
    // Its answer lost: kept, its stub on the screen and the cursor on it,
    // the sheet gone. Nothing kept (the phone's memory unread): the sheet
    // stands, its words with it.
    if (useCorrectionCommand.getState().pending !== null) {
      setSheet(null);
      setFocus("kept");
    }
    return null;
  }

  function check(): void {
    if (pending === null) return;
    void resolveCorrectionCommand(journalKey, token, pending).then(
      (outcome) => {
        if (outcome.kind === "done")
          void settled(outcome.result, shownNow.current !== null);
        // Proven to have recorded nothing: it says so before why (ADR-0008
        // §9; ADR-0013 §1).
        else if (outcome.kind === "refused") {
          // A kept change keeps its words (owner, В-П1 (б): the kept
          // operations' words stay).
          setFailure(
            `Зміну каталогу не записано. ${inOwnWords(
              errorText(outcome.error),
              "Внесіть її ще раз.",
              "Каталог змінився, поки сервер не відповідав: перегляньте модель і внесіть зміну ще раз.",
            )}`,
          );
          if (isConflict(outcome.error)) void reread();
        }
      },
    );
  }
  // Checked by itself as the server comes back, and once as it is read
  // from the phone (G11), as every kept operation is.
  useAutoCheck([
    {
      pending: pending !== null,
      busy,
      loaded: loaded || keptOnOpen,
      run: check,
    },
  ]);

  const keptStub = kept && (
    <div ref={keptBox} tabIndex={-1} className="models-kept">
      <Kept
        own
        title="Зміну каталогу ще не підтверджено"
        busy={busy}
        check={{ label: "Перевірити результат зміни", run: check }}
      >
        <p>
          Невідомо, чи записано зміну. Перевірте результат — та сама зміна не
          запишеться двічі.
        </p>
        <p>{keptCashText(kept.since)}</p>
      </Kept>
    </div>
  );
  const said = (
    <>
      {done && (
        <section className="notice stub-notice" role="status">
          <Stub state="recorded">
            <p>{done}</p>
          </Stub>
        </section>
      )}
      {failure && <p role="alert">{failure}</p>}
    </>
  );

  function toSearch(): void {
    shownBefore.current = selected;
    setSelected(null);
    setSheet(null);
    setDone(null);
    setFailure(null);
    setFocus("row");
  }

  function retireOrRestore(model: ModelCard): void {
    setSheet(null);
    const retired = model.status === "RETIRED";
    void send({
      kind: retired ? "restore" : "retire",
      product_variant_id: model.product_variant_id,
    }).then((error) => {
      // Refused: the cursor back on the name, the sheet's ⋯ held a moment
      // ago.
      if (error) setFocus("name");
      if (error)
        setFailure(
          refusedWrite(
            error,
            retired ? "Модель не повернуто." : "Модель не прибрано.",
            "Перегляньте її картку.",
            retired
              ? "Модель не повернуто: її щойно змінили — перегляньте її."
              : "Модель не прибрано: її щойно змінили — перегляньте її.",
          ),
        );
    });
  }

  if (merging && card.data)
    return (
      <>
        <MergeScreen
          key={`${card.data.product_variant_id}:${mergeTarget ?? ""}`}
          store={store}
          token={token}
          duplicate={card.data}
          into={mergeTarget}
          busy={busy}
          blocked={blocked || (pending !== null && !busy)}
          send={send}
          leave={() => {
            setMerging(false);
            setMergeTarget(null);
            setFocus("name");
          }}
          notice={
            <>
              {keptStub}
              {failure && <p role="alert">{failure}</p>}
            </>
          }
        />
      </>
    );

  const model = card.data;
  return (
    <>
      <ScreenHeader
        title={selected ? undefined : "Моделі"}
        back={
          selected ? (
            <Back go={toSearch} held={working} label="Назад до пошуку моделей">
              <span aria-hidden="true">← </span>
              Моделі
            </Back>
          ) : (
            back && <BackToMore back={back} />
          )
        }
      />
      {keptStub}
      <div ref={found} hidden={selected !== null}>
        <p className="t-meta">
          Виправлення каталогу: перейменувати модель, об’єднати дублікат,
          прибрати модель чи повернути її.
        </p>
        {/* Said once: over the card while a model is open. */}
        {selected === null && said}
        <ModelSearch
          store={store}
          token={token}
          label="Знайти модель"
          text={searchText}
          change={setSearchText}
          choose={(item) => {
            setSelected(item.product_variant_id);
            setSheet(null);
            setDone(null);
            setFailure(null);
            setFocus("name");
          }}
        />
      </div>
      {selected && card.isPending && <ModelPlaceholder />}
      {selected && card.isError && (
        <Unread
          error={card.error}
          retry={() => {
            void card.refetch();
          }}
        />
      )}
      {selected && model && (
        <section className="model-screen">
          {said}
          <div className="model-hang">
            <div className="tag-hero tag-outline">
              <div className="model-hero" role="group" aria-labelledby={nameId}>
                <span className="hero-eyelet" aria-hidden="true" />
                <div className="model-hero-head">
                  <h1
                    id={nameId}
                    ref={name}
                    tabIndex={-1}
                    className="model-hero-name"
                  >
                    {visible(model.display_name)}
                  </h1>
                  {model.status !== "MERGED" && (
                    <button
                      ref={more}
                      type="button"
                      className="debt-more"
                      aria-label="Дії з моделлю"
                      aria-haspopup="dialog"
                      disabled={working}
                      onClick={() => {
                        setSheet("ways");
                      }}
                    >
                      <Icon name="tab-more" />
                    </button>
                  )}
                </div>
                {model.status !== "ACTIVE" && (
                  <p className="model-state">
                    <Sticker>{statusText[model.status]}</Sticker>
                  </p>
                )}
                {model.source && (
                  <p className="t-row">
                    {wordLabels.source}: {visible(model.source)}
                  </p>
                )}
                {model.merged_into && (
                  <p className="t-row">
                    Веде до моделі «{visible(model.merged_into.display_name)}».
                  </p>
                )}
                {model.status === "RETIRED" && (
                  <p className="t-meta">
                    Прибрану модель не пропонують у «Прийшов товар» і пошуку; її
                    залишок продають, повертають і списують.
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>
      )}
      {sheet === "ways" && model && (
        <Sheet
          title={visible(model.display_name)}
          close={() => {
            setSheet(null);
          }}
          fallback={more}
        >
          <div className="debt-more-ways">
            <button
              type="button"
              className="sheet-way"
              disabled={working}
              onClick={() => {
                setSheet("rename");
              }}
            >
              Перейменувати
            </button>
            {model.may_merge && (
              <button
                type="button"
                className="sheet-way"
                disabled={working}
                onClick={() => {
                  setSheet(null);
                  setMergeTarget(null);
                  setDone(null);
                  setFailure(null);
                  setMerging(true);
                }}
              >
                Об’єднати з іншою
              </button>
            )}
            {/* Brought back at will: no question asked (P1-2). */}
            <button
              type="button"
              className="sheet-way"
              disabled={working}
              onClick={() => {
                retireOrRestore(model);
              }}
            >
              {model.status === "RETIRED"
                ? "Повернути модель"
                : "Прибрати модель"}
            </button>
          </div>
        </Sheet>
      )}
      {sheet === "rename" && model && (
        <RenameSheet
          key={model.product_variant_id}
          store={store}
          token={token}
          card={model}
          busy={busy}
          blocked={blocked || (pending !== null && !busy)}
          send={send}
          mergeInto={(target) => {
            setSheet(null);
            setMergeTarget(target);
            setMerging(true);
          }}
          close={() => {
            setSheet(null);
          }}
          fallback={more}
        />
      )}
    </>
  );
}
